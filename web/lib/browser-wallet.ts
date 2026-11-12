/**
 * Wallets on iOS and Android: the Juno wallet, a Fuji test key made on this phone and kept in its keychain
 * (lib/local-wallet). Metro picks `browser-wallet.web.ts` for the web export, where browser wallets (Core,
 * MetaMask) are offered as well. A native Core mobile connection (WalletConnect) is not wired in this build.
 */
import { getAddress, type Address, type Hex } from "viem";

import { LOCAL_ID, LOCAL_NAME, localAddress, openLocal, sendLocal, signLocal, signRawLocal } from "./local-wallet";

export type WalletOption = { id: string; name: string; icon: string | null; provider: unknown };
export const BROWSER_WALLET: { id: string; name: string; url: string } | null = null;
const LOCAL: WalletOption = { id: LOCAL_ID, name: LOCAL_NAME, icon: null, provider: null };
let connected = false;

export async function discoverWallets(): Promise<WalletOption[]> {
  return [LOCAL];
}
export function preloadWallet(): void {}
/** The phone reopens its Juno wallet on launch when it has one. */
export async function restoreWallet(): Promise<string | null> {
  const address = await localAddress();
  connected = !!address;
  return address ? getAddress(address) : null;
}
export async function connectWallet(_id?: string): Promise<string> {
  const { address } = await openLocal();
  connected = true;
  return getAddress(address);
}
export async function disconnectWallet(): Promise<void> {
  connected = false;
}
export function activeWalletName(): string | null {
  return connected ? LOCAL_NAME : null;
}
export function isLocalWallet(): boolean {
  return connected;
}
export async function sendWithWallet(tx: { from: Address; to: Address; data: Hex; value: bigint }): Promise<Hex> {
  if (!connected) throw new Error("Open the Juno wallet first.");
  return sendLocal(tx);
}
export async function signWithWallet(from: Address, message: string): Promise<Hex> {
  if (!connected) throw new Error("Open the Juno wallet first.");
  return signLocal(from, message);
}
export async function signRawWithWallet(from: Address, raw: Hex): Promise<Hex> {
  if (!connected) throw new Error("Open the Juno wallet first.");
  return signRawLocal(from, raw);
}
