/** The Juno wallet's key on iOS and Android: the OS keystore (expo-secure-store), this device only. */
import * as SecureStore from "expo-secure-store";

const KEY = "juno-avax.local-wallet.v1";
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const KEY_HOME = "this phone";

export async function readKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY, OPTS);
}

export async function writeKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, value, OPTS);
}
