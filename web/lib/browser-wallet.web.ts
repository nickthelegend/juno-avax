/**
 * Browser wallets on web: Core, MetaMask, Rabby or any EIP-1193 wallet,
 * discovered with EIP-6963 (and `window.avalanche` / `window.ethereum` as a
 * fallback for wallets that do not announce themselves).
 *
 * The person's own account signs every call and pays its own value and gas.
 * Before the first call the wallet is moved to Avalanche Fuji (43113),
 * adding the network when it does not know it.
 *
 * The native build resolves `./browser-wallet` to the stub next to this file.
 */
import type { Address, Hex } from "viem";
import { getAddress, numberToHex, toHex } from "viem";
import { FUJI_EXPLORER } from "@juno/sdk";

import { CHAIN_ID, RPC_URL } from "./chain";

type Eip1193 = { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> };
export type WalletOption = { id: string; name: string; icon: string | null; provider: Eip1193 };

export const BROWSER_WALLET = { id: "injected", name: "your wallet", url: "https://core.app" } as const;
const SAVED = "juno-avax:wallet";

let options: WalletOption[] = [];
let active: WalletOption | null = null;

/** Every wallet this browser offers, Core first. */
export async function discoverWallets(): Promise<WalletOption[]> {
  if (typeof window === "undefined") return [];
  const found = new Map<string, WalletOption>();
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 }>).detail;
    if (detail?.info?.rdns && detail.provider) {
      found.set(detail.info.rdns, { id: detail.info.rdns, name: detail.info.name, icon: detail.info.icon ?? null, provider: detail.provider });
    }
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 250));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  const w = window as unknown as { avalanche?: Eip1193; ethereum?: Eip1193 & { isMetaMask?: boolean } };
  if (!found.size && w.avalanche) found.set("app.core.extension", { id: "app.core.extension", name: "Core", icon: null, provider: w.avalanche });
  if (!found.size && w.ethereum) found.set("injected", { id: "injected", name: w.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", icon: null, provider: w.ethereum });
  options = [...found.values()].sort((a, b) => Number(/core/i.test(b.id)) - Number(/core/i.test(a.id)));
  return options;
}

export function preloadWallet(): void {
  void discoverWallets();
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(SAVED, id);
    else localStorage.removeItem(SAVED);
  } catch {
    /* storage refused */
  }
}

/** The account connected on an earlier visit, without opening the wallet. */
export async function restoreWallet(): Promise<string | null> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SAVED);
  } catch {
    return null;
  }
  if (!saved) return null;
  const list = await discoverWallets();
  const option = list.find((o) => o.id === saved);
  if (!option) return null;
  const accounts = (await option.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
  if (!accounts[0]) return null;
  active = option;
  return getAddress(accounts[0]);
}

async function ensureFuji(provider: Eip1193) {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === CHAIN_ID) return;
  const chainId = numberToHex(CHAIN_ID);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((error as Error).message))) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: "Avalanche Fuji C-Chain", nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: [FUJI_EXPLORER] }],
    });
  }
}

/** Ask the chosen wallet for an account and move it to Fuji. */
export async function connectWallet(id?: string): Promise<string> {
  const list = options.length ? options : await discoverWallets();
  const option = list.find((o) => o.id === id) ?? list[0];
  if (!option) throw new Error("No browser wallet found. Install Core (core.app) or MetaMask, then try again.");
  const accounts = (await option.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error(`${option.name} did not return an account.`);
  await ensureFuji(option.provider);
  active = option;
  remember(option.id);
  return getAddress(accounts[0]);
}

export async function disconnectWallet(): Promise<void> {
  const option = active;
  active = null;
  remember(null);
  await option?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
}

export function activeWalletName(): string | null {
  return active?.name ?? null;
}

/** Have the wallet sign and send one call. Resolves with the hash once the wallet has broadcast it. */
export async function sendWithWallet(tx: { from: Address; to: Address; data: Hex; value: bigint }): Promise<Hex> {
  if (!active) throw new Error("Connect a wallet first.");
  await ensureFuji(active.provider);
  const hash = (await active.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: tx.from, to: tx.to, data: tx.data, value: numberToHex(tx.value) }],
  })) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet did not return a transaction hash. Check Snowtrace before trying again.");
  return hash;
}

/**
 * Ask the wallet to sign a plain-text message (personal_sign). Used once per
 * session to derive the holder's eERC key; it is not a transaction.
 */
export async function signWithWallet(from: Address, message: string): Promise<Hex> {
  if (!active) throw new Error("Connect a wallet first.");
  const signature = (await active.provider.request({ method: "personal_sign", params: [toHex(message), from] })) as Hex;
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("The wallet did not return a signature.");
  return signature;
}
