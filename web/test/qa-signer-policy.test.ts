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
