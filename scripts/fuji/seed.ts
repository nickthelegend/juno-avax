/**
 * Seeds Juno on Fuji with real posts from three test accounts (mira, kai, oto):
 * sealed bids, reveals, an unrevealed bid, settlement, refunds, buys, a sell,
 * a graduation, floor redemptions, an accepted dare and a failed one. Every
 * transaction is recorded in deployments/fuji.json → seed.
 *
 * Salts are written to the gitignored .seed-secrets.json before a bid is
 * sent, so a stopped run can still reveal. Balances are checked up front.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEventLog, formatEther, parseEther, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { commitment, factoryAbi, postAbi, quoteBuy as readQuote, FUJI_CHAIN_ID } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { call, deployment, pub, record, untilChainTime, type Sent } from './tx.ts';

const P = { mira: account('JUNO_MIRA_KEY'), kai: account('JUNO_KAI_KEY'), oto: account('JUNO_OTO_KEY') };
type Who = keyof typeof P;
const NEED: Record<Who, string> = { mira: '0.02', kai: '0.06', oto: '0.04' };
for (const [who, need] of Object.entries(NEED) as [Who, string][]) {
  const have = await pub.getBalance({ address: P[who].address });
  if (have < parseEther(need)) throw Error(`${who} holds ${formatEther(have)} AVAX; the seed needs ${need}. Run fuji/fund.ts first.`);
}

const factory = deployment().factory.address;
const log: Sent[] = [];
const posts: Record<string, Address> = {};
const run = async (p: Promise<Sent>) => {
  const s = await p;
  log.push(s);
  record('seed', log);
  if (s.status !== 'success') throw Error(`${s.label} failed: ${s.hash}`);
  return s;
};
const e12 = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 10n; // n x 1e12 wei
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

type Plan = {
  slug: string; creator: Who; caption: string; art: string; dare?: string; bond?: string;
  bids: Array<{ who: Who; amount: bigint; price: bigint; hide?: boolean }>;
  after: (post: Address) => Promise<void>;
};

const PLANS: Plan[] = [
  {
    slug: 'sprout', creator: 'mira', art: '/art/juno-feature-1.webp',
    caption: 'Posted a photo, it grew a coin. First Juno post on Avalanche.',
    bids: [{ who: 'kai', amount: 50n, price: e12(5) }, { who: 'oto', amount: 75n, price: e12(4) }],
    after: async (t) => {
      await buy('oto', t, 25n, 'sprout_buy_25');
      await buy('mira', t, 10n, 'sprout_buy_10');
      await run(call(P.oto, t, postAbi, 'sell', [5n, 0n], 0n, 'sprout_sell_5'));
    },
  },
  {
    slug: 'pile-in', creator: 'kai', art: '/art/juno-feature-2.webp',
    caption: 'Everyone threw a coin at the same photo. It sold out.',
    bids: [{ who: 'mira', amount: 60n, price: e12(6) }, { who: 'oto', amount: 40n, price: e12(5) }],
    after: async (t) => {
      await buy('kai', t, 800n, 'pile_in_buy_800_graduates');
      await run(call(P.mira, t, postAbi, 'redeem', [20n, 0n], 0n, 'pile_in_redeem_20_floor'));
    },
  },
  {
    slug: 'rooftop', creator: 'oto', art: '/art/juno-feature-3.webp', bond: '0.02',
    caption: 'Dare: a graduation photo from the roof before Friday. 0.02 AVAX says I do it.',
    dare: 'Post a graduation photo from the roof before Friday',
    bids: [{ who: 'mira', amount: 40n, price: e12(5) }, { who: 'kai', amount: 60n, price: e12(5) }],
    after: async (t) => {
      await buy('kai', t, 40n, 'rooftop_buy_40');
      await run(call(P.oto, t, postAbi, 'submitProof', ['/art/juno-onboard-2.webp'], 0n, 'rooftop_submit_proof'));
      await run(call(P.kai, t, postAbi, 'vote', [true], 0n, 'rooftop_vote_yes_kai'));
      await run(call(P.mira, t, postAbi, 'vote', [true], 0n, 'rooftop_vote_yes_mira'));
    },
  },
  {
    slug: 'balloons', creator: 'mira', art: '/art/juno-social-square.webp',
    caption: 'Every post floats up on its own curve.',
    bids: [{ who: 'oto', amount: 50n, price: e12(4) }, { who: 'kai', amount: 30n, price: e12(9), hide: true }],
    after: async (t) => {
      await buy('mira', t, 60n, 'balloons_buy_60');
      await buy('kai', t, 30n, 'balloons_buy_30');
    },
  },
  {
    slug: 'night-swim', creator: 'kai', art: '/art/juno-onboard-1.webp', bond: '0.01',
    caption: 'Dare: a swim at midnight, photo or it did not happen. 0.01 AVAX on it.',
    dare: 'Post a photo of a midnight swim',
    bids: [{ who: 'mira', amount: 30n, price: e12(5) }, { who: 'oto', amount: 20n, price: e12(5) }],
    after: async (t) => {
      await buy('oto', t, 15n, 'night_swim_buy_15');
    },
  },
];

async function launch(plan: Plan): Promise<Address> {
  const value = plan.bond ? parseEther(plan.bond) : 0n;
  const sent = await run(call(P[plan.creator], factory, factoryAbi, 'createPost', [plan.slug, plan.caption, plan.art, plan.dare ?? ''], value, `create_post_${plan.slug}`));
  const receipt = await pub.getTransactionReceipt({ hash: sent.hash });
  for (const l of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
      if (ev.eventName === 'PostCreated') return ev.args.post;
    } catch { /* another contract's event */ }
  }
  throw Error('PostCreated not found');
}

// Launch everything, then bid inside each post's first minute (one account at a time keeps nonces simple).
for (const plan of PLANS) {
  posts[plan.slug] = await launch(plan);
  record('posts', posts);
}
for (const plan of PLANS) {
  for (const b of plan.bids) {
    const c = commitment(posts[plan.slug]!, FUJI_CHAIN_ID, P[b.who].address, b.amount, b.price, saltFor(`${plan.slug}:${b.who}`));
    await run(call(P[b.who], posts[plan.slug]!, postAbi, 'commit', [c], parseEther('0.005'), `${plan.slug}_sealed_bid_${b.who}${b.hide ? '_never_revealed' : ''}`));
  }
}
const end = async (fn: 'commitEnd' | 'revealEnd' | 'dareEnd') =>
  Math.max(...(await Promise.all(PLANS.map((p) => pub.readContract({ address: posts[p.slug]!, abi: postAbi, functionName: fn })))).map(Number));
await untilChainTime(await end('commitEnd'));
for (const plan of PLANS) {
  for (const b of plan.bids.filter((b) => !b.hide)) {
    await run(call(P[b.who], posts[plan.slug]!, postAbi, 'reveal', [b.amount, b.price, saltFor(`${plan.slug}:${b.who}`)], 0n, `${plan.slug}_reveal_${b.who}`));
  }
}
await untilChainTime(await end('revealEnd'));
for (const plan of PLANS) {
  const t = posts[plan.slug]!;
  await run(call(P[plan.creator], t, postAbi, 'settle', [], 0n, `${plan.slug}_settle`));
  for (const b of plan.bids) await run(call(P[b.who], t, postAbi, 'claimRefund', [], 0n, `${plan.slug}_refund_${b.who}${b.hide ? '_minus_1pct' : ''}`));
  await plan.after(t);
}

// Both dares close five minutes after launch.
await untilChainTime(await end('dareEnd'));
await run(call(P.kai, posts.rooftop!, postAbi, 'finalizeDare', [], 0n, 'rooftop_finalize_accepted'));
await run(call(P.oto, posts.rooftop!, postAbi, 'withdrawEarnings', [], 0n, 'rooftop_creator_withdraws_bond'));
await run(call(P.mira, posts['night-swim']!, postAbi, 'finalizeDare', [], 0n, 'night_swim_finalize_no_proof_bond_to_floor'));
await run(call(P.mira, posts['night-swim']!, postAbi, 'redeem', [10n, 0n], 0n, 'night_swim_redeem_10_with_bond_in_floor'));

const receipts = log.map((s) => s.confirmMs).sort((a, b) => a - b);
const blocks = log.map((s) => s.blockMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
const pick = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
record('seedStats', {
  txs: log.length,
  failed: log.filter((s) => s.status !== 'success').length,
  measured: log.length,
  confirmMsMedian: pick(receipts, 0.5), confirmMsP90: pick(receipts, 0.9), confirmMsMin: receipts[0], confirmMsMax: receipts[receipts.length - 1],
  blockMsMeasured: blocks.length,
  blockMsMedian: pick(blocks, 0.5), blockMsP90: pick(blocks, 0.9), blockMsMin: blocks[0], blockMsMax: blocks[blocks.length - 1],
  note: 'confirmMs: eth_sendRawTransaction accepted -> receipt readable (polled every 60 ms). blockMs: including block timestampMilliseconds minus this machine\'s clock at broadcast (shown only when positive). Avalanche blocks are final on acceptance.',
});
console.log(`done: ${log.length} txs; median ${pick(blocks, 0.5)} ms to a final block, ${pick(receipts, 0.5)} ms to receipt`);
for (const who of Object.keys(P) as Who[]) console.log(`${who} ${formatEther(await pub.getBalance({ address: P[who].address }))} AVAX`);
