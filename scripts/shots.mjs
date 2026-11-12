/**
 * Screenshots of every route at 1440 and 375, from the production web export
 * (web/dist) reading live Fuji, in headless Chrome under the shared Chrome lock.
 * Fails when a route renders nothing, throws, logs a console error, or scrolls sideways.
 *
 *   node scripts/shots.mjs            (serves web/dist on 5393 itself)
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'scripts/package.json'));
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const OUT = process.env.SHOTS_DIR ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-juno/v2';
const DIST = join(root, 'web/dist');
const PORT = 5393;
// SHOTS_BASE=https://juno-avax.vercel.app shoots the hosted site instead of serving web/dist.
const BASE = (process.env.SHOTS_BASE ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const d = JSON.parse(readFileSync(join(root, 'deployments/fuji.json'), 'utf8'));

const routes = [
  ['/', 'landing'],
  ['/social', 'feed'],
  ['/trade', 'trade'],
  ['/reels', 'reels'],
  ['/post', 'post'],
  ['/profile', 'profile'],
  [`/coin/${d.posts['pile-in']}`, 'coin-graduated'],
  [`/coin/${d.posts.rooftop}`, 'coin-dare'],
  [`/coin/${d.posts.sprout}`, 'coin-sprout'],
  ...(d.qaRuns?.['1440']?.post ? [[`/coin/${d.qaRuns['1440'].post}`, 'coin-qa']] : d.qaFlow?.post ? [[`/coin/${d.qaFlow.post}`, 'coin-qa']] : []),
  ...(d.posts['first-ollie'] ? [[`/coin/${d.posts['first-ollie']}`, 'coin-live-dare']] : []),
  [`/trader/${d.accounts.kai}`, 'trader'],
  ['/vault', 'vault-public'],
  ['/vault?view=yours', 'vault-yours-signed-out'],
  ['/vault?view=auditor', 'vault-auditor'],
  ['/coin/0x0000000000000000000000000000000000000001', 'coin-not-found'],
  ['/nope', 'not-found'],
];

const types = { '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
const server = process.env.SHOTS_BASE ? null : createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
server?.listen(PORT, '127.0.0.1');

await mkdir(OUT, { recursive: true });
let failed = false;
try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      for (const [route, name] of routes) {
        for (const [width, height] of [[1440, 900], [375, 812]]) {
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
          page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
          await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch((e) => errors.push(String(e)));
          await page.waitForTimeout(Number(process.env.SHOT_WAIT_MS ?? 7000));
          const check = await page.evaluate(() => ({
            text: (document.getElementById('root')?.innerText ?? document.body.innerText ?? '').trim().length,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          }));
          const file = `${OUT}/${name}-${width}.png`;
          await page.screenshot({ path: file, fullPage: name === 'landing' });
          const ok = check.text > 0 && errors.length === 0 && check.overflow <= 0;
          if (!ok) failed = true;
          console.log(JSON.stringify({ route: name, width, ok, overflow: check.overflow, errors: errors.slice(0, 3) }));
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
} finally {
  server?.close();
}
process.exit(failed ? 1 : 0);
