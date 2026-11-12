// Rewrites the evidence tables in README.md (between the EVIDENCE markers) from deployments/fuji.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(readFileSync(join(root, 'deployments/fuji.json'), 'utf8'));
const tx = (h) => `[${h.slice(0, 10)}…](https://testnet.snowtrace.io/tx/${h})`;
const addr = (a) => `[\`${a}\`](https://testnet.snowtrace.io/address/${a})`;
const names = Object.fromEntries(Object.entries(d.accounts ?? {}).filter(([k]) => k !== 'note').map(([k, v]) => [v.toLowerCase(), k]));
const who = (a) => names[a?.toLowerCase()] ?? a;
const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} s`);

const lines = [];
lines.push('### Contracts', '', '| Contract | Address |', '| --- | --- |');
lines.push(`| JunoFactory (source verified) | ${addr(d.factory.address)} — deployed in ${tx(d.factory.deployTx)} |`);
for (const [slug, a] of Object.entries(d.posts ?? {})) lines.push(`| Post \`${slug}\` (JunoPost + its ERC-20) | ${addr(a)} |`);
if (d.qaFlow?.post) lines.push(`| Post \`${d.qaFlow.slug}\` (launched from the web app) | ${addr(d.qaFlow.post)} |`);
lines.push('');

if (d.qaFlow?.steps?.length) {
  const q = d.qaFlow;
  const ok = q.steps.filter((s) => s.status === 'success').length;
  lines.push(`### One full flow from the web app (${ok}/${q.steps.length} succeeded)`, '');
  lines.push(`Driven through the web build in headless Chrome by \`scripts/qa-flow.ts\` with the QA signer (account ${addr(q.account)}), post \`${q.slug}\`.`, '');
  lines.push('| # | Call | Tx | Final block | Receipt |', '| ---: | --- | --- | ---: | ---: |');
  q.steps.forEach((s, i) => lines.push(`| ${i + 1} | \`${s.functionName}\` | ${s.hash ? tx(s.hash) : '—'} ${s.status === 'success' ? '' : `(${s.status ?? 'not sent'})`} | ${sec(s.blockMs)} | ${sec(s.confirmMs)} |`));
  lines.push('');
  if (d.qaAbandoned) {
    lines.push(`An earlier QA run (post ${addr(d.qaAbandoned.post)}) stopped after its sealed bid because a test-harness locator matched two elements; that post was closed by script: ${d.qaAbandoned.steps.map((s) => `${s.label.replace(/_/g, ' ')} ${tx(s.hash)}`).join(', ')}.`, '');
  }
}

lines.push(`### Seeded on Fuji (${d.seed.length} transactions, ${d.seed.filter((s) => s.status !== 'success').length} failed)`, '');
lines.push('Three test accounts (mira, kai, oto) created and funded by `scripts/fuji/fund.ts`; every call made by `scripts/fuji/seed.ts`.', '');
lines.push('| # | Step | From | Tx | Final block | Receipt |', '| ---: | --- | --- | --- | ---: | ---: |');
d.seed.forEach((s, i) => lines.push(`| ${i + 1} | ${s.label.replace(/_/g, ' ')} | ${who(s.from)} | ${tx(s.hash)} | ${sec(s.blockMs)} | ${sec(s.confirmMs)} |`));
lines.push('');
const st = d.seedStats;
if (st?.blockMsMedian) {
  lines.push(`Across the ${st.txs} seeded transactions: median **${sec(st.blockMsMedian)}** from broadcast to a final block (p90 ${sec(st.blockMsP90)}, over the ${st.blockMsMeasured} where this machine's clock was not ahead of the block's), and ${sec(st.confirmMsMedian)} until the public RPC returned the receipt (p90 ${sec(st.confirmMsP90)}). "Final block" is the including block's \`timestampMilliseconds\` minus this machine's clock at broadcast.`, '');
}
if (d.v1) {
  lines.push('### Superseded: v1', '');
  lines.push(`A first factory, ${addr(d.v1.factory.address)}, ran ${d.v1.seed.length} seed transactions and 10 steps of the web flow before a design flaw showed in its own chart: a curve buy right after the auction could undercut the auction's clearing price. v2 (above) prices every buy at the highest of the curve, the floor and the clearing price. The test AVAX in v1 was recovered by redeeming (${(d.v1.recovery ?? []).length} transactions). All v1 transactions are kept in \`deployments/fuji.json\` → \`v1\`.`, '');
}

const readme = join(root, 'README.md');
const text = readFileSync(readme, 'utf8');
const start = '<!-- EVIDENCE:START -->';
const end = '<!-- EVIDENCE:END -->';
const out = text.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${lines.join('\n')}\n${end}`);
writeFileSync(readme, out);
console.log(`README evidence: ${lines.length} lines`);
