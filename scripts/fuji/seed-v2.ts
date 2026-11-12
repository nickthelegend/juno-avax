/**
 * v2: three more posts from the seeded accounts (one with a live dare), appended to deployments/fuji.json →
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

const PLANS: { slug: string; creator: Who; art: string; caption: string; dare?: string; bond?: bigint; bids: { who: Who; amount: bigint; price: bigint }[]; after: (t: Address) => Promise<void> }[] = [
  {
    slug: 'night-market', creator: 'kai', art: '/art/juno-feature-2.webp',
    caption: 'Street food at 1am. The dumpling stall had a queue round the block.',
    bids: [{ who: 'oto', amount: 50n, price: e12(6) }, { who: 'mira', amount: 30n, price: e12(5) }],
    after: async (t: Address) => {
      await buy('mira', t, 15n, 'night_market_buy_15');
      await buy('oto', t, 30n, 'night_market_buy_30');
      await run(call(P.mira, t, postAbi, 'sell', [4n, 0n], 0n, 'night_market_sell_4'));
    },
  },
  {
    slug: 'first-ollie', creator: 'oto', art: '/art/juno-onboard-1.webp',
    caption: 'Landed my first ollie. Dare: a kickflip on video by Sunday.',
    dare: 'Kickflip on video by Sunday', bond: parseEther('0.002'),
    bids: [{ who: 'kai', amount: 70n, price: e12(8) }, { who: 'mira', amount: 20n, price: e12(7) }],
    after: async (t: Address) => {
      await buy('kai', t, 40n, 'first_ollie_buy_40');
      await buy('mira', t, 10n, 'first_ollie_buy_10');
    },
  },
  {
    slug: 'coffee-run', creator: 'mira', art: '/art/juno-feature-3.webp',
    caption: 'Ranking every flat white on my street. Day 1 of 30.',
    bids: [{ who: 'kai', amount: 40n, price: e12(5) }],
    after: async (t: Address) => {
      await buy('oto', t, 22n, 'coffee_run_buy_22');
      await buy('kai', t, 8n, 'coffee_run_buy_8');
      const q = await pub.readContract({ address: t, abi: postAbi, functionName: 'quoteRedeem', args: [5n] });
      await run(call(P.kai, t, postAbi, 'redeem', [5n, (q * 99n) / 100n], 0n, 'coffee_run_redeem_5'));
    },
  },
];

for (const plan of PLANS) {
  if (posts[plan.slug]) throw Error(`${plan.slug} already seeded`);
  const sent = await run(call(P[plan.creator], d.factory.address, factoryAbi, 'createPost', [plan.slug, plan.caption, plan.art, plan.dare ?? ''], plan.bond ?? 0n, `create_post_${plan.slug}`));
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
