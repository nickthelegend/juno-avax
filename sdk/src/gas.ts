/**
 * Zero-setup start (v2.1). A brand-new wallet signs a request; Juno's API relays it to JunoGasStation on Fuji, which
 * checks the signature, pays 0.008 AVAX once (enough for one sealed bid and a few trades), and keeps the daily and
 * per-requester caps on-chain. The digest here must match JunoGasStation.digest (tested against the deployed contract).
 */
import { encodePacked, keccak256, type Address, type Hex } from 'viem';

/** Juno's API (Vercel serverless): the gas sponsor and Juno AI. Apps may override it with EXPO_PUBLIC_JUNO_API. */
export const JUNO_API = 'https://juno-avax-api.vercel.app';
export const GAS_STATION: Address = '0x45fdcdf64f6fa312b02b98ad248461c6a02e722a';

export function gasDigest(station: Address, to: Address, deadline: bigint, chainId = 43113n): Hex {
  return keccak256(encodePacked(['string', 'uint256', 'address', 'address', 'uint256'], ['Juno gas', chainId, station, to, deadline]));
}

export type GasRequest = { address: Address; deadline: string; signature: Hex };
export type GasResult =
  | { ok: true; hash: Hex; amount: string; left: { today: number; funded: number } }
  | { ok: false; error: string; setup?: boolean; status: number };

/** Signs and sends a gas request. `sign` signs the raw 32-byte digest (EIP-191 personal_sign of the bytes). */
export async function requestGas(opts: { api?: string; station?: Address; address: Address; now: bigint; sign: (raw: Hex) => Promise<Hex> }): Promise<GasResult> {
  const deadline = opts.now + 600n;
  const signature = await opts.sign(gasDigest(opts.station ?? GAS_STATION, opts.address, deadline));
  let r: Response;
  try {
    r = await fetch(`${opts.api ?? JUNO_API}/api/gas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: opts.address, deadline: deadline.toString(), signature } satisfies GasRequest),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Juno's gas sponsor did not answer (${(e as Error).message}).` };
  }
  const body = (await r.json().catch(() => ({ error: `Juno's gas sponsor answered ${r.status}` }))) as Record<string, any>;
  if (!r.ok || !body.hash) return { ok: false, status: r.status, error: body.error ?? `Juno's gas sponsor answered ${r.status}`, setup: !!body.setup };
  return { ok: true, hash: body.hash, amount: body.amount, left: body.left };
}
