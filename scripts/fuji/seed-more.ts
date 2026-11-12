/**
 * Two more posts from the seeded accounts, appended to deployments/fuji.json →
 * seed (and posts). Same flow as seed.ts: launch, sealed bids, reveals,
 * settlement, refunds, then a few curve trades. Salts go to the gitignored
 * .seed-secrets.json before any bid is sent.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEventLog, formatEther, parseEther, type Address, type Hex } from 'viem';
import { commitment, factoryAbi, postAbi, quoteBuy as readQuote, FUJI_CHAIN_ID } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { call, deployment, pub, record, untilChainTime, type Sent } from './tx.ts';

const P = { mira: account('JUNO_MIRA_KEY'), kai: account('JUNO_KAI_KEY'), oto: account('JUNO_OTO_KEY') };
type Who = keyof typeof P;
const d = deployment() as ReturnType<typeof deployment> & { seed: Sent[]; posts: Record<string, Address> };
const log: Sent[] = d.seed;
const posts = d.posts;
const run = async (p: Promise<Sent>) => {
  const s = await p;
  log.push(s);
  record('seed', log);
  if (s.status !== 'success') throw Error(`${s.label} failed: ${s.hash}`);
  return s;
};
const e12 = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 10n;
const buy = async (who: Who, post: Address, q: bigint, label: string) => {
  const total = await readQuote(pub, post, q);
  await run(call(P[who], post, postAbi, 'buy', [q], (total * 102n) / 100n, label));
};
const secretsFile = join(ROOT, '.seed-secrets.json');
const secrets: Record<string, Hex> = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {};
const saltFor = (key: string): Hex => {
  if (!secrets[key]) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    secrets[key] = `0x${Buffer.from(b).toString('hex')}` as Hex;
    writeFileSync(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets[key]!;
};

const PLANS = [
  {
    slug: 'sunset-dump', creator: 'oto' as Who, art: '/art/juno-mobile-hero.webp',
    caption: 'Camera roll from the weekend. Every sunset gets a coin.',
    bids: [{ who: 'mira' as Who, amount: 40n, price: e12(6) }, { who: 'kai' as Who, amount: 50n, price: e12(5) }],
    after: async (t: Address) => {
      await buy('mira', t, 20n, 'sunset_dump_buy_20');
      await buy('kai', t, 12n, 'sunset_dump_buy_12');
    },
  },
  {
    slug: 'glow-up', creator: 'mira' as Who, art: '/art/juno-hero.webp',
    caption: 'Before and after. Mostly after.',
    bids: [{ who: 'oto' as Who, amount: 60n, price: e12(7) }, { who: 'kai' as Who, amount: 30n, price: e12(6) }],
    after: async (t: Address) => {
      await buy('oto', t, 25n, 'glow_up_buy_25');
      await run(call(P.oto, t, postAbi, 'sell', [5n, 0n], 0n, 'glow_up_sell_5'));
    },
  },
];

for (const plan of PLANS) {
  if (posts[plan.slug]) throw Error(`${plan.slug} already seeded`);
  const sent = await run(call(P[plan.creator], d.factory.address, factoryAbi, 'createPost', [plan.slug, plan.caption, plan.art, ''], 0n, `create_post_${plan.slug}`));
  const receipt = await pub.getTransactionReceipt({ hash: sent.hash });
  for (const l of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
      if (ev.eventName === 'PostCreated') posts[plan.slug] = ev.args.post;
    } catch { /* another event */ }
  }
  record('posts', posts);
}
for (const plan of PLANS) {
  for (const b of plan.bids) {
    const c = commitment(posts[plan.slug]!, FUJI_CHAIN_ID, P[b.who].address, b.amount, b.price, saltFor(`${plan.slug}:${b.who}`));
    await run(call(P[b.who], posts[plan.slug]!, postAbi, 'commit', [c], parseEther('0.005'), `${plan.slug}_sealed_bid_${b.who}`));
  }
}
const end = async (fn: 'commitEnd' | 'revealEnd') => Math.max(...(await Promise.all(PLANS.map((p) => pub.readContract({ address: posts[p.slug]!, abi: postAbi, functionName: fn })))).map(Number));
await untilChainTime(await end('commitEnd'));
for (const plan of PLANS) for (const b of plan.bids) await run(call(P[b.who], posts[plan.slug]!, postAbi, 'reveal', [b.amount, b.price, saltFor(`${plan.slug}:${b.who}`)], 0n, `${plan.slug}_reveal_${b.who}`));
await untilChainTime(await end('revealEnd'));
for (const plan of PLANS) {
  const t = posts[plan.slug]!;
  await run(call(P[plan.creator], t, postAbi, 'settle', [], 0n, `${plan.slug}_settle`));
  for (const b of plan.bids) await run(call(P[b.who], t, postAbi, 'claimRefund', [], 0n, `${plan.slug}_refund_${b.who}`));
  await plan.after(t);
}

const receipts = log.map((s) => s.confirmMs).sort((a, b) => a - b);
const blocks = log.map((s) => s.blockMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
const pick = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
const prev = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8')).seedStats ?? {};
record('seedStats', {
  ...prev,
  txs: log.length, failed: log.filter((s) => s.status !== 'success').length, measured: log.length,
  confirmMsMedian: pick(receipts, 0.5), confirmMsP90: pick(receipts, 0.9), confirmMsMin: receipts[0], confirmMsMax: receipts[receipts.length - 1],
  blockMsMeasured: blocks.length, blockMsMedian: pick(blocks, 0.5), blockMsP90: pick(blocks, 0.9), blockMsMin: blocks[0], blockMsMax: blocks[blocks.length - 1],
});
console.log(`done: ${log.length} seed txs in total`);
for (const who of Object.keys(P) as Who[]) console.log(`${who} ${formatEther(await pub.getBalance({ address: P[who].address }))} AVAX`);
