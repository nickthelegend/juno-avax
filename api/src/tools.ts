/**
 * Juno AI's read-only tools over live Fuji. Every number comes from a JunoPost or the JunoFactory (or the eERC vault's
 * public ERC-20 balance); nothing here signs or sends.
 */
import { formatEther, isAddress, type Address, type PublicClient } from 'viem';
import { factoryAbi, holders, market, postAbi, posts, trades } from '@juno/sdk';
import { DEPLOYMENT } from '../../web/lib/deployment.ts';

export const FACTORY = DEPLOYMENT.factory as Address;
const VAULT = (DEPLOYMENT.eerc?.encryptedERC ?? null) as Address | null;
const NAMES = new Map(Object.entries(DEPLOYMENT.names as Record<string, string>).map(([a, n]) => [a.toLowerCase(), n]));
// Demo accounts are people: their names are capitalised wherever the agent sees them ("Mira", not "mira").
const person = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
export const nameOf = (a: string) => { const n = NAMES.get(a.toLowerCase()); return n ? person(n) : `${a.slice(0, 6)}…${a.slice(-4)}`; };
const avax = (wei: string | bigint) => `${Number(formatEther(BigInt(wei))).toLocaleString('en-US', { maximumSignificantDigits: 6 })} AVAX`;

export type Ctx = { pub: PublicClient; coin: Address | null };

const coinArg = { coin: { type: 'string', description: '0x address of the post; omit for the coin the asker is viewing' } };

export const TOOLS = [
  { name: 'list_coins', description: 'Every post coin on Juno (newest first, up to 20): slug, address, phase, spot price, floor per token, supply, trades.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_coin', description: 'One post coin: creator, caption, phase, opening-auction result, curve progress, spot price, floor vault and floor per token, creator earnings, dare and its vote.', input_schema: { type: 'object', properties: coinArg, additionalProperties: false } },
  { name: 'get_auction', description: 'The sealed-bid opening of one coin: each bid (bidder, revealed or not, tokens asked, max price, tokens won, refund) and the clearing price every winner paid.', input_schema: { type: 'object', properties: coinArg, additionalProperties: false } },
  { name: 'get_holders', description: 'Holders of one coin with balances and share of supply. The eERC vault appears as "private bags" (who holds inside it is hidden).', input_schema: { type: 'object', properties: coinArg, additionalProperties: false } },
  { name: 'get_trades', description: 'The latest fills of one coin (auction fills, buys, sells, redeems) with account, tokens and AVAX.', input_schema: { type: 'object', properties: { ...coinArg, limit: { type: 'number', description: '1 to 30, default 15' } }, additionalProperties: false } },
] as const;

export const LABEL: Record<string, (input: any) => string> = {
  list_coins: () => 'Read every coin',
  get_coin: () => 'Read the coin',
  get_auction: () => 'Read the sealed-bid opening',
  get_holders: () => 'Read holders',
  get_trades: () => 'Read recent trades',
};

async function coinOf(input: any, ctx: Ctx): Promise<Address> {
  const raw = (input?.coin ?? ctx.coin) as string | null;
  if (!raw || !isAddress(raw)) throw Error('No coin given. Pass a 0x post address (list_coins has them).');
  const ok = await ctx.pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'isPost', args: [raw as Address] });
  if (!ok) throw Error(`${raw} is not a Juno post.`);
  return raw as Address;
}

export async function runTool(name: string, input: any, ctx: Ctx): Promise<unknown> {
  const { pub } = ctx;
  if (name === 'list_coins') {
    const list = (await posts(pub, FACTORY)).reverse().slice(0, 20);
    return Promise.all(list.map(async (p) => {
      const m = await market(pub, p);
      return { address: p, slug: m.slug, phase: m.phase, spot: avax(m.spot_price), floorPerToken: avax(m.floor_per_token), supply: m.total_supply, trades: m.trade_count, graduated: m.graduated };
    }));
  }
  const coin = await coinOf(input, ctx);
  if (name === 'get_coin') {
    const m = await market(pub, coin);
    return {
      address: coin, slug: m.slug, symbol: `$${m.slug.toUpperCase()}`, creator: nameOf(m.creator), caption: m.caption, phase: m.phase,
      openedAt: new Date(m.opened_ms).toISOString(),
      auction: { sealedBids: m.sealed_bid_count, revealedBids: m.revealed_bid_count, clearingPrice: avax(m.clearing_price), tokensForSale: 200 },
      curve: { sold: Number(m.curve_sold), of: 800, spotPrice: avax(m.spot_price), graduated: m.graduated },
      floor: { vault: avax(m.floor_vault), perToken: avax(m.floor_per_token), totalSupply: m.total_supply, note: 'Any holder can redeem for 99% of their pro-rata share of the vault at any time.' },
      creatorEarnings: avax(m.creator_earnings),
      dare: m.dare ? { promise: m.dare, bond: avax(m.dare_bond), proof: m.proof || null, votesYes: m.votes_yes, votesNo: m.votes_no, finalized: m.dare_finalized, accepted: m.dare_accepted, endsAt: new Date(m.dare_end_ms).toISOString() } : null,
      trades: m.trade_count,
    };
  }
  if (name === 'get_auction') {
    const [bids, m] = await Promise.all([pub.readContract({ address: coin, abi: postAbi, functionName: 'bids' }), market(pub, coin)]);
    return {
      phase: m.phase,
      clearingPrice: avax(m.clearing_price),
      escrowPerBid: '0.005 AVAX, the same for everyone, so the deposit reveals nothing',
      bids: (bids as readonly any[]).map((b) => ({ bidder: nameOf(b.owner), revealed: b.revealed, tokensAsked: b.revealed ? Number(b.amount) : 'sealed', maxPrice: b.revealed ? avax(b.maxPrice) : 'sealed', tokensWon: Number(b.allocated), escrowRefundStillUnclaimed: avax(b.refund) })),
      note: 'Each bidder escrowed 0.005 AVAX; after settlement the unused part is claimable, and escrowRefundStillUnclaimed drops to 0 once claimed.',
    };
  }
  if (name === 'get_holders') {
    const list = await holders(pub, coin);
    const supply = list.reduce((s, [, b]) => s + BigInt(b), 0n);
    return list.slice(0, 25).map(([a, b]) => ({ holder: VAULT && a.toLowerCase() === VAULT.toLowerCase() ? 'private bags (eERC vault)' : nameOf(a), tokens: Number(b), share: supply > 0n ? `${(Number((BigInt(b) * 10000n) / supply) / 100).toFixed(2)}%` : '0%' }));
  }
  if (name === 'get_trades') {
    const n = Math.max(1, Math.min(30, Number(input?.limit ?? 15)));
    const list = await trades(pub, coin);
    return list.slice(-n).reverse().map((t) => ({ at: new Date(t.ms).toISOString(), kind: t.kind, account: nameOf(t.account), tokens: Number(t.quantity), avax: avax(t.total) }));
  }
  throw Error(`Unknown tool ${name}`);
}
