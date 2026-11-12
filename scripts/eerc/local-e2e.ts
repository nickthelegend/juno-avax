/**
 * End-to-end test of "Hide your bag" on a local Anvil chain: the real Juno
 * contracts, Ava Labs' EncryptedERC (converter mode, production verifiers),
 * and real Groth16 proofs from the shipped zkeys. No mocks, no stub verifiers.
 *
 *   pnpm test:eerc
 *
 * Covers the happy path (register, shield, private send, unshield, sell) and
 * the attacks the vault must refuse on chain.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { factoryAbi, postAbi } from '@juno/sdk';
import { contractProof, decryptBalance, encryptedErcAbi, registrarAbi, registrationInput, vaultMoves, withdrawInput, auditorKey } from '@juno/sdk/eerc';
import { ROOT } from '../fuji/env.ts';
import { bag, closeProver, deployVault, nodeProver, openKey, postFrom, register, send, sendPrivately, shield, unshield, type Ctx } from './vault.ts';

const PORT = 5345;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// Anvil's public development mnemonic: local chain only.
const dev = (i: number) => mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: i }) as unknown as PrivateKeyAccount;
const [owner, auditor, mira, kai, stranger] = [0, 1, 2, 3, 4].map(dev) as PrivateKeyAccount[];

let checks = 0;
const ok = (name: string) => { checks += 1; console.log(`  ✔ ${name}`); };

async function reverts(ctx: Ctx, who: PrivateKeyAccount, to: Address, abi: Abi, fn: string, args: readonly unknown[], expect: RegExp, name: string) {
  const { encodeFunctionData } = await import('viem');
  const data = encodeFunctionData({ abi, functionName: fn, args } as never);
  const err = await ctx.pub.call({ account: who.address, to, data }).then(() => null, (e: Error) => e);
  assert.ok(err, `${name}: expected a revert`);
  const raw = /custom error (0x[0-9a-f]{8})/.exec(err!.message)?.[1] ?? (err as { data?: Hex }).data;
  let decoded = '';
  if (raw) {
    const { decodeErrorResult } = await import('viem');
    try { decoded = decodeErrorResult({ abi: [...(encryptedErcAbi as Abi), ...(abi as Abi)], data: raw as Hex }).errorName; } catch { decoded = raw; }
  }
  const text = `${decoded} ${(err as { shortMessage?: string }).shortMessage ?? ''} ${err!.message}`;
  assert.match(text, expect, `${name}: wrong reason: ${text.slice(0, 300)}`);
  ok(name);
}

const anvil = spawn('anvil', ['--port', String(PORT), '--silent', '--code-size-limit', '30000'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);

try {
  const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 50 });
  for (let i = 0; ; i += 1) { try { await pub.getBlockNumber(); break; } catch { if (i > 50) throw Error('anvil did not start'); await new Promise((r) => setTimeout(r, 200)); } }
  const ctx: Ctx = { pub: pub as never, chain, rpc: RPC, log: [] };
  const rpc = (method: string, params: unknown[]) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

  console.log('Juno post with real holders');
  const fac = JSON.parse(readFileSync(join(ROOT, 'contracts/out/JunoFactory.sol/JunoFactory.json'), 'utf8'));
  const w = createWalletClient({ account: owner, chain, transport: http(RPC) });
  const fh = await w.deployContract({ abi: factoryAbi, bytecode: fac.bytecode.object as Hex });
  const factory = (await pub.waitForTransactionReceipt({ hash: fh })).contractAddress!;
  const created = await send(ctx, mira, factory, factoryAbi as Abi, 'createPost', ['bag-test', 'hide your bag', 'https://juno.test/a.webp', ''], 'createPost');
  const post = postFrom((await pub.getTransactionReceipt({ hash: created.hash })).logs as never, factoryAbi as Abi);
  await rpc('evm_increaseTime', [130]);
  await rpc('evm_mine', []);
  for (const [who, q] of [[mira, 40n], [kai, 10n]] as const) {
    const [total] = await pub.readContract({ address: post, abi: postAbi, functionName: 'quoteBuy', args: [q] });
    await send(ctx, who, post, postAbi as Abi, 'buy', [q], `buy ${q}`, total);
  }
  assert.equal(await pub.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [mira.address] }), 40n);
  ok('mira holds 40 public post coins');

  console.log('Vault: EncryptedERC converter, production verifiers');
  const v = await deployVault(ctx, owner);
  assert.equal(await pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'isConverter' }), true);
  ok('EncryptedERC deployed in converter mode');

  const kMira = await openKey(mira, chain.id);
  const kKai = await openKey(kai, chain.id);
  const kAud = await openKey(auditor, chain.id);
  const kMira2 = await openKey(mira, chain.id);
  assert.deepEqual(kMira.publicKey, kMira2.publicKey);
  ok('the same wallet signature reopens the same eERC key');

  // Registration and its attacks.
  const regMira = await nodeProver('registration', registrationInput(kMira, mira.address, chain.id));
  await reverts(ctx, kai, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], /InvalidSender/, "kai cannot register with mira's proof");
  const wrongChain = await nodeProver('registration', registrationInput(kMira, mira.address, 43113));
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(wrongChain.proof, wrongChain.publicSignals)], /InvalidChainId/, 'a proof for another chain is refused');
  const forged = contractProof(regMira.proof, regMira.publicSignals);
  forged.publicSignals[0] = kKai.publicKey[0];
  forged.publicSignals[1] = kKai.publicKey[1];
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [forged], /InvalidProof|revert/, 'a proof with a swapped public key is refused');
  await send(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], 'mira registers');
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], /UserAlreadyRegistered/, 'registering twice is refused');

  await shieldBeforeAuditor();
  async function shieldBeforeAuditor() {
    await send(ctx, mira, post, postAbi as Abi, 'approve', [v.encryptedERC, 30n], 'mira approves vault');
    await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [30n, post, Array(7).fill(0n)], /Auditor public key not set/, 'nothing can be shielded before an auditor is set');
  }

  await register(ctx, v, auditor, kAud, nodeProver, 'auditor registers');
  await reverts(ctx, stranger, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [auditor.address], /OwnableUnauthorizedAccount|revert/, 'only the owner sets the auditor');
  await send(ctx, owner, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [auditor.address], 'owner sets auditor');
  const aud = await auditorKey(pub as never, v.encryptedERC);
  assert.deepEqual(aud.publicKey, kAud.publicKey);
  ok('auditor public key is on chain');

  console.log('Shield');
  await reverts(ctx, stranger, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [1n, post, Array(7).fill(0n)], /UserNotRegistered/, 'an unregistered account cannot shield');
  await shield(ctx, v, mira, kMira, post, 30n, 'mira shields 30');
  const [holders, balances] = await pub.readContract({ address: post, abi: postAbi, functionName: 'holders' });
  const vaultIdx = holders.findIndex((h) => h.toLowerCase() === v.encryptedERC.toLowerCase());
  assert.ok(vaultIdx >= 0);
  assert.equal(balances[vaultIdx], 30n);
  assert.equal(await pub.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [mira.address] }), 10n);
  ok("the post's public holder list shows the vault holding 30; mira shows 10");
  let m = await bag(ctx, v, mira.address, kMira, post);
  assert.equal(m.balance, 30n);
  ok("mira's own key decrypts 30 shielded");
  assert.throws(() => decryptBalance(kKai, m.b));
  ok("kai's key cannot open mira's bag");

  console.log('Send privately');
  await register(ctx, v, kai, kKai, nodeProver, 'kai registers');
  const sent = await sendPrivately(ctx, v, mira, kMira, post, kai.address, 12n, nodeProver, 'mira sends 12 privately to kai');
  m = await bag(ctx, v, mira.address, kMira, post);
  const k = await bag(ctx, v, kai.address, kKai, post);
  assert.equal(m.balance, 18n);
  assert.equal(k.balance, 12n);
  ok('after the private send: mira 18, kai 12, each read with their own key');
  const tx = await pub.getTransaction({ hash: sent.hash });
  assert.ok(!tx.input.includes((12n).toString(16).padStart(64, '0')));
  ok('the amount 12 appears nowhere in the transfer calldata');
  const movesPublic = await vaultMoves(pub as never, v.encryptedERC, 0n);
  assert.equal(movesPublic.find((x) => x.kind === 'transfer')?.amount, null);
  const movesAudited = await vaultMoves(pub as never, v.encryptedERC, 0n, kAud);
  assert.equal(movesAudited.find((x) => x.kind === 'transfer')?.amount, 12n);
  ok('the public sees a transfer of unknown size; the auditor decrypts 12');
  const movesWrongKey = await vaultMoves(pub as never, v.encryptedERC, 0n, kKai);
  assert.equal(movesWrongKey.find((x) => x.kind === 'transfer')?.amount, null);
  ok("a holder's key is not an auditor key");

  const { decodeFunctionData } = await import('viem');
  const replay = decodeFunctionData({ abi: encryptedErcAbi as Abi, data: tx.input });
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', replay.args as unknown[], /InvalidProof|InvalidBalance|revert/, 'replaying the same transfer proof is refused');

  console.log('Unshield and the attacks on it');
  const wIn = withdrawInput(kKai, 12n, k.b, 5n, aud.publicKey);
  const wProof = await nodeProver('withdraw', wIn.input);
  const wCall = contractProof(wProof.proof, wProof.publicSignals);
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], /InvalidProof|InvalidSender|revert/, "mira cannot submit kai's withdraw proof");
  const tampered = contractProof(wProof.proof, wProof.publicSignals);
  tampered.publicSignals[0] = 11n; // ValueToWithdraw
  await reverts(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, tampered, wIn.balancePCT], /InvalidProof|revert/, 'a withdraw proof with a raised amount is refused');
  const lie = withdrawInput(kKai, 50n, k.b, 40n, aud.publicKey);
  await assert.rejects(nodeProver('withdraw', lie.input));
  ok('no proof exists for unshielding more than the encrypted balance');
  await send(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], 'kai unshields 5');
  await reverts(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], /InvalidProof|InvalidBalance|revert/, 'replaying a withdraw proof is refused');
  assert.equal(await pub.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [kai.address] }), 15n);
  assert.equal((await bag(ctx, v, kai.address, kKai, post)).balance, 7n);
  ok('kai: 15 public (10 bought + 5 unshielded), 7 still shielded');
  await send(ctx, kai, post, postAbi as Abi, 'sell', [5n, 0n], 'kai sells the 5 he unshielded');
  ok('unshielded coins sell on the curve as normal');
  await unshield(ctx, v, mira, kMira, post, 18n, nodeProver, 'mira unshields everything');
  assert.equal((await bag(ctx, v, mira.address, kMira, post)).balance, 0n);
  assert.equal(await pub.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [mira.address] }), 28n);
  ok('an emptied bag decrypts to 0 and the coins are back in public');

  console.log(`\neERC local end-to-end: ${checks}/${checks} checks passed, ${ctx.log.length} transactions`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeProver();
  stop();
  process.exit(process.exitCode ?? 0);
}
