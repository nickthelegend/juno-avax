/**
 * The chain the app talks to, and everything that depends on which one it is.
 *
 * Juno on Avalanche runs on the Fuji C-Chain (43113). The factory lists every
 * post; each post is its own contract and coin, holding the sealed-bid opening
 * auction, the bonding curve, the redeemable floor and the dare bond. One
 * place, so no screen hardcodes an explorer, a network name or an RPC.
 */
import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import { FUJI_CHAIN_ID, FUJI_EXPLORER, FUJI_RPC } from "@juno/sdk";

export const CHAIN_ID = FUJI_CHAIN_ID;
export const RPC_URL = process.env.EXPO_PUBLIC_FUJI_RPC_URL || FUJI_RPC;
/** Public Fuji RPCs tried in order when one throttles. Reads only; each is a real Fuji node. */
export const RPC_URLS: string[] = [...new Set([RPC_URL, FUJI_RPC, "https://avalanche-fuji-c-chain-rpc.publicnode.com"])];
/** The JunoFactory every post was created by. Null means Setup required. */
export const FACTORY: Address | null = (process.env.EXPO_PUBLIC_JUNO_FACTORY as Address | undefined) || null;

export const IS_TESTNET = true;
export const NETWORK_NAME = "Avalanche Fuji";
/** What the money is, said once wherever a balance is shown. */
export const NETWORK_LABEL = "Avalanche Fuji · test AVAX, no real money";
export const EXPLORER_NAME = "Snowtrace";
export const FAUCET_URL = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";

export function explorer(kind: "tx" | "address" | "token", id: string): string {
  if (kind === "tx") return `${FUJI_EXPLORER}/tx/${id}`;
  if (kind === "token") return `${FUJI_EXPLORER}/token/${id}`;
  return `${FUJI_EXPLORER}/address/${id}`;
}

export function validAddress(value: string | null | undefined): value is Address {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function displayAddress(value: string): string {
  return value;
}

/** 0x1234…cdef */
export function shortAddress(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type TxFailure = {
  /** Copy to show. Empty when `cancelled`. */
  message: string;
  /** The person backed out. Say nothing. */
  cancelled: boolean;
  /** The contract's custom error name, when there was one. */
  reason: string | null;
};

export class TxError extends Error {
  readonly cancelled: boolean;
  readonly reason: string | null;
  constructor(failure: TxFailure) {
    super(failure.message || "Cancelled");
    this.name = "TxError";
    this.cancelled = failure.cancelled;
    this.reason = failure.reason;
  }
}

/** The contracts' custom errors, one line each. */
const REASONS: Record<string, string> = {
  CommitClosed: "The sealed-bid window has closed.",
  RevealWindow: "Bids can only be revealed in the minute after bidding closes.",
  SettleWindow: "The auction cannot be settled yet.",
  DuplicateBid: "You already placed a sealed bid on this post.",
  FixedEscrow: "A sealed bid escrows exactly 0.005 AVAX.",
  TooManyBids: "This auction is full (64 bids).",
  NoCommit: "This account has no sealed bid here.",
  BadBid: "That bid is not valid: 1–200 tokens at no less than 0.000001 AVAX each.",
  HashMismatch: "That reveal does not match your sealed bid.",
  EscrowExceeded: "Amount × max price is more than the 0.005 AVAX you escrowed.",
  NotSettled: "The opening auction has not settled yet.",
  NoRefund: "Nothing left to refund.",
  CurveClosed: "The curve is closed: this post graduated. You can still redeem against the floor.",
  Payment: "The price moved. Try again.",
  SellTooLarge: "Nothing to sell at this size.",
  Slippage: "The price moved past your limit. Try again.",
  Balance: "You do not hold that many.",
  Redeem: "Nothing to redeem yet.",
  Quantity: "That is more than the curve has left.",
  OnlyCreator: "Only the creator can do that.",
  NoDare: "This post has no dare.",
  ProofWindow: "Proof can be posted once, within five minutes of launch.",
  ProofInvalid: "Proof must be a link of up to 300 characters.",
  VoteWindow: "Voting opens when proof is posted and closes five minutes after launch.",
  NotHolder: "Only holders vote.",
  AlreadyVoted: "You already voted.",
  TooManyVoters: "This vote is full (64 voters).",
  DareWindow: "The dare cannot be finalized yet.",
  TransferFailed: "The AVAX transfer failed.",
  Slug: "Names are 2–32 lowercase letters, digits or dashes.",
  Duplicate: "A post with that name already exists.",
  Metadata: "Caption up to 400 characters and a picture are required.",
  DareBond: "A dare needs a bond (up to 2 AVAX), and a bond needs a dare.",
  ReentrancyGuardReentrantCall: "Refused: re-entrant call.",
  // The Juno eERC vault (Ava Labs EncryptedERC).
  UserAlreadyRegistered: "This wallet already has a private bag.",
  UserNotRegistered: "That account has not opened a private bag yet.",
  InvalidProof: "The proof did not verify against your bag. Reload the bag and try again.",
  InvalidSender: "This proof was made for another account.",
  InvalidChainId: "This proof was made for another chain.",
  PendingHistoryLimitReached: "This bag has too many incoming amounts waiting. Move or unshield once to fold them in.",
  AmountTooSmall: "That amount is too small to unshield.",
  TokenBlacklisted: "This coin cannot be shielded.",
  UnknownToken: "Nothing of this coin has been shielded yet.",
};

/** The custom error name inside a viem error, if the contract reverted with one. */
function revertName(error: unknown): string | null {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? null;
  }
  const text = error instanceof Error ? error.message : String(error ?? "");
  const named = /reverted with (?:the following )?(?:custom error|reason)[^:]*:\s*\n?\s*([A-Za-z]+)\(/.exec(text)?.[1];
  if (named) return named;
  const known = Object.keys(REASONS).find((name) => new RegExp(`\\b${name}\\b`).test(text));
  return known ?? null;
}

export function describeTxError(error: unknown): TxFailure {
  if (error instanceof TxError) {
    return { message: error.cancelled ? "" : error.message, cancelled: error.cancelled, reason: error.reason };
  }
  const text = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage || error.message : typeof error === "string" ? error : "The transaction failed";
  const code = (error as { code?: number } | null)?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request|cancelled|canceled/i.test(text)) {
    return { message: "", cancelled: true, reason: null };
  }
  const name = revertName(error);
  if (name) return { message: REASONS[name] ?? `The contract refused it (${name}).`, cancelled: false, reason: name };
  if (/insufficient funds|exceeds the balance|not enough/i.test(text)) {
    return { message: "Not enough test AVAX for this and its gas. Top up from the Fuji faucet.", cancelled: false, reason: null };
  }
  if (/chain|network/i.test(text) && /mismatch|switch|unrecognized|does not match/i.test(text)) {
    return { message: "Switch your wallet to Avalanche Fuji (43113) and try again.", cancelled: false, reason: null };
  }
  if (/429|rate limit|too many requests|timeout|timed out|fetch failed|failed to fetch|HTTP request failed/i.test(text)) {
    return { message: "The network is busy. Try again in a moment.", cancelled: false, reason: null };
  }
  return { message: text.split("\n")[0]!.slice(0, 220), cancelled: false, reason: null };
}
