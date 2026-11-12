# What still separates Juno v2.2 from a 9

An honest re-score after the ship round (12 November 2026), against the Speedrun's own weights. Every claim below points at evidence in this repo.

## Score

| Criterion (weight) | v2.0 | v2.1 | v2.2 | Evidence |
| --- | ---: | ---: | ---: | --- |
| Does it work (30%) | 9.0 | **9.4** | **9.5** | The hosted app is live, and a judge needs nothing installed: Juno wallet + JunoGasStation give a new browser 0.008 test AVAX in one tap. That path (launch, sealed bid, reveal, settle, claim, buy, sell, redeem, register, shield) ran on https://juno-avax.vercel.app in a fresh browser profile, 11/11 at 1440 and 11/11 at 375, 0 console errors (`deployments/fuji.json` → `judgeRuns`). The native app runs in Expo Go and did real Fuji transactions in the iOS Simulator (`iosRun`). 34/34 route shots. Held back: Hide your bag is web-only, and the native run lost one bid's salt before the keychain fix (refunded minus 1%, as designed). **v2.2:** a standalone iOS Simulator build downloads from the landing with its SHA-256; installed from that zip it made a keychain wallet, got its drip and bought on Fuji (`standaloneIosRun`). Screen audit fixed a spilled vault empty state, a nav that floated over the landing and a NEAR screenshot on the Avalanche landing ([SCREEN-AUDIT](SCREEN-AUDIT.md)); 34/34 routes at 1440 and 375 with 0 console errors. |
| Idea and originality (25%) | 7.5 | **7.5** | **7.5** | Unchanged in substance. Juno has shipped on six chains, so the core mechanics are not new to judges. New in v2.1: private creator tips over eERC, and an AI that explains a coin's auction and floor from chain reads. Neither changes the idea score much. |
| Technical depth (20%) | 9.0 | **9.2** | **9.2** | A signature-bound gas station with on-chain caps (21 Forge tests incl. forged, moved, malleated and expired signatures, plus a judge-path test that runs the whole flow on one drip), a relayer API with 8 live tests incl. a real drip, a tool-using Claude agent with 6 live tests checked against direct chain reads, and an Expo SDK 58 native build with five real native bugs fixed. |
| Avalanche fit (15%) | 8.5 | **8.6** | **8.6** | eERC now does a second real job (creator tips) on top of Hide your bag. Sub-second finality is still measured on every transaction, on the phone too. Still no ICM/ICTT feature, no own L1, no mainnet deploy. |
| Demo and communication (10%) | 6.0 | **6.0** | **6.3** | README leads with a five-step "try it with nothing installed", every claim links to Snowtrace, and the iOS screenshots exist. **There is still no video.** **v2.2:** the landing now says who it's for and offers the app three ways (download, Expo Go slot, web). Still no video. |
| **Weighted** | **8.3** | **8.4** | **8.5** | |

8.5 is the honest number. It is not a 9.

## The gap, in order of points per hour

1. **The video (≈ +0.3).** Only Nick can record and submit it. Suggested 3-minute cut, all live: open the hosted app in a clean browser → Juno wallet (watch the drip land) → post → sealed bid → reveal → settle → buy → Hide your bag → public view shows "amount hidden" → Ask Juno AI "how did the opening clear?". Demo 6 → 9.
2. **ICTT for graduated coins (≈ +0.15).** Still blocked on Echo gas from an account we own. The funding hub holds Fuji AVAX only; Echo's native token needs a Builder Hub faucet login (Nick). Not claimed.
3. **Mainnet (bonus).** `scripts/mainnet/deploy.ts` is ready (~0.104 AVAX with the vault); Nick runs it after choosing the mainnet auditor.
4. **Expo Go link (small).** Everything is ready; Nick runs `npx expo login` then `web/scripts/publish-expo.sh`, and the landing's QR fills in.
5. **Hide your bag on the phone.** Needs a WebView prover (Kumi's pattern) and `react-native-webview`; skipped this round to keep the native build small.
6. **Originality ceiling.** Lead the video and slides with the zero-setup start, Hide your bag and Juno AI, and say plainly what is new in this build (README → "What existed before the Speedrun").

## Funding and limits worth knowing

- JunoGasStation holds what is left of 0.15 AVAX (0.05 from Juno's kai account, 0.1 from the Avalanche funding hub). At 0.008 per drip that is about 13 more new wallets (5 drips so far: tests, QA and the simulator); the API's `/api/health` shows the live count. Top-ups go through `avax/.hub/fund.sh juno 0x45fdcdf64f6fa312b02b98ad248461c6a02e722a <AVAX> "<why>"`.
- Daily cap 12 drips, 6 per requester network. A room of judges on one Wi-Fi can use six; after that the app says so and links the Core faucet.
- The Juno wallet's key lives in the browser's localStorage (web) or the keychain (phone). It is meant for test AVAX only, and the sign-in sheet says where it is kept.
- Privacy starts with the first private transfer (upstream encrypts deposits with fixed randomness). The README says so, and the app's order (shield, then send) follows it.
