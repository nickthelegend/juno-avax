/**
 * @juno/sdk — Juno on Avalanche Fuji.
 *
 * Reads the JunoFactory and each JunoPost over plain JSON-RPC (viem), and
 * mirrors the contracts' integer maths so a quote on screen is the number
 * the chain will charge. Every amount is wei (AVAX has 18 decimals); post
 * coins have 0 decimals, so a token amount is a whole number.
 *
 * The returned shapes keep the field names the Juno app was written against
 * on NEAR (`Market`, `Trade`), with times in milliseconds and amounts as
 * decimal strings, so the screens did not have to be rewritten.
 */
import {
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  fallback,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

import { factoryAbi, postAbi } from './abi';

export { factoryAbi, postAbi };
export { gasStationAbi } from './abi';
export * from './gas';

export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const FUJI_EXPLORER = 'https://testnet.snowtrace.io';

export const fuji = defineChain({
  id: FUJI_CHAIN_ID,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC] } },
  blockExplorers: { default: { name: 'Snowtrace', url: FUJI_EXPLORER } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  testnet: true,
});

export const WEI = 10n ** 18n;
export const BASE = 10n ** 12n;
export const BID_ESCROW = 5n * 10n ** 15n; // 0.005 AVAX
export const AUCTION_UNITS = 200n;
export const CURVE_UNITS = 800n;

/* ------------------------------------------------------------------ */
/* Curve maths (mirrors contracts/src/CurveMath.sol)                   */
/* ------------------------------------------------------------------ */

const PRICES = [
  1000000000000n, 1333521432163n, 1778279410038n, 2371373705660n, 3162277660166n, 4216965034282n,
  5623413251898n, 7498942093317n, 9999999999989n, 13335214321618n, 17782794100368n, 23713737056588n,
  31622776601645n, 42169650342806n, 56234132518965n, 74989420933152n, 99999999999875n,
];
const SIZES = [9n, 10n, 13n, 15n, 18n, 22n, 27n, 32n, 39n, 47n, 56n, 67n, 81n, 97n, 117n, 150n];

export function curveCost(sold: bigint, quantity: bigint, roundUp = true): bigint {
  if (quantity <= 0n || sold < 0n || sold + quantity > CURVE_UNITS) throw Error('Quantity');
  const from = sold;
  const to = sold + quantity;
  let start = 0n;
  let total = 0n;
  for (let k = 0; k < 16; k++) {
    if (start >= to) break;
    const end = start + SIZES[k]!;
    if (end > from) {
      const lo = from > start ? from : start;
      const hi = to < end ? to : end;
      const x = hi - lo;
      const a = lo - start;
      const numerator = (PRICES[k + 1]! - PRICES[k]!) * x * (2n * a + x);
      const denominator = 2n * SIZES[k]!;
      total += x * PRICES[k]! + (roundUp ? (numerator + denominator - 1n) / denominator : numerator / denominator);
    }
    start = end;
  }
  return total;
}

/** Price of the next whole token on the curve, in wei. */
export function spotPrice(sold: bigint): bigint {
  return sold >= CURVE_UNITS ? curveCost(CURVE_UNITS - 1n, 1n) : curveCost(sold, 1n);
}

/** Gross of a buy: the highest of the curve, the pro-rata floor and the auction's clearing price. */
export function grossBuy(sold: bigint, quantity: bigint, vault: bigint, supply: bigint, clearing = 0n): bigint {
  let gross = curveCost(sold, quantity);
  const floor = supply === 0n ? 0n : (vault * quantity + supply - 1n) / supply;
  if (floor > gross) gross = floor;
  if (clearing * quantity > gross) gross = clearing * quantity;
  return gross;
}

/** Everything a buy costs: gross + 20% into the floor + 1% fee. */
export function buyQuote(sold: bigint, quantity: bigint, vault = 0n, supply = 0n, clearing = 0n): bigint {
  const gross = grossBuy(sold, quantity, vault, supply, clearing);
  return gross + gross / 5n + gross / 100n;
}

/** What a sell pays after the 1% fee (curve or floor, whichever is higher). */
export function sellQuote(sold: bigint, quantity: bigint, vault: bigint, supply: bigint): bigint {
  if (quantity <= 0n || quantity > sold || supply === 0n) throw Error('SellTooLarge');
  const gross = curveCost(sold - quantity, quantity, false);
  const floorGross = (vault * quantity) / supply;
  const actual = gross < floorGross ? floorGross : gross;
  return actual - actual / 100n;
}

/** What redeeming `quantity` against the floor pays (1% stays for the remaining holders). */
export function redeemQuote(vault: bigint, supply: bigint, quantity: bigint): bigint {
  if (quantity <= 0n || supply === 0n || quantity > supply) return 0n;
  const proRata = (vault * quantity) / supply;
  return proRata - proRata / 100n;
}

export function floorPerToken(vault: bigint, supply: bigint): bigint {
  return supply === 0n ? 0n : vault / supply;
}

/** wei → "1.2345" (fixed decimals, no rounding up). */
export function formatAvax(wei: bigint, precision = 6): string {
  const sign = wei < 0n ? '-' : '';
  const a = wei < 0n ? -wei : wei;
  const scale = 10n ** BigInt(precision);
  const fraction = ((a % WEI) * scale) / WEI;
  return `${sign}${a / WEI}.${fraction.toString().padStart(precision, '0')}`;
}

export function parseAvax(value: string): bigint {
  const clean = value.trim();
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') throw Error('Not an AVAX amount');
  const [whole = '0', frac = ''] = clean.split('.');
  return BigInt(whole || '0') * WEI + BigInt((frac + '0'.repeat(18)).slice(0, 18));
}

/* ------------------------------------------------------------------ */
/* Sealed bids                                                         */
/* ------------------------------------------------------------------ */

/** The commitment JunoPost.commitmentOf computes: bound to the post, the chain and the bidder. */
export function commitment(post: Address, chainId: number, bidder: Address, amount: bigint, maxPrice: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      ['juno:v1', post, BigInt(chainId), bidder, amount, maxPrice, salt],
    ),
  );
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type Phase = 'commit' | 'reveal' | 'settle' | 'curve' | 'graduated';
const PHASES: Phase[] = ['commit', 'reveal', 'settle', 'curve', 'graduated'];
const KINDS = ['auction', 'buy', 'sell', 'redeem'] as const;

export type Market = {
  slug: string;
  creator: string;
  caption: string;
  media_url: string;
  phase: Phase;
  opened_ms: number;
  commit_end_ms: number;
  reveal_end_ms: number;
  dare_end_ms: number;
  sealed_bid_count: number;
  revealed_bid_count: number;
  clearing_price: string;
  total_supply: string;
  curve_sold: string;
  floor_vault: string;
  floor_per_token: string;
  curve_reserve: string;
  graduation_escrow: string;
  creator_earnings: string;
  spot_price: string;
  graduated: boolean;
  dare: string;
  dare_bond: string;
  proof: string;
  dare_finalized: boolean;
  dare_accepted: boolean;
  votes_yes: string;
  votes_no: string;
  trade_count: number;
};

export type Trade = { ms: number; kind: (typeof KINDS)[number]; account: string; quantity: string; total: string; sold_after: string };

export type BidView = {
  exists: boolean;
  revealed: boolean;
  amount: number;
  allocated: number;
  maxPrice: bigint;
  commitment: Hex;
  refund: bigint;
};

/** Public Fuji RPCs for servers and scripts: publicnode first (the official endpoint rate-limits busy IPs). */
export const FUJI_RPCS = ['https://avalanche-fuji-c-chain-rpc.publicnode.com', FUJI_RPC];

/** A fallback transport over the public Fuji RPCs (for wallet clients that send). */
export function fujiTransport(rpcs: string[] = FUJI_RPCS) {
  return fallback(rpcs.map((url) => http(url, { timeout: 12_000, retryCount: 2 })));
}

export function client(rpcs: string[] = [FUJI_RPC]): PublicClient {
  return createPublicClient({
    chain: fuji,
    // The public Fuji endpoint answers HTTP 500 to a JSON-RPC batch of ~64+ calls; keep batches at 32.
    transport: fallback(rpcs.map((url) => http(url, { batch: { wait: 16, batchSize: 32 }, timeout: 12_000, retryCount: 2 }))),
    pollingInterval: 250,
  }) as PublicClient;
}

export async function posts(c: PublicClient, factory: Address): Promise<Address[]> {
  return [...(await c.readContract({ address: factory, abi: factoryAbi, functionName: 'posts' }))];
}

export async function market(c: PublicClient, post: Address): Promise<Market> {
  const v = await c.readContract({ address: post, abi: postAbi, functionName: 'market' });
  return {
    slug: v.slug,
    creator: v.creator,
    caption: v.caption,
    media_url: v.mediaUrl,
    phase: PHASES[v.phase] ?? 'curve',
    opened_ms: Number(v.openedAt) * 1000,
    commit_end_ms: Number(v.commitEnd) * 1000,
    reveal_end_ms: Number(v.revealEnd) * 1000,
    dare_end_ms: Number(v.dareEnd) * 1000,
    sealed_bid_count: Number(v.sealedBids),
    revealed_bid_count: Number(v.revealedBids),
    clearing_price: v.clearingPrice.toString(),
    total_supply: v.totalSupply.toString(),
    curve_sold: v.curveSold.toString(),
    floor_vault: v.floorVault.toString(),
    floor_per_token: v.floorPerToken.toString(),
    curve_reserve: v.curveReserve.toString(),
    graduation_escrow: v.graduationEscrow.toString(),
    creator_earnings: v.creatorEarnings.toString(),
    spot_price: v.spotPrice.toString(),
    graduated: v.graduated,
    dare: v.dare,
    dare_bond: v.dareBond.toString(),
    proof: v.proof,
    dare_finalized: v.dareFinalized,
    dare_accepted: v.dareAccepted,
    votes_yes: v.votesYes.toString(),
    votes_no: v.votesNo.toString(),
    trade_count: Number(v.tradeCount),
  };
}

export async function trades(c: PublicClient, post: Address): Promise<Trade[]> {
  const list = await c.readContract({ address: post, abi: postAbi, functionName: 'trades' });
  return list.map((t) => ({
    ms: Number(t.time) * 1000,
    kind: KINDS[t.kind] ?? 'buy',
    account: t.account,
    quantity: String(t.quantity),
    total: t.total.toString(),
    sold_after: String(t.soldAfter),
  }));
}

/** Holders, largest first. */
export async function holders(c: PublicClient, post: Address): Promise<Array<[string, string]>> {
  const [accounts, balances] = await c.readContract({ address: post, abi: postAbi, functionName: 'holders' });
  return accounts
    .map((a, i) => [a, balances[i]!.toString()] as [string, string])
    .sort((x, y) => (BigInt(y[1]) > BigInt(x[1]) ? 1 : BigInt(y[1]) < BigInt(x[1]) ? -1 : 0));
}

export async function balanceOf(c: PublicClient, post: Address, account: Address): Promise<bigint> {
  return c.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [account] });
}

export async function quoteBuy(c: PublicClient, post: Address, quantity: bigint): Promise<bigint> {
  const [total] = await c.readContract({ address: post, abi: postAbi, functionName: 'quoteBuy', args: [quantity] });
  return total;
}

export async function bidOf(c: PublicClient, post: Address, bidder: Address): Promise<BidView> {
  const [exists, b] = await c.readContract({ address: post, abi: postAbi, functionName: 'bidOf', args: [bidder] });
  return { exists, revealed: b.revealed, amount: Number(b.amount), allocated: Number(b.allocated), maxPrice: b.maxPrice, commitment: b.commitment, refund: b.refund };
}

export async function voteOf(c: PublicClient, post: Address, voter: Address): Promise<0 | 1 | 2> {
  return (await c.readContract({ address: post, abi: postAbi, functionName: 'voteOf', args: [voter] })) as 0 | 1 | 2;
}

export async function accountBalance(c: PublicClient, account: Address): Promise<bigint> {
  return c.getBalance({ address: account });
}
