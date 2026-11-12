import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";

import type { Coin } from "../lib/api";
import { explorer, FACTORY } from "../lib/chain";
import { DEPLOYMENT } from "../lib/deployment";
import { useBlockCadence } from "../lib/cadence";
import { loadMarkets } from "../lib/markets";
import { qrDataUrl } from "../lib/qr";
import { useApi } from "../lib/useApi";
import { LANDING_CSS } from "./landing-css";

/**
 * The web landing page, `/` on the web build.
 *
 * Plain DOM rather than React Native views: it is a marketing page, it needs
 * real headings, links, `clip-path` paper edges and a CSS grid that reflows at
 * 375px, and none of the app's screens are reused or restyled here. Native
 * builds never render it; `app/index.tsx` keeps the phone onboarding there.
 *
 * Every number on it is read from the factory on Avalanche Fuji through the
 * same `loadMarkets()` the feed uses, plus the chain's own block clock. Until
 * a read lands the figures say "Reading Fuji", and a failed read says so.
 */

const DEPLOY_TX = DEPLOYMENT.factoryTx;
const FONTS = "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Urbanist:wght@400;500;600;700;800;900&display=swap";

/** The seeded posts' own media; the stickers are those posts. */
const ART = {
  sprout: "/art/juno-feature-1.webp",
  pileIn: "/art/juno-feature-2.webp",
  capToss: "/art/juno-feature-3.webp",
  balloons: "/art/juno-social-square.webp",
  camera: "/art/juno-object-2.webp",
  coin: "/brand/flame-coin.webp",
};

/** A deckled paper edge, the same for a given seed on every render. */
function torn(seed: number, depth = 2.6, steps = 16): string {
  let s = seed * 7919 + 104729;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s % 1000) / 1000;
  };
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) pts.push(`${((i / steps) * 100).toFixed(1)}% ${(r() * depth).toFixed(2)}%`);
  for (let i = 0; i < steps; i++) pts.push(`${(100 - r() * depth).toFixed(2)}% ${((i / steps) * 100).toFixed(1)}%`);
  for (let i = 0; i < steps; i++) pts.push(`${(100 - (i / steps) * 100).toFixed(1)}% ${(100 - r() * depth).toFixed(2)}%`);
  for (let i = 0; i < steps; i++) pts.push(`${(r() * depth).toFixed(2)}% ${(100 - (i / steps) * 100).toFixed(1)}%`);
  return `polygon(${pts.join(",")})`;
}

/** 0.05312 → "0.0531"; 0.0000636 → "0.0000636". Four significant figures, never rounded to zero. */
function avaxFigure(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-US");
  return Number(n.toPrecision(4)).toString();
}

function dayTag(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${d.getUTCFullYear()}`;
}

function byArt(posts: Coin[] | null, src: string): Coin | undefined {
  return posts?.find((c) => c.media.url.endsWith(src));
}

/** A post printed as a photo card: deckled paper, the post's own image, and its live ticker once the chain answers. */
function PhotoCard({ src, coin, seed, className, tape }: { src: string; coin?: Coin; seed: number; className: string; tape?: boolean }) {
  const clip = useMemo(() => torn(seed), [seed]);
  return (
    <div className={`jl-st ${className}`} aria-hidden="true">
      <div className="jl-card">
        <div className="jl-paper" style={{ clipPath: clip }}>
          <img src={src} alt="" decoding="async" draggable={false} />
          <span className="jl-cap">{coin ? <><b>${coin.symbol}</b><i>{avaxFigure(coin.marketCapQuote ?? coin.marketCap)} AVAX</i></> : <b className="jl-cap-wait">&nbsp;</b>}</span>
        </div>
      </div>
      {tape ? <span className="jl-tape" /> : null}
      {coin?.curve.graduated ? <span className="jl-stamp">Graduated</span> : null}
    </div>
  );
}

/** A die-cut sticker: transparent art with a white kiss-cut outline. */
function DieCut({ src, className }: { src: string; className: string }) {
  return (
    <div className={`jl-st ${className}`} aria-hidden="true">
      <img className="jl-die" src={src} alt="" decoding="async" draggable={false} />
    </div>
  );
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M9 38.5C9 38.5 18 36.5 24 30C29 24.6 30.5 18.5 30.5 18.5" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      <circle cx={36.5} cy={10.5} r={4.8} fill="currentColor" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function External() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5h5v5M9.5 2.5 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** `/download/manifest.json`, written by `web/scripts/build-ios-sim.sh` and `web/scripts/publish-expo.sh`. */
type Manifest = {
  ios?: { file: string; bytes: number; sha256: string; version: string; built: string; bundleId: string };
  expo?: { url: string | null };
};

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** Get the app: the iOS Simulator build, Expo Go (only once a real update link exists) and the web app. */
function GetApp({ go }: { go: (path: string) => (e: React.MouseEvent) => void }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch("/download/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Manifest) => setM(j))
      .catch((e: Error) => setErr(e.message));
  }, []);
  const expo = m?.expo?.url ?? null;
  useEffect(() => {
    if (expo) qrDataUrl(expo).then(setQr).catch(() => setQr(null));
  }, [expo]);
  const ios = m?.ios;
  const install = ios ? `xcrun simctl install booted ${ios.file.replace(/-iOS-Simulator\.zip$/, "")}.app` : "";
  const copy = () => {
    navigator.clipboard?.writeText(install).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  return (
    <section className="jl-sec" id="get-app" aria-labelledby="jl-get-title">
      <div className="jl-wrap">
        <header className="jl-head">
          <p className="jl-lbl">Get the app</p>
          <h2 id="jl-get-title">Juno is a phone app.</h2>
        </header>
        <div className="jl-get">
          <article>
            <h3>iOS Simulator</h3>
            <p className="jl-get-meta">{ios ? `For a Mac with Xcode · ${mb(ios.bytes)} · v${ios.version}` : err ? "Download unavailable" : "Loading…"}</p>
            {ios ? (
              <>
                <a className="jl-pill jl-pill-ink" href={`/download/${ios.file}`} download>Download for iOS Simulator</a>
                <div className="jl-cmd">
                  <code>{install}</code>
                  <button type="button" onClick={copy} aria-label="Copy the install command">{copied ? "Copied" : "Copy"}</button>
                </div>
                <p className="jl-get-note">Unzip, open a simulator, run the line. <a href={`/download/${ios.file}.sha256`} title={ios.sha256}>SHA-256 {ios.sha256.slice(0, 12)}…</a></p>
              </>
            ) : err ? (
              <p className="jl-err" role="alert">Could not load the download list: {err}</p>
            ) : (
              <span className="jl-chip jl-skel" />
            )}
          </article>
          <article>
            <h3>Expo Go</h3>
            <p className="jl-get-meta">Scan with your phone&apos;s camera</p>
            {expo && qr ? (
              <div className="jl-qr">
                <img src={qr} width={148} height={148} alt="QR code that opens Juno in Expo Go" />
                <a href={expo}>{expo.replace(/^exp:\/\//, "")}</a>
              </div>
            ) : (
              <p className="jl-setup"><b>Setup required</b><span>The Expo Go link appears here once Juno is published.</span></p>
            )}
          </article>
          <article>
            <h3>In your browser</h3>
            <p className="jl-get-meta">Nothing to install</p>
            <a href="/social" onClick={go("/(tabs)/social")} className="jl-pill jl-pill-lime">Open Juno</a>
          </article>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const router = useRouter();
  const markets = useApi(() => loadMarkets(), []);
  const posts = markets.data?.posts ?? null;

  useEffect(() => {
    if (typeof document === "undefined" || document.querySelector('link[data-juno="fonts"]')) return;
    const pre = document.createElement("link");
    pre.rel = "preconnect";
    pre.href = "https://fonts.gstatic.com";
    pre.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS;
    link.setAttribute("data-juno", "fonts");
    document.head.append(pre, link);
  }, []);

  const go = (path: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.push(path as never);
  };

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const failed = !!markets.error && !posts;
  const stat = (value: string | number | undefined) => (failed ? "—" : value === undefined ? "…" : String(value));
  const holders = posts?.reduce((n, c) => n + (c.holders ?? 0), 0);
  const floors = posts?.reduce((n, c) => n + c.onchain.floorVault, 0);
  const bids = posts?.reduce((n, c) => n + c.onchain.sealedBids, 0);
  const graduated = posts?.filter((c) => c.curve.graduated).length;
  const settled = posts?.filter((c) => c.onchain.clearingPrice > 0).sort((a, b) => b.onchain.sealedBids - a.onchain.sealedBids)[0];
  const deepest = posts ? [...posts].sort((a, b) => b.onchain.floorVault - a.onchain.floorVault)[0] : undefined;
  const sprout = byArt(posts, ART.sprout);
  const tag = dayTag(posts?.[0]?.createdAt);
  const cadence = useBlockCadence();

  return (
    <div className="jl" id="top">
      <style>{LANDING_CSS}</style>

      <header className="jl-nav">
        <a href="/" className="jl-brand" aria-label="Juno home"><Mark size={26} /><span>juno</span></a>
        <nav aria-label="Primary">
          <a href="#how" onClick={jump("how")} className="jl-link">How it works</a>
          <a href="#get-app" onClick={jump("get-app")} className="jl-link">Get the app</a>
          <a href="/social" onClick={go("/(tabs)/social")} className="jl-pill jl-pill-white">Open app</a>
        </nav>
      </header>

      <main>
        <section className="jl-hero" aria-labelledby="jl-title">
          <div className="jl-stickers">
            <PhotoCard src={ART.sprout} coin={sprout} seed={3} className="st-sprout" tape />
            <DieCut src={ART.coin} className="st-coin" />
            <div className="jl-st st-cap-wrap" aria-hidden="true">
              <PhotoCard src={ART.capToss} coin={byArt(posts, ART.capToss)} seed={7} className="st-cap" />
              {tag ? <span className="jl-date">{tag}</span> : null}
              <span className="jl-marktag"><Mark size={30} /></span>
            </div>
            <DieCut src={ART.camera} className="st-camera" />
            <PhotoCard src={ART.balloons} coin={byArt(posts, ART.balloons)} seed={11} className="st-balloons" />
            <div className="jl-torn" aria-hidden="true" />
            <PhotoCard src={ART.pileIn} coin={byArt(posts, ART.pileIn)} seed={17} className="st-pile" tape />
          </div>

          <div className="jl-hero-copy">
            <h1 id="jl-title">Every post<br />is a coin<span className="jl-dot">.</span></h1>
            <a href="/social" onClick={go("/(tabs)/social")} className="jl-pill jl-pill-lime jl-pill-xl">Open Juno</a>
            <p className="jl-sub">
              Post a photo and fans can buy in. Each post is its own coin with a floor holders can always redeem, final in about a second on Avalanche. Fuji testnet, no real money.
            </p>
          </div>
        </section>

        <section className="jl-live" aria-labelledby="jl-live-title">
          <div className="jl-wrap">
            <div className="jl-live-head">
              <p className="jl-lbl"><i className={`jl-pulse ${failed ? "is-off" : ""}`} />{failed ? "Fuji unreadable" : posts ? "Live from the factory" : "Reading Fuji"}</p>
              <h2 id="jl-live-title" className="jl-visually-hidden">Live figures</h2>
              {FACTORY ? (
                <a className="jl-acct" href={explorer("address", FACTORY)} target="_blank" rel="noreferrer">{FACTORY} <External /></a>
              ) : (
                <span className="jl-acct">Setup required: EXPO_PUBLIC_JUNO_FACTORY</span>
              )}
            </div>
            <dl className="jl-stats">
              <div><dt>Posts</dt><dd>{stat(posts?.length)}</dd><span>{graduated !== undefined ? `${graduated} graduated` : " "}</span></div>
              <div><dt>Holders</dt><dd>{stat(holders)}</dd><span>summed across posts</span></div>
              <div><dt>In floors</dt><dd>{stat(floors !== undefined ? avaxFigure(floors) : undefined)}<small>AVAX</small></dd><span>redeemable by holders</span></div>
              <div><dt>Block every</dt><dd>{cadence ? (cadence.ms / 1000).toFixed(2) : cadence === null ? "…" : "—"}<small>s</small></dd><span>{cadence ? `Fuji, last ${cadence.blocks} blocks` : "read from block headers"}</span></div>
            </dl>
            {failed ? (
              <p className="jl-err" role="alert"><img className="jl-obj" src="/art/3d/juno-3d-warning.webp" width={64} height={64} alt="" aria-hidden="true" decoding="async" draggable={false} /><span>Could not read {FACTORY ?? "the factory"} on Avalanche Fuji: {markets.error}</span></p>
            ) : (
              <ul className="jl-tape-row" aria-label="Posts on the factory">
                {(posts ?? []).map((c) => (
                  <li key={c.address}>
                    <a href={`/coin/${c.address}`} onClick={go(`/coin/${c.address}`)} className="jl-chip">
                      <img src={c.media.url} alt="" loading="lazy" decoding="async" />
                      <span className="jl-chip-body">
                        <b>${c.symbol}</b>
                        <span>{c.curve.graduated ? "Graduated" : c.onchain.phase === "curve" ? "On the curve" : c.onchain.phase === "commit" ? "Sealed bids open" : c.onchain.phase === "reveal" ? "Revealing" : "Settling"}</span>
                        <span>{c.holders ?? 0} {c.holders === 1 ? "holder" : "holders"}</span>
                      </span>
                      <span className="jl-chip-fig"><b>{avaxFigure(c.onchain.floorVault)}</b><span>AVAX floor</span></span>
                    </a>
                  </li>
                ))}
                {!posts ? [0, 1, 2, 3].map((i) => <li key={i}><span className="jl-chip jl-skel" /></li>) : null}
                {posts && posts.length === 0 ? <li className="jl-empty"><img className="jl-obj" src="/art/3d/juno-3d-empty.webp" width={64} height={64} alt="" aria-hidden="true" decoding="async" draggable={false} /><span>No posts on the factory yet. The first photo posted opens here.</span></li> : null}
              </ul>
            )}
          </div>
        </section>

        <section className="jl-sec" id="how" aria-labelledby="jl-how-title">
          <div className="jl-wrap">
            <header className="jl-head">
              <p className="jl-lbl">How it works</p>
              <h2 id="jl-how-title">Three beats, all on chain.</h2>
            </header>
            <ol className="jl-beats">
              <li>
                <div className="jl-beat-art"><PhotoCard src={ART.sprout} seed={21} className="beat-card" /></div>
                <span className="jl-beat-n">01 · Post</span>
                <h3>Post a photo. It becomes a coin.</h3>
                <p>Posting deploys the post&apos;s own contract from the factory. That one contract is the ERC-20 coin, the auction and the vault.</p>
                <p className="jl-fig">{sprout ? <><b>{sprout.address.slice(0, 10)}…{sprout.address.slice(-6)}</b><span>a live post contract</span></> : <span>{failed ? "Fuji unreadable" : "Reading Fuji…"}</span>}</p>
              </li>
              <li>
                <div className="jl-beat-art jl-seal" aria-hidden="true">
                  <span className="jl-env e1" /><span className="jl-env e2" /><span className="jl-env e3"><i>keccak</i></span>
                </div>
                <span className="jl-beat-n">02 · Sealed opening</span>
                <h3>One minute of sealed bids. One price for all.</h3>
                <p>Every bidder escrows exactly 0.005 AVAX and posts only a hash. After the reveal, every winner pays the same clearing price, so being first, or a bot, buys nothing.</p>
                <p className="jl-fig">{settled ? <><b>{settled.onchain.sealedBids} sealed bids · {avaxFigure(settled.onchain.clearingPrice)} AVAX</b><span>${settled.symbol} cleared at one price</span></> : bids !== undefined ? <><b>{bids} sealed bids</b><span>across every post</span></> : <span>{failed ? "Fuji unreadable" : "Reading Fuji…"}</span>}</p>
              </li>
              <li>
                <div className="jl-beat-art"><img className="jl-die beat-coin" src={ART.coin} alt="" aria-hidden="true" /></div>
                <span className="jl-beat-n">03 · Floor</span>
                <h3>A floor you can always redeem.</h3>
                <p>20% of every curve buy and half the auction raise go into the post's vault. Any holder can burn tokens and take their share of it, at any time.</p>
                <p className="jl-fig">{deepest ? <><b>{avaxFigure(deepest.onchain.floorVault)} AVAX</b><span>in ${deepest.symbol}'s floor vault</span></> : <span>{failed ? "Fuji unreadable" : "Reading Fuji…"}</span>}</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="jl-phone-sec" aria-labelledby="jl-phone-title">
          <div className="jl-wrap jl-phone-grid">
            <div className="jl-phone-copy">
              <p className="jl-lbl jl-lbl-dark">The app</p>
              <h2 id="jl-phone-title">A feed first. The market comes with it.</h2>
              <p>Scroll, like, and tap Buy. Every card reads its post&apos;s contract on Fuji: the price in AVAX, who bought, how far to graduation, and the floor.</p>
              <ul className="jl-points">
                <li><b>Floor chip</b><span>the AVAX each token can redeem right now</span></li>
                <li><b>Bought by</b><span>names from the contract&apos;s own fill log</span></li>
                <li><b>Final in 0.9 s</b><span>every trade shows how long Avalanche took</span></li>
              </ul>
              <div className="jl-more-row">
                <a href="/social" onClick={go("/(tabs)/social")} className="jl-more">Scroll the feed <Arrow /></a>
                <a href="#get-app" onClick={jump("get-app")} className="jl-more">Get the app <Arrow /></a>
              </div>
            </div>
            <figure className="jl-phone-fig">
              <div className="jl-phone">
                <span className="jl-island" aria-hidden="true" />
                <img src="/landing/feed-390.webp" width={390} height={844} alt="Juno's feed on Avalanche Fuji: a post with its price in AVAX, who bought it, its progress to graduation and its floor" loading="lazy" decoding="async" />
              </div>
              <DieCut src={ART.coin} className="st-phone-coin" />
              <figcaption>Screenshot of /social on Avalanche Fuji</figcaption>
            </figure>
          </div>
        </section>

        <GetApp go={go} />

        <section className="jl-sec" id="tech" aria-labelledby="jl-tech-title">
          <div className="jl-wrap">
            <header className="jl-head">
              <p className="jl-lbl">The Avalanche tech</p>
              <h2 id="jl-tech-title">What runs where, plainly.</h2>
            </header>
            <div className="jl-tech">
              <article>
                <h3>A post is a contract</h3>
                <p><code>createPost</code> on the factory deploys the post&apos;s own <code>JunoPost</code> in one transaction: a 0-decimal ERC-20 with the auction, curve, floor and dare inside. No pool, no registry.</p>
              </article>
              <article>
                <h3>Commit, reveal, settle</h3>
                <p>Bids are <code>keccak(post, chain, bidder, amount, max price, salt)</code> with identical 0.005 AVAX escrows, so a copied hash cannot be revealed by anyone else. A bid left hidden forfeits 1% to the creator.</p>
              </article>
              <article>
                <h3>Curve and floor vault</h3>
                <p>800 tokens sell on a 16-segment curve priced in wei integers, rounded against the trader. <code>redeem</code> burns tokens for 99% of the holder&apos;s pro-rata vault share.</p>
              </article>
              <article>
                <h3>Final in about a second</h3>
                <p>Avalanche&apos;s C-Chain finalizes a block when it is accepted, with no reorgs to wait out. Every trade in the app shows its own time from broadcast to a final block{DEPLOYMENT.blockMedianMs && DEPLOYMENT.medianMs ? <>. Across {DEPLOYMENT.measuredTxs} seeded transactions the median was <b>{(DEPLOYMENT.blockMedianMs / 1000).toFixed(2)} s</b> to a final block, and {(DEPLOYMENT.medianMs / 1000).toFixed(2)} s until the public RPC returned the receipt</> : null}.</p>
              </article>
              <article>
                <h3>Your wallet, no relayer</h3>
                <p>Core, MetaMask or any EIP-6963 wallet signs each call from your own account. The app simulates every call against Fuji first, so a refusal says why before the wallet opens.</p>
              </article>
              <article>
                <h3>Accounts</h3>
                <p>
                  Factory {FACTORY ? <a href={explorer("address", FACTORY)} target="_blank" rel="noreferrer">{FACTORY}</a> : "Setup required"}, deployed in{" "}
                  <a href={explorer("tx", DEPLOY_TX)} target="_blank" rel="noreferrer">{DEPLOY_TX.slice(0, 6)}…{DEPLOY_TX.slice(-4)}</a>. Charts and holder lists come from the contract's <code>trades()</code> and <code>holders()</code> views, with no indexer.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="jl-end" aria-label="Open Juno">
          <div className="jl-wrap jl-end-in">
            <h2>Post something.<br />Watch it trade.</h2>
            <a href="/social" onClick={go("/(tabs)/social")} className="jl-pill jl-pill-lime jl-pill-xl">Open Juno</a>
          </div>
        </section>
      </main>

      <footer className="jl-foot">
        <div className="jl-wrap jl-foot-row">
          <a href="#top" onClick={jump("top")} className="jl-brand" aria-label="Back to top"><Mark size={22} /><span>juno</span></a>
          <p>A social feed where every post is a coin, on Avalanche Fuji. MIT · © 2026 Nivesh Gajengi</p>
          {FACTORY ? <a className="jl-foot-link" href={explorer("address", FACTORY)} target="_blank" rel="noreferrer">Factory on Snowtrace <External /></a> : null}
        </div>
        <p className="jl-word" aria-hidden="true">juno</p>
      </footer>
    </div>
  );
}
