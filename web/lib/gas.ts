/**
 * Free test AVAX in one tap. The connected wallet signs a request (not a transaction); Juno's API relays it to
 * JunoGasStation on Fuji, which pays 0.008 AVAX once to a brand-new, empty wallet, with daily caps kept on-chain.
 */
import type { Address, Hex } from "viem";
import { GAS_STATION, gasStationAbi, JUNO_API, requestGas } from "@juno/sdk";

import { fujiClient } from "./api";

export const API = (process.env.EXPO_PUBLIC_JUNO_API as string | undefined) || JUNO_API;
export const STATION = GAS_STATION;

export class SetupError extends Error {}

/** Whether this account can still get Juno's starter AVAX (never dripped and empty). */
export async function canGetGas(address: Address): Promise<boolean> {
  const client = fujiClient();
  const [dripped, balance] = await Promise.all([
    client.readContract({ address: STATION, abi: gasStationAbi, functionName: "dripped", args: [address] }),
    client.getBalance({ address }),
  ]);
  return !dripped && balance === 0n;
}

export async function getGas(address: Address, signRaw: (raw: Hex) => Promise<Hex>): Promise<{ hash: Hex; amount: string }> {
  const client = fujiClient();
  const block = await client.getBlock({ blockTag: "latest" });
  const r = await requestGas({ api: API, station: STATION, address, now: block.timestamp, sign: signRaw });
  if (!r.ok) throw r.setup ? new SetupError(r.error) : new Error(r.error);
  for (let i = 0; i < 30; i++) {
    if ((await client.getBalance({ address })) > 0n) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { hash: r.hash, amount: r.amount };
}
