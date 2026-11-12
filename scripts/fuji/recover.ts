/**
 * Pulls the test AVAX back out of a superseded deployment so it can fund the
 * next one: every test account redeems all it holds on every post (99% of its
 * floor share), claims any refund, and creators withdraw their earnings.
 * Every call is recorded under deployments/fuji.json → <section>.recovery.
 *
 *   npx tsx fuji/recover.ts <section-with-posts>   (default: v1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatEther, type Address } from 'viem';
import { bidOf, postAbi } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { call, pub, type Sent } from './tx.ts';
import { writeFileSync } from 'node:fs';

const section = process.argv[2] ?? 'v1';
const file = join(ROOT, 'deployments/fuji.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const posts: Address[] = [...Object.values(data[section].posts as Record<string, Address>), ...(data[section].qaFlow?.post ? [data[section].qaFlow.post as Address] : [])];
const people = { mira: account('JUNO_MIRA_KEY'), kai: account('JUNO_KAI_KEY'), oto: account('JUNO_OTO_KEY'), qa: account('JUNO_QA_KEY') };
const log: Sent[] = [];
const save = () => {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  d[section].recovery = log;
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
};

for (const post of posts) {
  const creator = (await pub.readContract({ address: post, abi: postAbi, functionName: 'creator' })) as Address;
  const settled = await pub.readContract({ address: post, abi: postAbi, functionName: 'settled' });
  for (const [name, who] of Object.entries(people)) {
    if (settled) {
      const bid = await bidOf(pub, post, who.address);
      if (bid.exists && bid.refund > 0n) log.push(await call(who, post, postAbi, 'claimRefund', [], 0n, `recover_refund_${name}`));
    }
    const balance = (await pub.readContract({ address: post, abi: postAbi, functionName: 'balanceOf', args: [who.address] })) as bigint;
    if (balance > 0n) log.push(await call(who, post, postAbi, 'redeem', [balance, 0n], 0n, `recover_redeem_${balance}_${name}`));
    if (creator.toLowerCase() === who.address.toLowerCase()) {
      const earned = (await pub.readContract({ address: post, abi: postAbi, functionName: 'creatorEarnings' })) as bigint;
      if (earned > 0n) log.push(await call(who, post, postAbi, 'withdrawEarnings', [], 0n, `recover_earnings_${name}`));
    }
    save();
  }
}
for (const [name, who] of Object.entries(people)) console.log(`${name} ${formatEther(await pub.getBalance({ address: who.address }))} AVAX`);
console.log(`recovery: ${log.length} txs, ${log.filter((s) => s.status !== 'success').length} failed`);
