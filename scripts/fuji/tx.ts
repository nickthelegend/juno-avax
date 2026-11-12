/**
 * Send a Juno call on Fuji and time it the way the app does: the clock starts
 * when the signed transaction is handed to the RPC (eth_sendRawTransaction)
 * and stops when its receipt is readable. Signing, nonce and gas estimation
 * happen before the clock starts, so the figure is the network's, not ours.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, http, type Abi, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { client, fuji, FUJI_RPC } from '@juno/sdk';
import { ROOT } from './env.ts';
import { confirmTx } from '../../web/lib/tx-status.ts';

export const pub = client();
export type Sent = { label: string; from: Address; to: Address | null; hash: Hex; status: string; block: number; gasUsed: number; confirmMs: number; blockMs?: number | null; at: string };

export async function call(
  who: PrivateKeyAccount,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  value = 0n,
  label = functionName,
): Promise<Sent> {
  const wallet = createWalletClient({ account: who, chain: fuji, transport: http(FUJI_RPC) });
  const request = await wallet.prepareTransactionRequest({
    to,
    data: (await import('viem')).encodeFunctionData({ abi, functionName, args } as never),
    value,
  } as never);
  const signed = await wallet.signTransaction(request as never);
  const hash = await wallet.sendRawTransaction({ serializedTransaction: signed });
  // Same measurement as the app: from the RPC accepting the transaction to a readable receipt.
  const done = await confirmTx(pub, hash);
  const receipt = await pub.getTransactionReceipt({ hash });
  const sent: Sent = { label, from: who.address, to, hash, status: receipt.status, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed), confirmMs: done.ms, blockMs: done.blockMs, at: new Date().toISOString() };
  console.log(`${receipt.status === 'success' ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${hash} ${done.ms}ms`);
  return sent;
}

export function record(section: string, entries: unknown) {
  const file = join(ROOT, 'deployments/fuji.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  data[section] = entries;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function deployment(): { factory: { address: Address } } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the chain's own clock passes `unixSeconds` (block timestamps decide the windows, not ours). */
export async function untilChainTime(unixSeconds: number) {
  for (;;) {
    const block = await pub.getBlock({ blockTag: 'latest' });
    if (Number(block.timestamp) >= unixSeconds) return;
    await sleep(Math.min(5000, Math.max(500, (unixSeconds - Number(block.timestamp)) * 1000)));
  }
}
