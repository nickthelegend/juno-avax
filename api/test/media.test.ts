// Juno's photo store against live Fuji: one real JunoMedia.store() from Juno's QA test account, read back through
// the same reader /api/media uses; then the refusals (a tx that is not a store, a bad hash, a missing tx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, encodeFunctionData, http, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, FUJI_RPC, mediaAbi } from '@juno/sdk';
import { MEDIA, MediaError, readImage, typeOf } from '../src/media.ts';
import { fujiClient } from '../src/pub.ts';
import { REPO_ENV } from './env.ts';

const pub = fujiClient();
const jpeg = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/juno-96.jpg')));

test('typeOf knows JPEG, PNG and WebP by their magic bytes, and nothing else', () => {
  assert.equal(typeOf(jpeg), 'image/jpeg');
  assert.equal(typeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png');
  assert.equal(typeOf(new TextEncoder().encode('RIFF....WEBPVP8 ')), 'image/webp');
  assert.equal(typeOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('refuses a malformed hash, a missing tx and a tx that did not call JunoMedia', async () => {
  await assert.rejects(readImage(pub, '0x1234'), (e: MediaError) => e.status === 400);
  await assert.rejects(readImage(pub, `0x${'ab'.repeat(32)}`), (e: MediaError) => e.status === 404);
  // The factory's deploy transaction is real but is not a store() call.
  await assert.rejects(readImage(pub, '0xdc72b603c6ab6c4f80aa2db93ad74918216b89a6e21ce6a52cc5c020db712d5c'), (e: MediaError) => e.status === 422);
});

test('a photo stored on Fuji reads back byte for byte, with its keccak256 checked against the Stored event', { timeout: 60_000 }, async () => {
  assert.ok(MEDIA, 'JunoMedia deployed');
  const key = REPO_ENV.JUNO_QA_KEY as Hex | undefined;
  assert.ok(key, 'Setup required: JUNO_QA_KEY in .env');
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: fuji, transport: http(FUJI_RPC) });
  const hash = await wallet.sendTransaction({ to: MEDIA!, data: encodeFunctionData({ abi: mediaAbi, functionName: 'store', args: [toHex(jpeg)] }) });
  await pub.waitForTransactionReceipt({ hash });
  const img = await readImage(pub, hash);
  assert.equal(img.type, 'image/jpeg');
  assert.equal(img.by.toLowerCase(), account.address.toLowerCase());
  assert.equal(img.hash, keccak256(jpeg));
  assert.deepEqual(new Uint8Array(img.bytes), jpeg);
});
