/**
 * The native build has no browser wallet. Metro picks `browser-wallet.web.ts`
 * for the web export; this file keeps the same shape so `wallet.tsx` imports
 * one module on every platform. A native wallet (Core mobile via
 * WalletConnect) is not wired in this build.
 */
import type { Address, Hex } from "viem";

export type WalletOption = { id: string; name: string; icon: string | null; provider: unknown };
export const BROWSER_WALLET: { id: string; name: string; url: string } | null = null;
const unavailable = () => new Error("Wallet connection is available in the web app.");

export async function discoverWallets(): Promise<WalletOption[]> {
  return [];
}
export function preloadWallet(): void {}
export async function restoreWallet(): Promise<string | null> {
  return null;
}
export async function connectWallet(_id?: string): Promise<string> {
  throw unavailable();
}
export async function disconnectWallet(): Promise<void> {}
export function activeWalletName(): string | null {
  return null;
}
export async function sendWithWallet(_tx: { from: Address; to: Address; data: Hex; value: bigint }): Promise<Hex> {
  throw unavailable();
}
