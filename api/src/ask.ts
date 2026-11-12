/**
 * POST /api/ask { question, coin? }: Juno AI, a Claude agent (claude-haiku-5-5) that explains a coin from live Fuji
 * reads: its sealed-bid opening, curve, floor, holders and trades. Read-only tools only; it cannot sign or trade. No
 * wallet is needed to ask (a judge can use it signed out), so it is rate limited per IP and per instance instead.
 * The Anthropic key stays on the server.
 */
import Anthropic from '@anthropic-ai/sdk';
import { isAddress, type Address, type PublicClient } from 'viem';
import { Limiter, setup, type Reply } from './http.ts';
import { LABEL, TOOLS, runTool, type Ctx } from './tools.ts';

export const MODEL = 'claude-haiku-5-5';
const perIp = new Limiter(10, 10 * 60_000);
const perInstance = new Limiter(150, 60 * 60_000);
const MAX_TURNS = 5;

const SYSTEM = `You are Juno AI, inside Juno: every post is a coin on Avalanche (Fuji testnet). Each post coin opens with a one-minute sealed-bid auction for 200 tokens where every winner pays one clearing price, then a bonding curve for 800 tokens in AVAX. 20% of every buy and half the auction raise go into the post's floor vault, which any holder can redeem against at any time. A creator can back a dare with a bond that holders vote on. Holders can hide their bag in an eERC vault (Ava Labs EncryptedERC): balances and private transfer amounts are encrypted; shield and unshield amounts are public.

Answer the asker's question about the coin they are viewing (or the coin they name). Use the tools for every number; never invent a price, a holder or a name. If a tool fails, say what you could not read.

You cannot sign, send or trade. Do not tell people what to buy or sell; explain what the chain shows (for example how the opening cleared, where the floor sits against the spot price, who holds most).

Style: plain text, at most about 90 words, short sentences, no markdown headings, lists or tables, AVAX with sensible precision. Coins are test AVAX on Fuji, not real money.`;

export type AskEnv = { ANTHROPIC_API_KEY?: string };

export async function handleAsk(body: any, ip: string, env: AskEnv, pub: PublicClient, client?: Anthropic): Promise<Reply> {
  if (!env.ANTHROPIC_API_KEY && !client) return setup('ANTHROPIC_API_KEY on Juno\'s API.');
  const { question, coin } = body ?? {};
  if (typeof question !== 'string' || !question.trim()) return { status: 400, body: { error: 'Ask something about this coin.' } };
  if (question.length > 400) return { status: 400, body: { error: 'Keep the question under 400 characters.' } };
  if (coin !== undefined && coin !== null && (typeof coin !== 'string' || !isAddress(coin))) return { status: 400, body: { error: 'coin must be a post address.' } };

  for (const [lim, key, what] of [[perIp, ip, 'this network'], [perInstance, 'all', 'Juno AI']] as const) {
    const r = lim.take(key);
    if (!r.ok) return { status: 429, body: { error: `Juno AI is busy for ${what}. Try again in ${Math.max(1, Math.ceil(r.retryS / 60))} min.` } };
  }

  const anthropic = client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  const ctx: Ctx = { pub, coin: (coin as Address | undefined) ?? null };
  const context = `Viewing: ${ctx.coin ? `coin ${ctx.coin}` : 'the feed (no coin open)'}. Time: ${new Date().toISOString()}.`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${context}\n\nQuestion: ${question.trim()}` }];
  const used: { name: string; label: string }[] = [];
  const t0 = Date.now();
  let answer = '';
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: SYSTEM, tools: TOOLS as unknown as Anthropic.Tool[], output_config: { effort: 'low' }, messages } as any);
      if (res.stop_reason === 'refusal') { answer = 'Juno AI can\'t help with that one.'; break; }
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || calls.length === 0) { answer = text; break; }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(calls.map(async (c) => {
        used.push({ name: c.name, label: (LABEL[c.name] ?? (() => c.name))(c.input) });
        try {
          const out = await runTool(c.name, c.input, ctx);
          return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) };
        } catch (e) {
          return { type: 'tool_result' as const, tool_use_id: c.id, content: `Could not read it: ${(e as Error).message.split('\n')[0]}`, is_error: true };
        }
      }));
      messages.push({ role: 'user', content: results });
      if (turn === MAX_TURNS - 1) answer = text || 'Juno AI ran out of steps on that one. Ask a narrower question.';
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return setup('a valid ANTHROPIC_API_KEY on Juno\'s API.');
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'Juno AI is rate limited by the model provider. Try again in a minute.' } };
    if (e instanceof Anthropic.APIError) return { status: 502, body: { error: `Juno AI's model call failed (${e.status ?? 'network'}).` } };
    throw e;
  }
  if (!answer) answer = 'No answer came back. Try asking again.';
  return { status: 200, body: { id: `ai-${t0.toString(36)}`, answer, tools: used, at: Date.now(), model: MODEL, ms: Date.now() - t0 } };
}
