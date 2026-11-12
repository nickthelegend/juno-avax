/**
 * Juno on Avalanche C-Chain MAINNET (43114) — for Nick to run himself.
 * Nothing in this repo has been deployed to mainnet, and this script was
 * never run with --broadcast by an agent.
 *
 *   cd scripts
 *   npx tsx mainnet/deploy.ts                 # dry run: checks chain, bytecode, gas and cost; sends nothing
 *   JUNO_MAINNET_DEPLOYER_KEY=… JUNO_MAINNET_CONFIRM=deploy-juno-on-43114 \
 *     npx tsx mainnet/deploy.ts --broadcast   # deploys JunoFactory (and with --with-vault, the eERC vault)
 *
 * Safety rails:
 *  - the RPC must report chain id 43114, or it stops;
 *  - --broadcast needs JUNO_MAINNET_CONFIRM=deploy-juno-on-43114 typed out;
 *  - the key is read from the environment by name, never printed or written;
 *  - it prints the estimated cost and waits 10 seconds (Ctrl-C to stop);
 *  - it refuses if the deployer holds less than the estimate plus 20%;
 *  - it writes deployments/mainnet.json and refuses to overwrite an existing one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, http, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { factoryAbi } from '@juno/sdk';
import { ROOT } from '../fuji/env.ts';

const RPC = process.env.JUNO_MAINNET_RPC ?? 'https://api.avax.network/ext/bc/C/rpc';
const EXPLORER = 'https://snowtrace.io';
const CONFIRM = 'deploy-juno-on-43114';
const OUT = join(ROOT, 'deployments/mainnet.json');
const broadcast = process.argv.includes('--broadcast');
const withVault = process.argv.includes('--with-vault');

const avalanche = defineChain({ id: 43114, name: 'Avalanche C-Chain', nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Snowtrace', url: EXPLORER } } });
const pub = createPublicClient({ chain: avalanche, transport: http(RPC) });

const chainId = await pub.getChainId();
if (chainId !== 43114) throw Error(`Refusing: ${RPC} reports chain ${chainId}, not Avalanche C-Chain mainnet (43114).`);

type Plan = { name: string; abi: Abi; bytecode: Hex; args: unknown[]; libs?: Record<string, string> };
const art = (dir: string, name: string) => JSON.parse(readFileSync(join(ROOT, 'contracts', dir, `${name}.sol`, `${name}.json`), 'utf8'));
const factory = art('out', 'JunoFactory');
const plans: Plan[] = [{ name: 'JunoFactory', abi: factoryAbi as Abi, bytecode: factory.bytecode.object, args: [] }];
if (withVault) {
  for (const v of ['RegistrationVerifier', 'MintVerifier', 'WithdrawVerifier', 'TransferVerifier', 'BurnVerifier', 'BabyJubJub']) {
    const a = art('out-eerc', v);
    plans.push({ name: v, abi: a.abi, bytecode: a.bytecode.object, args: [] });
  }
  // Registrar and EncryptedERC take addresses known only after the verifiers land; estimated with placeholders.
  const reg = art('out-eerc', 'Registrar');
  plans.push({ name: 'Registrar', abi: reg.abi, bytecode: reg.bytecode.object, args: ['0x0000000000000000000000000000000000000001'] });
  const eerc = art('out-eerc', 'EncryptedERC');
  plans.push({ name: 'EncryptedERC', abi: eerc.abi, bytecode: eerc.bytecode.object, args: [], libs: eerc.bytecode.linkReferences });
}

const key = process.env.JUNO_MAINNET_DEPLOYER_KEY as Hex | undefined;
const deployer: Address = key ? privateKeyToAccount(key).address : '0x000000000000000000000000000000000000dEaD';
const [gasPrice, balance, head] = await Promise.all([pub.getGasPrice(), key ? pub.getBalance({ address: deployer }) : Promise.resolve(0n), pub.getBlockNumber()]);

console.log(`Avalanche C-Chain mainnet via ${RPC}, block ${head}`);
console.log(`deployer ${key ? deployer : '(no key: dry run with a placeholder address)'}${key ? `, balance ${formatEther(balance)} AVAX` : ''}`);
let totalGas = 0n;
for (const p of plans) {
  // Estimate creation gas from the bytecode itself (the EncryptedERC estimate links a placeholder library).
  let code = p.bytecode;
  if (p.libs) for (const spots of Object.values(p.libs)) for (const list of Object.values(spots as Record<string, { start: number; length: number }[]>)) for (const s of list) code = `${code.slice(0, 2 + s.start * 2)}${'00'.repeat(19)}01${code.slice(2 + (s.start + s.length) * 2)}` as Hex;
  const data = p.name === 'EncryptedERC'
    ? encodeDeployData({ abi: p.abi, bytecode: code, args: [{ registrar: '0x0000000000000000000000000000000000000001', isConverter: true, name: '', symbol: '', decimals: 0, mintVerifier: '0x0000000000000000000000000000000000000001', withdrawVerifier: '0x0000000000000000000000000000000000000001', transferVerifier: '0x0000000000000000000000000000000000000001', burnVerifier: '0x0000000000000000000000000000000000000001' }] } as never)
    : encodeDeployData({ abi: p.abi, bytecode: code, args: p.args } as never);
  const gas = await pub.estimateGas({ account: deployer, data }).catch(() => BigInt(Math.ceil((data.length / 2) * 220)));
  totalGas += gas;
  console.log(`  ${p.name.padEnd(22)} ~${gas} gas  ~${formatEther(gas * gasPrice)} AVAX`);
}
const cost = totalGas * gasPrice;
console.log(`total ~${totalGas} gas at ${formatEther(gasPrice * 10n ** 9n)} nAVAX/gas ≈ ${formatEther(cost)} AVAX (plus 20% margin required: ${formatEther((cost * 12n) / 10n)})`);

if (!broadcast) {
  console.log('\nDry run only. Nothing was sent. See scripts/deploy-mainnet.md before using --broadcast.');
  process.exit(0);
}
if (!key) throw Error('Setup required: JUNO_MAINNET_DEPLOYER_KEY (a mainnet key you control; never commit it)');
if (process.env.JUNO_MAINNET_CONFIRM !== CONFIRM) throw Error(`Refusing to broadcast: set JUNO_MAINNET_CONFIRM=${CONFIRM}`);
if (existsSync(OUT)) throw Error('deployments/mainnet.json already exists. Move it aside if you really mean to deploy again.');
if (balance < (cost * 12n) / 10n) throw Error(`Deployer holds ${formatEther(balance)} AVAX; needs about ${formatEther((cost * 12n) / 10n)}.`);
if (withVault) throw Error('The eERC vault on mainnet needs an auditor decision first (scripts/deploy-mainnet.md, step 5). Deploy the factory alone, then run scripts/eerc/fuji.ts adapted for 43114.');

console.log('\nBroadcasting to MAINNET in 10 s. Ctrl-C to stop.');
await new Promise((r) => setTimeout(r, 10_000));
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: avalanche, transport: http(RPC) });
const hash = await wallet.deployContract({ abi: factoryAbi, bytecode: factory.bytecode.object as Hex });
console.log(`sent ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success' || !receipt.contractAddress) throw Error(`deploy failed: ${EXPLORER}/tx/${hash}`);
writeFileSync(OUT, `${JSON.stringify({ network: { name: 'Avalanche C-Chain', chainId: 43114, rpc: RPC, explorer: EXPLORER }, factory: { address: receipt.contractAddress, deployTx: hash, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed), deployer, deployedAt: new Date().toISOString(), snowtrace: `${EXPLORER}/address/${receipt.contractAddress}` } }, null, 2)}\n`);
console.log(`JunoFactory on mainnet: ${EXPLORER}/address/${receipt.contractAddress}`);
