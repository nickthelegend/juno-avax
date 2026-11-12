import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import { factoryAbi, postAbi } from '@juno/sdk';
import { QA_BUDGET, qaRpc, reserveQaBudget, validateQaCall } from '../lib/qa-signer-policy';

const factory = '0xac736951c75e849e7db40b333cc0dff2baf88539' as const;
const post = '0x3AD60B725BdB66A663878F894386e7bD1801C94d' as const;
const buy = encodeFunctionData({ abi: postAbi, functionName: 'buy', args: [2n] });

test('QA signer only talks to the public Fuji RPCs', () => {
  assert.equal(qaRpc('https://api.avax-test.network/ext/bc/C/rpc'), 'https://api.avax-test.network/ext/bc/C/rpc');
  for (const rpc of ['https://api.avax.network/ext/bc/C/rpc', 'https://api.avax-test.network.evil.example/ext/bc/C/rpc', 'http://api.avax-test.network/ext/bc/C/rpc', 'https://api.avax-test.network/ext/bc/C/rpc?x=1']) assert.throws(() => qaRpc(rpc));
});

test('QA signer only signs Juno calls on the factory and its posts', () => {
  assert.equal(validateQaCall({ to: post, data: buy, value: 10n ** 14n }, factory, true).functionName, 'buy');
  assert.throws(() => validateQaCall({ to: post, data: buy, value: 1n }, factory, false), /only calls this Juno factory/);
  const transfer = encodeFunctionData({ abi: postAbi, functionName: 'transfer', args: [factory, 1n] });
  assert.throws(() => validateQaCall({ to: post, data: transfer, value: 0n }, factory, true), /refuses transfer/);
  const launch = encodeFunctionData({ abi: factoryAbi, functionName: 'createPost', args: ['qa', '', '/a.webp', ''] });
  assert.equal(validateQaCall({ to: factory, data: launch, value: 0n }, factory, false).target, 'factory');
  assert.throws(() => validateQaCall({ to: post, data: buy, value: QA_BUDGET + 1n }, factory, true), /budget/);
});

test('one shared budget reserves value plus three times the gas charge', () => {
  const first = reserveQaBudget(0n, 10n ** 15n, 200_000n, 200n);
  assert.equal(first, 10n ** 15n + 200_000n * 200n * 3n);
  assert.throws(() => reserveQaBudget(QA_BUDGET, 1n, 1n, 1n), /0.015/);
  assert.throws(() => reserveQaBudget(0n, 0n, 1n, -1n));
});

// The eERC vault (Hide your bag): only the four user calls, no value, approvals only to the vault.
import { encryptedErcAbi, registrarAbi } from '@juno/sdk/eerc';
import { validateQaMessage } from '../lib/qa-signer-policy';

const vault = { encryptedERC: '0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac', registrar: '0x949a55ddff2a85ce1a1bad7c760515903dee0c93' } as const;
const zeros7 = Array(7).fill(0n) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];

test('QA signer calls only deposit/transfer/withdraw on the vault and register on the registrar, with no value', () => {
  const deposit = encodeFunctionData({ abi: encryptedErcAbi, functionName: 'deposit', args: [5n, post, zeros7] });
  assert.equal(validateQaCall({ to: vault.encryptedERC, data: deposit, value: 0n }, factory, false, vault).target, 'vault');
  assert.throws(() => validateQaCall({ to: vault.encryptedERC, data: deposit, value: 1n }, factory, false, vault), /no value/);
  const setAuditor = encodeFunctionData({ abi: encryptedErcAbi, functionName: 'setAuditorPublicKey', args: [post] });
  assert.throws(() => validateQaCall({ to: vault.encryptedERC, data: setAuditor, value: 0n }, factory, false, vault), /refuses setAuditorPublicKey/);
  const proof = { proofPoints: { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] }, publicSignals: [0n, 0n, 0n, 0n, 0n] } as never;
  const register = encodeFunctionData({ abi: registrarAbi, functionName: 'register', args: [proof] });
  assert.equal(validateQaCall({ to: vault.registrar, data: register, value: 0n }, factory, false, vault).functionName, 'register');
  assert.throws(() => validateQaCall({ to: vault.encryptedERC, data: deposit, value: 0n }, factory, false, null), /only calls this Juno factory/);
});

test('QA signer approves a post coin only to the vault', () => {
  const ok = encodeFunctionData({ abi: postAbi, functionName: 'approve', args: [vault.encryptedERC, 5n] });
  assert.equal(validateQaCall({ to: post, data: ok, value: 0n }, factory, true, vault).functionName, 'approve');
  const bad = encodeFunctionData({ abi: postAbi, functionName: 'approve', args: [factory, 5n] });
  assert.throws(() => validateQaCall({ to: post, data: bad, value: 0n }, factory, true, vault), /only approves the Juno eERC vault/);
});

test('QA signer signs only the eERC key message for its own account on Fuji', () => {
  const me = '0xB490723D988BD713374D9c6Efd875614B89770fe' as const;
  const good = `Juno: open your private bag\n\n...\n\nAccount: ${me.toLowerCase()}\nChain: 43113`;
  validateQaMessage(good, me);
  assert.throws(() => validateQaMessage('Sign in to evil.example', me), /only signs/);
  assert.throws(() => validateQaMessage(good.replace(me.toLowerCase(), '0x0000000000000000000000000000000000000001'), me), /another account/);
  assert.throws(() => validateQaMessage(good.replace('43113', '43114'), me), /another account or chain/);
});
