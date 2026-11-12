import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { BID_ESCROW, bidOf, commitment, parseAvax, randomSalt, voteOf, BASE } from "@juno/sdk";
import type { Address, Hex } from "viem";

import { CoinGlyph } from "./art";
import { BrandImage } from "./brand";
import { Object3D } from "./art3d";
import { Button, Skeleton } from "./kit";
import { Tappable } from "./Press";
import { fujiClient, juno, type Coin, type FeedItem } from "../lib/api";
import { CHAIN_ID, describeTxError, EXPLORER_NAME, explorer, sameAddress } from "../lib/chain";
import { loadMarkets, invalidateMarkets } from "../lib/markets";
import { useHandle } from "../lib/names";
import { useReducedMotion } from "../lib/motion";
import { amountOf, money, since, splitAmount, useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * What makes a Juno post more than a meme coin, drawn in the app's own surfaces.
 *
 * - The ink panel in the feed rail: AVAX held in every
 *   post's redeemable floor, live sealed bids, and the newest fill.
 * - A floor chip under each post, in the same pill as the old burned chip.
 * - On a coin page: the sealed-bid opening auction (with its countdown), the
 *   graduation escrow, and the dare bond — each a card in the page's own style.
 *
 * Every figure is read from Avalanche Fuji. Nothing here is computed from a
 * guess: a figure that could not be read shows a dash.
 */

const c = theme.colors;
const POLL_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

/** A floor: a bar under a stack. Means one thing: AVAX held for holders to redeem. */
export function FloorGlyph({ size = 16, color = c.pos, filled = false }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={4.5} width={12} height={5} rx={2.5} fill={filled ? color : "none"} stroke={color} strokeWidth={1.9} />
      <Rect x={6} y={10.5} width={12} height={5} rx={2.5} fill={filled ? color : "none"} stroke={color} strokeWidth={1.9} />
      <Path d="M3.5 19.5h17" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

/** A sealed envelope: a bid nobody can read until it is revealed. */
export function SealGlyph({ size = 16, color = c.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={6} width={17} height={12.5} rx={2.5} stroke={color} strokeWidth={1.9} />
      <Path d="m4.5 7.5 7.5 6 7.5-6" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
      <Circle cx={12} cy={14.5} r={2} fill={color} />
    </Svg>
  );
}

function ArrowOut({ size = 14, color = c.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 16 16 8M9.5 8H16v6.5" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/** Seconds until `ms`, re-rendered every second while it is in the future. */
export function useCountdown(ms: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (ms === null || ms <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ms]);
  if (ms === null) return null;
  return Math.max(0, Math.ceil((ms - now) / 1000));
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Where a post is in its life, in a few words, for a button or a chip. */
export function phaseLabel(coin: Coin, secondsLeft: number | null): string {
  const n = coin.onchain;
  const bids = `${n.sealedBids} sealed ${n.sealedBids === 1 ? "bid" : "bids"}`;
  if (n.phase === "commit") return secondsLeft !== null ? `Bidding · ${clock(secondsLeft)}` : bids;
  if (n.phase === "reveal") return secondsLeft !== null ? `Reveal · ${clock(secondsLeft)}` : "Revealing";
  if (n.phase === "settle") return "Ready to settle";
  if (n.phase === "graduated") return "Graduated";
  return "Buy";
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

function useTicking(target: number | null): number | null {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) return;
    const start = from.current ?? target;
    from.current = target;
    if (reduced || !(target > start) || start === 0) {
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) setShown(target);
      else {
        setShown(start + (target - start) * eased);
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return shown;
}

function useLive<T>(load: () => Promise<T>) {
  const state = useApi(load, []);
  const refresh = useRef(state.refresh);
  refresh.current = state.refresh;
  useEffect(() => {
    const id = setInterval(() => {
      invalidateMarkets();
      refresh.current();
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);
  return state;
}

/** The ink panel: AVAX held in post floors across Juno, the auctions running now, and the newest fill. */
export function FloorPanel() {
  const router = useRouter();
  const markets = useLive(() => loadMarkets());
  const fills = useLive(() => juno.feed(4));
  const posts = markets.data?.posts ?? null;
  const total = posts ? posts.reduce((sum, coin) => sum + coin.onchain.floorVault, 0) : null;
  const shown = useTicking(total);

  if (!posts) {
    if (markets.loading) {
      return (
        <View style={s.panel} accessibilityLabel="Reading the post floors">
          <Text style={s.panelLabel}>AVAX in post floors</Text>
          <Skeleton h={40} w="70%" style={{ backgroundColor: c.inkSoft, marginTop: 12 }} />
          <Skeleton h={14} w="45%" style={{ backgroundColor: c.inkSoft, marginTop: 12 }} />
        </View>
      );
    }
    const setup = /setup required/i.test(markets.error ?? "");
    return (
      <View style={s.panel}>
        <Row>
          <FloorGlyph color={c.lime} />
          <Text style={s.panelLabel}>{setup ? "Setup required" : "Could not read Avalanche Fuji"}</Text>
        </Row>
        <Text style={s.panelDetail}>{(markets.error ?? "The RPC did not answer.").replace(/^Setup required:\s*/i, "Set ")}</Text>
        {setup ? null : (
          <Button label="Try again" variant="lime" onPress={markets.refresh} style={{ alignSelf: "flex-start", marginTop: 14 }} />
        )}
      </View>
    );
  }

  const figure = splitAmount((shown ?? 0).toFixed(8), 4);
  const bidding = posts.filter((coin) => coin.onchain.phase === "commit" || coin.onchain.phase === "reveal");
  const sealed = bidding.reduce((sum, coin) => sum + coin.onchain.sealedBids, 0);
  const graduated = posts.filter((coin) => coin.curve.graduated).length;
  const latest: FeedItem | null = fills.data?.items[0] ?? null;

  return (
    <View style={s.panel}>
      <Row justify="space-between">
        <Row>
          <FloorGlyph color={c.lime} filled />
          <Text style={s.panelLabel}>AVAX in post floors</Text>
        </Row>
        <View style={s.livePill} accessibilityLabel={markets.error ? "Stale: the last read failed" : "Live: re-read every few seconds"}>
          <View style={[s.liveDot, markets.error ? { backgroundColor: c.neg } : null]} />
          <Text style={s.liveText}>{markets.error ? "Stale" : "Live"}</Text>
        </View>
      </Row>

      <View style={s.figureRow}>
        <Text style={[s.figure, { flexShrink: 1 }]} accessibilityLabel={`${total} AVAX in floors`} numberOfLines={1} adjustsFontSizeToFit>
          {figure.whole}
          <Text style={s.figureFrac}>.{figure.frac}</Text>
          <Text style={s.figureUnit}> AVAX</Text>
        </Text>
        <View style={s.coin}>
          <BrandImage art="postCard" alt="" size={76} float="drift" eager />
        </View>
      </View>
      <Text style={s.panelDetail}>
        Any holder can redeem against a post's floor at any time. Half of every opening auction and 20% of each buy go in. Fuji testnet.
      </Text>

      <View style={s.split}>
        <SplitFigure label="Sealed bids now" value={String(sealed)} hint={`${bidding.length} ${bidding.length === 1 ? "auction" : "auctions"} open`} />
        <View style={s.splitRule} />
        <SplitFigure label="Posts" value={String(posts.length)} hint={`${graduated} graduated`} />
      </View>

      {latest ? (
        <Tappable
          onPress={() => router.push(`/coin/${latest.coin.address}` as never)}
          to={0.98}
          accessibilityRole="link"
          accessibilityLabel={`Latest fill on $${latest.coin.symbol}, ${since(latest.timestamp)} ago. Open the coin.`}
          style={s.latest}
        >
          <CoinGlyph seed={latest.coin.address} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.latestTitle} numberOfLines={1}>
              {latest.fill === "auction" ? "Won" : latest.fill === "redeem" ? "Redeemed" : latest.fill === "buy" ? "Bought" : "Sold"} {latest.amount} ${latest.coin.symbol} · {amountOf(latest.valueUsd, "AVAX")}
            </Text>
            <LatestDetail item={latest} />
          </View>
          <ArrowOut />
        </Tappable>
      ) : (
        <View style={[s.latest, { paddingVertical: 14 }]}>
          <Text style={[s.latestDetail, { flex: 1 }]}>No fills yet. The first auction settles a minute after bidding closes.</Text>
        </View>
      )}
    </View>
  );
}

function LatestDetail({ item }: { item: FeedItem }) {
  const handle = useHandle(item.actor.wallet);
  return (
    <Text style={s.latestDetail} numberOfLines={1}>
      {handle} · {since(item.timestamp)} ago
    </Text>
  );
}

function SplitFigure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.splitLabel}>{label}</Text>
      <Text style={s.splitValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.splitHint}>{hint}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

/** "Floor 0.0012 AVAX" under a post: what one token redeems for right now. */
export function FloorChip({ coin, tone = "light" }: { coin: Coin; tone?: "light" | "night" }) {
  if (!(coin.onchain.floorPerToken > 0)) return null;
  return (
    <View style={[s.floor, tone === "night" ? s.floorNight : null]} accessibilityLabel={`Floor ${coin.onchain.floorPerToken} AVAX per token`}>
      <FloorGlyph size={12} color={tone === "night" ? c.lime : c.pos} filled />
      <Text style={[s.floorText, tone === "night" ? { color: c.lime } : null]}>Floor {money(coin.onchain.floorPerToken, "AVAX")}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Coin page cards                                                     */
/* ------------------------------------------------------------------ */

type BidSecret = { amount: string; maxPrice: string; salt: Hex };
function secretKey(token: string, account: string) {
  return `juno-avax-bid:${token.toLowerCase()}:${account.toLowerCase()}`;
}
function readSecret(token: string, account: string): BidSecret | null {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(secretKey(token, account));
      return raw ? (JSON.parse(raw) as BidSecret) : null;
    }
  } catch {
    /* storage refused */
  }
  return null;
}
function writeSecret(token: string, account: string, secret: BidSecret) {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") localStorage.setItem(secretKey(token, account), JSON.stringify(secret));
  } catch {
    /* storage refused */
  }
}

/**
 * The sealed-bid opening auction, as a coin-page card.
 *
 * For its first minute a post takes sealed bids: each is a keccak hash of
 * (post, chain, bidder, amount, max price, salt) with exactly 0.005 AVAX
 * escrowed, so nobody — not the creator, not a bot watching the mempool — can
 * see or copy a bid. The salt never leaves this browser until the reveal.
 * The next minute bids are revealed. Then anyone settles: everyone who
 * cleared pays the same price, the rest is refunded, and half the proceeds
 * seed the floor.
 */
export function AuctionCard({ coin, onChanged }: { coin: Coin; onChanged: () => void }) {
  const wallet = useWallet();
  const n = coin.onchain;
  const commitLeft = useCountdown(n.phase === "commit" ? n.commitEndMs : null);
  const revealLeft = useCountdown(n.phase === "reveal" ? n.revealEndMs : null);
  const [amount, setAmount] = useState("50");
  const [maxPrice, setMaxPrice] = useState("0.00001");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<{ hash: string; ms: number | null } | null>(null);
  const [mineOnChain, setMineOnChain] = useState<{ exists: boolean; revealed: boolean; refund: number; allocated: number } | null>(null);
  const pendingBidAccount = useRef<string | null>(null);

  // A phase boundary passing on screen is a reason to re-read.
  useEffect(() => {
    if (commitLeft === 0 || revealLeft === 0) onChanged();
  }, [commitLeft, revealLeft, onChanged]);

  // This account's bid as the contract sees it (exists, revealed, refund owed).
  useEffect(() => {
    let live = true;
    if (!wallet.address) {
      setMineOnChain(null);
      return;
    }
    bidOf(fujiClient(), coin.address as Address, wallet.address as Address)
      .then((b) => live && setMineOnChain({ exists: b.exists, revealed: b.revealed, refund: Number(b.refund) / 1e18, allocated: b.allocated }))
      .catch(() => live && setMineOnChain(null));
    return () => {
      live = false;
    };
  }, [wallet.address, coin.address, n.phase, n.sealedBids, n.revealedBids, hash]);

  const run = async (label: string, build: () => Promise<Parameters<typeof wallet.send>[0]>) => {
    setBusy(true);
    setError(null);
    setHash(null);
    try {
      if (!wallet.address) await wallet.connect();
      const steps = await build();
      const sent = await wallet.send(steps);
      const last = sent.hashes.length - 1;
      setHash({ hash: sent.hashes[last] ?? "", ms: sent.blockMs[last] ?? sent.finalityMs[last] ?? null });
      onChanged();
    } catch (caught) {
      const failure = describeTxError(caught);
      if (label === "Bid" && pendingBidAccount.current && failure.cancelled) {
        // A cancelled approval cannot have submitted this commitment.
        try {
          if (typeof localStorage !== "undefined") localStorage.removeItem(secretKey(coin.address, pendingBidAccount.current));
        } catch { /* storage refused */ }
        pendingBidAccount.current = null;
      }
      setError(failure.cancelled ? null : failure.message || `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const refundButton =
    mineOnChain?.exists && mineOnChain.refund > 0 && (n.phase === "curve" || n.phase === "graduated") ? (
      <Button
        label={`Claim ${money(mineOnChain.refund, "AVAX", { compact: false })} refund`}
        variant="ink"
        tall
        onPress={() => void run("Refund", async () => [juno.call(coin.address as Address, "claimRefund", "Claim refund")])}
        loading={busy}
      />
    ) : null;

  if (n.phase === "curve" || n.phase === "graduated") {
    if (!(n.clearingPrice > 0) && n.sealedBids === 0) return null;
    return (
      <View style={f.card}>
        <Row justify="space-between">
          <Row>
            <SealGlyph />
            <Text style={f.title}>Opening auction</Text>
          </Row>
          <Object3D art="envelope" alt="" size={44} style={{ margin: "-6px 0" }} />
        </Row>
        <View style={f.tiles}>
          <Tile label="Cleared at" value={n.clearingPrice > 0 ? money(n.clearingPrice, "AVAX") : "No fills"} />
          <Tile label="Sealed bids" value={String(n.sealedBids)} />
          <Tile label="Revealed" value={String(n.revealedBids)} />
        </View>
        <Text style={f.body}>
          {n.clearingPrice > 0
            ? "Every winning bid paid the same clearing price, however early it came in. Bids never revealed got their escrow back minus 1%."
            : "No bid was revealed, so nothing filled: the curve opened at its first price. Unrevealed bids got their escrow back minus 1%."}
        </Text>
        {mineOnChain?.exists ? (
          <Text style={f.mine}>
            {mineOnChain.allocated > 0 ? `You won ${mineOnChain.allocated} at the clearing price.` : mineOnChain.revealed ? "Your bid was under the clearing price." : "Your bid was never revealed."}
          </Text>
        ) : null}
        {refundButton}
        {error ? <Text style={f.error}>{error}</Text> : null}
        {hash ? <TxLink hash={hash.hash} ms={hash.ms} /> : null}
      </View>
    );
  }

  const commit = () =>
    run("Bid", async () => {
      const account = (wallet.address ?? (await wallet.connect())) as Address;
      const units = BigInt(Math.max(1, Math.floor(Number(amount) || 0)));
      let price: bigint;
      try {
        price = parseAvax(maxPrice);
      } catch {
        throw new Error("Enter a max price in AVAX, like 0.00001.");
      }
      if (units > 200n) throw new Error("At most 200 tokens are sold in the opening auction.");
      if (price < BASE) throw new Error("The max price must be at least 0.000001 AVAX, the curve's first price.");
      if (units * price > BID_ESCROW) throw new Error("Tokens × max price must fit inside the 0.005 AVAX escrow.");
      const salt = randomSalt();
      writeSecret(coin.address, account, { amount: units.toString(), maxPrice: price.toString(), salt });
      pendingBidAccount.current = account;
      const c = commitment(coin.address as Address, CHAIN_ID, account, units, price, salt);
      return [juno.call(coin.address as Address, "commit", "Sealed bid", [c], BID_ESCROW)];
    });
  const reveal = () =>
    run("Reveal", async () => {
      const account = wallet.address ?? (await wallet.connect());
      const secret = readSecret(coin.address, account);
      if (!secret) throw new Error("This browser does not hold your bid's secret, so it cannot reveal it.");
      return [juno.call(coin.address as Address, "reveal", "Reveal", [BigInt(secret.amount), BigInt(secret.maxPrice), secret.salt])];
    });
  const settle = () => run("Settle", async () => [juno.call(coin.address as Address, "settle", "Settle")]);

  const mine = wallet.address ? readSecret(coin.address, wallet.address) : null;
  const units = Math.max(0, Math.floor(Number(amount) || 0));
  const priceNum = Number(maxPrice) || 0;
  const spend = units * priceNum;

  return (
    <View style={f.card}>
      <Row justify="space-between">
        <Row>
          <SealGlyph />
          <Text style={f.title}>Sealed-bid opening</Text>
        </Row>
        <View style={f.clock}>
          <Text style={f.clockText}>
            {n.phase === "commit" && commitLeft !== null
              ? `Bids close ${clock(commitLeft)}`
              : n.phase === "reveal" && revealLeft !== null
                ? `Reveals close ${clock(revealLeft)}`
                : "Ready to settle"}
          </Text>
        </View>
      </Row>
      <PhaseTrack phase={n.phase} />
      <View style={f.tiles}>
        <Tile label="Sealed bids" value={String(n.sealedBids)} on />
        <Tile label="Revealed" value={String(n.revealedBids)} />
        <Tile label="For sale" value="200" />
      </View>
      <Text style={f.body}>
        {n.phase === "commit"
          ? "A bid is a hash with 0.005 AVAX escrowed, the same for everyone, so nobody can read a price until the reveal. Everyone who clears pays one price."
          : n.phase === "reveal"
            ? "Bidders reveal amount, max price and salt. A bid that is never revealed is refunded minus 1%."
            : "Bidding and reveals are over. Anyone can settle: winners get tokens at one price, and unused escrow is claimable."}
      </Text>

      {n.phase === "commit" ? (
        mine ? (
          <Text style={f.mine}>
            Your sealed bid: {mine.amount} tokens at up to {amountOf(Number(mine.maxPrice) / 1e18, "AVAX")}. The salt stays in this browser until you reveal.
          </Text>
        ) : mineOnChain?.exists ? (
          <Text style={f.mine}>This account already has a sealed bid here, placed from another browser.</Text>
        ) : (
          <>
            <View style={f.inputs}>
              <Field label="Tokens" value={amount} onChange={setAmount} />
              <Field label="Max AVAX each" value={maxPrice} onChange={setMaxPrice} />
            </View>
            <Text style={[f.hint, spend > 0.005 ? { color: c.neg } : null]}>
              {spend > 0 ? `Up to ${amountOf(spend, "AVAX")} of your 0.005 AVAX escrow; the rest comes back.` : "Tokens × max price must fit inside the escrow."}
            </Text>
            <Button label="Place sealed bid · 0.005 AVAX escrow" variant="lime" tall onPress={() => void commit()} loading={busy} />
          </>
        )
      ) : n.phase === "reveal" ? (
        <Button label={mine ? "Reveal my bid" : mineOnChain?.exists ? "Your bid's secret is in another browser" : "No bid from this account"} variant="ink" tall disabled={!mine || mineOnChain?.revealed === true} onPress={() => void reveal()} loading={busy} />
      ) : (
        <Button label="Settle the auction" variant="lime" tall onPress={() => void settle()} loading={busy} />
      )}
      {mineOnChain?.revealed && n.phase === "reveal" ? <Text style={f.mine}>Revealed. Settlement opens when the clock runs out.</Text> : null}
      {error ? <Text style={f.error}>{error}</Text> : null}
      {hash ? <TxLink hash={hash.hash} ms={hash.ms} /> : null}
    </View>
  );
}

/** Commit → Reveal → Settle → Curve, with the current step lit. */
function PhaseTrack({ phase }: { phase: Coin["onchain"]["phase"] }) {
  const steps = ["Bid", "Reveal", "Settle", "Trade"];
  const at = phase === "commit" ? 0 : phase === "reveal" ? 1 : phase === "settle" ? 2 : 3;
  return (
    <View style={f.track} accessibilityLabel={`Step ${at + 1} of 4: ${steps[at]}`}>
      {steps.map((label, i) => (
        <View key={label} style={f.trackStep}>
          <View style={[f.trackBar, i < at ? f.trackDone : i === at ? f.trackNow : null]} />
          <Text style={[f.trackLabel, i === at ? { color: c.text } : null]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A graduated post: the curve sold out and everything it raised now backs the floor. */
export function GraduationMoment({ coin }: { coin: Coin }) {
  if (!coin.curve.graduated) return null;
  const when = coin.graduation ? new Date(coin.graduation.timestamp) : null;
  return (
    <View style={f.moment}>
      <View style={f.momentBadge}>
        <FloorGlyph size={22} color={c.lime} filled />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={f.momentFigure}>{amountOf(coin.onchain.floorVault, "AVAX")} backs every token</Text>
        <Text style={f.momentKicker}>
          {when
            ? `Graduated ${when.toLocaleDateString([], { day: "numeric", month: "short" })}, ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Graduated"}
        </Text>
        <Text style={f.momentBody}>
          All 800 curve tokens sold. The curve closed and everything it raised moved into the floor, so each token redeems for {amountOf(coin.onchain.floorPerToken * 0.99, "AVAX")} any time.
        </Text>
        <Pressable onPress={() => void Linking.openURL(explorer("address", coin.address))} accessibilityRole="link" style={f.momentLink}>
          <Text style={f.momentLinkText}>Contract on {EXPLORER_NAME}</Text>
          <ArrowOut size={12} color={c.lime} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The dare: the creator's bond, the proof, the vote, and the outcome.
 * The creator posts proof; holders vote yes or no (weighted by what they hold
 * when the dare closes); after five minutes anyone finalizes. A passed proof
 * returns the bond; a flake sends it into the floor for the holders.
 */
export function DareCard({ coin, onChanged }: { coin: Coin; onChanged?: () => void }) {
  const wallet = useWallet();
  const n = coin.onchain;
  const left = useCountdown(n.dareFinalized ? null : n.dareEndMs);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<{ hash: string; ms: number | null } | null>(null);
  const [myVote, setMyVote] = useState<0 | 1 | 2>(0);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    if (!wallet.address || !n.dare) return;
    Promise.all([voteOf(fujiClient(), coin.address as Address, wallet.address as Address), juno.balances(wallet.address, coin.address)])
      .then(([vote, balances]) => {
        if (!live) return;
        setMyVote(vote);
        setHeld(balances.token);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wallet.address, coin.address, n.dare, hash]);

  if (!n.dare) return null;
  const open = left !== null && left > 0;
  const isCreator = sameAddress(wallet.address, coin.creator.wallet);
  const totalVotes = n.votesYes + n.votesNo;
  const yesShare = totalVotes > 0 ? n.votesYes / totalVotes : 0;

  const act = async (label: string, functionName: string, args: readonly unknown[] = []) => {
    setBusy(label);
    setError(null);
    setHash(null);
    try {
      if (!wallet.address) await wallet.connect();
      const sent = await wallet.send([juno.call(coin.address as Address, functionName, label, args)]);
      setHash({ hash: sent.hashes[0] ?? "", ms: sent.blockMs[0] ?? sent.finalityMs[0] ?? null });
      onChanged?.();
    } catch (caught) {
      const failure = describeTxError(caught);
      setError(failure.cancelled ? null : failure.message);
    } finally {
      setBusy(null);
    }
  };

  const outcome = n.dareFinalized
    ? n.dareAccepted
      ? "Holders accepted the proof. The bond went back to the creator."
      : n.totalSupply > 0
        ? "The dare failed. The bond went into the floor for the holders."
        : "The dare closed with no holders, so the bond went back to the creator."
    : null;

  return (
    <View style={f.card}>
      <Row justify="space-between">
        <Text style={f.kicker}>Dare</Text>
        <Object3D art="dice" alt="" size={52} float style={{ margin: "-10px 0" }} />
      </Row>
      <Text style={f.dare}>{n.dare}</Text>
      <View style={f.tiles}>
        <Tile label="Bond" value={n.dareBond > 0 ? money(n.dareBond, "AVAX") : n.dareFinalized ? "Settled" : "None"} on={n.dareBond > 0} />
        <Tile label="Proof" value={n.proof ? "Posted" : "Not yet"} />
        <Tile label={n.dareFinalized ? "Result" : "Closes"} value={n.dareFinalized ? (n.dareAccepted ? "Done" : "Flaked") : open ? clock(left!) : "Now"} />
      </View>

      {totalVotes > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={f.voteBar}>
            <View style={[f.voteYes, { flex: Math.max(0.001, yesShare) }]} />
            <View style={{ flex: Math.max(0.001, 1 - yesShare), backgroundColor: c.negSoft }} />
          </View>
          <Text style={f.hint}>
            Yes {n.votesYes} · No {n.votesNo} tokens, counted at close
          </Text>
        </View>
      ) : null}

      {n.proof ? (
        /^https?:\/\//.test(n.proof) || n.proof.startsWith("/") ? (
          <Pressable onPress={() => void Linking.openURL(juno.media(n.proof) ?? n.proof)} accessibilityRole="link" style={f.txLink}>
            <Text style={f.txText}>Open the proof</Text>
            <ArrowOut size={12} color={c.focus} />
          </Pressable>
        ) : (
          <Text style={f.body}>Proof: {n.proof}</Text>
        )
      ) : null}

      {outcome ? (
        <Text style={f.mine}>{outcome}</Text>
      ) : open && isCreator && !n.proof ? (
        <>
          <View style={f.field}>
            <Text style={f.tileLabel}>Proof link</Text>
            <TextInput value={proof} onChangeText={setProof} placeholder="https://…" placeholderTextColor={c.faint} autoCapitalize="none" style={f.fieldInput} accessibilityLabel="Proof link" />
          </View>
          <Button label="Post proof" variant="lime" tall disabled={!/^https:\/\/\S{4,290}$/.test(proof.trim())} loading={busy === "Post proof"} onPress={() => void act("Post proof", "submitProof", [proof.trim()])} />
        </>
      ) : open && n.proof && myVote === 0 && (held ?? 0) > 0 ? (
        <View style={f.inputs}>
          <Button label="Proof holds" variant="lime" style={{ flex: 1 }} loading={busy === "Vote yes"} onPress={() => void act("Vote yes", "vote", [true])} />
          <Button label="It flaked" variant="sell" style={{ flex: 1 }} loading={busy === "Vote no"} onPress={() => void act("Vote no", "vote", [false])} />
        </View>
      ) : open ? (
        <Text style={f.body}>
          {myVote ? `You voted ${myVote === 1 ? "yes" : "no"}. ` : ""}
          {!n.proof ? "Waiting for the creator's proof. " : (held ?? 0) === 0 && !myVote ? "Holders vote on the proof. " : ""}
          If it passes, the bond returns to the creator; if it flakes, the bond goes into the floor.
        </Text>
      ) : (
        <Button label="Finalize the dare" variant="ink" tall loading={busy === "Finalize"} onPress={() => void act("Finalize", "finalizeDare")} />
      )}
      {error ? <Text style={f.error}>{error}</Text> : null}
      {hash ? <TxLink hash={hash.hash} ms={hash.ms} /> : null}
    </View>
  );
}

function Tile({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <View style={[f.tile, on ? f.tileOn : null]}>
      <Text style={f.tileLabel}>{label}</Text>
      <Text style={f.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={f.field}>
      <Text style={f.tileLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9.]/g, ""))}
        keyboardType="decimal-pad"
        style={f.fieldInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function TxLink({ hash, ms = null }: { hash: string; ms?: number | null }) {
  return (
    <Pressable onPress={() => void Linking.openURL(explorer("tx", hash))} accessibilityRole="link" style={f.txLink}>
      <Text style={f.txText}>
        {ms !== null ? `Final in ${(ms / 1000).toFixed(2)} s · ` : ""}tx {hash.slice(0, 8)}…{hash.slice(-6)} · {EXPLORER_NAME}
      </Text>
      <ArrowOut size={12} color={c.focus} />
    </Pressable>
  );
}

function Row({ children, justify }: { children: React.ReactNode; justify?: "space-between" }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: justify }}>{children}</View>;
}

const tabular = { fontVariant: ["tabular-nums" as const] };

const s = StyleSheet.create({
  figureRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  coin: { marginTop: 6, marginBottom: -16, marginRight: -4 },
  panel: { backgroundColor: c.ink, borderRadius: theme.radius.lg, padding: 20, gap: 6, alignSelf: "stretch" },
  panelLabel: { color: c.onInk, fontSize: theme.type.label.size, fontWeight: "600", letterSpacing: -0.1 },
  panelDetail: { color: "#A9B3A2", fontSize: theme.type.caption.size, lineHeight: 17 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.inkSoft },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.lime },
  liveText: { color: "#A9B3A2", fontSize: theme.type.micro.size, fontWeight: "600", ...tabular },
  figure: { marginTop: 10, color: c.lime, fontSize: theme.type.display.size, lineHeight: theme.type.display.height, letterSpacing: theme.type.display.tracking, fontWeight: "700", ...tabular },
  figureFrac: { color: "#7C8C55", fontWeight: "600" },
  figureUnit: { color: c.onInk, fontSize: theme.type.title.size, fontWeight: "600", letterSpacing: -0.2 },
  split: { flexDirection: "row", marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(243,247,238,0.16)", gap: 12 },
  splitRule: { width: StyleSheet.hairlineWidth, backgroundColor: "rgba(243,247,238,0.16)" },
  splitLabel: { color: "#A9B3A2", fontSize: theme.type.caption.size },
  splitValue: { color: c.onInk, fontSize: theme.type.body.size, fontWeight: "700", marginTop: 2, ...tabular },
  splitHint: { color: "#7F8A78", fontSize: theme.type.micro.size, marginTop: 1 },
  latest: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  latestTitle: { color: c.text, fontSize: theme.type.label.size, fontWeight: "700", ...tabular },
  latestDetail: { color: c.muted, fontSize: theme.type.caption.size, marginTop: 1 },
  floor: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.posSoft, alignSelf: "flex-start" },
  floorNight: { backgroundColor: "rgba(214,255,61,0.16)" },
  floorText: { color: c.pos, fontSize: theme.type.caption.size, fontWeight: "700", ...tabular },
});

const f = StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: theme.radius.lg, padding: 16, gap: 12, alignSelf: "stretch", marginTop: 16 },
  title: { color: c.text, fontSize: theme.type.title.size, fontWeight: "700", letterSpacing: -0.4 },
  kicker: { color: c.muted, fontSize: theme.type.caption.size, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  dare: { color: c.text, fontSize: theme.type.lead.size, fontWeight: "700", letterSpacing: -0.2, lineHeight: 24 },
  body: { color: c.muted, fontSize: theme.type.label.size, lineHeight: 20 },
  mine: { color: c.text, fontSize: theme.type.label.size, lineHeight: 20, fontWeight: "600" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minWidth: 0, backgroundColor: c.surfaceAlt, borderRadius: theme.radius.md, padding: 12, gap: 2 },
  tileOn: { backgroundColor: c.limeSoft },
  tileLabel: { color: c.muted, fontSize: theme.type.caption.size, fontWeight: "600" },
  tileValue: { color: c.text, fontSize: theme.type.lead.size, fontWeight: "800", letterSpacing: -0.2, ...tabular },
  clock: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.ink },
  clockText: { color: c.lime, fontSize: theme.type.caption.size, fontWeight: "700", ...tabular },
  inputs: { flexDirection: "row", gap: 8 },
  field: { flex: 1, minWidth: 0, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  fieldInput: { color: c.text, fontSize: theme.type.lead.size, fontWeight: "700", ...tabular, padding: 0 },
  error: { color: c.neg, fontSize: theme.type.label.size },
  hint: { color: c.muted, fontSize: theme.type.caption.size, ...tabular },
  track: { flexDirection: "row", gap: 6 },
  trackStep: { flex: 1, gap: 6 },
  trackBar: { height: 4, borderRadius: 2, backgroundColor: c.line },
  trackDone: { backgroundColor: c.ink },
  trackNow: { backgroundColor: c.lime },
  trackLabel: { color: c.faint, fontSize: theme.type.micro.size, fontWeight: "700" },
  voteBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: c.surfaceAlt },
  voteYes: { backgroundColor: c.pos },
  txLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  txText: { color: c.focus, fontSize: theme.type.caption.size, fontWeight: "600", ...tabular },
  moment: { flexDirection: "row", gap: 14, marginTop: 16, padding: 16, borderRadius: theme.radius.lg, backgroundColor: c.ink },
  momentBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.inkSoft, alignItems: "center", justifyContent: "center" },
  momentFigure: { color: c.lime, fontSize: theme.type.lead.size, fontWeight: "800", letterSpacing: -0.2, ...tabular },
  momentKicker: { color: "#A9B3A2", fontSize: theme.type.caption.size, ...tabular },
  momentBody: { color: c.onInk, fontSize: theme.type.label.size, lineHeight: 20 },
  momentLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  momentLinkText: { color: c.lime, fontSize: theme.type.caption.size, fontWeight: "600" },
});
