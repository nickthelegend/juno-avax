import {
  accountBalance,
  balanceOf,
  client,
  grossBuy,
  curveCost,
  formatAvax,
  holders as readHolders,
  market as readMarket,
  posts as readPosts,
  quoteBuy,
  redeemQuote,
  sellQuote,
  spotPrice,
  trades as readTrades,
  WEI,
  type Market,
  type Trade,
} from "@juno/sdk";
import { decodeEventLog, type Address, type PublicClient } from "viem";
import { factoryAbi } from "@juno/sdk";
import { Platform } from "react-native";

import { explorer, FACTORY, RPC_URLS, sameAddress } from "./chain";
import { DEPLOYMENT } from "./deployment";
import { portfolioHistory, positionAccounting } from "./accounting";

/**
 * The Juno client, on Avalanche Fuji.
 *
 * Every figure here is read from the Fuji C-Chain through `@juno/sdk`: the
 * JunoFactory lists the posts, and each post's own contract answers
 * `market`, `trades` and `holders`. There is no Juno server and no indexer.
 * A transaction is one contract call on the post (or the factory, for a
 * launch), signed by the person's own wallet (`lib/wallet`).
 *
 * Amounts: one post token is one whole unit (the coin has 0 decimals,
 * 1,000 per post: 200 in the opening auction, 800 on the curve). AVAX
 * figures are numbers of AVAX, converted from wei once, here.
 */

export class ApiError extends Error {
  readonly status: number;
  timedOut = false;
  body: unknown = null;
  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** The hosted web app, which serves the seeded posts' art to the native app. */
export const HOSTED_APP_URL = "https://juno-avax.vercel.app";

/** Where relative media paths (the seeded posts' art) resolve: this page's origin on web, the hosted app on a phone. */
export const APP_URL =
  process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : HOSTED_APP_URL);

/** Kept for the share link and anything that names the app's own origin. */
export const API_URL = APP_URL;

function requireFactory(): Address {
  if (!FACTORY) throw new ApiError("Setup required: EXPO_PUBLIC_JUNO_FACTORY", 503);
  return FACTORY;
}

/** One shared read client over the public Fuji RPCs (JSON-RPC batched). */
let reader: PublicClient | null = null;
export function fujiClient(): PublicClient {
  reader ??= client(RPC_URLS);
  return reader;
}

/** wei → AVAX, as a number for display. Exact amounts stay as bigint in the SDK. */
export function avax(wei: bigint | string | number): number {
  const value = typeof wei === "bigint" ? wei : BigInt(wei);
  return Number(formatAvax(value, 12));
}

export function toWei(amount: number): bigint {
  const [whole = "0", frac = ""] = amount.toFixed(18).split(".");
  return BigInt(whole) * WEI + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

async function guard<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const text = error instanceof Error ? error.message : String(error);
    if (/returned no data|is not a contract|does not have the function|reverted/i.test(text)) throw new ApiError("Not a Juno post on Avalanche Fuji", 404);
    if (/429|rate/i.test(text)) throw new ApiError("The Fuji RPC is rate limiting. Try again in a moment.", 429);
    if (/fetch|network|Failed|timed out|HTTP request/i.test(text)) throw new ApiError("Avalanche Fuji can't be reached right now. Check your connection and try again.", 0);
    throw new ApiError(text.slice(0, 200), 500);
  }
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type CurveState = {
  progress: number;
  raisedUsd: number;
  thresholdUsd: number;
  raisedQuote?: number;
  thresholdQuote?: number;
  graduated: boolean;
};

export type QuoteAsset = { address: null; symbol: "AVAX"; decimals: 18 };

/** A post's on-chain state beyond price: its opening auction, floor and dare. */
export type OnchainState = {
  phase: Market["phase"];
  openedMs: number;
  commitEndMs: number;
  revealEndMs: number;
  dareEndMs: number;
  sealedBids: number;
  revealedBids: number;
  /** AVAX per token the auction cleared at; 0 before settlement. */
  clearingPrice: number;
  /** AVAX held for holders, and what each token can redeem against it. */
  floorVault: number;
  floorPerToken: number;
  totalSupply: number;
  curveSold: number;
  curveReserve: number;
  graduationEscrow: number;
  dare: string;
  dareBond: number;
  proof: string;
  dareFinalized: boolean;
  dareAccepted: boolean;
  votesYes: number;
  votesNo: number;
  /** Exact wei strings, for quotes. */
  raw: Market;
};

export type Coin = {
  /** The post's contract, which is also its ERC-20 coin. */
  address: string;
  format: "post" | "reel";
  name: string;
  symbol: string;
  description?: string;
  media: { kind: "image" | "video"; url: string; posterUrl?: string; width: number; height: number };
  creator: { handle: string; displayName: string; avatarUrl: string; wallet: string };
  createdAt: string;
  pool: string;
  chainId: number;
  quote: QuoteAsset;
  /** Graduation moves everything raised into the post's floor; this is its explorer page. */
  graduatedPool?: string | null;
  /** No USD feed: prices are in AVAX. Always null. */
  quoteUsdRate: number | null;
  marketCap: number;
  marketCapQuote?: number;
  marketCapCurrency: string;
  marketCapChangePct: number | null;
  volume24h: number | null;
  volume24hQuote?: number | null;
  totalVolume: number | null;
  totalVolumeQuote?: number | null;
  creatorRewards: number;
  creatorFeesQuote?: number;
  holders: number | null;
  /** AVAX per token (named for the shape the screens were written against). */
  priceUsd: number;
  priceQuote?: number;
  graduation?: { txHash: string | null; timestamp: string } | null;
  priceHistory?: Array<{ t: string; price: number; volume: number; side: "buy" | "sell" }>;
  priceHistoryPartial?: boolean;
  curve: CurveState;
  curvePreset: string;
  likes?: number;
  commentCount?: number;
  viewerLiked?: boolean | null;
  onchain: OnchainState;
};

export type Activity = {
  id: string;
  side: "buy" | "sell";
  /** What the contract recorded: an auction fill, a curve buy or sell, or a floor redemption. */
  kind: Trade["kind"];
  actor: { handle: string; avatarUrl: string };
  wallet: string;
  amount: number;
  valueUsd: number;
  valueQuote?: number;
  timestamp: string;
  txHash?: string;
};

export type Holder = {
  rank: number;
  actor: { handle: string; avatarUrl: string };
  wallet: string;
  balance: number;
  share: number;
};

export type FeedItem = {
  kind: "trade";
  /** What the contract recorded for this fill. */
  fill: Trade["kind"];
  id: string;
  timestamp: string;
  side: "buy" | "sell";
  amount: number;
  valueUsd: number;
  price: number;
  priceNow: number | null;
  currency: string;
  note: string | null;
  actor: { wallet: string; handle: string; avatarUrl: string };
  coin: { address: string; name: string; symbol: string; mediaUrl: string | null; mediaKind: string; posterUrl: string | null };
};

export type PositionTrade = { t: string; side: "buy" | "sell"; base: number; price: number };

export type Position = {
  baseMint: string;
  poolAddress: string;
  name: string;
  symbol: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  curvePreset: string;
  balance: number;
  price: number;
  value: number;
  averageCost: number | null;
  unrealisedPnl: number | null;
  unrealisedPnlPct: number | null;
  realisedPnl: number | null;
  currency: string;
  graduated: boolean;
  trades: PositionTrade[];
  /** What this many tokens redeem against the floor right now. */
  floorValue: number;
  partial: boolean;
};

export type Portfolio = {
  wallet: string;
  positions: Position[];
  missing: number;
  totalValue: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
  currency: string;
  partial: boolean;
  history: Array<{ t: string; value: number }>;
};

export type Crowd = {
  currency: string;
  quoteUsdRate: number;
  traders: number;
  holdersStill: number;
  firstBuyer: { wallet: string; price: number; timestamp: string; multiple: number | null } | null;
  biggestBuy: number | null;
  partial: boolean;
};

export type DepthPoint = {
  amountIn: number;
  amountOut: number;
  averagePrice: number;
  priceImpact: number;
  curveImpact: number;
  fee: number;
  allowed?: boolean;
};

/** One contract call, for the wallet to sign and send. */
export type TxStep = {
  label: string;
  to: Address;
  abi: "post" | "factory" | "eerc" | "registrar" | "media";
  functionName: string;
  args: readonly unknown[];
  /** wei, decimal string. */
  value: string;
  /** Worked out just before this step is signed (a buy after a settle in the same flow). */
  resolveValue?: () => Promise<bigint>;
};

export type SwapQuote = {
  side: "buy" | "sell" | "redeem";
  /** Tokens for a buy, AVAX for a sell or redeem. */
  amountOut: number;
  /** AVAX a buy costs (fees and floor share included). */
  amountIn: number;
  fee: number;
  /** AVAX a buy adds to the redeemable floor (20% of the base price). */
  toFloor: number;
  priceImpact: number;
  /** Paid from the floor rather than the curve (the floor is higher). */
  fromFloor: boolean;
  /** What set the price: the curve, the floor, or (for a buy) the auction's clearing price. */
  pricedBy: "curve" | "floor" | "auction";
};

export type SwapBuild = { steps: TxStep[]; quote: SwapQuote };

export type Balances = {
  avax: number | null;
  /** One post token's balance, when asked for with `token`. */
  token: number | null;
};

export type Trader = {
  wallet: string;
  realised: number | null;
  unrealised: number | null;
  trades: number;
  coins: number;
  winRate: number | null;
  bestExit: number | null;
  holding: number;
  isCreator: boolean;
  followers: number;
};


/* ------------------------------------------------------------------ */
/* Reading a post                                                      */
/* ------------------------------------------------------------------ */

type Raw = { account: Address; market: Market; trades: Trade[]; holders: Array<[string, string]> };

const ART_EXT = /\.(mp4|webm|mov)(\?|$)/i;
const FULL_CURVE = avax(curveCost(0n, 800n));

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** Gross AVAX per token of one fill: the price the curve (or floor) charged, before fee and floor share. */
function fillPrice(trade: Trade): number | null {
  const quantity = Number(trade.quantity);
  if (!quantity) return null;
  const total = BigInt(trade.total);
  if (trade.kind === "auction") return avax(total) / quantity;
  if (trade.kind === "buy") return avax((total * 100n) / 121n) / quantity;
  if (trade.kind === "sell") return avax((total * 100n) / 99n) / quantity;
  return null;
}

/** What one more token costs now: the curve's marginal price, or the floor if that is higher. */
/**
 * What one more token costs now, before the floor share and fee. On an open
 * curve the contract answers this itself (`spotPrice`: the highest of the
 * curve, the floor and the auction's clearing price). Before settlement it is
 * the curve's first price; once graduated, the last price the curve charged.
 */
function priceNow(m: Market): number {
  if (m.phase === "curve") return avax(m.spot_price);
  if (m.phase === "graduated") return avax(spotPrice(BigInt(m.curve_sold)));
  return avax(spotPrice(0n));
}

function toCoin({ account, market: m, trades, holders }: Raw): Coin {
  const createdMs = m.opened_ms;
  const price = priceNow(m);
  const supply = Number(m.total_supply);
  const history = trades
    .map((trade) => ({ trade, price: fillPrice(trade) }))
    .filter((row): row is { trade: Trade; price: number } => row.price !== null)
    .map(({ trade, price: p }) => ({
      t: new Date(trade.ms).toISOString(),
      price: p,
      volume: avax(trade.total),
      side: (trade.kind === "sell" ? "sell" : "buy") as "buy" | "sell",
    }));
  const dayAgo = Date.now() - 86_400_000;
  const reference = history.find((point) => Date.parse(point.t) >= dayAgo) ?? history[0];
  const change = reference && reference.price > 0 && history.length > 0 ? ((price - reference.price) / reference.price) * 100 : null;
  const volume = trades.filter((t) => t.kind !== "redeem").reduce((sum, t) => sum + avax(t.total), 0);
  const volume24 = trades
    .filter((t) => t.kind !== "redeem" && t.ms >= dayAgo)
    .reduce((sum, t) => sum + avax(t.total), 0);
  const video = ART_EXT.test(m.media_url);
  const marketCap = price * supply;
  const graduatedAt = m.graduated ? [...trades].reverse().find((t) => t.kind === "buy" && t.sold_after === "800") : undefined;

  return {
    address: account,
    format: video ? "reel" : "post",
    name: titleCase(m.slug),
    symbol: m.slug.toUpperCase(),
    description: m.caption || undefined,
    media: { kind: video ? "video" : "image", url: m.media_url, width: 1, height: 1 },
    creator: { handle: m.creator, displayName: m.creator, avatarUrl: "", wallet: m.creator },
    createdAt: new Date(createdMs).toISOString(),
    pool: account,
    chainId: 43113,
    quote: { address: null, symbol: "AVAX", decimals: 18 },
    graduatedPool: m.graduated ? account : null,
    quoteUsdRate: null,
    marketCap,
    marketCapQuote: marketCap,
    marketCapCurrency: "AVAX",
    marketCapChangePct: change === null || !Number.isFinite(change) ? null : change,
    volume24h: volume24,
    volume24hQuote: volume24,
    totalVolume: volume,
    totalVolumeQuote: volume,
    creatorRewards: avax(m.creator_earnings),
    creatorFeesQuote: avax(m.creator_earnings),
    holders: holders.length,
    priceUsd: price,
    priceQuote: price,
    graduation: m.graduated ? { txHash: null, timestamp: new Date(graduatedAt?.ms ?? Date.now()).toISOString() } : null,
    priceHistory: history,
    priceHistoryPartial: trades.length >= 120,
    curve: {
      progress: Number(m.curve_sold) / 800,
      raisedUsd: avax(m.curve_reserve),
      thresholdUsd: FULL_CURVE,
      raisedQuote: avax(m.curve_reserve),
      thresholdQuote: FULL_CURVE,
      graduated: m.graduated,
    },
    curvePreset: "sealed-bid",
    onchain: {
      phase: m.phase,
      openedMs: m.opened_ms,
      commitEndMs: m.commit_end_ms,
      revealEndMs: m.reveal_end_ms,
      dareEndMs: m.dare_end_ms,
      sealedBids: m.sealed_bid_count,
      revealedBids: m.revealed_bid_count,
      clearingPrice: avax(m.clearing_price),
      floorVault: avax(m.floor_vault),
      floorPerToken: avax(m.floor_per_token),
      totalSupply: supply,
      curveSold: Number(m.curve_sold),
      curveReserve: avax(m.curve_reserve),
      graduationEscrow: avax(m.graduation_escrow),
      dare: m.dare,
      dareBond: avax(m.dare_bond),
      proof: m.proof,
      dareFinalized: m.dare_finalized,
      dareAccepted: m.dare_accepted,
      votesYes: Number(m.votes_yes),
      votesNo: Number(m.votes_no),
      raw: m,
    },
  };
}

/**
 * A read that a public RPC dropped (a throttled burst, a reset connection) is
 * worth two quiet retries before the screen says it failed. Only reads. The
 * viem transport already falls back across RPC_URLS.
 */
async function retry<T>(read: (c: PublicClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read(fujiClient());
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || /returned no data|reverted|is not a contract/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

async function readOne(account: string): Promise<Raw> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new ApiError("Not a Juno post on Avalanche Fuji", 404);
  const address = account as Address;
  const [m, t, h] = await Promise.all([
    retry((c) => readMarket(c, address)),
    retry((c) => readTrades(c, address)),
    retry((c) => readHolders(c, address)),
  ]);
  return { account: address, market: m, trades: t, holders: h };
}

/** Every post, read once and shared for a few seconds between screens. */
let shared: { at: number; value: Promise<Raw[]> } | null = null;
async function readAll(fresh = false): Promise<Raw[]> {
  if (!fresh && shared && Date.now() - shared.at < 15_000) return shared.value;
  const value = (async () => {
    const factory = requireFactory();
    const accounts = await guard(retry((c) => readPosts(c, factory)));
    // Portfolio and rankings must not turn failed market reads into empty wallets.
    return guard(Promise.all(accounts.map((account) => readOne(account))));
  })();
  shared = { at: Date.now(), value };
  value.catch(() => {
    if (shared?.value === value) shared = null;
  });
  return value;
}

export function invalidateReads() {
  shared = null;
}

function activityOf(raw: Raw): Activity[] {
  return [...raw.trades].reverse().map((trade, i) => ({
    id: `${raw.account}:${trade.ms}:${i}`,
    side: trade.kind === "sell" || trade.kind === "redeem" ? "sell" : "buy",
    kind: trade.kind,
    actor: { handle: trade.account, avatarUrl: "" },
    wallet: trade.account,
    amount: Number(trade.quantity),
    valueUsd: avax(trade.total),
    valueQuote: avax(trade.total),
    timestamp: new Date(trade.ms).toISOString(),
  }));
}

function holdersOf(raw: Raw): Holder[] {
  const total = raw.holders.reduce((sum, [, b]) => sum + Number(b), 0) || 1;
  return raw.holders.map(([wallet, balance], i) => ({
    rank: i + 1,
    actor: { handle: wallet, avatarUrl: "" },
    wallet,
    balance: Number(balance),
    share: Number(balance) / total,
  }));
}

function crowdOf(raw: Raw, coin: Coin): Crowd | null {
  const buys = raw.trades.filter((t) => t.kind === "buy" || t.kind === "auction");
  const traders = new Set(raw.trades.map((t) => t.account));
  const first = buys[0];
  const firstPrice = first ? fillPrice(first) : null;
  return {
    currency: "AVAX",
    quoteUsdRate: 0,
    traders: traders.size,
    holdersStill: raw.holders.filter(([wallet]) => traders.has(wallet)).length,
    firstBuyer:
      first && firstPrice
        ? {
            wallet: first.account,
            price: firstPrice,
            timestamp: new Date(first.ms).toISOString(),
            multiple: coin.priceQuote && firstPrice > 0 ? coin.priceQuote / firstPrice : null,
          }
        : null,
    biggestBuy: buys.length ? Math.max(...buys.map((t) => avax(t.total))) : null,
    partial: raw.trades.length >= 120,
  };
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

function quoteFor(coin: Coin, side: "buy" | "sell" | "redeem", quantity: number): SwapQuote {
  const m = coin.onchain.raw;
  const q = BigInt(Math.floor(quantity));
  const sold = BigInt(m.curve_sold);
  const vault = BigInt(m.floor_vault);
  const supply = BigInt(m.total_supply);
  const spot = coin.priceQuote ?? 0;
  if (side === "buy") {
    const gross = grossBuy(sold, q, vault, supply, BigInt(m.clearing_price));
    const total = gross + gross / 5n + gross / 100n;
    const floorPart = supply === 0n ? 0n : (vault * q + supply - 1n) / supply;
    const pricedBy: SwapQuote["pricedBy"] = gross === curveCost(sold, q) ? "curve" : gross === floorPart ? "floor" : "auction";
    const curveGross = curveCost(sold, q);
    const average = avax(gross) / quantity;
    return {
      side,
      amountOut: quantity,
      amountIn: avax(total),
      fee: avax(gross / 100n),
      toFloor: avax(gross / 5n),
      priceImpact: spot > 0 ? Math.max(0, average / spot - 1) : 0,
      fromFloor: gross > curveGross,
      pricedBy,
    };
  }
  if (side === "sell") {
    const out = sellQuote(sold, q, vault, supply);
    const curveOut = curveCost(sold - q, q, false);
    const gross = (out * 100n) / 99n;
    const average = avax(gross) / quantity;
    return {
      side,
      amountOut: avax(out),
      amountIn: 0,
      fee: avax(gross / 100n),
      toFloor: 0,
      priceImpact: spot > 0 ? Math.max(0, 1 - average / spot) : 0,
      fromFloor: gross > curveOut,
      pricedBy: gross > curveOut ? "floor" : "curve",
    };
  }
  const out = redeemQuote(vault, supply, q);
  return { side, amountOut: avax(out), amountIn: 0, fee: avax(out / 99n), toFloor: 0, priceImpact: 0, fromFloor: true, pricedBy: "floor" };
}

/* ------------------------------------------------------------------ */
/* Device-local social state                                           */
/* ------------------------------------------------------------------ */

/**
 * Likes and follows have no contract behind them, so they are kept on
 * this device only and never shown as anyone else's. A count is the viewer's
 * own like and nothing more.
 */
const memory = new Map<string, string>();
function local(key: string): string | null {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") return localStorage.getItem(`juno:${key}`);
  } catch {
    /* storage refused */
  }
  return memory.get(key) ?? null;
}
function setLocal(key: string, value: string) {
  memory.set(key, value);
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") localStorage.setItem(`juno:${key}`, value);
  } catch {
    /* storage refused */
  }
}
function localSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(local(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/* ------------------------------------------------------------------ */
/* The client                                                          */
/* ------------------------------------------------------------------ */

export const juno = {
  /** Every post on the factory, as markets. `missing` counts posts whose read failed. */
  coins: async (_limit?: number, opts: { viewer?: string | null; fresh?: boolean } = {}) => {
    const raws = await readAll(opts.fresh);
    const accounts = raws.map((raw) => raw.account);
    const liked = localSet(`likes:${opts.viewer ?? "anon"}`);
    const coins = raws.map((raw) => {
      const coin = toCoin(raw);
      coin.viewerLiked = liked.has(coin.address);
      coin.likes = liked.has(coin.address) ? 1 : 0;
      return coin;
    });
    return { coins, missing: Math.max(0, accounts.length - raws.length) };
  },

  /** One post with its fills, holders and crowd. */
  coin: async (token: string) => {
    const raw = await guard(readOne(token));
    const coin = toCoin(raw);
    return {
      coin,
      activity: activityOf(raw),
      activityPartial: raw.trades.length >= 120,
      holders: holdersOf(raw),
      holdersUnreadable: false,
      crowd: crowdOf(raw, coin),
      launchTxHash: null as string | null,
    };
  },

  /** The newest fills across every post, for "Bought by". */
  feed: async (limit = 60) => {
    const raws = await readAll();
    const items: FeedItem[] = raws
      .flatMap((raw) => {
        const coin = toCoin(raw);
        return raw.trades.map((trade, i) => ({
          kind: "trade" as const,
          fill: trade.kind,
          id: `${raw.account}:${trade.ms}:${i}`,
          timestamp: new Date(trade.ms).toISOString(),
          side: (trade.kind === "sell" || trade.kind === "redeem" ? "sell" : "buy") as "buy" | "sell",
          amount: Number(trade.quantity),
          valueUsd: avax(trade.total),
          price: fillPrice(trade) ?? 0,
          priceNow: coin.priceQuote ?? null,
          currency: "AVAX",
          note: null,
          actor: { wallet: trade.account, handle: trade.account, avatarUrl: "" },
          coin: { address: coin.address, name: coin.name, symbol: coin.symbol, mediaUrl: coin.media.url, mediaKind: coin.media.kind, posterUrl: null },
        }));
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit);
    return { items };
  },

  /** What a buy or sell of each size does to the price, computed from the same curve maths as the contract. */
  depth: async (mint: string, side: "buy" | "sell" = "buy", impact?: number) => {
    const { coin } = await juno.coin(mint);
    const room = side === "buy" ? 800 - coin.onchain.curveSold : coin.onchain.curveSold;
    const sizes = [1, 5, 10, 25, 50, 100, 200, 400, 800].filter((n) => n <= room);
    const points: DepthPoint[] = sizes.map((n) => {
      const q = quoteFor(coin, side, n);
      return {
        amountIn: side === "buy" ? q.amountIn : n,
        amountOut: side === "buy" ? n : q.amountOut,
        averagePrice: side === "buy" ? q.amountIn / n : q.amountOut / n,
        priceImpact: q.priceImpact,
        curveImpact: q.priceImpact,
        fee: q.fee,
        allowed: coin.onchain.phase === "curve",
      };
    });
    const budget = impact ?? 0.01;
    const within = points.filter((p) => p.curveImpact <= budget);
    const best = within[within.length - 1];
    return {
      side,
      quoteUsdRate: null as number | null,
      points,
      suggestion: best
        ? { amountIn: side === "buy" ? best.amountOut : best.amountIn, curveImpact: best.curveImpact, ceilingReached: within.length === points.length }
        : null,
    };
  },

  /** Every post this account holds, priced at the curve and at the floor. */
  portfolio: async (wallet: string): Promise<Portfolio> => {
    const raws = await readAll();
    const positions: Position[] = [];
    for (const raw of raws) {
      const held = raw.holders.find(([account]) => sameAddress(account, wallet));
      const mine = raw.trades.filter((t) => sameAddress(t.account, wallet));
      if (!held && mine.length === 0) continue;
      const coin = toCoin(raw);
      const balance = held ? Number(held[1]) : 0;
      const price = coin.priceQuote ?? 0;
      const value = balance * price;
      const accounting = positionAccounting(mine, balance, price, raw.trades.length >= 120);
      positions.push({
        baseMint: coin.address,
        poolAddress: coin.address,
        name: coin.name,
        symbol: coin.symbol,
        mediaUrl: coin.media.url,
        mediaMime: null,
        curvePreset: coin.curvePreset,
        balance,
        price,
        value,
        averageCost: accounting.averageCost,
        unrealisedPnl: accounting.unrealised,
        unrealisedPnlPct: accounting.unrealisedPct,
        realisedPnl: accounting.realised,
        currency: "AVAX",
        graduated: coin.curve.graduated,
        trades: mine.map((t) => ({ t: new Date(t.ms).toISOString(), side: t.kind === "sell" || t.kind === "redeem" ? "sell" : "buy", base: Number(t.quantity), price: fillPrice(t) ?? 0 })),
        floorValue: avax(redeemQuote(BigInt(raw.market.floor_vault), BigInt(raw.market.total_supply), BigInt(balance))),
        partial: raw.trades.length >= 120,
      });
    }
    const held = positions.filter((p) => p.balance > 0);
    const totalValue = held.reduce((s, p) => s + p.value, 0);
    const totalPnl = positions.some((p) => p.realisedPnl === null || p.unrealisedPnl === null)
      ? null
      : positions.reduce((s, p) => s + p.realisedPnl! + p.unrealisedPnl!, 0);
    const cost = held.reduce((s, p) => s + (p.averageCost ?? 0) * p.balance, 0);
    return {
      wallet,
      positions,
      missing: 0,
      totalValue,
      totalPnl,
      totalPnlPct: cost > 0 && totalPnl !== null ? totalPnl / cost : null,
      currency: "AVAX",
      partial: positions.some((p) => p.partial),
      history: positions.some((p) => p.realisedPnl === null || p.partial) ? [] : [
        ...portfolioHistory(raws.flatMap((raw) => raw.trades.map((trade) => ({
          market: raw.account, account: trade.account, ms: trade.ms, kind: trade.kind,
          quantity: Number(trade.quantity), price: fillPrice(trade),
        }))), wallet),
        ...(positions.length ? [{ t: new Date().toISOString(), value: totalValue }] : []),
      ],
    };
  },

  /** Traders ranked by realised AVAX profit, with open cost shown separately. Gas is excluded. */
  leaderboard: async (limit = 20) => {
    const raws = await readAll();
    const creators = new Set(raws.map((raw) => raw.market.creator));
    const rows = new Map<string, Trader>();
    const exits = new Map<string, number[]>();
    for (const raw of raws) {
      const coin = toCoin(raw);
      const accounts = new Set([...raw.trades.map((t) => t.account), ...raw.holders.map(([id]) => id)]);
      for (const account of accounts) {
        const mine = raw.trades.filter((t) => sameAddress(t.account, account));
        const balance = Number(raw.holders.find(([id]) => sameAddress(id, account))?.[1] ?? 0);
        const accounting = positionAccounting(mine, balance, coin.priceQuote ?? 0, raw.trades.length >= 120);
        const row = rows.get(account) ?? {
          wallet: account, realised: 0, unrealised: 0, trades: 0, coins: 0, winRate: null, bestExit: null, holding: 0,
          isCreator: creators.has(account), followers: 0,
        };
        row.trades += mine.length;
        row.coins += 1;
        row.holding += balance * (coin.priceQuote ?? 0);
        row.realised = row.realised === null || accounting.realised === null ? null : row.realised + accounting.realised;
        row.unrealised = row.unrealised === null || accounting.unrealised === null ? null : row.unrealised + accounting.unrealised;
        if (accounting.exits) exits.set(account, [...(exits.get(account) ?? []), ...accounting.exits]);
        rows.set(account, row);
      }
    }
    const traders = [...rows.values()].map((row) => {
      const closed = exits.get(row.wallet) ?? [];
      return { ...row, winRate: row.realised !== null && closed.length ? closed.filter((pnl) => pnl > 0).length / closed.length : null,
        bestExit: row.realised !== null && closed.length ? Math.max(...closed) : null };
    }).sort((a, b) => (b.realised ?? -Infinity) - (a.realised ?? -Infinity)).slice(0, limit);
    return { traders, currency: "AVAX", partial: raws.some((raw) => raw.trades.length >= 120), poolsRead: raws.length };
  },

  /** An AVAX balance, and optionally one post coin's. */
  balances: async (wallet: string, token?: string | null): Promise<Balances> => {
    const [native, held] = await Promise.all([
      retry((c) => accountBalance(c, wallet as Address)).then(avax).catch(() => null),
      token ? retry((c) => balanceOf(c, token as Address, wallet as Address)).then(Number).catch(() => null) : Promise.resolve(null),
    ]);
    return { avax: native, token: held };
  },

  /**
   * A buy, sell or floor redemption, quoted against the post's live state and
   * built as contract calls. A buy sends 2% over the quote as its ceiling (the
   * contract refunds whatever it does not use); a sell or redemption names a
   * minimum 2% under its quote. If the auction is over but unsettled, the
   * flow settles it first and prices the buy afterwards.
   */
  buildSwap: async (input: { curve: string; side: "buy" | "sell" | "redeem"; amountOut: number }): Promise<SwapBuild> => {
    const { coin } = await juno.coin(input.curve);
    const quantity = Math.floor(input.amountOut);
    const n = coin.onchain;
    const post = coin.address as Address;
    if (!(quantity > 0)) throw new ApiError("Enter a whole number of tokens", 400);
    if (n.phase === "commit" || n.phase === "reveal") throw new ApiError("The curve opens when the sealed-bid auction settles.", 409);
    if (input.side !== "redeem" && n.phase === "graduated") {
      throw new ApiError("This post graduated: its curve is closed. You can still redeem against the floor.", 409);
    }
    if (input.side === "buy" && quantity > 800 - n.curveSold) throw new ApiError(`Only ${800 - n.curveSold} tokens are left on the curve`, 400);
    if (input.side === "sell" && quantity > n.curveSold) throw new ApiError(`At most ${n.curveSold} can be sold back to the curve`, 400);
    const quote = quoteFor(coin, input.side, quantity);
    const q = BigInt(quantity);
    const steps: TxStep[] = [];
    if (n.phase === "settle") steps.push(juno.call(post, "settle", "Settle the auction"));
    if (input.side === "buy") {
      const ceiling = async () => ((await retry((c) => quoteBuy(c, post, q))) * 102n) / 100n;
      const value = n.phase === "settle" ? 0n : await ceiling();
      steps.push({ ...juno.call(post, "buy", "Buy", [q], value), resolveValue: n.phase === "settle" ? ceiling : undefined });
    } else {
      const m = n.raw;
      const out = input.side === "sell"
        ? sellQuote(BigInt(m.curve_sold), q, BigInt(m.floor_vault), BigInt(m.total_supply))
        : redeemQuote(BigInt(m.floor_vault), BigInt(m.total_supply), q);
      steps.push(juno.call(post, input.side, input.side === "sell" ? "Sell" : "Redeem", [q, (out * 98n) / 100n]));
    }
    return { quote, steps };
  },

  /** Quote only, for a signed-out visitor or while typing. */
  quoteSwap: async (input: { curve: string; side: "buy" | "sell" | "redeem"; amountOut: number }) => {
    const { coin } = await juno.coin(input.curve);
    return quoteFor(coin, input.side, Math.floor(input.amountOut));
  },

  /** Launch a post: the factory deploys its own coin contract. Any bond rides along as AVAX. */
  buildLaunch: (input: { slug: string; caption: string; mediaUrl: string; dare: string; dareBondAvax: number }): { steps: TxStep[] } => {
    const factory = requireFactory();
    const bond = toWei(input.dareBondAvax);
    return {
      steps: [
        {
          label: "Launch",
          to: factory,
          abi: "factory",
          functionName: "createPost",
          args: [input.slug, input.caption, input.mediaUrl, input.dare],
          value: bond.toString(),
        },
      ],
    };
  },

  /** Store a photo on Fuji: its bytes are the calldata of one JunoMedia.store call (see lib/photo.ts). */
  buildStorePhoto: (hex: `0x${string}`): { steps: TxStep[] } => {
    const media = DEPLOYMENT.media as Address | null;
    if (!media) throw new ApiError("Setup required: JunoMedia is not deployed (deployments/fuji.json → media)", 503);
    return { steps: [{ label: "Store photo", to: media, abi: "media", functionName: "store", args: [hex], value: "0" }] };
  },

  /** The post a launch transaction created, read from its PostCreated event. */
  postFromLaunch: async (hash: string): Promise<Address> => {
    const receipt = await retry((c) => c.getTransactionReceipt({ hash: hash as `0x${string}` }));
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
        if (event.eventName === "PostCreated") return event.args.post;
      } catch {
        /* another contract's event */
      }
    }
    throw new ApiError("The launch confirmed but its post could not be found in the receipt.", 500);
  },

  /** One call on a post (settle, reveal, refunds, earnings, dare steps). */
  call: (to: Address, functionName: string, label: string, args: readonly unknown[] = [], value = 0n): TxStep => ({
    label,
    to,
    abi: "post",
    functionName,
    args,
    value: value.toString(),
  }),

  /** The creator's fee share (and a returned dare bond). */
  buildClaim: (input: { curve: string }) => ({ steps: [juno.call(input.curve as Address, "withdrawEarnings", "Claim")] }),

  /* Device-local social state (see above). */
  likes: (coins: string[], viewer?: string | null) => {
    const liked = localSet(`likes:${viewer ?? "anon"}`);
    return Promise.resolve({
      counts: Object.fromEntries(coins.map((c) => [c, { likes: liked.has(c) ? 1 : 0, comments: 0, viewerLiked: liked.has(c) }])),
    });
  },
  setLike: (input: { coin: string; wallet: string; like: boolean }) => {
    const key = `likes:${input.wallet}`;
    const liked = localSet(key);
    if (input.like) liked.add(input.coin);
    else liked.delete(input.coin);
    setLocal(key, JSON.stringify([...liked]));
    return Promise.resolve({ likes: input.like ? 1 : 0, liked: input.like });
  },
  followStats: (wallet: string, viewer?: string | null) => {
    const following = localSet(`follows:${wallet}`);
    const viewerFollows = viewer ? localSet(`follows:${viewer}`).has(wallet) : null;
    return Promise.resolve({ wallet, followers: viewerFollows ? 1 : 0, following: following.size, followingList: [...following], viewerFollows });
  },
  setFollow: (follower: string, target: string, on: boolean) => {
    const key = `follows:${follower}`;
    const set = localSet(key);
    if (on) set.add(target);
    else set.delete(target);
    setLocal(key, JSON.stringify([...set]));
    return Promise.resolve({ isFollowing: on, followers: on ? 1 : 0 });
  },

  /**
   * A URL `<Image>` can load. The seeded posts store a path under the app's
   * own `/art`, which resolves against the app's origin.
   */
  media: (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith("data:image/svg")) return null;
    if (/^https?:\/\//.test(url)) return url;
    return url.startsWith("/") ? `${APP_URL}${url}` : `${APP_URL}/${url}`;
  },
  still: (media: { kind: "image" | "video"; url: string; posterUrl?: string }): string | null => {
    const poster = media.posterUrl && media.posterUrl !== media.url ? media.posterUrl : null;
    if (poster) return juno.media(poster);
    return media.kind === "video" ? null : juno.media(media.url);
  },

  explorer: (kind: "tx" | "address" | "token", id: string) => explorer(kind, id),
};

export { formatAvax };
