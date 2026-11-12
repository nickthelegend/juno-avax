/**
 * Seeds Juno on Fuji with real posts from three test accounts (mira, kai, oto):
 * sealed bids, reveals, settlement, refunds, buys, a sell, a graduation, a floor
 * redemption, an unrevealed (penalised) bid and a dare with proof, votes and
 * finalization. Every transaction is recorded in deployments/fuji.json.
 */
import { decodeEventLog, parseEther, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { commitment, factoryAbi, postAbi, quoteBuy as readQuote, FUJI_CHAIN_ID } from '@juno/sdk';
import { account } from './env.ts';
import { call, deployment, pub, record, untilChainTime, type Sent } from './tx.ts';

const P = { mira: account('JUNO_MIRA_KEY'), kai: account('JUNO_KAI_KEY'), oto: account('JUNO_OTO_KEY') };
type Who = keyof typeof P;
const factory = deployment().factory.address;
const log: Sent[] = [];
const run = async (p: Promise<Sent>) => {
  const s = await p;
  log.push(s);
  record('seed', log);
  if (s.status !== 'success') throw Error(`${s.label} failed: ${s.hash}`);
  return s;
};
const e12 = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 10n; // n x 1e12 wei

type Plan = {
  slug: string; creator: Who; caption: string; art: string; dare?: string; bond?: string;
  bids: Array<{ who: Who; amount: bigint; price: bigint; hide?: boolean }>;
  after: (post: Address) => Promise<void>;
};

async function buy(who: Who, post: Address, q: bigint, label: string) {
  const total = await readQuote(pub, post, q);
  await run(call(P[who], post, postAbi, 'buy', [q], total, label));
}

const WAVES: Plan[][] = [
  [
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
  ],
  [
    {
      slug: 'cap-toss', creator: 'oto', art: '/art/juno-feature-3.webp', bond: '0.02',
      caption: 'Dare: a graduation photo from the roof before Friday. 0.02 AVAX says I do it.',
      dare: 'Post a graduation photo from the roof before Friday',
      bids: [{ who: 'mira', amount: 40n, price: e12(5) }, { who: 'kai', amount: 60n, price: e12(5) }],
      after: async (t) => {
        await buy('kai', t, 40n, 'cap_toss_buy_40');
        await run(call(P.oto, t, postAbi, 'submitProof', ['/art/juno-onboard-2.webp'], 0n, 'cap_toss_submit_proof'));
        await run(call(P.kai, t, postAbi, 'vote', [true], 0n, 'cap_toss_vote_yes_kai'));
        await run(call(P.mira, t, postAbi, 'vote', [true], 0n, 'cap_toss_vote_yes_mira'));
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
  ],
];

const salts = new Map<string, Hex>();
const saltFor = (slug: string, who: Who) => {
  const key = `${slug}:${who}`;
  if (!salts.has(key)) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    salts.set(key, `0x${Buffer.from(b).toString('hex')}` as Hex);
  }
  return salts.get(key)!;
};

const posts: Record<string, Address> = {};

async function launch(plan: Plan): Promise<Address> {
  const value = plan.bond ? parseEther(plan.bond) : 0n;
  const sent = await run(call(P[plan.creator], factory, factoryAbi, 'createPost', [plan.slug, plan.caption, plan.art, plan.dare ?? ''], value, `create_post_${plan.slug}`));
  const receipt = await pub.getTransactionReceipt({ hash: sent.hash });
  for (const l of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
      if (ev.eventName === 'PostCreated') return ev.args.post;
    } catch { /* other events */ }
  }
  throw Error('PostCreated not found');
}

async function wave(plans: Plan[]) {
  const addrs = await Promise.all(plans.map(async (p) => {
    const a = await launch(p);
    posts[p.slug] = a;
    return a;
  }));
  record('posts', posts);
  // Bids: one per account per post, sequential per account to keep nonces simple.
  for (const [i, plan] of plans.entries()) {
    for (const b of plan.bids) {
      const c = commitment(addrs[i]!, FUJI_CHAIN_ID, P[b.who].address, b.amount, b.price, saltFor(plan.slug, b.who));
      await run(call(P[b.who], addrs[i]!, postAbi, 'commit', [c], parseEther('0.005'), `${plan.slug}_sealed_bid_${b.who}`));
    }
  }
  const commitEnd = Number(await pub.readContract({ address: addrs[0]!, abi: postAbi, functionName: 'commitEnd' }));
  await untilChainTime(Math.max(...(await Promise.all(addrs.map((a) => pub.readContract({ address: a, abi: postAbi, functionName: 'commitEnd' })))).map(Number), commitEnd));
  for (const [i, plan] of plans.entries()) {
    for (const b of plan.bids.filter((b) => !b.hide)) {
      await run(call(P[b.who], addrs[i]!, postAbi, 'reveal', [b.amount, b.price, saltFor(plan.slug, b.who)], 0n, `${plan.slug}_reveal_${b.who}`));
    }
  }
  const revealEnd = Math.max(...(await Promise.all(addrs.map((a) => pub.readContract({ address: a, abi: postAbi, functionName: 'revealEnd' })))).map(Number));
  await untilChainTime(revealEnd);
  for (const [i, plan] of plans.entries()) {
    await run(call(P[plan.creator], addrs[i]!, postAbi, 'settle', [], 0n, `${plan.slug}_settle`));
    for (const b of plan.bids) await run(call(P[b.who], addrs[i]!, postAbi, 'claimRefund', [], 0n, `${plan.slug}_refund_${b.who}${b.hide ? '_unrevealed_minus_1pct' : ''}`));
    await plan.after(addrs[i]!);
  }
}

for (const w of WAVES) await wave(w);

// The dare window is five minutes from the post's opening; finalize once it has passed.
const dareEnd = Number(await pub.readContract({ address: posts['cap-toss']!, abi: postAbi, functionName: 'dareEnd' }));
console.log(`waiting for the cap-toss dare window (${new Date(dareEnd * 1000).toISOString()})`);
await untilChainTime(dareEnd);
await run(call(P.kai, posts['cap-toss']!, postAbi, 'finalizeDare', [], 0n, 'cap_toss_finalize_dare'));
await run(call(P.oto, posts['cap-toss']!, postAbi, 'withdrawEarnings', [], 0n, 'cap_toss_creator_withdraws_bond'));
const ms = log.map((s) => s.confirmMs).sort((a, b) => a - b);
record('seedStats', { txs: log.length, failed: log.filter((s) => s.status !== 'success').length, confirmMsMedian: ms[Math.floor(ms.length / 2)], confirmMsP90: ms[Math.floor(ms.length * 0.9)], confirmMsMin: ms[0], confirmMsMax: ms[ms.length - 1] });
console.log(`done: ${log.length} txs, median confirmation ${ms[Math.floor(ms.length / 2)]}ms`);
