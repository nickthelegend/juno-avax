/**
 * The Juno wallet: a Fuji test key made on this device, for a first try with no Core or MetaMask. It signs and
 * sends like any wallet (each call is a normal Fuji transaction from its own account); Juno's server never sees the
 * key. It is created once and reopened on later visits; signing out does not delete it.
 */
import { createWalletClient, getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { fuji, fujiTransport } from "@juno/sdk";

import { readKey, writeKey } from "./key-store";
import { RPC_URLS } from "./chain";

export const LOCAL_ID = "juno";
export const LOCAL_NAME = "Juno wallet";
export { KEY_HOME } from "./key-store";

let account: PrivateKeyAccount | null = null;

/** The saved Juno wallet's address, without creating one. */
export async function localAddress(): Promise<Address | null> {
  if (account) return account.address;
  const key = await readKey();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  account = privateKeyToAccount(key as Hex);
  return account.address;
}

/** Opens the Juno wallet on this device, creating it the first time. */
export async function openLocal(): Promise<{ address: Address; created: boolean }> {
  const existing = await localAddress();
  if (existing) return { address: getAddress(existing), created: false };
  const key = generatePrivateKey();
  await writeKey(key);
  account = privateKeyToAccount(key);
  return { address: account.address, created: true };
}

function signer(): PrivateKeyAccount {
  if (!account) throw new Error("Open the Juno wallet first.");
  return account;
}

export async function sendLocal(tx: { from: Address; to: Address; data: Hex; value: bigint }): Promise<Hex> {
  const me = signer();
  if (tx.from.toLowerCase() !== me.address.toLowerCase()) throw new Error("The Juno wallet is a different account.");
  const wallet = createWalletClient({ account: me, chain: fuji, transport: fujiTransport(RPC_URLS) });
  const request = await wallet.prepareTransactionRequest({ to: tx.to, data: tx.data, value: tx.value });
  return wallet.sendRawTransaction({ serializedTransaction: await wallet.signTransaction(request) });
}

export async function signLocal(from: Address, message: string): Promise<Hex> {
  const me = signer();
  if (from.toLowerCase() !== me.address.toLowerCase()) throw new Error("The Juno wallet is a different account.");
  return me.signMessage({ message });
}

/** personal_sign over raw bytes (the gas request digest). */
export async function signRawLocal(from: Address, raw: Hex): Promise<Hex> {
  const me = signer();
  if (from.toLowerCase() !== me.address.toLowerCase()) throw new Error("The Juno wallet is a different account.");
  return me.signMessage({ message: { raw } });
}
