# Testing

Recorded on 12 November 2026. Every number below came from running the command next to it.

| Suite | Command | Result |
| --- | --- | --- |
| Contracts (Foundry, local EVM) | `cd contracts && forge test` | **69 passed, 0 failed** (7 suites) |
| SDK maths and commitment | `pnpm --filter @juno/sdk test` | **4 passed, 0 failed** |
| Web unit tests (accounting, price window, QA signer policy) | `pnpm --filter juno-avax-web test` | **10 passed, 0 failed** |
| Web typecheck | `cd web && npx tsc --noEmit` | 0 errors |
| Web static export | `pnpm --filter juno-avax-web export:web` | builds `web/dist` |
| Fuji seeding (live chain) | `scripts/fuji/seed.ts`, `seed-wave2.ts` | **50 transactions, 0 failed** — `deployments/fuji.json` → `seed` |
| Full flow through the web app (live chain, headless Chrome) | `npx tsx scripts/qa-flow.ts` | see `deployments/fuji.json` → `qaFlow` and the README table |
| Route screenshots at 1440 and 375 | `node scripts/shots.mjs` | `orchestration/shots/avax-juno/` |

No test that touches a chain uses a mock: Foundry runs the real contracts on its local EVM, and the seeding and web flow run on Avalanche Fuji.

## Contracts — 69 tests

| File | Tests | What it proves |
| --- | ---: | --- |
| `CurveMath.t.sol` | 6 | The constant price table equals the Rust/TS `table()` routine recomputed in Solidity; golden values shared with the SDK; rounding never favours the trader (fuzz); splitting a sell never beats one buy (fuzz); price is monotonic; empty and over-range quantities revert. |
| `Auction.t.sol` | 16 | One clearing price for an early high bid and a late low bid; under-subscribed auction clears at the lowest bid; ties go to the earlier commit; refunds are pulled once; **no bids** settles to an open curve; only-unrevealed bids forfeit 1%; no refund before settlement; the first buy after the window settles the auction; settle only once and only after reveals; fixed escrow; one bid per account; reveal cannot exceed the escrow; bids below the curve base refused; no transfers before settlement; 64-bid cap; a full 64-bid auction settles under 8M gas and stays solvent. |
| `Curve.t.sol` | 15 | Buy charges curve-or-floor + 20% floor + 1% fee and refunds overpayment; underpaid buy reverts; buying past 800 reverts; sell pays curve minus 1%; sell slippage guard; a round trip always loses; **sell from the floor** when it is higher keeps the floor per token; **redeem** pays 99% of pro-rata and raises the floor for the rest; over-redeem reverts; **graduation** moves reserve and escrow into the floor; curve closed after graduation, floor still open; only the creator withdraws; fill log and holders; the fill log is a ring of 120; a fuzzed buy/sell sequence stays solvent. |
| `Dare.t.sol` | 12 | Bond held by the post; accepted proof returns the bond; rejected or missing proof sends it to the floor; a tie is not an acceptance; only the creator posts proof, once, inside the window; only holders vote, once; no vote before proof or after the window; tokens moved between voters count once; finalize only once and only after the window; a failed dare with no holders returns the bond; plain posts have no dare. |
| `Factory.t.sol` | 6 | A post is deployed with name, symbol, 0 decimals and creator; bad slugs, duplicate slugs, missing media, bond without dare, dare without bond and bonds over 2 AVAX are refused. |
| `Attacks.t.sol` | 12 | **Reentrancy** from a malicious receiver on `sell`, `redeem` and `claimRefund` is blocked (`ReentrancyGuardReentrantCall`) and pays once; **reveal mismatch** (changed price, wrong salt) reverts; **late bid** reverts; early and late reveals revert; a **copied commitment** cannot be revealed by the copier; a commitment does not **replay** on another post; **floor drain**: buy-then-redeem never profits (fuzz), split redemptions never beat the pro-rata share (fuzz), the last holders draining the floor leave nothing for a new buyer to claim; strangers cannot withdraw earnings. |
| `Invariant.t.sol` | 2 | Over 64 runs × 40 random calls (buy, sell, redeem, claim, withdraw by three actors): the post's AVAX balance always covers floor + reserve + escrow + earnings + bond + refunds owed, and supply never exceeds 200 + curve sold. |

## SDK — 4 tests

Golden curve values identical to the Solidity test; buy/sell/redeem quotes including the floor-priced case; the TypeScript `commitment()` equals `JunoPost.commitmentOf` read with `cast call` from an Anvil deployment; AVAX parsing and formatting.

## Web — 10 tests

Position accounting from fill logs (realised/unrealised P&L), the price window, and the QA signer policy: only the public Fuji RPCs, only Juno calls on the factory and its posts (a `transfer` is refused), and the 0.015 AVAX budget.

## Live runs on Fuji

- **Seeding.** Three generated test accounts (mira, kai, oto), funded with 0.15 test AVAX from an existing Fuji key. Five posts: SPROUT (two bids, refunds, buys, a sell), PILE-IN (sold out and graduated in one 800-token buy, then a floor redemption), BALLOONS and CAP-TOSS (their bids were never revealed — see below — so they settled with no fills and refunded 99%), ROOFTOP (a dare: bids, proof, two yes votes, finalized as accepted, bond withdrawn).
  - The first run stopped after 26 transactions: kai's account ran out after the graduation buy, while wave 2's sealed bids were in. Those bids' salts lived only in that process, so they could never be revealed. `seed-wave2.ts` settled those auctions as they were (a real test of the unrevealed-bid path), topped kai up, and seeded ROOFTOP with its salts written to the gitignored `.seed-secrets.json` before any bid.
- **Finality.** Times are taken from the RPC accepting the signed transaction. "Final block" = the including block's `timestampMilliseconds` minus this machine's clock at broadcast (it trusts the local clock); "receipt" = when the public RPC first returned the receipt, polled every 60 ms. The first 26 seed transactions were timed with viem's block watcher and are not used for the medians.
- **Web flow.** `scripts/qa-flow.ts` exports nothing itself; it serves `web/dist-qa` (the QA-signer build) on port 5392, injects the QA test key into the page at runtime, approves each call against the budget, and drives the real UI: launch a dare post, bid, reveal, settle, claim the refund, buy 5, sell 2, redeem 1, post proof, vote, finalize, claim the returned bond. Screenshots of each step are in `orchestration/shots/avax-juno/flow/`.

## Known limits

- The bid's reveal is public: once a bidder reveals, the amount and price are on-chain. Bids stay hidden only until the reveal window (see README on eERC).
- Dare votes are weighted by balance at finalization; someone can still buy in before the window closes to swing a vote, paying the 21% buy overhead to do it.
- `trades()` keeps the newest 120 fills; older history is not drawn.
- The finality figure depends on this device's clock agreeing with the network; when the gap comes out negative the app shows only the receipt time.
