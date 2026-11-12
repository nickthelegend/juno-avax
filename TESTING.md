# Testing

Recorded on 12 November 2026 (v2.0). Every number below came from running the command next to it.

| Suite | Command | Result |
| --- | --- | --- |
| Contracts (Foundry, local EVM) | `cd contracts && forge test` | **70 passed, 0 failed** (7 suites) |
| eERC end to end (Anvil, real proofs, production verifiers) | `pnpm --filter @juno/scripts test:eerc` | **26/26 checks passed**, 21 transactions |
| SDK maths, commitment and eERC client crypto | `pnpm --filter @juno/sdk test` | **13 passed, 0 failed** (4 maths + 9 eERC) |
| Web unit tests (accounting, price window, QA signer policy incl. vault rules) | `pnpm --filter juno-avax-web test` | **13 passed, 0 failed** |
| Web typecheck | `cd web && npx tsc --noEmit` | 0 errors |
| Web static export (hostable) | `pnpm web:export` | builds `web/dist` with `/eerc/` circuits |
| Fuji seeding (live chain) | `scripts/fuji/seed*.ts`, `scripts/eerc/fuji.ts` | `deployments/fuji.json` → `seed`, `eerc` |
| Full post flow through the web app at 1440 and 375 (live chain) | `QA_WIDTH=1440 npx tsx scripts/qa-flow.ts` (and 375) | `deployments/fuji.json` → `qaRuns` |
| Hide your bag through the web app at 1440 and 375 (live chain) | `QA_WIDTH=1440 npx tsx scripts/qa-vault.ts` (and 375) | `deployments/fuji.json` → `qaVaultRuns` |
| Route screenshots at 1440 and 375 | `node scripts/shots.mjs` | `orchestration/shots/avax-juno/v2/` |

No test that touches a chain uses a mock: Foundry runs the real contracts on its local EVM, the eERC test runs Ava Labs' contracts and real Groth16 proofs on Anvil, and the seeding and web flows run on Avalanche Fuji.

## Contracts — 70 tests

| File | Tests | What it proves |
| --- | ---: | --- |
| `CurveMath.t.sol` | 6 | The constant price table equals the Rust/TS `table()` routine recomputed in Solidity; golden values shared with the SDK; rounding never favours the trader (fuzz); splitting a sell never beats one buy (fuzz); price is monotonic; empty and over-range quantities revert. |
| `Auction.t.sol` | 16 | One clearing price for an early high bid and a late low bid; under-subscribed auction clears at the lowest bid; ties go to the earlier commit; refunds are pulled once; **no bids** settles to an open curve; only-unrevealed bids forfeit 1%; no refund before settlement; the first buy after the window settles the auction; settle only once and only after reveals; fixed escrow; one bid per account; reveal cannot exceed the escrow; bids below the curve base refused; no transfers before settlement; 64-bid cap; a full 64-bid auction settles under 8M gas and stays solvent. |
| `Curve.t.sol` | 16 | Buy charges the highest of curve, floor and clearing price + 20% floor + 1% fee and refunds overpayment; **the curve never undercuts the auction's winners** until it climbs past the clearing price; underpaid buy reverts; buying past 800 reverts; sell pays curve minus 1%; sell slippage guard; a round trip always loses; **sell from the floor** when it is higher keeps the floor per token; **redeem** pays 99% of pro-rata and raises the floor for the rest; over-redeem reverts; **graduation** moves reserve and escrow into the floor; curve closed after graduation, floor still open; only the creator withdraws; fill log and holders; the fill log is a ring of 120; a fuzzed buy/sell sequence stays solvent. |
| `Dare.t.sol` | 12 | Bond held by the post; accepted proof returns the bond; rejected or missing proof sends it to the floor; a tie is not an acceptance; only the creator posts proof, once, inside the window; only holders vote, once; no vote before proof or after the window; tokens moved between voters count once; finalize only once and only after the window; a failed dare with no holders returns the bond; plain posts have no dare. |
| `Factory.t.sol` | 6 | A post is deployed with name, symbol, 0 decimals and creator; bad slugs, duplicate slugs, missing media, bond without dare, dare without bond and bonds over 2 AVAX are refused. |
| `Attacks.t.sol` | 12 | **Reentrancy** from a malicious receiver on `sell`, `redeem` and `claimRefund` is blocked (`ReentrancyGuardReentrantCall`) and pays once; **reveal mismatch** (changed price, wrong salt) reverts; **late bid** reverts; early and late reveals revert; a **copied commitment** cannot be revealed by the copier; a commitment does not **replay** on another post; **floor drain**: buy-then-redeem never profits (fuzz), split redemptions never beat the pro-rata share (fuzz), the last holders draining the floor leave nothing for a new buyer to claim; strangers cannot withdraw earnings. |
| `Invariant.t.sol` | 2 | Over 64 runs × 40 random calls (buy, sell, redeem, claim, withdraw by three actors): the post's AVAX balance always covers floor + reserve + escrow + earnings + bond + refunds owed, and supply never exceeds 200 + curve sold. |

## eERC — 26 checks on Anvil (`scripts/eerc/local-e2e.ts`)

The real Juno contracts plus Ava Labs' EncryptedERC (converter mode, the production verifiers from `contracts/lib/EncryptedERC/contracts/prod`) on a local Anvil chain, with proofs built by snarkjs from the shipped zkeys. Happy path: a post with real holders; the same wallet signature reopens the same key; register; nothing can be shielded before an auditor is set; only the owner sets the auditor; shield 30 (the post's public holder list shows the vault holding 30, and mira shows 10); mira's key decrypts 30 and kai's key cannot; a private send of 12 (mira 18, kai 12, each read with its own key; the amount does not appear in the calldata; the public sees no amount and the auditor decrypts 12; a holder key is not an auditor key); unshield 5 and sell them on the curve; unshield everything back to 0. **Attacks refused on chain:** another account submitting mira's registration proof (`InvalidSender`), a proof made for another chain (`InvalidChainId`), a registration proof with a swapped public key, registering twice, an unregistered account shielding, a replayed transfer proof, another account submitting a withdraw proof, a withdraw proof with a raised amount, and a replayed withdraw proof. No proof can even be built for unshielding more than the encrypted balance.

## SDK — 13 tests

`eerc.test.ts` (9): keys are scalars below the BabyJubJub subgroup order; a signature always reopens the same key; the key message names the account and chain; the registration hash; PCTs round-trip and interoperate with maci-crypto (which upstream's tests use); a PCT cannot be read with another key; ElGamal round-trip and a forged balance hint refused; withdraw/transfer inputs refuse overspending and zero; snarkjs proofs laid out for the verifier.

`math.test.ts` (4):

Golden curve values identical to the Solidity test; buy/sell/redeem quotes including the floor-priced case; the TypeScript `commitment()` equals `JunoPost.commitmentOf` read with `cast call` from an Anvil deployment; AVAX parsing and formatting.

## Web — 13 tests

Position accounting from fill logs (realised/unrealised P&L), the price window, and the QA signer policy: only the public Fuji RPCs, only Juno calls on the factory and its posts (a `transfer` is refused), and the 0.015 AVAX budget; for the vault, only `register`/`deposit`/`transfer`/`withdraw` with no value, approvals only to the vault, and only the eERC key message for its own account on Fuji.

## Flow QA (v2.0, 12 Nov 2026, live Fuji, production and QA-signer web builds)

Every row ran end to end on Avalanche Fuji through the web app in headless Chrome, at both widths. "Tx" rows are signed by the QA signer (`dist-qa`, a local-only build) and confirmed on chain. Hashes are in `deployments/fuji.json` → `qaRuns` and `qaVaultRuns` and in the README tables. Screenshot paths are relative to `/Volumes/Extreme SSD/Projects/grokbot/`.

| Flow | Steps checked | 1440 | 375 | Screenshots |
| --- | --- | --- | --- | --- |
| Landing | one line ("Every post is a coin."), one action (Open Juno), live post count | pass | pass | `orchestration/shots/avax-juno/v2/landing-*.png` |
| Feed | reads every post from Fuji, prices, floors, "Bought by" | pass | pass | `orchestration/shots/avax-juno/v2/feed-*.png` |
| Trade, reels, profile (signed out), trader page | render live data or a designed empty state | pass | pass | `orchestration/shots/avax-juno/v2/trade-*`, `reels-*`, `profile-*`, `trader-*` |
| Wallet connect | sign-in sheet → QA signer connected → account used by the next send | pass (tx) | pass (tx) | `orchestration/shots/avax-juno/v2/flow-*/00-connect-sheet-*.png` |
| Post (launch a dare post) | form → `createPost` with a 0.002 AVAX bond → coin page | pass (tx) | pass (tx) | `orchestration/shots/avax-juno/v2/flow-*/00-launch-form-*.png`, `01-auction-open-*` |
| Auction | sealed bid → reveal → settle → claim refund | pass (4 tx) | pass (4 tx) | `orchestration/shots/avax-juno/v2/flow-*/02-bid-placed-*` … `04-settled-*` |
| Buy / sell | quote from the contract → buy 5 → sell 2 | pass (2 tx) | pass (2 tx) | `orchestration/shots/avax-juno/v2/flow-*/05-buy-quote-*` … `07-sell-done-*` |
| Redeem against the floor | redeem 1 | pass (tx) | pass (tx) | `orchestration/shots/avax-juno/v2/flow-*/08-redeem-done-*` |
| Dare | post proof → vote yes → finalize (after the 5-minute window) → claim the bond | pass (4 tx) | pass (4 tx) | `orchestration/shots/avax-juno/v2/flow-*/10-voted-*`, `11-dare-final-*`, `12-claimed-*` |
| Hide your bag: open | coin page "Hide your bag" → vault with the coin picked → connect → one signature (no tx) | pass | pass | `orchestration/shots/avax-juno/v2/flow-vault-*/01-coin-hide-your-bag-*`, `02-open-bag-*` |
| Hide your bag: register | registration proof built in the page → `register` | pass (tx) | already registered | `orchestration/shots/avax-juno/v2/flow-vault-1440/03-create-bag-1440.png` |
| Hide your bag: shield | `approve` (to the vault only) → `deposit` → decrypted balance | pass (2 tx) | pass (2 tx) | `orchestration/shots/avax-juno/v2/flow-vault-*/*shield-done*` |
| Hide your bag: send privately | transfer proof in the page → `transfer` to mira, amount hidden publicly | pass (tx) | pass (tx) | `orchestration/shots/avax-juno/v2/flow-vault-*/*send_private-done*` |
| Hide your bag: unshield | withdraw proof in the page → `withdraw` → coins public again | pass (tx) | pass (tx) | `orchestration/shots/avax-juno/v2/flow-vault-*/*unshield-done*` |
| Vault public view | per-coin share hidden, ciphertext fingerprints, moves with transfer amounts hidden | pass | pass | `orchestration/shots/avax-juno/v2/vault-public-*`, `flow-vault-*/*public-view*` |
| Vault auditor view | non-auditor: sealed; auditor wallet: one signature → transfer amounts decrypted | pass | pass | `orchestration/shots/avax-juno/v2/vault-auditor-*`, `flow-vault-*/*auditor-open*` |
| Error and empty states | unknown coin ("No such coin"), unknown route, vault signed out ("Connect to open your bag") | pass | pass | `orchestration/shots/avax-juno/v2/coin-not-found-*`, `not-found-*`, `vault-yours-signed-out-*` |
| Hosted build | `pnpm web:export` → `web/dist` (37 MB with `/eerc/` circuits, `vercel.json` SPA fallback); route shots above were taken from this build served statically | builds | builds | not deployed (per brief) |

Totals: the full post flow passed 12/12 transactions at 1440 and 12/12 at 375. Hide your bag passed 5/5 at 1440 and 4/4 at 375. Route screenshots passed 34/34 (17 routes × 2 widths) with no console errors and no horizontal overflow.

**Bug found and fixed during this QA:** at both widths, the browser logged HTTP 500s from `api.avax-test.network`. The cause was viem batching about 75 `eth_call`s into one JSON-RPC request, which the public endpoint rejects above roughly 64 calls (measured: 40 → 200, 80 → 500). The app recovered through the publicnode fallback, but the errors were real. Fixed by capping batches at 32 (`sdk/src/index.ts`). After the fix, the route shots show no console errors.

## Live runs on Fuji

- **Seeding (v2).** Three generated test accounts (mira, kai, oto), funded with test AVAX from an existing Fuji key (0.179 AVAX drawn in total across v1 and v2). Seven posts: SPROUT (two bids, refunds, buys, a sell), PILE-IN (sold out and graduated in one 800-token buy, then a floor redemption), ROOFTOP (a dare: bids, proof, two yes votes, finalized as accepted, bond withdrawn), BALLOONS (one bid never revealed, refunded minus 1%), NIGHT-SWIM (a dare with no proof: finalized as failed, the bond went into the floor, then a holder redeemed against it), SUNSET-DUMP and GLOW-UP (two more plain posts with bids, refunds, buys and a sell, added so the feed does not open on QA posts), and in v2 NIGHT-MARKET, FIRST-OLLIE (a live dare) and COFFEE-RUN (auctions, buys, a sell and a redeem; `scripts/fuji/seed-v2.ts`). Salts are written to the gitignored `.seed-secrets.json` before any bid.
- **v1, superseded.** The first deployment's chart showed the auction winners being undercut by the very next curve buy, so the contract was changed (buys never below the clearing price, test above) and redeployed. Lessons from the v1 run that are now fixed: the seed script kept salts only in memory and stopped when kai ran dry (wave-2 bids could never be revealed, a real test of the unrevealed-bid path); the app's `send` read a stale address right after a first connect; the auction card claimed a sealed bid before it confirmed; the dare's Finalize button appeared on the local clock a moment before Fuji's block clock passed the window. v1's test AVAX was recovered by redeeming everything (`scripts/fuji/recover.ts`).
- **Finality.** Times are taken from the RPC accepting the signed transaction. "Final block" = the including block's `timestampMilliseconds` minus this machine's clock at broadcast (it trusts the local clock and is dropped when negative); "receipt" = when the public RPC first returned the receipt, polled every 60 ms.
- **Web flow.** `scripts/qa-flow.ts` exports nothing itself; it serves `web/dist-qa` (the QA-signer build) on port 5392, injects the QA test key into the page at runtime, approves each call against the budget, and drives the real UI: launch a dare post, bid, reveal, settle, claim the refund, buy 5, sell 2, redeem 1, post proof, vote, finalize, claim the returned bond. Screenshots of each step: v1 run in `orchestration/shots/avax-juno/flow/`, v2 runs in `orchestration/shots/avax-juno/v2/flow-1440/` and `flow-375/`.

## Known limits

- Hide your bag: shield and unshield amounts are public ERC-20 transfers; a bag that has only ever received deposits is derivable from them (upstream uses fixed randomness for deposits). Privacy begins with a private transfer. Shielded coins do not count as dare votes (the vault holds them).

- The bid's reveal is public: once a bidder reveals, the amount and price are on-chain. Bids stay hidden only until the reveal window (see README on eERC).
- Dare votes are weighted by balance at finalization; someone can still buy in before the window closes to swing a vote, paying the 21% buy overhead to do it.
- `trades()` keeps the newest 120 fills; older history is not drawn.
- The finality figure depends on this device's clock agreeing with the network; when the gap comes out negative the app shows only the receipt time.
