/**
 * A sealed bid's salt on iOS and Android: kept in memory for this session and in the keychain (expo-secure-store),
 * so a bid placed before the app closed can still be revealed. `loadSecret` reads the keychain into memory.
 */
import * as SecureStore from "expo-secure-store";
import type { Hex } from "viem";

export type BidSecret = { amount: string; maxPrice: string; salt: Hex };
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const memory = new Map<string, BidSecret | null>();
// SecureStore keys allow only letters, digits, ".", "-" and "_".
const key = (token: string, account: string) => `juno-avax-bid.${token.toLowerCase()}.${account.toLowerCase()}`;

export function readSecret(token: string, account: string): BidSecret | null {
  return memory.get(key(token, account)) ?? null;
}

export function writeSecret(token: string, account: string, secret: BidSecret): void {
  const k = key(token, account);
  memory.set(k, secret);
  void SecureStore.setItemAsync(k, JSON.stringify(secret), OPTS).catch(() => undefined);
}

export function removeSecret(token: string, account: string): void {
  const k = key(token, account);
  memory.set(k, null);
  void SecureStore.deleteItemAsync(k, OPTS).catch(() => undefined);
}

/** Loads a saved secret into memory; true when one was found that was not already loaded. */
export async function loadSecret(token: string, account: string): Promise<boolean> {
  const k = key(token, account);
  if (memory.has(k)) return false;
  const raw = await SecureStore.getItemAsync(k, OPTS).catch(() => null);
  memory.set(k, raw ? (JSON.parse(raw) as BidSecret) : null);
  return !!raw;
}
