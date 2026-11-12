# Juno on Avalanche

**Every post is a coin.** Post a photo and it launches its own coin on Avalanche: a one-minute sealed-bid opening at one clearing price, a bonding curve in AVAX, a floor every holder can always redeem, and dare bonds that put the creator's money behind a promise.

Launchpads reward whoever gets the first transaction in, and leave holders with no buyer when the hype goes. Juno opens every post with a sealed-bid auction where everyone pays the same price, and keeps AVAX in each post's own vault so any holder can always burn tokens for their share.

Live on **Avalanche Fuji C-Chain** (43113). Factory: [`0xac736951c75e849e7db40b333cc0dff2baf88539`](https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539) (source verified on Snowtrace).

## Try it

The hosted web app is deployed by the orchestrator after review; until then run it locally (Node 20+, pnpm 10):

```bash
pnpm install
cp web/.env.example web/.env.local          # public factory address only
pnpm web:export                             # static export in web/dist
pnpm web:serve                              # http://localhost:5391
pnpm test                                   # forge (70) + SDK (4) + web (10)
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
### Contracts

| Contract | Address |
| --- | --- |
| JunoFactory (source verified) | [`0xac736951c75e849e7db40b333cc0dff2baf88539`](https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539) — deployed in [0xdc72b603…](https://testnet.snowtrace.io/tx/0xdc72b603c6ab6c4f80aa2db93ad74918216b89a6e21ce6a52cc5c020db712d5c) |
| Post `sprout` (JunoPost + its ERC-20) | [`0x6F8135Afc46Cd603e19c74f4486D93A824D531e1`](https://testnet.snowtrace.io/address/0x6F8135Afc46Cd603e19c74f4486D93A824D531e1) |
| Post `pile-in` (JunoPost + its ERC-20) | [`0x035a2CF4714fedce1A80AC2790442B2912823b91`](https://testnet.snowtrace.io/address/0x035a2CF4714fedce1A80AC2790442B2912823b91) |
| Post `rooftop` (JunoPost + its ERC-20) | [`0xda23789f6D450793093Bf079c1Dc3B94D0aFce9B`](https://testnet.snowtrace.io/address/0xda23789f6D450793093Bf079c1Dc3B94D0aFce9B) |
| Post `balloons` (JunoPost + its ERC-20) | [`0x48604BA5590180a2386297F8E45B3Edde7C804D4`](https://testnet.snowtrace.io/address/0x48604BA5590180a2386297F8E45B3Edde7C804D4) |
| Post `night-swim` (JunoPost + its ERC-20) | [`0x48FCE68864116bA594Ae8C7412759F8BE86E1026`](https://testnet.snowtrace.io/address/0x48FCE68864116bA594Ae8C7412759F8BE86E1026) |
| Post `qa-11120941` (launched from the web app) | [`0x1701D2B17613242E978841349cf316938118010F`](https://testnet.snowtrace.io/address/0x1701D2B17613242E978841349cf316938118010F) |

### One full flow from the web app (12/12 succeeded)

Driven through the web build in headless Chrome by `scripts/qa-flow.ts` with the QA signer (account [`0xB490723D988BD713374D9c6Efd875614B89770fe`](https://testnet.snowtrace.io/address/0xB490723D988BD713374D9c6Efd875614B89770fe)), post `qa-11120941`.

| # | Call | Tx | Final block | Receipt |
| ---: | --- | --- | ---: | ---: |
| 1 | `createPost` | [0x81ef8d34…](https://testnet.snowtrace.io/tx/0x81ef8d345d31cb95cec00ca11c13d3f4b1178f98734d0dfd75e7b5cd8431ae47)  | 0.14 s | 1.72 s |
| 2 | `commit` | [0x7f71d5ff…](https://testnet.snowtrace.io/tx/0x7f71d5ffe4106b9baaa1002a67506a0c21d75150b4ecce378b8a12bacc825e57)  | 0.25 s | 2.00 s |
| 3 | `reveal` | [0x48b8798b…](https://testnet.snowtrace.io/tx/0x48b8798b16ddca9fd55126d0ad58726160fc4f796c00b4c44eaf8c5a37b3e65b)  | 0.83 s | 2.11 s |
| 4 | `settle` | [0x341e34fc…](https://testnet.snowtrace.io/tx/0x341e34fc72cc4ad058ab57d5b029d61e99507e7513c6bdca83bb47773c3b08ce)  | 0.06 s | 1.64 s |
| 5 | `claimRefund` | [0x4ddf9b39…](https://testnet.snowtrace.io/tx/0x4ddf9b394468f85bbdc5444bef57f117ffd67132458e85909ae2e267dfe0ee31)  | 0.75 s | 2.12 s |
| 6 | `buy` | [0xeb959195…](https://testnet.snowtrace.io/tx/0xeb959195cc48d350b1ed9d3db2404c0f4a8be31ee3ae2b0586ed8deafafd67c3)  | 0.35 s | 1.64 s |
| 7 | `sell` | [0xf93e8ef3…](https://testnet.snowtrace.io/tx/0xf93e8ef3e83ebbdf2b2a5d3f9aa581b81b3b8ecdb73449fd9ed0271f48056ed3)  | 0.18 s | 1.85 s |
| 8 | `redeem` | [0x914ecb2d…](https://testnet.snowtrace.io/tx/0x914ecb2d4bcf1d889ebaaa07f09dd07f66f564292e5d0be1ccca0da5df9517f2)  | 0.88 s | 2.34 s |
| 9 | `submitProof` | [0x79a8d8f5…](https://testnet.snowtrace.io/tx/0x79a8d8f5fb3b06dc2f1b3db45e8a35e4b052df08ea6e03ee524f6daad4fe9805)  | 0.84 s | 2.08 s |
| 10 | `vote` | [0xaf794548…](https://testnet.snowtrace.io/tx/0xaf794548c5724b43c528fcca4002c880af5493d30d67f18e8e7c526d48751efc)  | 0.26 s | 1.73 s |
| 11 | `finalizeDare` | [0x3e607d52…](https://testnet.snowtrace.io/tx/0x3e607d52f362b467b6199d0d9dc034ecbf6ac025ef86cbb24fb86cb5e34b2618)  | — | 1.39 s |
| 12 | `withdrawEarnings` | [0x63182a21…](https://testnet.snowtrace.io/tx/0x63182a2130520212759315b2e808e03c46ded1c7ffc6ddd071babef23673e966)  | 0.96 s | 2.32 s |

An earlier QA run (post [`0x93Fe6327e9e05594c15EBEC1716d4619433D4CD9`](https://testnet.snowtrace.io/address/0x93Fe6327e9e05594c15EBEC1716d4619433D4CD9)) stopped after its sealed bid because a test-harness locator matched two elements; that post was closed by script: settle bid never revealed [0x2fdbdacc…](https://testnet.snowtrace.io/tx/0x2fdbdacc11091906b3d8c6259a75f2b12b112761ed530f579c504282f8ffb9ff), refund minus 1pct [0x1a3d2682…](https://testnet.snowtrace.io/tx/0x1a3d26826945d4e80263c15010896b77b56fce8ffa94e7979fa0783f16259728), finalize no holders bond returns [0xcf3079a5…](https://testnet.snowtrace.io/tx/0xcf3079a509e93352176383378d25285c775986aa2701554f7568556450ed6470), creator withdraws bond and penalty [0xe155c874…](https://testnet.snowtrace.io/tx/0xe155c87402451ecab68d7c427ac4360708a18385cf67f048c40111aa6fda07a6).

### Seeded on Fuji (55 transactions, 0 failed)

Three test accounts (mira, kai, oto) created and funded by `scripts/fuji/fund.ts`; every call made by `scripts/fuji/seed.ts`.

| # | Step | From | Tx | Final block | Receipt |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | create post sprout | mira | [0x95184104…](https://testnet.snowtrace.io/tx/0x95184104b455acbc051456124f7b8da8bb8d0196197ea3ac91c4c157f92a43e2) | 0.12 s | 1.63 s |
| 2 | create post pile-in | kai | [0x2a778528…](https://testnet.snowtrace.io/tx/0x2a77852858d41ea37de3b4a04779a848412c1ed7c6817ff49de79f45139cd3a2) | 0.71 s | 2.31 s |
| 3 | create post rooftop | oto | [0x7646f11b…](https://testnet.snowtrace.io/tx/0x7646f11b64858e20e8585e2c26cc53eccfe10be2d4a7d1361649491544c3a719) | 0.04 s | 1.37 s |
| 4 | create post balloons | mira | [0x337a08bc…](https://testnet.snowtrace.io/tx/0x337a08bc3f1bdb04ab533bf1568e4051049a15f7419ca291e04b3d153ced49a9) | 0.01 s | 1.60 s |
| 5 | create post night-swim | kai | [0x955f7109…](https://testnet.snowtrace.io/tx/0x955f7109d64f74c491c893fca1c680d187c3988595308679cfd9a0b8b50a9171) | 0.03 s | 1.61 s |
| 6 | sprout sealed bid kai | kai | [0x8b708533…](https://testnet.snowtrace.io/tx/0x8b708533ff9bd0a7e6e1b388d8ee2afc6fc10933decd2350f77122f7f690b307) | 0.16 s | 1.60 s |
| 7 | sprout sealed bid oto | oto | [0xfb0fbf00…](https://testnet.snowtrace.io/tx/0xfb0fbf00284e4bbdbbedc5e869f147724c2ff20b63630f74846f3f4c45bc6d28) | 0.14 s | 1.85 s |
| 8 | pile-in sealed bid mira | mira | [0x253cea6e…](https://testnet.snowtrace.io/tx/0x253cea6e86d3edd382ec063e6c5117b77b56b742eb3840e06984b3addc36b63c) | 0.17 s | 1.61 s |
| 9 | pile-in sealed bid oto | oto | [0x490725e7…](https://testnet.snowtrace.io/tx/0x490725e7dd9b5cc793642778e7ab0a7cbf9b86322422fcf47b5ce6c6410b9f1f) | 0.24 s | 2.07 s |
| 10 | rooftop sealed bid mira | mira | [0x7a0c19eb…](https://testnet.snowtrace.io/tx/0x7a0c19ebd9d6a8d6b71b9b33b077f70fac88f5f739ea95873923d2f7c49608bd) | 0.75 s | 2.09 s |
| 11 | rooftop sealed bid kai | kai | [0xd463aac8…](https://testnet.snowtrace.io/tx/0xd463aac899896dbf7be754550423ea0d1932e6382259528143e0ae66770236bd) | 0.13 s | 1.85 s |
| 12 | balloons sealed bid oto | oto | [0x4cc2f06a…](https://testnet.snowtrace.io/tx/0x4cc2f06ab7c43baabdc4ce2ab7a60c4aff7ee0959d0622b3b687477d6d90fc36) | 0.06 s | 1.60 s |
| 13 | balloons sealed bid kai never revealed | kai | [0xd34b75c4…](https://testnet.snowtrace.io/tx/0xd34b75c449f586c89733c6c7b835abcdd1bd065f0e3d77d1744f0a4ce619ffd2) | 0.54 s | 2.09 s |
| 14 | night-swim sealed bid mira | mira | [0x62e5ad9d…](https://testnet.snowtrace.io/tx/0x62e5ad9d305d726f9a4f6bee46101410a23f4982b8b8ec67504a9b3817d07988) | 0.52 s | 2.08 s |
| 15 | night-swim sealed bid oto | oto | [0x4938a686…](https://testnet.snowtrace.io/tx/0x4938a686cefd2549025431cd5ccd2d1fb26ad4bad1b0f83b470f17209c01d885) | 0.67 s | 2.11 s |
| 16 | sprout reveal kai | kai | [0x7abf6bac…](https://testnet.snowtrace.io/tx/0x7abf6bac01471ee34c4da533e2953ede4fecaead0998931185498fc4ca9fcc38) | 0.29 s | 1.64 s |
| 17 | sprout reveal oto | oto | [0xac144cc0…](https://testnet.snowtrace.io/tx/0xac144cc07dd79f5df89372c7691c457f1c4b9e41eb05643af28976391bd730c2) | 0.10 s | 1.62 s |
| 18 | pile-in reveal mira | mira | [0x4667cb51…](https://testnet.snowtrace.io/tx/0x4667cb51b1ec3e2d40fc6cee652de1ff41250529b5fc95f1d1da3030e9f5ee38) | 0.03 s | 1.36 s |
| 19 | pile-in reveal oto | oto | [0x89e0165a…](https://testnet.snowtrace.io/tx/0x89e0165a5e6eb075dbffc4ca12390e8a6702b7851429489586c7e948c0e7de01) | 0.44 s | 1.87 s |
| 20 | rooftop reveal mira | mira | [0xb20f2521…](https://testnet.snowtrace.io/tx/0xb20f25215c206bbc966362690a91ddeb995b77212e135942b8ca104367afc8bb) | 0.73 s | 2.11 s |
| 21 | rooftop reveal kai | kai | [0xf25db0b5…](https://testnet.snowtrace.io/tx/0xf25db0b555407a83814f53f82c017cb78280a0e63a74610fa238bb389bc57315) | 0.56 s | 1.87 s |
| 22 | balloons reveal oto | oto | [0x477391ae…](https://testnet.snowtrace.io/tx/0x477391ae5107324d6958e4c47ec9835bb15e31647dda7ef9792e753c4e5f136c) | 0.74 s | 2.10 s |
| 23 | night-swim reveal mira | mira | [0x4a0604a9…](https://testnet.snowtrace.io/tx/0x4a0604a9f5cde51c264ef533f120804162d6e1c6ca460a598c1254c9c12f8315) | 0.10 s | 1.61 s |
| 24 | night-swim reveal oto | oto | [0xc6f9572f…](https://testnet.snowtrace.io/tx/0xc6f9572f91926fc136d9dddc01647d791ba5019665cc7e268f5c166b28b18864) | 0.17 s | 1.37 s |
| 25 | sprout settle | mira | [0xbc995373…](https://testnet.snowtrace.io/tx/0xbc9953734a3ef906459e3d8eb4ed60a9b27f19135f668741f15367c4c36dd7ad) | 0.48 s | 1.85 s |
| 26 | sprout refund kai | kai | [0x22ffd8b8…](https://testnet.snowtrace.io/tx/0x22ffd8b8e4b7822f132e85627be156cb8e35b1f12487229ccc12c253ae37d380) | 0.18 s | 1.62 s |
| 27 | sprout refund oto | oto | [0x8fa98796…](https://testnet.snowtrace.io/tx/0x8fa987969fb93917762e2aa3a7a71cae60b06e855726bcc990e7d3f0b66b021e) | 0.12 s | 1.85 s |
| 28 | sprout buy 25 | oto | [0x2aea642a…](https://testnet.snowtrace.io/tx/0x2aea642a4236489dedd0a3e849de0724bea23f2ca8a97a2c44edd3b96cde2b03) | 0.27 s | 1.87 s |
| 29 | sprout buy 10 | mira | [0x75572475…](https://testnet.snowtrace.io/tx/0x75572475c64bb235cddee2940f612b910ffc3ef8f9e9aa777522258b1d476fac) | 0.68 s | 2.09 s |
| 30 | sprout sell 5 | oto | [0x805b4687…](https://testnet.snowtrace.io/tx/0x805b4687eee1abb4f7fbc622e7aba98a54e13710df1f574a91dfcf84e695308e) | 0.24 s | 1.87 s |
| 31 | pile-in settle | kai | [0xdfb92e2f…](https://testnet.snowtrace.io/tx/0xdfb92e2f806fc4bde3827b2a707993b87046152022e6dbab0e983b37cf18d060) | — | 1.36 s |
| 32 | pile-in refund mira | mira | [0x8a622d89…](https://testnet.snowtrace.io/tx/0x8a622d891ace6b2da04c75f6dce36e0418cdd5c9aa92a0ed79ec4a3e32edf4e7) | 0.15 s | 1.84 s |
| 33 | pile-in refund oto | oto | [0x67859ec6…](https://testnet.snowtrace.io/tx/0x67859ec6dbf0e9d1c04cd8f990e63dd3a1109339ede76803628187858b1e7949) | 0.89 s | 2.32 s |
| 34 | pile in buy 800 graduates | kai | [0x5c517a10…](https://testnet.snowtrace.io/tx/0x5c517a10f789acccc7267493b303eada815478352a670af85bfa8494aecc1402) | 0.25 s | 1.84 s |
| 35 | pile in redeem 20 floor | mira | [0x30271f33…](https://testnet.snowtrace.io/tx/0x30271f33204644a2c4c3ac01923c74505097c4cd79d79f216d5dcd292cfba576) | 0.07 s | 1.61 s |
| 36 | rooftop settle | oto | [0xf303c772…](https://testnet.snowtrace.io/tx/0xf303c772ee2415bebfec50168779da3bd7d9bf7e0773835b685bb039d0acbb64) | 0.35 s | 1.61 s |
| 37 | rooftop refund mira | mira | [0x25e8c46c…](https://testnet.snowtrace.io/tx/0x25e8c46c3465ad8284690c379779b170a36a2206613558241b8431a0ed100810) | 0.40 s | 2.10 s |
| 38 | rooftop refund kai | kai | [0x978c6b7c…](https://testnet.snowtrace.io/tx/0x978c6b7ce102abf34dc9ab0acde758e2bae9c916e5c93ad0a19d586d484e40bf) | 0.27 s | 2.09 s |
| 39 | rooftop buy 40 | kai | [0x589eae68…](https://testnet.snowtrace.io/tx/0x589eae686c03eae4d672c11b9a69a19af04d5978c4eb19046ab9247717f81374) | 0.55 s | 2.07 s |
| 40 | rooftop submit proof | oto | [0x754757c3…](https://testnet.snowtrace.io/tx/0x754757c3cf8510e52305b021cd58cd1338dfee15573aa51adb2102c0ed5ba313) | 0.26 s | 1.37 s |
| 41 | rooftop vote yes kai | kai | [0x674895f6…](https://testnet.snowtrace.io/tx/0x674895f6caab9266d2b34f864225d74992533e5cd1d82a5737c867d74b4d9205) | 0.16 s | 2.09 s |
| 42 | rooftop vote yes mira | mira | [0x33f202bb…](https://testnet.snowtrace.io/tx/0x33f202bb267776abc84fd994dcc180dce3b7e32af4083cc6d81e959508daf849) | 0.15 s | 1.60 s |
| 43 | balloons settle | mira | [0x59fe8a4e…](https://testnet.snowtrace.io/tx/0x59fe8a4e3956f3712766a512692ca8adc1093281c1dbec5799fe0e3b138af4e5) | 0.14 s | 1.60 s |
| 44 | balloons refund oto | oto | [0x0077e07a…](https://testnet.snowtrace.io/tx/0x0077e07a9a4eea654013e1cf295203730a291c474bae9cb5960323d474f2ce43) | 0.42 s | 1.83 s |
| 45 | balloons refund kai minus 1pct | kai | [0x01dd6d4a…](https://testnet.snowtrace.io/tx/0x01dd6d4aa3f63b694037f2f3205c6f6c6a07397bb2bbb6b6d8b5b90db9b6dec5) | 0.38 s | 1.84 s |
| 46 | balloons buy 60 | mira | [0xbfe6e7df…](https://testnet.snowtrace.io/tx/0xbfe6e7df40d7b10b91d167aabd52958e870885150ac707c7c40a15c06e0b65a2) | 0.11 s | 1.62 s |
| 47 | balloons buy 30 | kai | [0xd3987c32…](https://testnet.snowtrace.io/tx/0xd3987c32501325c2dc14caf57bc63676d07ad82bda6caa9add54d085d098495b) | 0.69 s | 2.08 s |
| 48 | night-swim settle | kai | [0xcb53aac2…](https://testnet.snowtrace.io/tx/0xcb53aac251099bfc38be19f494711379d7227cbd2573f1502f587095399304ef) | 0.19 s | 1.42 s |
| 49 | night-swim refund mira | mira | [0x78ccc83a…](https://testnet.snowtrace.io/tx/0x78ccc83a513cf1223732f90e7334e627026fcd92c35b2388a49ebf235cb6fe17) | 0.54 s | 2.08 s |
| 50 | night-swim refund oto | oto | [0x8fb3a815…](https://testnet.snowtrace.io/tx/0x8fb3a8157d7945f5c20e60bc4a6c26ff7b605de516017c96e81d7ae89736b131) | 0.14 s | 1.62 s |
| 51 | night swim buy 15 | oto | [0xd4104eb1…](https://testnet.snowtrace.io/tx/0xd4104eb1de6c2e7e702d62a84a932e187dc76907abfbca7b3c325252a85082b0) | 0.22 s | 1.60 s |
| 52 | rooftop finalize accepted | kai | [0xb8a9d7a3…](https://testnet.snowtrace.io/tx/0xb8a9d7a3f5f72e3d8acf535b1365c5002da9dd8dbeacd3d100d2475a42afc87a) | — | 1.38 s |
| 53 | rooftop creator withdraws bond | oto | [0x4ce816f0…](https://testnet.snowtrace.io/tx/0x4ce816f0a825a58036a16926087d7fb684c605ed68b36c641cff0a3c712ab85e) | 0.27 s | 1.87 s |
| 54 | night swim finalize no proof bond to floor | mira | [0x4ef73c3d…](https://testnet.snowtrace.io/tx/0x4ef73c3d0230eefb5e0d393272da9a48f68973913ab5dd98f530d8903d7fa3b4) | 0.81 s | 2.35 s |
| 55 | night swim redeem 10 with bond in floor | mira | [0xaed0e7aa…](https://testnet.snowtrace.io/tx/0xaed0e7aa8560f7887179a7f18a72b87ab31f945563a96a92bffbc117c741028d) | 0.23 s | 2.10 s |

Across the 55 seeded transactions: median **0.24 s** from broadcast to a final block (p90 0.71 s, over the 53 where this machine's clock was not ahead of the block's), and 1.84 s until the public RPC returned the receipt (p90 2.10 s). "Final block" is the including block's `timestampMilliseconds` minus this machine's clock at broadcast.

### Superseded: v1

A first factory, [`0x44b3f36175d7426218a9fcac9ab5eb6f8444e758`](https://testnet.snowtrace.io/address/0x44b3f36175d7426218a9fcac9ab5eb6f8444e758), ran 50 seed transactions and 10 steps of the web flow before a design flaw showed in its own chart: a curve buy right after the auction could undercut the auction's clearing price. v2 (above) prices every buy at the highest of the curve, the floor and the clearing price. The test AVAX in v1 was recovered by redeeming (15 transactions). All v1 transactions are kept in `deployments/fuji.json` → `v1`.

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
