/**
 * "Hide your bag" driven through the real web app on Avalanche Fuji, in
 * headless Chrome: the QA signer build (dist-qa, never deployed) opens the
 * QA account's eERC key with one signature, registers it with a proof built
 * in the browser, shields a post coin, sends part of the bag privately to
 * mira and unshields the rest of a slice — every proof made by snarkjs in the
 * page. Then the auditor account opens the auditor view and decrypts the
 * transfer amounts. Hashes go to deployments/fuji.json → qaVault.
 *
 *   pnpm qa:vault        (exports dist-qa first)
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

const PORT = 5394;
const WIDTH = Number(process.env.QA_WIDTH ?? 1440);
const SHOTS = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-juno/v2/flow-vault';
const DIST = join(ROOT, 'web/dist-qa');
const deployment = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
const factory = deployment.factory.address as `0x${string}`;
const COIN = (process.env.QA_VAULT_COIN ?? deployment.qaFlow.post) as `0x${string}`;
const env = readEnv();
const qaKey = env['JUNO_QA_KEY'] as Hex | undefined;
const auditorKey = env['JUNO_AUDITOR_KEY'] as Hex | undefined;
if (!qaKey || !auditorKey) throw Error('Setup required: JUNO_QA_KEY and JUNO_AUDITOR_KEY in .env');
const qa = privateKeyToAccount(qaKey);
const pub = client();
const say = (s: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

type Step = { label: string; functionName: string; to: string; value: string; hash?: Hex; status?: string; block?: number; confirmMs?: number; blockMs?: number | null; gasUsed?: number; at?: string };
// A rerun after a harness failure keeps the transactions already made.
const steps: Step[] = deployment.qaVault?.account === qa.address ? deployment.qaVault.steps : [];
let reserved = 0n;
let currentLabel = 'open';
const pending: Promise<void>[] = [];
const record = () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
  data.qaVault = { note: 'Driven through the web app (dist-qa, QA signer build) in headless Chrome by scripts/qa-vault.ts; every proof built in the page with snarkjs', account: qa.address, coin: COIN, width: WIDTH, steps };
  writeFileSync(join(ROOT, 'deployments/fuji.json'), `${JSON.stringify(data, null, 2)}\n`);
};

async function authorize(call: QaChecked): Promise<number> {
  const gasPrice = await pub.getGasPrice();
  reserved = reserveQaBudget(reserved, BigInt(call.value), 2_000_000n, gasPrice > 0n ? gasPrice : 1n);
  steps.push({ label: currentLabel, functionName: call.functionName, to: call.to, value: call.value });
  record();
  say(`authorize ${currentLabel}: ${call.target}.${call.functionName}`);
  return steps.length - 1;
}

async function report(event: { event: string; reservation: number; hash: Hex }) {
  const step = steps[event.reservation];
  if (!step) return;
  step.hash = event.hash;
  step.status = event.event;
  record();
  if (event.event === 'submitted') {
    pending.push(
      confirmTx(pub, event.hash).then(async (r) => {
        const receipt = await pub.getTransactionReceipt({ hash: event.hash });
        Object.assign(step, { status: receipt.status, block: Number(receipt.blockNumber), confirmMs: r.ms, blockMs: r.blockMs, gasUsed: Number(receipt.gasUsed), at: new Date().toISOString() });
        record();
        say(`  ${receipt.status} ${event.hash} ${r.blockMs ?? '?'}ms to block, ${r.ms}ms to receipt`);
      }),
    );
  }
}

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
if (!existsSync(join(DIST, 'index.html'))) throw Error('Build the QA export first: pnpm --filter juno-avax-web export:qa');
if (!existsSync(join(DIST, 'eerc/transfer.zkey'))) throw Error('The QA export has no eERC circuits: run node scripts/copy-eerc-assets.mjs before export:qa');
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');

await mkdir(SHOTS, { recursive: true });
say(`QA account ${qa.address} balance ${formatEther(await pub.getBalance({ address: qa.address }))} AVAX; coin ${COIN}`);

try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const session = async (key: Hex, run: (page: any) => Promise<void>) => {
        const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
        await context.exposeFunction('__JUNO_QA_AUTHORIZE__', authorize);
        await context.exposeFunction('__JUNO_QA_REPORT__', report);
        await context.addInitScript((input: unknown) => Object.defineProperty(window, '__JUNO_QA_SIGNER__', { value: input, writable: true, configurable: true }), { privateKey: key, rpcUrl: QA_RPC_URLS[0], factory });
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => say(`pageerror: ${String(e).slice(0, 240)}`));
        page.on('response', async (r: any) => {
          if (r.status() >= 400) say(`http ${r.status()} ${r.url().slice(0, 90)} ${(r.request().postData() ?? '').slice(0, 160)}`);
        });
        page.on('console', (m: { type: () => string; text: () => string }) => {
          if (m.type() === 'error') say(`console error: ${m.text().slice(0, 240)}`);
        });
        try {
          await run(page);
        } catch (error) {
          await page.screenshot({ path: `${SHOTS}/zz-failure-${WIDTH}.png` }).catch(() => undefined);
          const text = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '');
          say(`FAILED at ${currentLabel}: ${String(error).split('\n')[0]}\npage text: ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
          throw error;
        } finally {
          await context.close();
        }
      };
      let n = 0;
      const shot = (page: any, name: string) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}-${WIDTH}.png` });
      const button = (page: any, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
      const until = (locator: { waitFor: (o: object) => Promise<void> }, ms = 120_000) => locator.waitFor({ state: 'visible', timeout: ms });

      await session(qaKey, async (page) => {
        // From the coin page: the "Hide your bag" row opens the vault with this coin picked.
        currentLabel = 'open';
        await page.goto(`http://127.0.0.1:${PORT}/coin/${COIN}`, { waitUntil: 'networkidle' });
        await until(button(page, 'Hide your bag'), 60_000);
        await shot(page, 'coin-hide-your-bag');
        await button(page, 'Hide your bag').click();
        await until(button(page, 'Connect wallet'), 60_000);
        await button(page, 'Connect wallet').click();
        await until(button(page, 'Connect QA signer'), 20_000);
        await button(page, 'Connect QA signer').click();
        await until(button(page, 'Sign to open'), 30_000);
        await shot(page, 'open-bag');
        await button(page, 'Sign to open').click();

        currentLabel = 'register';
        const create = button(page, 'Create private bag');
        const move = page.getByText('Move a bag');
        await Promise.race([until(create, 60_000), until(move, 60_000)]);
        if (await create.isVisible()) {
          await shot(page, 'create-bag');
          await create.click();
          await until(move, 120_000);
        }
        await shot(page, 'bag-open');

        const act = async (label: string, tab: string, amount: string, extra?: () => Promise<void>) => {
          currentLabel = label;
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await page.waitForTimeout(800);
          await page.getByRole('button', { name: /^\$QA-11120941/ }).first().click();
          if (extra) await extra();
          await page.getByLabel('Amount of tokens').fill(amount);
          await shot(page, `${label}-form`);
          await page.getByRole('button', { name: tab, exact: true }).last().click();
          await until(page.getByText(new RegExp(`^${tab} final on Fuji in`)).first(), 180_000);
          await shot(page, `${label}-done`);
          await page.waitForTimeout(3000);
        };
        if (process.env.QA_VAULT_ONLY !== 'views') {
          await act('shield', 'Shield', '20');
          await act('send_private', 'Send privately', '8', async () => {
            await page.getByRole('button', { name: /^to mira$/ }).click();
          });
          await act('unshield', 'Unshield', '5');
        }
        currentLabel = 'public_view';
        await page.getByRole('tab', { name: 'Public view', exact: true }).click();
        await page.waitForTimeout(6000);
        await shot(page, 'public-view');
        await page.getByRole('tab', { name: 'Auditor' }).click();
        await page.waitForTimeout(1500);
        await shot(page, 'auditor-sealed');
      });

      await session(auditorKey, async (page) => {
        currentLabel = 'auditor';
        await page.goto(`http://127.0.0.1:${PORT}/vault?view=auditor`, { waitUntil: 'networkidle' });
        await until(button(page, 'Connect wallet').or(button(page, 'Open the auditor key')).or(page.getByText('You are not the auditor')), 60_000);
        // Connect from the Your bag tab's button, then come back to the auditor tab.
        await page.getByRole('tab', { name: 'Your bag' }).click();
        await button(page, 'Connect wallet').click();
        await button(page, 'Connect QA signer').click();
        await page.getByRole('tab', { name: 'Auditor' }).click();
        await until(button(page, 'Open the auditor key'), 30_000);
        await button(page, 'Open the auditor key').click();
        await until(page.getByText('Auditor key open on this device.'), 30_000);
        await page.waitForTimeout(1000);
        await shot(page, 'auditor-open');
      });
    } finally {
      await browser.close();
    }
  });
} finally {
  await Promise.allSettled(pending);
  server.close();
  record();
  say(`done: ${steps.filter((s) => s.status === 'success').length}/${steps.length} succeeded; QA balance ${formatEther(await pub.getBalance({ address: qa.address }))} AVAX`);
}
