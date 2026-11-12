/**
 * A sealed bid's salt, amount and max price stay on this device until the reveal. On web they sit in this browser's
 * localStorage; Metro picks `bid-secrets.native.ts` on iOS and Android (the keychain).
 */
import type { Hex } from "viem";

export type BidSecret = { amount: string; maxPrice: string; salt: Hex };
const key = (token: string, account: string) => `juno-avax-bid:${token.toLowerCase()}:${account.toLowerCase()}`;

export function readSecret(token: string, account: string): BidSecret | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(token, account));
    return raw ? (JSON.parse(raw) as BidSecret) : null;
  } catch {
    return null;
  }
}

export function writeSecret(token: string, account: string, secret: BidSecret): void {
  try {
    globalThis.localStorage?.setItem(key(token, account), JSON.stringify(secret));
  } catch {
    /* storage refused */
  }
}

export function removeSecret(token: string, account: string): void {
  try {
    globalThis.localStorage?.removeItem(key(token, account));
  } catch {
    /* storage refused */
  }
}

/** Web reads synchronously; nothing to load. */
export async function loadSecret(_token: string, _account: string): Promise<boolean> {
  return false;
}
