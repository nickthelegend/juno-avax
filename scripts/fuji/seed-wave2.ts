/**
 * Second seeding pass, after the first run stopped when kai's account ran dry
 * (the 800-token graduation buy used most of it) while wave 2's sealed bids
 * were in. Those bids' salts lived only in that process, so they can never be
 * revealed: this pass settles those two auctions as they are (every bid is
 * an unrevealed bid, refunded minus 1%), lets the dare with no holders return
 * its bond, and trades into the open curve. Then it launches a fresh dare
 * post whose salts are written to the gitignored .seed-secrets.json first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEventLog, parseEther, type Address, type Hex } from 'viem';
import { commitment, factoryAbi, postAbi, quoteBuy as readQuote, FUJI_CHAIN_ID } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { call, deployment, pub, record, untilChainTime, type Sent } from './tx.ts';

const P = { mira: account('JUNO_MIRA_KEY'), kai: account('JUNO_KAI_KEY'), oto: account('JUNO_OTO_KEY') };
const deployer = account('JUNO_DEPLOYER_KEY');
const d = deployment() as ReturnType<typeof deployment> & { seed: Sent[]; posts: Record<string, Address> };
const log: Sent[] = d.seed ?? [];
const posts = d.posts;
const run = async (p: Promise<Sent>) => {
  const s = await p;
  log.push(s);
  record('seed', log);
  if (s.status !== 'success') throw Error(`${s.label} failed: ${s.hash}`);
  return s;
};
const buy = async (who: keyof typeof P, post: Address, q: bigint, label: string) => {
  const total = await readQuote(pub, post, q);
  await run(call(P[who], post, postAbi, 'buy', [q], (total * 102n) / 100n, label));
};
const transfer = async (to: Address, amount: string, label: string) => {
  const { createWalletClient, http } = await import('viem');
  const { fuji, FUJI_RPC } = await import('@juno/sdk');
  const w = createWalletClient({ account: deployer, chain: fuji, transport: http(FUJI_RPC) });
  const hash = await w.sendTransaction({ to, value: parseEther(amount) });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`fund ${label} ${amount} ${hash}`);
};

await transfer(P.kai.address, '0.012', 'kai');
await transfer(P.oto.address, '0.012', 'oto');

// 1. The two stuck auctions.
const capToss = posts['cap-toss']!;
const balloons = posts['balloons']!;
await run(call(P.mira, capToss, postAbi, 'settle', [], 0n, 'cap-toss_settle_all_bids_unrevealed'));
await run(call(P.mira, capToss, postAbi, 'claimRefund', [], 0n, 'cap-toss_refund_mira_unrevealed_minus_1pct'));
await run(call(P.kai, capToss, postAbi, 'claimRefund', [], 0n, 'cap-toss_refund_kai_unrevealed_minus_1pct'));
await untilChainTime(Number(await pub.readContract({ address: capToss, abi: postAbi, functionName: 'dareEnd' })));
await run(call(P.kai, capToss, postAbi, 'finalizeDare', [], 0n, 'cap-toss_finalize_no_holders_bond_returns'));
await run(call(P.oto, capToss, postAbi, 'withdrawEarnings', [], 0n, 'cap-toss_creator_withdraws_bond_and_penalties'));
await run(call(P.oto, balloons, postAbi, 'settle', [], 0n, 'balloons_settle_bid_unrevealed'));
await run(call(P.oto, balloons, postAbi, 'claimRefund', [], 0n, 'balloons_refund_oto_unrevealed_minus_1pct'));
await buy('mira', balloons, 60n, 'balloons_buy_60');
await buy('kai', balloons, 30n, 'balloons_buy_30');
await buy('oto', capToss, 15n, 'cap-toss_buy_15');

// 2. A fresh dare post, with its salts on disk before any bid is sent.
const secretsFile = join(ROOT, '.seed-secrets.json');
const secrets: Record<string, Hex> = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {};
const saltFor = (key: string) => {
  if (!secrets[key]) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    secrets[key] = `0x${Buffer.from(b).toString('hex')}` as Hex;
    writeFileSync(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }
  return secrets[key]!;
};
const created = await run(call(P.oto, d.factory.address, factoryAbi, 'createPost', ['rooftop', 'Dare: a graduation photo from the roof before Friday. 0.02 AVAX says I do it.', '/art/juno-feature-3.webp', 'Post a graduation photo from the roof before Friday'], parseEther('0.02'), 'create_post_rooftop'));
const receipt = await pub.getTransactionReceipt({ hash: created.hash });
let rooftop: Address | null = null;
for (const l of receipt.logs) {
  try {
    const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
    if (ev.eventName === 'PostCreated') rooftop = ev.args.post;
  } catch { /* not ours */ }
}
if (!rooftop) throw Error('no PostCreated');
posts.rooftop = rooftop;
record('posts', posts);
const bids = [{ who: 'mira' as const, amount: 40n, price: 5n * 10n ** 12n }, { who: 'kai' as const, amount: 60n, price: 5n * 10n ** 12n }];
for (const b of bids) {
  const c = commitment(rooftop, FUJI_CHAIN_ID, P[b.who].address, b.amount, b.price, saltFor(`rooftop:${b.who}`));
  await run(call(P[b.who], rooftop, postAbi, 'commit', [c], parseEther('0.005'), `rooftop_sealed_bid_${b.who}`));
}
await untilChainTime(Number(await pub.readContract({ address: rooftop, abi: postAbi, functionName: 'commitEnd' })));
for (const b of bids) await run(call(P[b.who], rooftop, postAbi, 'reveal', [b.amount, b.price, saltFor(`rooftop:${b.who}`)], 0n, `rooftop_reveal_${b.who}`));
await untilChainTime(Number(await pub.readContract({ address: rooftop, abi: postAbi, functionName: 'revealEnd' })));
await run(call(P.oto, rooftop, postAbi, 'settle', [], 0n, 'rooftop_settle'));
for (const b of bids) await run(call(P[b.who], rooftop, postAbi, 'claimRefund', [], 0n, `rooftop_refund_${b.who}`));
await buy('kai', rooftop, 40n, 'rooftop_buy_40');
await run(call(P.oto, rooftop, postAbi, 'submitProof', ['/art/juno-onboard-2.webp'], 0n, 'rooftop_submit_proof'));
await run(call(P.kai, rooftop, postAbi, 'vote', [true], 0n, 'rooftop_vote_yes_kai'));
await run(call(P.mira, rooftop, postAbi, 'vote', [true], 0n, 'rooftop_vote_yes_mira'));
await untilChainTime(Number(await pub.readContract({ address: rooftop, abi: postAbi, functionName: 'dareEnd' })));
await run(call(P.kai, rooftop, postAbi, 'finalizeDare', [], 0n, 'rooftop_finalize_dare_accepted'));
await run(call(P.oto, rooftop, postAbi, 'withdrawEarnings', [], 0n, 'rooftop_creator_withdraws_bond'));

const all = log.filter((s) => s.blockMs !== undefined).map((s) => s.confirmMs).sort((a, b) => a - b);
record('seedStats', {
  txs: log.length,
  failed: log.filter((s) => s.status !== 'success').length,
  note: 'confirmMs = eth_sendRawTransaction accepted -> receipt readable, polled every 60 ms; measured on txs sent after the polling fix',
  measured: all.length,
  confirmMsMedian: all[Math.floor(all.length / 2)],
  confirmMsP90: all[Math.floor(all.length * 0.9)],
  confirmMsMin: all[0],
  confirmMsMax: all[all.length - 1],
});
console.log(`done: ${log.length} txs; median ${all[Math.floor(all.length / 2)]}ms over ${all.length} measured`);
