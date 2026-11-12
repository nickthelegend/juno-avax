/**
 * Funds the Juno test accounts on Fuji.
 *  1. From an already-funded Fuji key in another local repo's env file
 *     (JUNO_FUNDER_ENV = path, JUNO_FUNDER_VAR = variable name; read here,
 *     never printed or copied), send JUNO_FUND_AVAX to the Juno deployer.
 *  2. From the deployer, top each player and the QA signer up to its target.
 */
import { createWalletClient, formatEther, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { client, fuji, FUJI_RPC } from '@juno/sdk';
import { account, readEnv } from './env.ts';

const pub = client();
const targets: Record<string, string> = { JUNO_MIRA_KEY: '0.022', JUNO_KAI_KEY: '0.07', JUNO_OTO_KEY: '0.045', JUNO_QA_KEY: '0.015' };

async function send(from: ReturnType<typeof privateKeyToAccount>, to: `0x${string}`, value: bigint, label: string) {
  const w = createWalletClient({ account: from, chain: fuji, transport: http(FUJI_RPC) });
  const t0 = Date.now();
  const hash = await w.sendTransaction({ to, value });
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  console.log(`${label}: ${formatEther(value)} AVAX -> ${to} ${hash} status=${r.status} ${Date.now() - t0}ms`);
}

const deployer = account('JUNO_DEPLOYER_KEY');
const want = parseEther(process.env.JUNO_FUND_AVAX ?? '0.15');
const have = await pub.getBalance({ address: deployer.address });
if (have < want / 2n) {
  const file = process.env.JUNO_FUNDER_ENV;
  const name = process.env.JUNO_FUNDER_VAR ?? 'PRIVATE_KEY';
  if (!file) throw Error('Setup required: JUNO_FUNDER_ENV (path to an env file holding a funded Fuji key)');
  const key = readEnv(file)[name];
  if (!key) throw Error(`Setup required: ${name} in the funder env file`);
  const funder = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
  console.log(`funder ${funder.address} balance ${formatEther(await pub.getBalance({ address: funder.address }))} AVAX`);
  await send(funder, deployer.address, want - have, 'fund deployer');
}
for (const [role, amount] of Object.entries(targets)) {
  const a = account(role as never);
  const bal = await pub.getBalance({ address: a.address });
  const target = parseEther(amount);
  if (bal < target) await send(deployer, a.address, target - bal, `top up ${role.replace(/_KEY$/, '')}`);
}
console.log(`deployer left ${formatEther(await pub.getBalance({ address: deployer.address }))} AVAX`);
