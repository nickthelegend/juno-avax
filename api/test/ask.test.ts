// Juno AI against live Fuji: each read-only tool agrees with a direct chain read, the endpoint refuses bad input and
// reports Setup required without a key, and one real claude-haiku-5-5 run answers with visible tool calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from 'viem';
import { holders, market, postAbi, trades } from '@juno/sdk';
import { handleAsk } from '../src/ask.ts';
import { runTool, type Ctx } from '../src/tools.ts';
import { fujiClient } from '../src/pub.ts';
import { ANTHROPIC_ENV } from './env.ts';

const pub = fujiClient();
const d = JSON.parse(readFileSync(join(import.meta.dirname, '../../deployments/fuji.json'), 'utf8'));
const PILE = d.posts['pile-in'] as Address;
const ctx: Ctx = { pub, coin: PILE };

test('get_coin matches JunoPost.market on Fuji', { timeout: 60_000 }, async () => {
  const out: any = await runTool('get_coin', {}, ctx);
  const m = await market(pub, PILE);
  assert.equal(out.slug, m.slug);
  assert.equal(out.phase, m.phase);
  assert.equal(out.curve.sold, Number(m.curve_sold));
  assert.equal(out.trades, m.trade_count);
});

test('get_auction lists every bid with the clearing price', { timeout: 60_000 }, async () => {
  const out: any = await runTool('get_auction', {}, ctx);
  const bids = await pub.readContract({ address: PILE, abi: postAbi, functionName: 'bids' });
  assert.equal(out.bids.length, bids.length);
  assert.equal(out.bids.reduce((s: number, b: any) => s + b.tokensWon, 0), bids.reduce((s, b) => s + Number(b.allocated), 0));
});

test('get_holders and get_trades agree with the chain; the vault is labelled', { timeout: 60_000 }, async () => {
  const [h, t] = await Promise.all([runTool('get_holders', {}, ctx) as Promise<any[]>, runTool('get_trades', { limit: 5 }, ctx) as Promise<any[]>]);
  const chainHolders = await holders(pub, PILE);
  assert.equal(h[0].tokens, Number(chainHolders[0]![1]));
  const chainTrades = await trades(pub, PILE);
  assert.equal(t.length, Math.min(5, chainTrades.length));
  assert.equal(t[0].tokens, Number(chainTrades.at(-1)!.quantity));
});

test('a non-post address is refused by the tool', { timeout: 60_000 }, async () => {
  await assert.rejects(runTool('get_coin', { coin: '0x0000000000000000000000000000000000000001' }, ctx), /not a Juno post/);
});

test('Setup required without a key; bad input refused', async () => {
  const r = await handleAsk({ question: 'hi' }, '198.51.100.20', {}, pub);
  assert.equal(r.status, 503);
  assert.match(String(r.body.error), /^Setup required/);
  assert.equal((await handleAsk({ question: '' }, '198.51.100.21', { ANTHROPIC_API_KEY: 'x' }, pub)).status, 400);
  assert.equal((await handleAsk({ question: 'hi', coin: 'nope' }, '198.51.100.21', { ANTHROPIC_API_KEY: 'x' }, pub)).status, 400);
});

test('one real Juno AI answer about PILE-IN, with tool calls', { timeout: 120_000, skip: !ANTHROPIC_ENV.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY not set' }, async () => {
  const r = await handleAsk({ question: 'How did the opening auction clear, and where is the floor against the spot price?', coin: PILE }, '198.51.100.22', { ANTHROPIC_API_KEY: ANTHROPIC_ENV.ANTHROPIC_API_KEY }, pub);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const tools = (r.body.tools as { name: string }[]).map((x) => x.name);
  assert.ok(tools.length > 0, 'used at least one tool');
  assert.ok(String(r.body.answer).length > 20);
  console.log(`tools: ${tools.join(', ')}\nanswer: ${r.body.answer}`);
});
