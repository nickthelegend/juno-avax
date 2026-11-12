/** JUNO_QA_SIGNER_BUILD_ONLY — selected by Metro only in an explicitly flagged web build (metro.config.js). */
import { createWalletClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { factoryAbi, fuji } from "@juno/sdk";

import { fujiClient } from "./api";
import { FACTORY, RPC_URL } from "./chain";
import { qaRpc, validateQaCall, validateQaMessage, type QaChecked } from "./qa-signer-policy";
import { DEPLOYMENT } from "./deployment";

export type WalletOption = { id: string; name: string; icon: string | null; provider: unknown };
type Injection = { privateKey: Hex; rpcUrl: string; factory: Address };
type Report = { event: "prepared" | "submitted"; reservation: number; hash: Hex };
declare global {
  interface Window {
    __JUNO_QA_SIGNER__?: Injection;
    __JUNO_QA_AUTHORIZE__?: (call: QaChecked) => Promise<number>;
    __JUNO_QA_REPORT__?: (report: Report) => Promise<void>;
  }
}

export const BROWSER_WALLET = { id: "juno-qa-signer", name: "QA signer", url: "http://localhost" } as const;
const SESSION = "juno-qa-connected";
let loaded: { account: PrivateKeyAccount; rpc: string; factory: Address } | null = null;
let connected = false;
let busy = false;

function credentials() {
  if (process.env.EXPO_PUBLIC_QA_SIGNER !== "1") throw Error("QA signer is disabled in this build.");
  if (!["localhost", "127.0.0.1"].includes(location.hostname) || Number(location.port) < 5300 || Number(location.port) > 5999) {
    throw Error("QA signer only runs on the local QA preview port.");
  }
  qaRpc(RPC_URL);
  if (loaded) return loaded;
  const input = window.__JUNO_QA_SIGNER__;
  delete window.__JUNO_QA_SIGNER__;
  if (!input || !window.__JUNO_QA_AUTHORIZE__ || !window.__JUNO_QA_REPORT__) throw Error("QA signer requires the Playwright harness injection and budget guard.");
  if (!FACTORY || input.factory.toLowerCase() !== FACTORY.toLowerCase()) throw Error("QA signer factory mismatch.");
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(input.privateKey);
  } catch {
    throw Error("QA signer could not read the injected Fuji test key.");
  }
  loaded = { account, rpc: qaRpc(input.rpcUrl), factory: input.factory };
  return loaded;
}

export async function discoverWallets(): Promise<WalletOption[]> {
  return [{ id: BROWSER_WALLET.id, name: BROWSER_WALLET.name, icon: null, provider: null }];
}
export function preloadWallet() {}
export async function restoreWallet() {
  if (sessionStorage.getItem(SESSION) !== "1") return null;
  connected = true;
  return credentials().account.address;
}
export async function connectWallet(_id?: string) {
  const current = credentials();
  connected = true;
  sessionStorage.setItem(SESSION, "1");
  return getAddress(current.account.address);
}
export async function disconnectWallet() {
  connected = false;
  sessionStorage.removeItem(SESSION);
}
export function activeWalletName() {
  return connected ? BROWSER_WALLET.name : null;
}

export async function sendWithWallet(tx: { from: Address; to: Address; data: Hex; value: bigint }): Promise<Hex> {
  if (!connected) throw Error("QA signer is not connected.");
  if (busy) throw Error("QA signer waits for the current call before signing another.");
  busy = true;
  try {
    const current = credentials();
    if (tx.from.toLowerCase() !== current.account.address.toLowerCase()) throw Error("QA signer account mismatch.");
    const reader = fujiClient();
    const isPost = tx.to.toLowerCase() === current.factory.toLowerCase() || (DEPLOYMENT.eerc && [DEPLOYMENT.eerc.encryptedERC, DEPLOYMENT.eerc.registrar].some((a) => a.toLowerCase() === tx.to.toLowerCase()))
      ? false
      : await reader.readContract({ address: current.factory, abi: factoryAbi, functionName: "isPost", args: [tx.to] });
    const vault = DEPLOYMENT.eerc ? { encryptedERC: DEPLOYMENT.eerc.encryptedERC as Address, registrar: DEPLOYMENT.eerc.registrar as Address } : null;
    const isVault = !!vault && [vault.encryptedERC, vault.registrar].some((a) => a.toLowerCase() === tx.to.toLowerCase());
    const checked = validateQaCall({ to: tx.to, data: tx.data, value: tx.value }, current.factory, isPost && !isVault, vault);
    const reservation = await window.__JUNO_QA_AUTHORIZE__!(checked);
    const wallet = createWalletClient({ account: current.account, chain: fuji, transport: http(current.rpc) });
    const request = await wallet.prepareTransactionRequest({ to: tx.to, data: tx.data, value: tx.value });
    const signed = await wallet.signTransaction(request);
    const { keccak256 } = await import("viem");
    const hash = keccak256(signed);
    // Persist only the public hash before the broadcast.
    await window.__JUNO_QA_REPORT__!({ event: "prepared", reservation, hash });
    await wallet.sendRawTransaction({ serializedTransaction: signed });
    await window.__JUNO_QA_REPORT__!({ event: "submitted", reservation, hash });
    return hash;
  } finally {
    busy = false;
  }
}

/** Signs only the eERC key message for its own account on Fuji (see validateQaMessage). */
export async function signWithWallet(from: Address, message: string): Promise<Hex> {
  if (!connected) throw Error("QA signer is not connected.");
  const current = credentials();
  if (from.toLowerCase() !== current.account.address.toLowerCase()) throw Error("QA signer account mismatch.");
  validateQaMessage(message, current.account.address);
  return current.account.signMessage({ message });
}

export function isLocalWallet(): boolean {
  return false;
}

/** The QA signer never asks Juno's gas sponsor: it is funded by the harness. */
export async function signRawWithWallet(_from: Address, _raw: Hex): Promise<Hex> {
  throw Error("QA signer does not sign gas requests.");
}
