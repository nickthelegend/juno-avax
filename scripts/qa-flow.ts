/**
 * One full Juno flow driven through the real web app, on Avalanche Fuji, in
 * headless Chrome — no mocks. The web build is exported with
 * EXPO_PUBLIC_QA_SIGNER=1 (dist-qa/, never deployed), which swaps the browser
 * wallet for a QA signer that only signs Juno calls on Fuji within a
 * 0.015 AVAX budget. This script injects the QA test key (read from the
 * gitignored .env, never printed), approves each call against that budget,
 * and records every transaction hash in deployments/fuji.json → qaFlow.
 *
 * Flow: launch a dare post → sealed bid → reveal → settle → claim refund →
 * buy 5 → sell 2 → redeem 1 → post proof → vote yes → finalize → claim.
 *
 *   pnpm --filter web export:qa && npx tsx scripts/qa-flow.ts
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { formatEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { client } from '@juno/sdk';
import { reserveQaBudget, QA_RPC_URLS, type QaChecked } from '../web/lib/qa-signer-policy.ts';
import { readEnv, ROOT } from './fuji/env.ts';
import { confirmTx } from '../web/lib/tx-status.ts';

delete process.env.DEBUG;
delete process.env.PWDEBUG;
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');

const PORT = 5392;
const WIDTH = Number(process.env.QA_WIDTH ?? 1440);
const SHOTS = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-juno/flow';
const DIST = join(ROOT, 'web/dist-qa');
const deployment = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
const factory = deployment.factory.address as `0x${string}`;
const key = readEnv()['JUNO_QA_KEY'] as Hex | undefined;
if (!key) throw Error('Setup required: JUNO_QA_KEY in .env');
const qa = privateKeyToAccount(key);
const pub = client();
const slug = process.env.QA_SLUG ?? `qa-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`;
const say = (s: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

type Step = { label: string; functionName: string; to: string; value: string; hash?: Hex; status?: string; block?: number; confirmMs?: number; blockMs?: number | null; gasUsed?: number; at?: string };
const steps: Step[] = [];
let reserved = 0n;
let currentLabel = 'launch';
let postAddress: string | null = null;
const record = () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
  data.qaFlow = { note: 'Driven through the web app (dist-qa, QA signer build) in headless Chrome by scripts/qa-flow.ts', account: qa.address, slug, post: postAddress, width: WIDTH, steps };
  writeFileSync(join(ROOT, 'deployments/fuji.json'), `${JSON.stringify(data, null, 2)}\n`);
};

async function authorize(call: QaChecked): Promise<number> {
  const gasPrice = await pub.getGasPrice();
  reserved = reserveQaBudget(reserved, BigInt(call.value), 2_000_000n, gasPrice > 0n ? gasPrice : 1n);
  const balance = await pub.getBalance({ address: qa.address });
  if (balance < BigInt(call.value)) throw Error('Stopped: the QA account is too low for this call.');
  // Labelled by the call itself: the UI can move on before a wallet call is authorized.
  const n = steps.filter((x) => x.functionName === call.functionName).length;
  steps.push({ label: n ? `${call.functionName}_${n + 1}` : call.functionName, functionName: call.functionName, to: call.to, value: call.value });
  record();
  say(`authorize ${currentLabel}: ${call.functionName} value ${formatEther(BigInt(call.value))} (reserved ${formatEther(reserved)})`);
  return steps.length - 1;
}

async function report(event: { event: string; reservation: number; hash: Hex }) {
  const step = steps[event.reservation];
  if (!step) return;
  step.hash = event.hash;
  step.status = event.event;
  record();
  if (event.event === 'submitted') {
    void confirmTx(pub, event.hash).then(async (r) => {
      const receipt = await pub.getTransactionReceipt({ hash: event.hash });
      Object.assign(step, { status: receipt.status, block: Number(receipt.blockNumber), confirmMs: r.ms, blockMs: r.blockMs, gasUsed: Number(receipt.gasUsed), at: new Date().toISOString() });
      record();
      say(`  ${receipt.status} ${event.hash} ${r.blockMs ?? '?'}ms to block, ${r.ms}ms to receipt`);
    });
  }
}

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
if (!existsSync(join(DIST, 'index.html'))) throw Error('Build the QA export first: pnpm --filter juno-avax-web export:qa');
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');

await mkdir(SHOTS, { recursive: true });
say(`QA account ${qa.address} balance ${formatEther(await pub.getBalance({ address: qa.address }))} AVAX; post ${slug}`);

try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
      await context.exposeFunction('__JUNO_QA_AUTHORIZE__', authorize);
      await context.exposeFunction('__JUNO_QA_REPORT__', report);
      await context.addInitScript((input: unknown) => Object.defineProperty(window, '__JUNO_QA_SIGNER__', { value: input, writable: true, configurable: true }), { privateKey: key, rpcUrl: QA_RPC_URLS[0], factory });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(String(e)));
      page.on('console', (m: { type: () => string; text: () => string }) => {
        if (m.type() === 'error' || m.type() === 'warning') say(`console ${m.type()}: ${m.text().slice(0, 240)}`);
      });
      const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${String(steps.length).padStart(2, '0')}-${name}-${WIDTH}.png` });
      const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
      const until = async (locator: { waitFor: (o: object) => Promise<void> }, ms = 180_000) => locator.waitFor({ state: 'visible', timeout: ms });

      try {
      // 1. Launch a dare post from /post.
      currentLabel = 'launch_dare_post';
      await page.goto(`http://127.0.0.1:${PORT}/post?format=dare`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Use /art/juno-object-2.webp' }).click();
      await page.getByPlaceholder('night-market').fill(slug);
      await page.getByPlaceholder('Say what this is').fill('QA run from the web app: a dare post, launched, bid, revealed, settled and traded on Fuji.');
      await page.getByPlaceholder('I will post the sunrise from the summit by Friday').fill('Post a photo of the sunrise by Friday');
      await page.getByPlaceholder('Bond in AVAX').fill('0.002');
      await shot('launch-form');
      await button(/^Launch post/).click();
      await until(button('Connect QA signer'), 20_000);
      await shot('connect-sheet');
      await button('Connect QA signer').click();
      await page.waitForURL(/\/coin\/0x/, { timeout: 90_000 });
      const post = page.url().split('/coin/')[1]!.split(/[?#]/)[0]!;
      postAddress = post;
      record();
      say(`post ${post}`);

      // 2. Sealed bid inside the first minute.
      currentLabel = 'sealed_bid';
      await until(button(/^Place sealed bid/), 30_000);
      await shot('auction-open');
      await button(/^Place sealed bid/).click();
      await until(page.getByText(/^Your sealed bid:/), 60_000);
      await shot('bid-placed');

      // 3. Reveal in the second minute.
      currentLabel = 'reveal';
      await until(button('Reveal my bid'));
      await button('Reveal my bid').click();
      await until(page.getByText(/^Revealed\./), 60_000);
      await shot('revealed');

      // 4. Settle, then claim the unused escrow.
      currentLabel = 'settle';
      await until(button('Settle the auction'));
      await button('Settle the auction').click();
      await until(button(/^Claim .* refund$/), 90_000);
      await shot('settled');
      currentLabel = 'claim_refund';
      await button(/^Claim .* refund$/).click();
      await until(page.getByText(/^Final in /).first(), 60_000);

      // 5. Buy 5, sell 2, redeem 1 through the trade sheet.
      const trade = async (side: 'Buy' | 'Sell' | 'Redeem', amount: string) => {
        currentLabel = `${side.toLowerCase()}_${amount}`;
        if (side === 'Redeem') await page.getByRole('button', { name: 'Redeem against the floor' }).first().click();
        else await button('Buy').first().click();
        if (side === 'Sell') await button('Sell').first().click();
        await button(amount).click();
        await page.waitForTimeout(1200);
        await shot(`${side.toLowerCase()}-quote`);
        await button(side).last().click();
        await until(button('Done'), 90_000);
        await shot(`${side.toLowerCase()}-done`);
        await button('Done').click();
        await page.waitForTimeout(1500);
      };
      await trade('Buy', '5');
      await trade('Sell', '2');
      await trade('Redeem', '1');

      // 6. The dare: proof, vote, then finalize once five minutes have passed.
      currentLabel = 'submit_proof';
      await page.getByPlaceholder('https:// link to your photo').fill('/art/juno-onboard-2.webp');
      await button('Post proof').click();
      await until(button('Proof holds'), 60_000);
      currentLabel = 'vote_yes';
      await button('Proof holds').click();
      await until(page.getByText(/^You voted yes/), 60_000);
      await shot('voted');
      currentLabel = 'finalize_dare';
      await until(button('Finalize the dare'), 330_000);
      await button('Finalize the dare').click();
      await until(page.getByText(/^Holders accepted the proof/), 60_000);
      await shot('dare-final');
      currentLabel = 'claim_creator_earnings';
      await until(button(/^Claim .* in creator fees$/), 30_000);
      await button(/^Claim .* in creator fees$/).click();
      await until(page.getByText(/^Claimed /), 60_000);
      await shot('claimed');
      await page.waitForTimeout(4000);
      } catch (error) {
        await page.screenshot({ path: `${SHOTS}/zz-failure-${WIDTH}.png`, fullPage: false }).catch(() => undefined);
        const text = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '');
        say(`FAILED at ${currentLabel}: ${String(error).split('\n')[0]}\npage text: ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
        throw error;
      }
      if (errors.length) say(`page errors: ${errors.slice(0, 3).join(' | ')}`);
    } finally {
      await browser.close();
    }
  });
} finally {
  server.close();
  record();
  say(`done: ${steps.filter((s) => s.status === 'success').length}/${steps.length} succeeded; QA balance ${formatEther(await pub.getBalance({ address: qa.address }))} AVAX`);
}
