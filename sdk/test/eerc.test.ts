import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Base8, mulPointEscalar, subOrder } from '@zk-kit/baby-jubjub';
import { poseidonEncrypt, poseidonDecrypt } from 'maci-crypto';
import { poseidon3 } from 'poseidon-lite';
import {
  contractProof, decryptBalance, decryptPct, elgamalDecryptPoint, elgamalEncrypt, encryptPct, keyMessage,
  keypairFromSeed, keypairFromSignature, registrationHash, transferInput, withdrawInput, type EncryptedBalance,
} from '../src/eerc.ts';

// Cross-checked against maci-crypto, which Ava Labs' own eERC tests use (test/user.ts, src/jub, src/poseidon).
test('keys are scalars below the BabyJubJub subgroup order with pub = sk * Base8', () => {
  const k = keypairFromSeed(2n ** 255n + 17n);
  assert.ok(k.secret > 0n && k.secret < subOrder);
  assert.deepEqual(k.publicKey, mulPointEscalar(Base8, k.secret));
  assert.equal(keypairFromSeed(subOrder).secret, 1n);
});

test('a signature always opens the same key; a different signature a different one', () => {
  const sig = `0x${'ab'.repeat(65)}` as const;
  assert.deepEqual(keypairFromSignature(sig), keypairFromSignature(sig));
  assert.notDeepEqual(keypairFromSignature(sig).publicKey, keypairFromSignature(`0x${'ac'.repeat(65)}`).publicKey);
});

test('the key message names the account and the chain', () => {
  const m = keyMessage('0xB490723D988BD713374D9c6Efd875614B89770fe', 43113);
  assert.match(m, /0xb490723d988bd713374d9c6efd875614b89770fe/);
  assert.match(m, /Chain: 43113/);
});

test('registration hash is poseidon3(chainId, secret, address)', () => {
  const k = keypairFromSeed(42n);
  const a = '0x00000000000000000000000000000000000000aa' as const;
  assert.equal(registrationHash(k, a, 43113), poseidon3([43113n, k.secret, 0xaan]));
});

test('PCTs round-trip and interoperate with maci-crypto poseidon encryption', () => {
  const k = keypairFromSeed(7n);
  const { pct, ciphertext, nonce } = encryptPct([37n], k.publicKey);
  assert.equal(pct.length, 7);
  assert.deepEqual(decryptPct(k, pct), [37n]);
  const shared = mulPointEscalar([pct[4]!, pct[5]!], k.secret);
  assert.deepEqual(poseidonDecrypt(ciphertext, shared, nonce, 1).slice(0, 1), [37n]);
  const viaMaci = poseidonEncrypt([5n], shared, nonce);
  assert.deepEqual(decryptPct(k, [...viaMaci, pct[4]!, pct[5]!, nonce]), [5n]);
});

test('a PCT cannot be read with another key', () => {
  const a = keypairFromSeed(1n);
  const b = keypairFromSeed(2n);
  const { pct } = encryptPct([9n], a.publicKey);
  assert.throws(() => decryptPct(b, pct));
});

test('ElGamal round-trip and the balance check', () => {
  const k = keypairFromSeed(99n);
  const { c1, c2 } = elgamalEncrypt(k.publicKey, 12n);
  assert.deepEqual(elgamalDecryptPoint(k, c1, c2), mulPointEscalar(Base8, 12n));
  const hint = encryptPct([12n], k.publicKey).pct;
  const bag: EncryptedBalance = { c1, c2, nonce: 0n, amountPCTs: [{ pct: hint, index: 0n }], balancePCT: Array(7).fill(0n), transactionIndex: 1n };
  assert.equal(decryptBalance(k, bag), 12n);
  // A forged hint that disagrees with the ElGamal balance is refused.
  const lie = { ...bag, amountPCTs: [{ pct: encryptPct([13n], k.publicKey).pct, index: 0n }] };
  assert.throws(() => decryptBalance(k, lie), /does not match/);
});

test('withdraw and transfer inputs refuse overspending and zero', () => {
  const k = keypairFromSeed(5n);
  const aud = keypairFromSeed(6n).publicKey;
  const { c1, c2 } = elgamalEncrypt(k.publicKey, 3n);
  const bag: EncryptedBalance = { c1, c2, nonce: 0n, amountPCTs: [], balancePCT: Array(7).fill(0n), transactionIndex: 0n };
  assert.throws(() => withdrawInput(k, 3n, bag, 4n, aud), /Only 3/);
  assert.throws(() => withdrawInput(k, 3n, bag, 0n, aud), /at least one/);
  assert.throws(() => transferInput(k, 3n, bag, aud, 4n, aud), /Only 3/);
  const w = withdrawInput(k, 3n, bag, 2n, aud);
  assert.deepEqual(decryptPct(k, w.balancePCT), [1n]);
  assert.deepEqual(decryptPct(keypairFromSeed(6n), [...w.input.AuditorPCT, ...w.input.AuditorPCTAuthKey, w.input.AuditorPCTNonce]), [2n]);
});

test('snarkjs proofs are laid out for the Groth16 verifier (G2 swapped)', () => {
  const p = contractProof({ pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'] }, ['9', '10']);
  assert.deepEqual(p.proofPoints.b, [[4n, 3n], [6n, 5n]]);
  assert.deepEqual(p.publicSignals, [9n, 10n]);
});
