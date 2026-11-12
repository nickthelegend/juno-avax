/**
 * The Juno eERC vault from Node: deploy Ava Labs' EncryptedERC in converter
 * mode (from the pinned submodule's Foundry build), then register, shield,
 * send privately and unshield with real Groth16 proofs (snarkjs, the
 * production zkeys shipped in contracts/lib/EncryptedERC/circom/build).
 *
 * Used by the local Anvil test (local-e2e.ts) and the Fuji scripts. Nothing
 * here prints a key: holders' eERC keys come from a wallet signature over
 * keyMessage(), exactly as in the web app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createWalletClient, decodeEventLog, encodeFunctionData, http, type Abi, type Address, type Chain, type Hex, type PrivateKeyAccount, type PublicClient,
} from 'viem';
import {
  auditorKey, contractProof, decryptBalance, depositPct, encryptedBalance, encryptedErcAbi, keyMessage, keypairFromSignature,
  registeredKey, registrarAbi, registrationInput, transferInput, withdrawInput, type Circuit, type Keypair, type Prover,
} from '@juno/sdk/eerc';
import { postAbi } from '@juno/sdk';
import { ROOT } from '../fuji/env.ts';

const require = createRequire(import.meta.url);
const BUILD = join(ROOT, 'contracts/lib/EncryptedERC/circom/build');
export const CIRCUIT_FILES: Record<Circuit, { wasm: string; zkey: string }> = {
  registration: { wasm: join(BUILD, 'registration/registration.wasm'), zkey: join(BUILD, 'registration/circuit_final.zkey') },
  transfer: { wasm: join(BUILD, 'transfer/transfer.wasm'), zkey: join(BUILD, 'transfer/transfer.zkey') },
  withdraw: { wasm: join(BUILD, 'withdraw/withdraw.wasm'), zkey: join(BUILD, 'withdraw/circuit_final.zkey') },
};

const strings = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(strings) : v);

export const nodeProver: Prover = async (circuit, input) => {
  const snarkjs = require('snarkjs');
  const flat = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strings(v)]));
  const { wasm, zkey } = CIRCUIT_FILES[circuit];
  const t0 = Date.now();
  const out = await snarkjs.groth16.fullProve(flat, wasm, zkey);
  console.log(`     proof ${circuit} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return out;
};

export async function closeProver() {
  const curve = (globalThis as { curve_bn128?: { terminate: () => Promise<void> } }).curve_bn128;
  if (curve) await curve.terminate();
}

function artifact(name: string, file = name) {
  const j = JSON.parse(readFileSync(join(ROOT, 'contracts/out-eerc', `${file}.sol`, `${name}.json`), 'utf8'));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex, links: j.bytecode.linkReferences as Record<string, Record<string, { start: number; length: number }[]>> };
}

export type Sent = { label: string; from: Address; to: Address | null; hash: Hex; status: string; block: number; gasUsed: number; ms: number; at: string };
export type Ctx = { pub: PublicClient; chain: Chain; rpc: string; log: Sent[] };

export async function send(ctx: Ctx, who: PrivateKeyAccount, to: Address, abi: Abi, functionName: string, args: readonly unknown[], label: string, value = 0n): Promise<Sent> {
  const wallet = createWalletClient({ account: who, chain: ctx.chain, transport: http(ctx.rpc) });
  const data = encodeFunctionData({ abi, functionName, args } as never);
  await ctx.pub.call({ account: who.address, to, data, value }); // refuse before broadcasting, with the contract's reason
  const t0 = Date.now();
  const hash = await wallet.sendTransaction({ to, data, value } as never);
  const r = await ctx.pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  const sent: Sent = { label, from: who.address, to, hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), ms: Date.now() - t0, at: new Date().toISOString() };
  console.log(`${r.status === 'success' ? 'ok  ' : 'FAIL'} ${label.padEnd(40)} ${hash} ${sent.ms}ms gas ${r.gasUsed}`);
  if (r.status !== 'success') throw Error(`${label} reverted: ${hash}`);
  ctx.log.push(sent);
  return sent;
}

async function deploy(ctx: Ctx, who: PrivateKeyAccount, name: string, args: unknown[] = [], libs: Record<string, Address> = {}, file = name) {
  const a = artifact(name, file);
  let code = a.bytecode;
  for (const [, byName] of Object.entries(a.links ?? {})) {
    for (const [lib, spots] of Object.entries(byName)) {
      const addr = libs[lib];
      if (!addr) throw Error(`missing library ${lib}`);
      for (const s of spots) code = `${code.slice(0, 2 + s.start * 2)}${addr.slice(2).toLowerCase()}${code.slice(2 + (s.start + s.length) * 2)}` as Hex;
    }
  }
  const wallet = createWalletClient({ account: who, chain: ctx.chain, transport: http(ctx.rpc) });
  const t0 = Date.now();
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: code, args } as never);
  const r = await ctx.pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  if (r.status !== 'success' || !r.contractAddress) throw Error(`deploy ${name} failed: ${hash}`);
  const sent: Sent = { label: `deploy ${name}`, from: who.address, to: null, hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), ms: Date.now() - t0, at: new Date().toISOString() };
  ctx.log.push(sent);
  console.log(`ok   deploy ${name.padEnd(33)} ${r.contractAddress} gas ${r.gasUsed}`);
  return r.contractAddress;
}

export type Vault = {
  encryptedERC: Address;
  registrar: Address;
  babyJubJub: Address;
  verifiers: { registration: Address; mint: Address; withdraw: Address; transfer: Address; burn: Address };
};

/** Same order and parameters as upstream scripts/deploy-converter.ts with isProd = true, decimals 0. */
export async function deployVault(ctx: Ctx, owner: PrivateKeyAccount): Promise<Vault> {
  const registration = await deploy(ctx, owner, 'RegistrationVerifier');
  const mint = await deploy(ctx, owner, 'MintVerifier');
  const withdraw = await deploy(ctx, owner, 'WithdrawVerifier');
  const transfer = await deploy(ctx, owner, 'TransferVerifier');
  const burn = await deploy(ctx, owner, 'BurnVerifier');
  const babyJubJub = await deploy(ctx, owner, 'BabyJubJub');
  const registrar = await deploy(ctx, owner, 'Registrar', [registration]);
  const encryptedERC = await deploy(ctx, owner, 'EncryptedERC', [
    { registrar, isConverter: true, name: '', symbol: '', decimals: 0, mintVerifier: mint, withdrawVerifier: withdraw, transferVerifier: transfer, burnVerifier: burn },
  ], { BabyJubJub: babyJubJub });
  return { encryptedERC, registrar, babyJubJub, verifiers: { registration, mint, withdraw, transfer, burn } };
}

export async function openKey(who: PrivateKeyAccount, chainId: number): Promise<Keypair> {
  return keypairFromSignature(await who.signMessage({ message: keyMessage(who.address, chainId) }));
}

export async function register(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, prover: Prover, label: string) {
  if (await registeredKey(ctx.pub, v.registrar, who.address)) return null;
  const { proof, publicSignals } = await prover('registration', registrationInput(k, who.address, ctx.chain.id));
  return send(ctx, who, v.registrar, registrarAbi as Abi, 'register', [contractProof(proof, publicSignals)], label);
}

export async function tokenId(ctx: Ctx, v: Vault, token: Address): Promise<bigint> {
  return ctx.pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [token] });
}

export async function bag(ctx: Ctx, v: Vault, who: Address, k: Keypair, token: Address) {
  const id = await tokenId(ctx, v, token);
  const b = await encryptedBalance(ctx.pub, v.encryptedERC, who, id);
  return { id, b, balance: id === 0n ? 0n : decryptBalance(k, b) };
}

export async function shield(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, amount: bigint, label: string) {
  const allowance = await ctx.pub.readContract({ address: token, abi: postAbi, functionName: 'allowance', args: [who.address, v.encryptedERC] });
  if (allowance < amount) await send(ctx, who, token, postAbi as Abi, 'approve', [v.encryptedERC, amount], `${label} approve`);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [amount, token, depositPct(k, amount)], label);
}

export async function sendPrivately(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, to: Address, amount: bigint, prover: Prover, label: string) {
  const { id, b, balance } = await bag(ctx, v, who.address, k, token);
  const toKey = await registeredKey(ctx.pub, v.registrar, to);
  if (!toKey) throw Error(`${to} has not opened a private bag yet`);
  const auditor = await auditorKey(ctx.pub, v.encryptedERC);
  const t = transferInput(k, balance, b, toKey, amount, auditor.publicKey);
  const { proof, publicSignals } = await prover('transfer', t.input);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [to, id, contractProof(proof, publicSignals), t.balancePCT], label);
}

export async function unshield(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, amount: bigint, prover: Prover, label: string) {
  const { id, b, balance } = await bag(ctx, v, who.address, k, token);
  const auditor = await auditorKey(ctx.pub, v.encryptedERC);
  const w = withdrawInput(k, balance, b, amount, auditor.publicKey);
  const { proof, publicSignals } = await prover('withdraw', w.input);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [id, contractProof(proof, publicSignals), w.balancePCT], label);
}

export function postFrom(receiptLogs: { data: Hex; topics: readonly Hex[] }[], abi: Abi): Address {
  for (const l of receiptLogs) {
    try {
      const ev = decodeEventLog({ abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as { eventName: string; args: { post?: Address } };
      if (ev.eventName === 'PostCreated' && ev.args.post) return ev.args.post;
    } catch { /* another contract's event */ }
  }
  throw Error('no PostCreated event');
}
