# Juno on Avalanche

**Every post is a coin.** Post a photo and it launches its own coin on Avalanche: a one-minute sealed-bid opening at one clearing price, a bonding curve in AVAX, a floor every holder can always redeem, and dare bonds that put the creator's money behind a promise.

Launchpads reward whoever gets the first transaction in, and leave holders with no buyer when the hype goes. Juno opens every post with a sealed-bid auction where everyone pays the same price, and keeps AVAX in each post's own vault so any holder can always burn tokens for their share.

Live on **Avalanche Fuji C-Chain** (43113). Factory: [`0xac736951c75e849e7db40b333cc0dff2baf88539`](https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539) (source verified on Snowtrace).

## Try it

The hosted web app is deployed by the orchestrator after review; until then run it locally (Node 20+, pnpm 10):

```bash
pnpm install
cp web/.env.example web/.env.local          # public factory address only
pnpm --filter juno-avax-web export:web      # static export in web/dist
node web/scripts/serve.mjs 5391             # http://localhost:5391
```

1. Open `/social` — the feed reads every post from Fuji, with prices, floors and who bought.
2. Open a post (PILE-IN is graduated, ROOFTOP's dare was accepted, NIGHT-SWIM's dare flaked into the floor) — chart, holders, the opening auction's clearing price, the floor per token, the dare's vote.
3. Tap **Buy** — the sheet quotes from the contract (`quoteBuy`) and shows the fee and what the buy adds to the floor. Nothing is sent until your wallet approves.
4. **Connect** Core, MetaMask or any EIP-6963 wallet; the app asks it to switch to Fuji (adding the network if needed). Get test AVAX from the [Core faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c).
5. **Post** (the + tab): pick art, name it, launch. Then you have one minute to place a sealed bid, one to reveal, and anyone can settle. After each transaction the app shows how long Avalanche took to make it final.

## How a post works

1. **Launch.** `JunoFactory.createPost(slug, caption, mediaUrl, dare)` deploys the post's own `JunoPost`: a 0-decimal ERC-20 (at most 1,000 tokens) holding the auction, curve, floor vault and dare. Any AVAX sent is the dare bond.
2. **Sealed-bid opening (60 s + 60 s).** A bid is `keccak256("juno:v1", post, chainId, bidder, amount, maxPrice, salt)` plus exactly **0.005 AVAX** of escrow, the same for everyone, so the deposit says nothing about the bid. The salt stays in the bidder's browser. In the next minute bidders reveal. Then anyone calls `settle()`: bids fill highest price first (earlier commit wins ties) for the 200 auction tokens and **every winner pays the same clearing price**, the lowest filled bid. Unused escrow is claimable; a bid never revealed is refunded minus 1% (to the creator). If nobody settles, the first buy settles it.
3. **Curve (800 tokens).** Juno's 16-segment weighted curve (ported from the earlier Juno curve), base price 0.000001 AVAX rising 100× to the last token, integer wei maths rounded against the trader. A buy pays **the highest of the curve price, the pro-rata floor and the auction's clearing price** — so the curve never undercuts the people who won the auction — plus 20% into the floor vault and a 1% fee split between the creator and the graduation escrow. A sell pays the curve (or the floor, if higher) minus 1%.
4. **Floor.** Half the auction raise plus 20% of every buy sit in the post's vault. `redeem(q)` burns tokens for 99% of their pro-rata share at any time; the 1% left behind raises the floor for everyone else.
5. **Graduation.** When all 800 curve tokens are sold the curve closes and the curve reserve and graduation escrow move into the floor vault, so every token left redeems against everything the post raised.
6. **Dare.** The creator posts proof (a link) within five minutes of launch; holders vote once each, weighted by their balance when the dare is finalized (so tokens moved between voters count once). Accepted → the bond returns to the creator. Rejected or no proof → the bond goes into the floor. No holders at all → the bond returns to the creator.

Payouts that can wait are pulled (refunds, creator earnings); sells and redemptions pay last, after all state is written, under a reentrancy guard. Each post keeps a 120-entry fill log (`trades()`) and a `holders()` view, so the app draws charts and holder lists with no indexer and no server.

## What is Avalanche-native here, and what is not

| | Status |
| --- | --- |
| **Fast finality, measured** | **Used.** Every transaction sent from the app shows its own time from broadcast to a final block, read from the including block's millisecond timestamp (Fuji headers carry `timestampMilliseconds`), and the time until the public RPC returned the receipt. Avalanche C-Chain blocks are final when accepted, so there is no confirmation count to wait for. The desktop rail and the landing page read Fuji's live block cadence from the headers. Seeded run: see the median under the tables below. |
| **Fuji C-Chain contracts, Core wallet** | **Used.** Solidity on C-Chain, factory source verified on Snowtrace, EIP-6963 wallet discovery with Core listed first, `wallet_switchEthereumChain` / `wallet_addEthereumChain` to Fuji. |
| **Sealed bids with eERC** | **Not used — commit-reveal instead.** eERC (AvaCloud's encrypted ERC) keeps balances and amounts as ElGamal ciphertexts that only the owner and the auditor can decrypt, with client-side Groth16 proofs. A clearing-price auction has to read every bid to settle it on-chain, which eERC deliberately does not allow without a trusted decryptor. So bids are hidden with commit-reveal and identical escrows, and the reveal step is public. This is stated in the app as well. |
| **ICM / ICTT** | **Not used.** Juno needs no second chain; bridging test USDC in from another L1 would not have made the product better within the time. |
| Mainnet, own L1 | Not used. Fuji only, test AVAX only. |

## Live on Fuji

<!-- EVIDENCE:START -->
<!-- EVIDENCE:END -->

All of the above is in [deployments/fuji.json](deployments/fuji.json), with gas used, blocks and timings per transaction.

## The app (`web/`)

The Juno Expo Router app, exported as a static web build (`expo export --platform web`), served by any static host with a single-page fallback (`web/vercel.web.json`).

- **Reads:** `web/lib/api.ts` reads the factory's `posts()`, then each post's `market()`, `trades()` and `holders()` through `@juno/sdk` (viem, JSON-RPC batched, two public Fuji RPCs with fallback). Buy quotes come from the contract's `quoteBuy`; sell and redemption quotes from the SDK's mirror of the contract maths.
- **Writes:** `web/lib/wallet.tsx` encodes each call, **simulates it against Fuji with `eth_call` first** (so a refusal shows the contract's reason, mapped to plain words, before the wallet opens), sends it through the person's wallet, and follows it to a receipt, timing it (`lib/tx-status.ts`, `lib/finality.ts`).
- **Screens:** feed (bump order: live auctions first, then latest trade), reels, coin page (chart, auction card with countdown and phase track, floor, graduation, dare card with proof/vote/finalize, activity, holders, details), trade sheet (buy / sell / redeem with a numpad and live quote), launch flow, profile with positions and P&L from the fill logs, trader pages and a leaderboard.
- **Missing values** show "Setup required: NAME". Empty, loading and error states are drawn, nothing is mocked; likes and follows have no contract and are kept on the device only.
- **QA signer:** a web build made with `EXPO_PUBLIC_QA_SIGNER=1` (`dist-qa/`, never deployed) swaps the browser wallet for a signer that only runs on a local port, only signs Juno calls on Fuji, and stops at 0.015 test AVAX. A production build refuses to import it (`metro.config.js`).

## Repository

```
contracts/   Foundry: JunoFactory, JunoPost, CurveMath + 70 tests (auction, curve, dare, factory, attacks, invariant)
sdk/         @juno/sdk: viem reads, ABIs, the contract maths in TypeScript
web/         the Juno app (Expo Router, static web export)
scripts/     Fuji keys, funding, deploy, seeding, the web QA flow, evidence tables
deployments/ fuji.json: addresses and every recorded transaction
docs/        SLIDES.md
```

Tests and how to run them: [TESTING.md](TESTING.md). Submission fields: [SUBMISSION.md](SUBMISSION.md).

Keys: `scripts/fuji/keys.ts` writes test-account keys into the gitignored `.env`; scripts read them by name and never print them. The funding script reads an existing funded Fuji key from another local env file by path (`JUNO_FUNDER_ENV`), only to send 0.15 test AVAX to this repo's deployer.

## What existed before the Speedrun

Juno is our own product and has been built on several chains before. Everything listed here existed before this build and is reused or ported, not offered as new work:

- [nickthelegend/juno](https://github.com/nickthelegend/juno) — the original Juno on Solana (Meteora curves).
- [nickthelegend/juno-arbitrum](https://github.com/nickthelegend/juno-arbitrum) — Juno on Arbitrum: Stylus curve maths, Uniswap v3 graduation.
- [nickthelegend/juno-clockin](https://github.com/nickthelegend/juno-clockin) — Solana Mobile build.
- [nickthelegend/juno-monad](https://github.com/nickthelegend/juno-monad) — Juno on Monad.
- [nickthelegend/juno-arc](https://github.com/nickthelegend/juno-arc) — Juno on Arc (USDC curves).
- `juno-landing` (private) — marketing site.
- `juno-wif` (private) — Juno on Robinhood Chain: the Expo app, the 16-segment curve and the art.
- `juno-near` (NEAR testnet, Nov 9–11 2026, [juno-near.vercel.app](https://juno-near.vercel.app)) — the sealed-bid opening, redeemable floor and dare bond mechanics, the Juno app's NEAR screens and the lilac-and-lime 3D object kit.

The app in `web/` was imported unchanged from `juno-near/packages/app` in commit `29c2ade` (its screens, theme, fonts, components and art). The mechanics (auction, floor, dare) were designed in `juno-near`, in Rust.

**Built for this Speedrun (Nov 12, 2026, from commit `9ba6f0e`):** the Solidity contracts and their 70 tests (a new implementation of the mechanics for the EVM, with changes: bids bound to post/chain/bidder, curve buys never below the auction's clearing price, graduation into the floor, failed dare bonds into the floor, dust sweep, a solvency invariant), the viem SDK, the Fuji deployment and 50 seeded transactions, the move of the app from NEAR to EVM (reads, wallet, simulation, QA signer), measured finality in the UI, web controls for refunds and the dare (proof, vote, finalize), the live block-cadence readout, and the web QA flow. To see only this work: `git diff 29c2ade..HEAD`.

## Hackathon disclosures

Built for **Build Anything on Avalanche** (Team1 India Speedrun, Nov 2026).

AI tools: built with AI coding agents (Claude Code) under human direction; the 3D art kit was generated earlier with ChatGPT images. All code reviewed and tested; see TESTING.md.

## License

MIT. Copyright (c) 2026 Nivesh Gajengi. See [LICENSE](LICENSE).
