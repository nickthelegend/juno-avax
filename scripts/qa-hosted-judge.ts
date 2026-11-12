/**
 * The zero-setup judge path on the HOSTED app (default https://juno-avax.vercel.app), in headless Chrome with a
 * fresh browser profile: no extension, no QA signer, no key from this repo. The page makes its own Juno wallet, gets
 * its starter AVAX from JunoGasStation through Juno's API, then launches a post, wins its sealed-bid opening, buys,
 * sells, redeems against the floor and hides part of its bag in the eERC vault. Every hash is read from the page's
 * own eth_sendRawTransaction calls and checked on Fuji; the run is recorded in deployments/fuji.json → judgeRuns.
 *
 *   QA_WIDTH=1440 npx tsx qa-hosted-judge.ts       (QA_URL to point at another build)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { formatEther, type Hex } from 'viem';
import { client, FUJI_RPCS } from '@juno/sdk';
import { ROOT } from './fuji/env.ts';
import { confirmTx } from '../web/lib/tx-status.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');

const URL = (process.env.QA_URL ?? 'https://juno-avax.vercel.app').replace(/\/$/, '');
const WIDTH = Number(process.env.QA_WIDTH ?? 1440);
const SHOTS = `/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-juno/9round/judge-${WIDTH}`;
const slug = `judge-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`;
const pub = client(FUJI_RPCS);
const say = (s: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

type Step = { step: string; hash: Hex; status?: string; block?: number; confirmMs?: number; blockMs?: number | null };
const run: { url: string; width: number; slug: string; account?: string; gasTx?: Hex; post?: string; steps: Step[]; errors: string[]; at: string; result?: string } = { url: URL, width: WIDTH, slug, steps: [], errors: [], at: new Date().toISOString() };
const pending: Promise<unknown>[] = [];
let current = 'connect';
const save = () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
  data.judgeRuns ??= {};
  data.judgeRuns[String(WIDTH)] = { note: 'Hosted app, fresh browser profile, Juno wallet + JunoGasStation, driven by scripts/qa-hosted-judge.ts', ...run };
  writeFileSync(join(ROOT, 'deployments/fuji.json'), `${JSON.stringify(data, null, 2)}\n`);
};

await mkdir(SHOTS, { recursive: true });
try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 500 ? 812 : 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', (e: Error) => run.errors.push(`pageerror: ${String(e).slice(0, 200)}`));
      page.on('console', (m: { type: () => string; text: () => string }) => {
        if (m.type() === 'error') { run.errors.push(`console: ${m.text().slice(0, 200)}`); say(`console error: ${m.text().slice(0, 200)}`); }
      });
      page.on('request', (r: any) => {
        if (r.method() !== 'POST') return;
        const body = r.postData() ?? '';
        if (r.url().endsWith('/api/gas')) { try { run.account = JSON.parse(body).address; } catch { /* */ } }
      });
      page.on('response', async (r: any) => {
        if (r.request().method() !== 'POST') return;
        const body = r.request().postData() ?? '';
        if (r.url().endsWith('/api/gas')) {
          const j = await r.json().catch(() => ({}));
          if (j.hash) { run.gasTx = j.hash; say(`gas drip ${j.hash}`); } else say(`gas refused ${r.status()}: ${j.error}`);
          save();
          return;
        }
        if (!body.includes('eth_sendRawTransaction')) return;
        const j = await r.json().catch(() => null);
        const results = (Array.isArray(j) ? j : [j]).filter((x: any) => typeof x?.result === 'string' && /^0x[0-9a-f]{64}$/i.test(x.result));
        for (const x of results) {
          const step: Step = { step: current, hash: x.result };
          if (run.steps.some((s) => s.hash === step.hash)) continue;
          run.steps.push(step);
          save();
          say(`${current}: ${step.hash}`);
          pending.push(confirmTx(pub, step.hash).then(async (c) => {
            const rc = await pub.getTransactionReceipt({ hash: step.hash });
            Object.assign(step, { status: rc.status, block: Number(rc.blockNumber), confirmMs: c.ms, blockMs: c.blockMs });
            save();
          }));
        }
      });
      let n = 0;
      const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}-${WIDTH}.png` });
      const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
      const until = (l: { waitFor: (o: object) => Promise<void> }, ms = 180_000) => l.waitFor({ state: 'visible', timeout: ms });

      try {
        // 1. A judge with nothing: open Profile, connect, pick the Juno wallet. One tap creates it and gets gas.
        await page.goto(`${URL}/profile`, { waitUntil: 'networkidle' });
        await shot('profile-signed-out');
        await page.getByRole('button', { name: /Connect/ }).first().click();
        await until(button('Use a Juno wallet'), 20_000);
        await shot('connect-sheet');
        await button('Use a Juno wallet').click();
        await until(page.getByText(/AVAX from Juno.s gas station/).first(), 90_000);
        await page.waitForTimeout(2500);
        await shot('funded');
        if (!run.gasTx) throw Error('no gas drip');

        // 2. Launch a plain post.
        current = 'launch_post';
        await page.goto(`${URL}/post`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Use /art/juno-object-2.webp' }).click();
        await page.getByPlaceholder('night-market').fill(slug);
        await page.getByPlaceholder('Say what this is').fill('A judge run on the hosted app: new Juno wallet, free test AVAX, then a post with its own sealed-bid opening.');
        await shot('launch-form');
        await button(/^Launch post/).click();
        await page.waitForURL(/\/coin\/0x/, { timeout: 90_000 });
        run.post = page.url().split('/coin/')[1]!.split(/[?#]/)[0]!;
        save();
        say(`post ${run.post}`);

        // 3. Sealed bid, reveal, settle, claim.
        current = 'sealed_bid';
        await until(button(/^Place sealed bid/), 30_000);
        await shot('auction-open');
        await button(/^Place sealed bid/).click();
        await until(page.getByText(/^Your sealed bid:/).first(), 60_000);
        await shot('bid-placed');
        current = 'reveal';
        await until(button('Reveal my bid'));
        await button('Reveal my bid').click();
        await until(page.getByText(/^Revealed\./).first(), 60_000);
        current = 'settle';
        await until(button('Settle the auction'));
        await button('Settle the auction').click();
        await until(button(/^Claim .* refund$/), 90_000);
        await shot('settled');
        current = 'claim_refund';
        await button(/^Claim .* refund$/).click();
        await until(page.getByText(/^Final in /).first(), 60_000);

        // 4. Buy, sell, redeem.
        const trade = async (side: 'Buy' | 'Sell' | 'Redeem', amount: string) => {
          current = `${side.toLowerCase()}_${amount}`;
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

        // 5. Hide the bag: open it (one signature, no tx), register with a browser proof, shield 10.
        current = 'open_bag';
        await until(button('Hide your bag'), 30_000);
        await button('Hide your bag').click();
        await until(button('Sign to open'), 60_000);
        await button('Sign to open').click();
        current = 'register';
        const create = button('Create private bag');
        await until(create, 60_000);
        await shot('create-bag');
        await create.click();
        await until(page.getByText('Move a bag'), 180_000);
        current = 'shield';
        await page.getByRole('tab', { name: 'Shield', exact: true }).click();
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: new RegExp(`^\\$${slug.toUpperCase()}`) }).first().click();
        await page.getByLabel('Amount of tokens').fill('10');
        await shot('shield-form');
        await page.getByRole('button', { name: 'Shield', exact: true }).last().click();
        await until(page.getByText(/^Shield final on Fuji in/).first(), 180_000);
        await shot('shield-done');
        await page.getByRole('tab', { name: 'Public view', exact: true }).click();
        await page.waitForTimeout(5000);
        await shot('public-view');
        run.result = 'complete';
      } catch (error) {
        run.result = `failed at ${current}: ${String(error).split('\n')[0]}`;
        await page.screenshot({ path: `${SHOTS}/zz-failure-${WIDTH}.png` }).catch(() => undefined);
        const text = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '');
        say(`FAILED at ${current}: ${String(error).split('\n')[0]}\npage text: ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
        throw error;
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
} finally {
  await Promise.allSettled(pending);
  save();
  const bal = run.account ? formatEther(await pub.getBalance({ address: run.account as `0x${string}` })) : '?';
  say(`done: ${run.result}; ${run.steps.filter((s) => s.status === 'success').length}/${run.steps.length} txs succeeded; wallet ${run.account} left with ${bal} AVAX; ${run.errors.length} console errors`);
}
