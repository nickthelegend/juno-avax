/**
 * The landing page scrolls inside `.jl`, so a full-page screenshot only shows the hero.
 * This shoots each landing section (hero, live strip, how, app, get the app, tech, end) at 1440 and 375,
 * clicks Copy on the install line, and fails on console errors or sideways scroll.
 *   node scripts/landing-sections.mjs [base]     (default: serves web/dist on 5394)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'scripts/package.json'));
const { chromium } = require('playwright-core');
const { withChromeLock } = await import('/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
const OUT = process.env.SHOTS_DIR ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-juno/ship/after';
const DIST = join(root, 'web/dist');
const PORT = 5394;
const BASE = (process.argv[2] ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.zip': 'application/zip', '.sha256': 'text/plain', '.wasm': 'application/wasm' };
const server = process.argv[2] ? null : createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
server?.listen(PORT, '127.0.0.1');

const sections = ['.jl-hero', '.jl-live', '#how', '.jl-phone-sec', '#get-app', '#tech', '.jl-end'];
await mkdir(OUT, { recursive: true });
let failed = false;
try {
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      for (const [width, height] of [[1440, 900], [375, 812]]) {
        const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000);
        for (const sel of sections) {
          const el = page.locator(sel).first();
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(700);
          const name = sel.replace(/[#.]/g, '').replace(/^jl-/, '');
          await el.screenshot({ path: `${OUT}/landing-${name}-${width}.png` });
        }
        const copy = page.locator('#get-app button');
        const copied = (await copy.count()) ? (await copy.click(), await page.waitForTimeout(300), await copy.textContent()) : 'missing';
        const check = await page.evaluate(() => {
          const jl = document.querySelector('.jl');
          return {
            overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, jl ? jl.scrollWidth - jl.clientWidth : 0),
            download: document.querySelector('#get-app a[download]')?.getAttribute('href') ?? null,
            setup: document.querySelector('#get-app .jl-setup b')?.textContent ?? null,
          };
        });
        const zip = check.download ? await page.request.get(`${BASE}${check.download}`).then((r) => ({ status: r.status(), bytes: Number(r.headers()['content-length'] ?? 0) })) : null;
        const ok = errors.length === 0 && check.overflow <= 0 && !!check.download && zip?.status === 200 && copied === 'Copied';
        if (!ok) failed = true;
        console.log(JSON.stringify({ width, ok, ...check, zip, copied, errors: errors.slice(0, 3) }));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  });
} finally {
  server?.close();
}
process.exit(failed ? 1 : 0);
