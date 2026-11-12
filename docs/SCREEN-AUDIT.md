# Juno screen audit (ship round, 12 November 2026)

Every route of the hosted web app at 1440 and 375, every state reached in the hosted judge runs, and the standalone iOS
build on an iPhone 17 Pro simulator. Scores are out of 10, before and after this round's fixes. The look is unchanged:
no new colours, fonts, layout or art; the fixes are functional, copy, spacing, overflow and broken-content fixes.

Screenshots (outside the repo):

- Before, hosted site: `orchestration/shots/avax-juno/ship/before/` (34 shots, `scripts/shots.mjs` with `SHOTS_BASE`)
- After, production export: `orchestration/shots/avax-juno/ship/after/` (34 route shots plus `landing-<section>-<width>.png`
  from `scripts/landing-sections.mjs`, because the landing scrolls inside its own container)
- Standalone iOS app: `orchestration/shots/avax-juno/ship/ios/`
- Signed-in and mid-transaction states: the hosted judge runs in `orchestration/shots/avax-juno/9round/judge-1440/` and
  `judge-375/` (same code apart from the copy changes below)

Automated checks after the fixes: 34/34 route shots render with 0 console errors and no sideways scroll; the landing
section run finds the download link (HTTP 200), the Copy button works, Expo Go shows "Setup required", and nothing
overflows at either width.

## Web routes

| Screen | Width | Before | What was wrong | Fix | After |
| --- | --- | ---: | --- | --- | ---: |
| Landing, hero | 1440 / 375 | 8.0 | The sub-line said "Live on Avalanche Fuji. 18 posts trading…", which doesn't say who it's for or what they get | "Post a photo and fans can buy in. Each post is its own coin with a floor holders can always redeem, final in about a second on Avalanche. Fuji testnet, no real money." | 9.2 |
| Landing, every section below the hero | 1440 / 375 | 7.0 | The nav (light wordmark, "Open app") stayed pinned over every sage section while scrolling, covering headings | The scroll container is now the nav's containing block, so the nav scrolls away with the hero | 9.2 |
| Landing, the app section | 1440 / 375 | 6.5 | The phone mock was a NEAR screenshot ("+0.053 NEAR") under the caption "Screenshot of /social on Avalanche Fuji" | Re-shot from the Avalanche export at 390 px; added a "Get the app" link next to "Scroll the feed" | 9.2 |
| Landing, Get the app | 1440 / 375 | n/a | No download, no Expo Go slot | New section in the existing card style: iOS Simulator download (size, version, the install line with Copy, SHA-256 link), Expo Go QR that says "Setup required" until a real update link exists, Open Juno | 9.0 |
| Landing, error and setup boxes | 1440 / 375 | 8.0 | `.jl p` reset the padding of `p.jl-err`, so the "Fuji unreadable" error text sat on the box edge | Higher-specificity rule for `.jl-err` and the new setup box | 9.0 |
| Landing, live strip, how it works, tech, end | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Feed `/social` | 1440 / 375 | 9.0 | The top card can read "▼ 0 AVAX market cap" when every holder sold out. That's real chain data and is left as is | n/a | 9.0 |
| Trade `/trade` | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Reels `/reels` | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Post `/post` | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Profile, signed out | 1440 / 375 | 8.5 | The empty-state copy said "test AVAX" twice | "Connect Core or MetaMask, or make a Juno wallet in one tap. Avalanche Fuji · test AVAX, no real money." | 9.0 |
| Coin pages (curve, graduated, dare, live dare, QA post) | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Coin, sealed-bid card | 1440 / 375 | 8.5 | Long explainer under the tiles | "Bids are sealed: the same 0.005 AVAX escrow and only a hash on chain. Winners all pay one price." | 9.0 |
| Floor panel (desktop rail) | 1440 | 8.5 | Explainer plus a redundant "Fuji testnet." | "Holders can redeem against a post's floor at any time. It holds half of each opening auction and 20% of every buy." | 9.0 |
| Trader `/trader/kai` | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Private bags, public view | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Private bags, Your bag, signed out | 375 | 6.0 | The wallet art and the empty-state title spilled up over the hero card and the tab control: a flex-1 placeholder inside a scroll body had no height | `Placeholder inline` sizes to its content. It's also used for the vault's error state and its "different bag" state | 9.0 |
| Private bags, Your bag, signed out | 1440 | 7.0 | Same spill, smaller | Same fix | 9.0 |
| Private bags, auditor view | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |
| Coin not found, 404 | 1440 / 375 | 9.0 | n/a | n/a | 9.0 |

## States (hosted judge runs, fresh browser, Juno wallet)

| State | Before | Note | After |
| --- | ---: | --- | ---: |
| Connect sheet, getting gas, funded | 9.0 | n/a | 9.0 |
| Launch form, auction open, bid placed, settled | 9.0 | Sealed-bid copy shortened (above); the bid salt line says "on this device", which is true on web and in the phone keychain | 9.0 |
| Buy, sell, redeem: quote and done receipts | 9.0 | n/a | 9.0 |
| Create bag, shield form, shield done | 8.5 | Shield, send and unshield captions were two sentences of mechanism | "Moves public coins into your encrypted balance. The amount you shield is public; what happens after is not." (send and unshield likewise) | 9.0 |
| Error states (Fuji unreadable, Setup required) | 8.5 | Landing error box padding (above) | 9.0 |

## Standalone iOS app (Release build from the hosted zip, iPhone 17 Pro simulator)

| Screen | Before | What was wrong | Fix | After |
| --- | ---: | --- | --- | ---: |
| Launch / splash | 6.0 | There was no splash config, so the launch screen was the white Expo default | expo-splash-screen: the Juno mark on ink (#12150E), light launch status bar | 9.0 |
| Home screen icon | 9.0 | n/a (Juno mark on ink, from `assets/icon.png`) | n/a | 9.0 |
| Onboarding | 9.0 | n/a | n/a | 9.0 |
| Feed, Trade, Reels | 9.0 | n/a | n/a | 9.0 |
| Post sheet | 9.0 | n/a | n/a | 9.0 |
| Profile, signed out | 8.5 | "test AVAX" twice | Copy above | 9.0 |
| Connect sheet, getting gas, funded | 9.0 | Keychain wallet works in the ad-hoc-signed build; drip landed (`deployments/fuji.json` → `standaloneIosRun`) | n/a | 9.0 |
| Coin page | 8.5 | The price line starts with a vertical stroke at the left edge (two points at the window's left edge) | Not changed this round | 8.5 |
| Buy sheet, done receipt | 9.0 | Bought 10 SPROUT, final in 0.10 s | n/a | 9.0 |

## Still below 9

- **Coin page chart on a phone (8.5):** the first segment can draw as a vertical stroke at the left edge. It's real
  data, but it reads as a glitch. Not touched this round, to keep the native build unchanged after its last test run.
- **Hide your bag isn't in the phone app.** It's a missing feature, not a screen defect: the eERC prover runs in the
  browser only, so the phone app has no vault tab. README says so.
