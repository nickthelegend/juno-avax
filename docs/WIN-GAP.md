# What still separates Juno v2.0 from a 9

An honest re-score on 12 November 2026, against the Speedrun's own weights. Every claim below points at evidence in this repo.

## Score

| Criterion (weight) | v1.0 | v2.0 | Evidence |
| --- | ---: | ---: | --- |
| Does it work (30%) | 8.5 | **9.0** | Every flow was driven through the web app on Fuji at 1440 px and at 375 px. The full post flow passed 12/12 at each width, and Hide your bag passed 5/5 at 1440 and 4/4 at 375 (the key was already registered). Then the auditor view ran. `deployments/fuji.json` → `qaRuns`, `qaVaultRuns`. All 17 routes × 2 widths render with no console errors and no sideways scroll (`scripts/shots.mjs`). One real bug was found and fixed: oversized RPC batches got HTTP 500s. Held back from higher because no hosted URL exists yet. |
| Idea and originality (25%) | 7.0 | **7.5** | "Hide your bag" is new: an eERC privacy layer over a meme-coin launchpad, with an honest public, holder and auditor split. Juno itself has shipped on six chains before, so the core idea is not new to judges who have seen it. |
| Technical depth (20%) | 8.0 | **9.0** | Ava Labs' EncryptedERC, unchanged and pinned. Client crypto written against its circuits. Groth16 proofs built in the browser. 26 Anvil checks with real proofs, including replayed, tampered, wrong-sender and wrong-chain attacks refused on chain. 70 Forge tests. A guarded mainnet script. |
| Avalanche fit (15%) | 6.5 | **8.5** | eERC is live and meaningful (a bonus item). Sub-second finality is measured on every transaction. Core wallet comes first. Mainnet cost was read from mainnet and the runbook is written, but nothing is deployed. ICM was probed (one message from Fuji reached Echo) but no feature ships. No own L1. |
| Demo and communication (10%) | 6.0 | **6.0** | README, TESTING, SLIDES and SUBMISSION are complete, and every route has screenshots. **There is no video yet.** |
| **Weighted** | **7.5** | **8.3** | |

8.3 is the honest number. It is not a 9.

## The gap, in order of points per hour

1. **The video (≈ +0.3).** A live, unedited 3-minute recording: open the feed, buy, shield the bag, show the public view's "amount hidden", then the auditor view. Demo would go from 6 to 9. Only Nick can record and submit it.
2. **Host the static build (≈ +0.15).** `web/dist` is ready: `pnpm web:export` builds it with `vercel.json` (SPA fallback, and static files served before the rewrite, which includes `/eerc/*.zkey`). It is 37 MB, mostly the transfer zkey (15 MB). It was not deployed, per the brief. A judge clicking a live link moves "Does it work" toward 9.5.
3. **Ship ICTT for graduated coins (≈ +0.15).** The probe proved the public relayer delivers Fuji → Echo. What remains: deploy ICTT `ERC20TokenHome` for a graduated coin on Fuji and `ERC20TokenRemote` on Echo, register the remote, and send and return tokens. This needs Echo gas. The only Echo-funded key found locally is the public "ewoq" test key, which was not used without Nick's say-so. A Builder Hub faucet login (Nick) would unblock it.
4. **Mainnet (bonus).** `npx tsx scripts/mainnet/deploy.ts` estimates ~0.037 AVAX for the factory and ~0.104 AVAX with the vault. Nick runs it himself, after deciding who the mainnet auditor is.
5. **Originality ceiling.** Prior Juno builds cap the idea score. Lead with Hide your bag in the video and slides, and say plainly what is new in this build (README → "What existed before the Speedrun").

## Not a gap, but worth knowing

- Privacy starts with the first private transfer. Upstream encrypts deposits with fixed randomness, so a deposit-only bag can be worked out from public deposits. The README states this, and the app's order (shield, then send) follows it.
- The public Fuji RPC is rate-limited per IP (Cloudflare 1015) during heavy seeding. The app falls back to publicnode. Logs are read in 49,000-block windows.
