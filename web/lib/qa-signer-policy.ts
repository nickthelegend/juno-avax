/**
 * Rules for the QA-only signer, shared by the browser adapter and its Node
 * harness (scripts/qa-flow.mjs). The QA signer exists only in a web build made
 * with EXPO_PUBLIC_QA_SIGNER=1, runs only on a local preview port, and signs
 * only Juno calls on Avalanche Fuji within a small test budget.
 */
import { decodeFunctionData, type Address, type Hex } from "viem";
import { factoryAbi, postAbi } from "@juno/sdk";
import { encryptedErcAbi, registrarAbi } from "@juno/sdk/eerc";

export const QA_CHAIN_ID = 43113;
export const QA_BUDGET = 15n * 10n ** 15n; // 0.015 test AVAX across a run
export const QA_RPC_URLS = ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"];
const POST_CALLS = new Set(["commit", "reveal", "settle", "claimRefund", "buy", "sell", "redeem", "withdrawEarnings", "submitProof", "vote", "finalizeDare"]);
const FACTORY_CALLS = new Set(["createPost"]);
const VAULT_CALLS = new Set(["deposit", "transfer", "withdraw"]);
const REGISTRAR_CALLS = new Set(["register"]);
/** The only message the QA signer will sign: the eERC key message for its own account on Fuji. */
export const QA_KEY_MESSAGE_PREFIX = "Juno: open your private bag";

export function qaRpc(endpoint: string): string {
  const url = new URL(endpoint);
  const origin = `${url.origin}${url.pathname}`;
  if (!QA_RPC_URLS.includes(origin) || url.search || url.hash || url.username || url.password) {
    throw Error("QA signer refuses this RPC; only the public Fuji endpoints are allowed.");
  }
  return origin;
}

export type QaCall = { to: Address; data: Hex; value: bigint };
export type QaChecked = { to: Address; target: "factory" | "post" | "vault" | "registrar"; functionName: string; args: readonly unknown[]; value: string };
export type QaVault = { encryptedERC: Address; registrar: Address } | null;

/** Decode a call and refuse anything that is not a Juno call within budget. `isPost` is read from the factory on chain. */
export function validateQaCall(call: QaCall, factory: Address, isPost: boolean, vault: QaVault = null): QaChecked {
  if (!/^0x[0-9a-fA-F]{40}$/.test(call.to)) throw Error("QA signer requires a contract address.");
  if (call.value < 0n || call.value > QA_BUDGET) throw Error("QA signer value exceeds the test budget.");
  const to = call.to.toLowerCase();
  if (vault && (to === vault.encryptedERC.toLowerCase() || to === vault.registrar.toLowerCase())) {
    const isVault = to === vault.encryptedERC.toLowerCase();
    const decoded = decodeFunctionData({ abi: isVault ? encryptedErcAbi : registrarAbi, data: call.data });
    if (!(isVault ? VAULT_CALLS : REGISTRAR_CALLS).has(decoded.functionName)) throw Error(`QA signer refuses ${decoded.functionName}.`);
    if (call.value !== 0n) throw Error("QA signer sends no value to the eERC vault.");
    return { to: call.to, target: isVault ? "vault" : "registrar", functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[], value: "0" };
  }
  const toFactory = to === factory.toLowerCase();
  if (!toFactory && !isPost) throw Error("QA signer only calls this Juno factory, its posts and the Juno eERC vault.");
  const decoded = decodeFunctionData({ abi: toFactory ? factoryAbi : postAbi, data: call.data });
  if (!toFactory && decoded.functionName === "approve") {
    // Approving a post coin is allowed only towards the Juno eERC vault (to shield it).
    const spender = String((decoded.args ?? [])[0] ?? "").toLowerCase();
    if (!vault || spender !== vault.encryptedERC.toLowerCase()) throw Error("QA signer only approves the Juno eERC vault.");
    return { to: call.to, target: "post", functionName: "approve", args: (decoded.args ?? []) as readonly unknown[], value: call.value.toString() };
  }
  const allowed = toFactory ? FACTORY_CALLS : POST_CALLS;
  if (!allowed.has(decoded.functionName)) throw Error(`QA signer refuses ${decoded.functionName}.`);
  return { to: call.to, target: toFactory ? "factory" : "post", functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[], value: call.value.toString() };
}

/** The QA signer signs one kind of message: the eERC key message naming its own account and Fuji. */
export function validateQaMessage(message: string, account: Address): void {
  if (!message.startsWith(QA_KEY_MESSAGE_PREFIX)) throw Error("QA signer only signs the Juno eERC key message.");
  if (!message.includes(`Account: ${account.toLowerCase()}`) || !message.includes(`Chain: ${QA_CHAIN_ID}`)) throw Error("QA signer refuses a key message for another account or chain.");
}

/** Running total of value plus a generous gas allowance; throws once the run would pass QA_BUDGET. */
export function reserveQaBudget(reserved: bigint, value: bigint, gas: bigint, gasPrice: bigint): bigint {
  if (reserved < 0n || value < 0n || gas <= 0n || gasPrice <= 0n) throw Error("Invalid QA budget input.");
  const next = reserved + value + gas * gasPrice * 3n;
  if (next > QA_BUDGET) throw Error("QA signer stopped: the 0.015 test AVAX budget would be exceeded.");
  return next;
}
