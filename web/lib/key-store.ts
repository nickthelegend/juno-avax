/**
 * Where the Juno wallet keeps its key on web: this browser's localStorage (the web has no keystore). The app says
 * so where the wallet is created. Metro picks `key-store.native.ts` on iOS and Android (the OS keystore).
 */
const KEY = "juno-avax:local-wallet.v1";

export const KEY_HOME = "this browser";

export async function readKey(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function writeKey(value: string): Promise<void> {
  try {
    globalThis.localStorage.setItem(KEY, value);
  } catch {
    throw new Error("This browser refused to store the wallet (private mode?). Use Core or MetaMask instead.");
  }
}
