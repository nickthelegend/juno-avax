/**
 * "Hide your bag" on Avalanche Fuji: deploy the Juno eERC vault (Ava Labs'
 * EncryptedERC in converter mode, production verifiers) once, set its
 * auditor, then let the three test holders register, shield, move bags
 * privately and unshield to sell. Every transaction goes into
 * deployments/fuji.json → eerc.
 *
 *   cd scripts && npx tsx eerc/fuji.ts            # deploy (if needed) + seed
 *   cd scripts && npx tsx eerc/fuji.ts deploy     # deploy + auditor only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, formatEther, http, parseEther, type Abi, type Address } from 'viem';
import { client, fuji, FUJI_RPC, FUJI_EXPLORER, postAbi } from '@juno/sdk';
import { encryptedErcAbi } from '@juno/sdk/eerc';
import { account, ROOT } from '../fuji/env.ts';
import { bag, closeProver, deployVault, nodeProver, openKey, register, send, sendPrivately, shield, unshield, type Ctx, type Vault } from './vault.ts';

const FILE = join(ROOT, 'deployments/fuji.json');
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const save = () => writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
const pub = client();
const ctx: Ctx = { pub, chain: fuji, rpc: FUJI_RPC, log: [] };
const owner = account('JUNO_DEPLOYER_KEY');
const auditor = account('JUNO_AUDITOR_KEY');
const mira = account('JUNO_MIRA_KEY');
const kai = account('JUNO_KAI_KEY');
const oto = account('JUNO_OTO_KEY');
const post = (slug: string) => data.posts[slug] as Address;

function persist() {
  data.eerc ??= {};
  data.eerc.transactions = [...(data.eerc.transactions ?? []), ...ctx.log.splice(0)];
  save();
}

try {
  data.accounts.auditor = auditor.address;
  let v: Vault = data.eerc?.vault;
  if (!v) {
    const gas = await pub.getBalance({ address: auditor.address });
    if (gas < parseEther('0.002')) {
      const w = createWalletClient({ account: owner, chain: fuji, transport: http(FUJI_RPC) });
      const hash = await w.sendTransaction({ to: auditor.address, value: parseEther('0.003') - gas });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`funded auditor for gas ${hash}`);
    }
    v = await deployVault(ctx, owner);
    data.eerc = {
      vault: v,
      source: 'https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1',
      mode: 'converter',
      decimals: 0,
      owner: owner.address,
      auditor: auditor.address,
      deployedAt: new Date().toISOString(),
      snowtrace: `${FUJI_EXPLORER}/address/${v.encryptedERC}`,
      startBlock: Number((await pub.getTransactionReceipt({ hash: ctx.log.at(-1)!.hash })).blockNumber),
    };
    persist();
  }
  const kAud = await openKey(auditor, fuji.id);
  await register(ctx, v, auditor, kAud, nodeProver, 'auditor registers');
  const current = await pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'auditor' });
  if (current.toLowerCase() !== auditor.address.toLowerCase()) {
    await send(ctx, owner, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [auditor.address], 'owner sets auditor');
  }
  persist();
  if (process.argv[2] === 'deploy') throw 'done';

  const keys = { mira: await openKey(mira, fuji.id), kai: await openKey(kai, fuji.id), oto: await openKey(oto, fuji.id) };
  for (const [name, who] of [['mira', mira], ['kai', kai], ['oto', oto]] as const) await register(ctx, v, who, keys[name], nodeProver, `${name} registers`);
  persist();

  const plan = data.eerc.seeded ?? {};
  const step = async (id: string, fn: () => Promise<unknown>) => {
    if (plan[id]) return;
    await fn();
    plan[id] = true;
    data.eerc.seeded = plan;
    persist();
  };
  // The PILE-IN whale hides most of the bag; a slice of it moves to oto without anyone seeing how much.
  await step('kai-shield-pile-in', () => shield(ctx, v, kai, keys.kai, post('pile-in'), 600n, 'kai shields 600 PILE-IN'));
  await step('kai-send-oto-pile-in', () => sendPrivately(ctx, v, kai, keys.kai, post('pile-in'), oto.address, 150n, nodeProver, 'kai sends PILE-IN to oto privately'));
  await step('oto-unshield-pile-in', () => unshield(ctx, v, oto, keys.oto, post('pile-in'), 50n, nodeProver, 'oto unshields 50 PILE-IN'));
  await step('oto-redeem-pile-in', async () => {
    const [quote] = [await pub.readContract({ address: post('pile-in'), abi: postAbi, functionName: 'quoteRedeem', args: [10n] })];
    return send(ctx, oto, post('pile-in'), postAbi as Abi, 'redeem', [10n, (quote * 99n) / 100n], 'oto redeems 10 unshielded PILE-IN');
  });
  // SPROUT: oto shields, slips 20 to mira, who unshields some and sells.
  await step('oto-shield-sprout', () => shield(ctx, v, oto, keys.oto, post('sprout'), 60n, 'oto shields 60 SPROUT'));
  await step('oto-send-mira-sprout', () => sendPrivately(ctx, v, oto, keys.oto, post('sprout'), mira.address, 20n, nodeProver, 'oto sends SPROUT to mira privately'));
  await step('mira-unshield-sprout', () => unshield(ctx, v, mira, keys.mira, post('sprout'), 10n, nodeProver, 'mira unshields 10 SPROUT'));
  await step('mira-sell-sprout', () => send(ctx, mira, post('sprout'), postAbi as Abi, 'sell', [5n, 0n], 'mira sells 5 unshielded SPROUT'));
  // BALLOONS and GLOW-UP: two more bags go dark.
  await step('mira-shield-balloons', () => shield(ctx, v, mira, keys.mira, post('balloons'), 30n, 'mira shields 30 BALLOONS'));
  await step('oto-shield-glow-up', () => shield(ctx, v, oto, keys.oto, post('glow-up'), 40n, 'oto shields 40 GLOW-UP'));

  console.log('\nBags now (each read with its owner key):');
  for (const [name, who] of [['mira', mira], ['kai', kai], ['oto', oto]] as const) {
    for (const slug of ['pile-in', 'sprout', 'balloons', 'glow-up']) {
      const b = await bag(ctx, v, who.address, keys[name], post(slug));
      if (b.balance > 0n) console.log(`  ${name} ${slug}: ${b.balance} shielded`);
    }
  }
  console.log(`owner left ${formatEther(await pub.getBalance({ address: owner.address }))} AVAX`);
} catch (e) {
  if (e !== 'done') {
    persist();
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  await closeProver();
  process.exit(process.exitCode ?? 0);
}
