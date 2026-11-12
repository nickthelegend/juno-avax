/**
 * Rules for the QA-only signer, shared by the browser adapter and its Node
 * harness (scripts/qa-flow.mjs). The QA signer exists only in a web build made
 * with EXPO_PUBLIC_QA_SIGNER=1, runs only on a local preview port, and signs
 * only Juno calls on Avalanche Fuji within a small test budget.
 */
import { decodeFunctionData, type Address, type Hex } from "viem";
import { factoryAbi, postAbi } from "@juno/sdk";

export const QA_CHAIN_ID = 43113;
export const QA_BUDGET = 15n * 10n ** 15n; // 0.015 test AVAX across a run
export const QA_RPC_URLS = ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"];
const POST_CALLS = new Set(["commit", "reveal", "settle", "claimRefund", "buy", "sell", "redeem", "withdrawEarnings", "submitProof", "vote", "finalizeDare"]);
const FACTORY_CALLS = new Set(["createPost"]);

export function qaRpc(endpoint: string): string {
  const url = new URL(endpoint);
  const origin = `${url.origin}${url.pathname}`;
  if (!QA_RPC_URLS.includes(origin) || url.search || url.hash || url.username || url.password) {
    throw Error("QA signer refuses this RPC; only the public Fuji endpoints are allowed.");
  }
  return origin;
}

export type QaCall = { to: Address; data: Hex; value: bigint };
export type QaChecked = { to: Address; target: "factory" | "post"; functionName: string; args: readonly unknown[]; value: string };

/** Decode a call and refuse anything that is not a Juno call within budget. `isPost` is read from the factory on chain. */
export function validateQaCall(call: QaCall, factory: Address, isPost: boolean): QaChecked {
  if (!/^0x[0-9a-fA-F]{40}$/.test(call.to)) throw Error("QA signer requires a contract address.");
  const toFactory = call.to.toLowerCase() === factory.toLowerCase();
  if (!toFactory && !isPost) throw Error("QA signer only calls this Juno factory and its posts.");
  const decoded = decodeFunctionData({ abi: toFactory ? factoryAbi : postAbi, data: call.data });
  const allowed = toFactory ? FACTORY_CALLS : POST_CALLS;
  if (!allowed.has(decoded.functionName)) throw Error(`QA signer refuses ${decoded.functionName}.`);
  if (call.value < 0n || call.value > QA_BUDGET) throw Error("QA signer value exceeds the test budget.");
  return { to: call.to, target: toFactory ? "factory" : "post", functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[], value: call.value.toString() };
}

/** Running total of value plus a generous gas allowance; throws once the run would pass QA_BUDGET. */
export function reserveQaBudget(reserved: bigint, value: bigint, gas: bigint, gasPrice: bigint): bigint {
  if (reserved < 0n || value < 0n || gas <= 0n || gasPrice <= 0n) throw Error("Invalid QA budget input.");
  const next = reserved + value + gas * gasPrice * 3n;
  if (next > QA_BUDGET) throw Error("QA signer stopped: the 0.015 test AVAX budget would be exceeded.");
  return next;
}
