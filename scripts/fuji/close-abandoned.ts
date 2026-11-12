/**
 * Closes a post whose QA run stopped after the sealed bid (a harness locator
 * bug, not the app): once its windows pass, settle it (the bid was never
 * revealed, so it is refunded minus 1%), finalize its dare (no holders, so
 * the bond returns to the creator) and withdraw. Recorded under
 * deployments/fuji.json → qaAbandoned.
 *
 *   npx tsx fuji/close-abandoned.ts <post>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from 'viem';
import { postAbi } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { call, pub, untilChainTime, type Sent } from './tx.ts';

const post = process.argv[2] as Address;
if (!/^0x[0-9a-fA-F]{40}$/.test(post ?? '')) throw Error('usage: close-abandoned.ts <post>');
const qa = account('JUNO_QA_KEY');
const log: Sent[] = [];
await untilChainTime(Number(await pub.readContract({ address: post, abi: postAbi, functionName: 'dareEnd' })));
if (!(await pub.readContract({ address: post, abi: postAbi, functionName: 'settled' }))) log.push(await call(qa, post, postAbi, 'settle', [], 0n, 'settle_bid_never_revealed'));
log.push(await call(qa, post, postAbi, 'claimRefund', [], 0n, 'refund_minus_1pct'));
log.push(await call(qa, post, postAbi, 'finalizeDare', [], 0n, 'finalize_no_holders_bond_returns'));
log.push(await call(qa, post, postAbi, 'withdrawEarnings', [], 0n, 'creator_withdraws_bond_and_penalty'));
const file = join(ROOT, 'deployments/fuji.json');
const d = JSON.parse(readFileSync(file, 'utf8'));
d.qaAbandoned = { post, note: 'A QA run stopped after its sealed bid (a test-harness locator matched two elements). Closed here: the unrevealed bid refunded minus 1%, the dare finalized with no holders, the bond withdrawn.', steps: log };
writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
console.log(`closed ${post}: ${log.filter((s) => s.status === 'success').length}/${log.length}`);
