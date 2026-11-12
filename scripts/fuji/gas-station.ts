/**
 * Juno v2.1 zero-setup judge path on Fuji: deploys JunoGasStation (owner = Juno's deployer, relayer = a dedicated
 * Juno sponsor key that only Juno's API holds) and funds it modestly from Juno's own test accounts.
 *   npx tsx fuji/gas-station.ts          deploy (once) and fund up to JUNO_STATION_TARGET (default 0.05 AVAX)
 * Further top-ups come from the Avalanche funding hub (avax/.hub/fund.sh juno <station> <AVAX> "<why>").
 * Keys are read by name from the repo's gitignored .env; nothing here prints one. Missing JUNO_SPONSOR_KEY and
 * JUNO_TAG_SECRET are created once (appended to .env, mode 600).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createWalletClient, formatEther, http, parseEther, type Abi, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fuji, FUJI_RPC } from '@juno/sdk';
import { account, readEnv, ROOT } from './env.ts';
import { deployment, pub, record } from './tx.ts';
import { confirmTx } from '../../web/lib/tx-status.ts';

const ENV = join(ROOT, '.env');
if (!readEnv().JUNO_SPONSOR_KEY) appendFileSync(ENV, `JUNO_SPONSOR_KEY=${generatePrivateKey()}\n`, { mode: 0o600 });
if (!readEnv().JUNO_TAG_SECRET) appendFileSync(ENV, `JUNO_TAG_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
const sponsor = privateKeyToAccount(readEnv().JUNO_SPONSOR_KEY as Hex);
const deployer = account('JUNO_DEPLOYER_KEY');

const DRIP = parseEther('0.008');
const DAILY_CAP = 12;
const PER_TAG = 3;
const target = parseEther(process.env.JUNO_STATION_TARGET ?? '0.05');

type Entry = { label: string; from: Address; to: Address | null; hash: Hex; status: string; block: number; confirmMs: number; at: string };
const d = deployment() as Record<string, any>;
const gs: { address?: Address; config?: unknown; txs: Entry[] } = d.gasStation ?? { txs: [] };
const save = () => record('gasStation', gs);

async function send(who: ReturnType<typeof account>, label: string, req: { to?: Address; value?: bigint; data?: Hex }): Promise<{ hash: Hex; contract?: Address }> {
  const wallet = createWalletClient({ account: who, chain: fuji, transport: http(FUJI_RPC) });
  const prepared = await wallet.prepareTransactionRequest({ ...req } as never);
  const hash = await wallet.sendRawTransaction({ serializedTransaction: await wallet.signTransaction(prepared as never) });
  const done = await confirmTx(pub, hash);
  const r = await pub.getTransactionReceipt({ hash });
  gs.txs.push({ label, from: who.address, to: (req.to ?? r.contractAddress ?? null) as Address | null, hash, status: r.status, block: Number(r.blockNumber), confirmMs: done.ms, at: new Date().toISOString() });
  save();
  console.log(`${r.status === 'success' ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${hash}`);
  if (r.status !== 'success') throw Error(`${label} reverted: ${hash}`);
  return { hash, contract: r.contractAddress ?? undefined };
}

if (!gs.address) {
  const art = JSON.parse(readFileSync(join(ROOT, 'contracts/out/JunoGasStation.sol/JunoGasStation.json'), 'utf8'));
  const { encodeDeployData } = await import('viem');
  const data = encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode.object as Hex, args: [sponsor.address, DRIP, DAILY_CAP, PER_TAG] });
  const { contract } = await send(deployer, 'deploy_JunoGasStation', { data });
  gs.address = contract!;
  gs.config = { dripAvax: formatEther(DRIP), dailyCap: DAILY_CAP, perRequesterDaily: PER_TAG, relayer: sponsor.address, owner: deployer.address };
  save();
}
const station = gs.address!;

// Fund from Juno's own test accounts, leaving each enough for its own seeding (Fuji gas is ~160 wei).
const KEEP = parseEther('0.012');
for (const role of ['JUNO_KAI_KEY', 'JUNO_OTO_KEY'] as const) {
  const have = await pub.getBalance({ address: station });
  if (have >= target) break;
  const from = account(role);
  const bal = await pub.getBalance({ address: from.address });
  const give = bal - KEEP < target - have ? bal - KEEP : target - have;
  if (give <= 0n) continue;
  await send(from, `fund_station_${role.replace(/^JUNO_|_KEY$/g, '').toLowerCase()}`, { to: station, value: give });
}
// The relayer pays the drip txs' own gas.
const sBal = await pub.getBalance({ address: sponsor.address });
if (sBal < parseEther('0.0002')) await send(account('JUNO_OTO_KEY'), 'fund_relayer_gas', { to: sponsor.address, value: parseEther('0.0005') - sBal });
console.log(`station ${station} holds ${formatEther(await pub.getBalance({ address: station }))} AVAX; relayer ${sponsor.address} holds ${formatEther(await pub.getBalance({ address: sponsor.address }))}`);
