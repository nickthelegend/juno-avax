# Juno on Avalanche

**Every post is a coin.** Post a photo and it launches its own coin on Avalanche: a one-minute sealed-bid opening at one clearing price, a bonding curve in AVAX, a floor every holder can always redeem, and dare bonds that put the creator's money behind a promise.

Launchpads reward whoever gets the first transaction in, and leave holders with no buyer when the hype goes. Juno opens every post with a sealed-bid auction where everyone pays the same price, and keeps AVAX in each post's own vault so any holder can always burn tokens for their share.

And because every post coin is a public ERC-20, holders can **hide their bag**: shield it into an eERC vault (Ava Labs' EncryptedERC), move it privately, and unshield to sell. Whales and copy-trade bots see the vault, not you.

Live on **Avalanche Fuji C-Chain** (43113). Factory: [`0xac736951c75e849e7db40b333cc0dff2baf88539`](https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539) (source verified on Snowtrace). eERC vault: [`0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac`](https://testnet.snowtrace.io/address/0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac). Version **v2.0** (see [CHANGELOG.md](CHANGELOG.md)).

## Try it

Live app: **https://juno-avax.vercel.app** (Fuji testnet; static export of `e59d313`). To run it locally (Node 20+, pnpm 10):

```bash
pnpm install
cp web/.env.example web/.env.local          # public factory address only
pnpm web:export                             # static export in web/dist
pnpm web:serve                              # http://localhost:5391
pnpm test                                   # forge (70) + SDK (13) + web (13) + eERC on Anvil (26 checks)
```

1. Open `/social` — the feed reads every post from Fuji, with prices, floors and who bought.
2. Open a post (PILE-IN is graduated, ROOFTOP's dare was accepted, NIGHT-SWIM's dare flaked into the floor) — chart, holders, the opening auction's clearing price, the floor per token, the dare's vote.
3. Tap **Buy** — the sheet quotes from the contract (`quoteBuy`) and shows the fee and what the buy adds to the floor. Nothing is sent until your wallet approves.
4. **Connect** Core, MetaMask or any EIP-6963 wallet; the app asks it to switch to Fuji (adding the network if needed). Get test AVAX from the [Core faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c).
5. **Post** (the + tab): pick art, name it, launch. Then you have one minute to place a sealed bid, one to reveal, and anyone can settle. After each transaction the app shows how long Avalanche took to make it final.
6. **Hide your bag**: on any coin page tap *Hide your bag* (or open `/vault`). *Public view* shows what anyone can read. *Your bag* asks for one signature (not a transaction), then registers your key with a proof built in the browser, and lets you shield, send privately and unshield. *Auditor* shows transfer amounts only to the auditor's wallet.

## How a post works

1. **Launch.** `JunoFactory.createPost(slug, caption, mediaUrl, dare)` deploys the post's own `JunoPost`: a 0-decimal ERC-20 (at most 1,000 tokens) holding the auction, curve, floor vault and dare. Any AVAX sent is the dare bond.
2. **Sealed-bid opening (60 s + 60 s).** A bid is `keccak256("juno:v1", post, chainId, bidder, amount, maxPrice, salt)` plus exactly **0.005 AVAX** of escrow, the same for everyone, so the deposit says nothing about the bid. The salt stays in the bidder's browser. In the next minute bidders reveal. Then anyone calls `settle()`: bids fill highest price first (earlier commit wins ties) for the 200 auction tokens and **every winner pays the same clearing price**, the lowest filled bid. Unused escrow is claimable; a bid never revealed is refunded minus 1% (to the creator). If nobody settles, the first buy settles it.
3. **Curve (800 tokens).** Juno's 16-segment weighted curve (ported from the earlier Juno curve), base price 0.000001 AVAX rising 100× to the last token, integer wei maths rounded against the trader. A buy pays **the highest of the curve price, the pro-rata floor and the auction's clearing price** — so the curve never undercuts the people who won the auction — plus 20% into the floor vault and a 1% fee split between the creator and the graduation escrow. A sell pays the curve (or the floor, if higher) minus 1%.
4. **Floor.** Half the auction raise plus 20% of every buy sit in the post's vault. `redeem(q)` burns tokens for 99% of their pro-rata share at any time; the 1% left behind raises the floor for everyone else.
5. **Graduation.** When all 800 curve tokens are sold the curve closes and the curve reserve and graduation escrow move into the floor vault, so every token left redeems against everything the post raised.
6. **Dare.** The creator posts proof (a link) within five minutes of launch; holders vote once each, weighted by their balance when the dare is finalized (so tokens moved between voters count once). Accepted → the bond returns to the creator. Rejected or no proof → the bond goes into the floor. No holders at all → the bond returns to the creator.

Payouts that can wait are pulled (refunds, creator earnings); sells and redemptions pay last, after all state is written, under a reentrancy guard. Each post keeps a 120-entry fill log (`trades()`) and a `holders()` view, so the app draws charts and holder lists with no indexer and no server.

## Avalanche features

| | Status | Evidence |
| --- | --- | --- |
| **eERC: Hide your bag** | **Used, live on Fuji.** Ava Labs' official [EncryptedERC](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1) in converter mode, used unchanged and pinned as a submodule, with production verifiers and an auditor. Any post coin can be shielded into one vault, moved privately between holders with transfer proofs, and unshielded to sell or redeem. Proofs are built in the browser. | Vault [`0xb999d23a…`](https://testnet.snowtrace.io/address/0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac) · Registrar [`0x949a55dd…`](https://testnet.snowtrace.io/address/0x949a55ddff2a85ce1a1bad7c760515903dee0c93) · a private transfer, kai → oto, PILE-IN [0xbd167cc5…](https://testnet.snowtrace.io/tx/0xbd167cc59c65aff309d69915f27e4a1f869baca49d0198d6774cf39106db4896) · the web-app run (table below) |
| **Fast finality, measured** | **Used.** Every transaction sent from the app shows its own time from broadcast to a final block (read from the block's `timestampMilliseconds`) and to a readable receipt. C-Chain blocks are final when accepted, so there is no confirmation count. | Seeded run: median 0.24 s to a final block (below) |
| **Fuji C-Chain contracts, Core wallet** | **Used.** Solidity on C-Chain, factory source verified on Snowtrace, EIP-6963 discovery with Core listed first, `wallet_switchEthereumChain` / `wallet_addEthereumChain`. | Factory [`0xac736951…`](https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539) |
| **Mainnet readiness** | **Ready, not deployed.** `scripts/mainnet/deploy.ts` runs dry by default: it checks chain 43114 and reads gas and cost from mainnet (about 0.037 AVAX for the factory, 0.104 AVAX with the vault on 12 Nov). A broadcast needs a typed confirmation and Nick's own key. Runbook: [scripts/deploy-mainnet.md](scripts/deploy-mainnet.md). | No mainnet transaction exists |
| **ICM / ICTT** | **Probed, not shipped.** One Teleporter message from Fuji C-Chain to Echo was delivered by the public relayer ([0xe47dac77…](https://testnet.snowtrace.io/tx/0xe47dac771067e3a763a85e94608f9610029e40db69f926aba38c3240e36a3efc)), so ICTT bridging of graduated coins is feasible. No product feature uses it yet, so it is not claimed. | `deployments/fuji.json` → `icmProbe` |
| Own L1 | Not used. | — |

### Hide your bag: what is private, and what is not

- **Public:** how many of each coin the vault holds (an ERC-20 balance), who has opened a private bag, and every **shield** and **unshield** amount, because those are ERC-20 transfers.
- **Private:** each holder's balance inside the vault (an ElGamal ciphertext on BabyJubJub) and the amount of every **private transfer**. The public sees "kai → oto, amount hidden".
- **The auditor** (a separate account set by the vault owner) can decrypt transfer and withdraw amounts, because every proof has to encrypt the amount to the auditor's key. The auditor cannot move anyone's coins.
- **Honest limit, from upstream:** a deposit is encrypted with a fixed randomness (a contract has no randomness), so an account that has only ever shielded has a balance anyone could work out from its public deposits. Privacy starts once a bag receives a private transfer or spends one. The app shows that order: shield, then send privately.
- **Why the opening auction does not use eERC:** a clearing-price auction has to read every bid to settle it on-chain. The opening uses commit-reveal with identical escrows. eERC hides holdings instead.
- **Keys:** one wallet signature over a fixed message (naming the account and chain 43113) derives the holder's BabyJubJub key on the device. Juno never stores it. RFC 6979 wallets (Core, MetaMask) sign deterministically, so the same wallet always reopens the same bag.

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
| Post `sunset-dump` (JunoPost + its ERC-20) | [`0x12D9a65e6ca502e65c847214aFB82b7049E139BF`](https://testnet.snowtrace.io/address/0x12D9a65e6ca502e65c847214aFB82b7049E139BF) |
| Post `glow-up` (JunoPost + its ERC-20) | [`0x628dD88892F45d416AAdC0185407f726A0929e9b`](https://testnet.snowtrace.io/address/0x628dD88892F45d416AAdC0185407f726A0929e9b) |
| Post `night-market` (JunoPost + its ERC-20) | [`0xF022Ac5a5237229aEbe06911Bf3f30B8258eC002`](https://testnet.snowtrace.io/address/0xF022Ac5a5237229aEbe06911Bf3f30B8258eC002) |
| Post `first-ollie` (JunoPost + its ERC-20) | [`0x2C515031f820A89A5251eF7bBbE5fe490BDcb9c4`](https://testnet.snowtrace.io/address/0x2C515031f820A89A5251eF7bBbE5fe490BDcb9c4) |
| Post `coffee-run` (JunoPost + its ERC-20) | [`0x0b0044D6bA59cD998d43C07B0D74ebd7A3D43f63`](https://testnet.snowtrace.io/address/0x0b0044D6bA59cD998d43C07B0D74ebd7A3D43f63) |
| Post `qa-11120941` (launched from the web app, v1 run) | [`0x1701D2B17613242E978841349cf316938118010F`](https://testnet.snowtrace.io/address/0x1701D2B17613242E978841349cf316938118010F) |
| Post `qa-11121113` (launched from the web app at 375 px) | [`0x9052d709428F2eCe2216BcAFF56D65b0681D1988`](https://testnet.snowtrace.io/address/0x9052d709428F2eCe2216BcAFF56D65b0681D1988) |
| Post `qa-11121108` (launched from the web app at 1440 px) | [`0x37f124557feed5f292AB80De1379f133bcdC6B62`](https://testnet.snowtrace.io/address/0x37f124557feed5f292AB80De1379f133bcdC6B62) |
| eERC vault: EncryptedERC, converter mode ([upstream](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1)) | [`0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac`](https://testnet.snowtrace.io/address/0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac) |
| eERC Registrar | [`0x949a55ddff2a85ce1a1bad7c760515903dee0c93`](https://testnet.snowtrace.io/address/0x949a55ddff2a85ce1a1bad7c760515903dee0c93) |
| eERC BabyJubJub library | [`0xbac19231588a71ede20f820917593bcf180ab416`](https://testnet.snowtrace.io/address/0xbac19231588a71ede20f820917593bcf180ab416) |
| eERC registration verifier (production) | [`0xb1a21983062d4d613924c8d0dc21332858c7c94e`](https://testnet.snowtrace.io/address/0xb1a21983062d4d613924c8d0dc21332858c7c94e) |
| eERC mint verifier (production) | [`0x4a129268ccd6a9c69f3452b39b08e7a76df688ae`](https://testnet.snowtrace.io/address/0x4a129268ccd6a9c69f3452b39b08e7a76df688ae) |
| eERC withdraw verifier (production) | [`0x567a6c6638d2ad7f80db688900a1d983e2d4b17e`](https://testnet.snowtrace.io/address/0x567a6c6638d2ad7f80db688900a1d983e2d4b17e) |
| eERC transfer verifier (production) | [`0xc6749bfdf4ad3058ec8e7013e364cad80b366fda`](https://testnet.snowtrace.io/address/0xc6749bfdf4ad3058ec8e7013e364cad80b366fda) |
| eERC burn verifier (production) | [`0x1ae83ae1fd91c091fc4bbddcfff0f17069937635`](https://testnet.snowtrace.io/address/0x1ae83ae1fd91c091fc4bbddcfff0f17069937635) |
| eERC auditor (account) | [`0xA98280DF5007bc9E78B1644327702eE9f55B6cb8`](https://testnet.snowtrace.io/address/0xA98280DF5007bc9E78B1644327702eE9f55B6cb8) |

### Hide your bag from the web app at 375 px (4/4 succeeded)

Driven through the web build in headless Chrome by `scripts/qa-vault.ts` with the QA signer (account [`0xB490723D988BD713374D9c6Efd875614B89770fe`](https://testnet.snowtrace.io/address/0xB490723D988BD713374D9c6Efd875614B89770fe)). Every proof was built in the page by snarkjs. Coin [`0x1701D2B17613242E978841349cf316938118010F`](https://testnet.snowtrace.io/address/0x1701D2B17613242E978841349cf316938118010F). The auditor account then opened the auditor view and decrypted the transfer amounts.

| # | Step | Call | Tx | Final block | Receipt |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | shield | `approve` | [0x3e8773ff…](https://testnet.snowtrace.io/tx/0x3e8773ff8784fab79a0d8f1add654d1322f7b16a161dac72c6b56495f1e35843)  | 0.09 s | 1.62 s |
| 2 | shield | `deposit` | [0x0a31ade5…](https://testnet.snowtrace.io/tx/0x0a31ade5d76673926f2581b86d5e72a38a7d7ceff40adf4cedc2861676943bac)  | 0.18 s | 1.98 s |
| 3 | send private | `transfer` | [0xb83db8f9…](https://testnet.snowtrace.io/tx/0xb83db8f96e6f29689c40588f3433f2e8d41294c42602fa0808ee7701988a2149)  | 0.84 s | 1.93 s |
| 4 | unshield | `withdraw` | [0x8058b176…](https://testnet.snowtrace.io/tx/0x8058b1767517ddf64fbbc8a7f9bb06da93cd9b931f4da2c5320f5119b85b25a7)  | 0.20 s | 1.60 s |

### Hide your bag from the web app at 1440 px (5/5 succeeded)

Driven through the web build in headless Chrome by `scripts/qa-vault.ts` with the QA signer (account [`0xB490723D988BD713374D9c6Efd875614B89770fe`](https://testnet.snowtrace.io/address/0xB490723D988BD713374D9c6Efd875614B89770fe)). Every proof was built in the page by snarkjs. Coin [`0x1701D2B17613242E978841349cf316938118010F`](https://testnet.snowtrace.io/address/0x1701D2B17613242E978841349cf316938118010F). The auditor account then opened the auditor view and decrypted the transfer amounts.

| # | Step | Call | Tx | Final block | Receipt |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | register | `register` | [0x519520e9…](https://testnet.snowtrace.io/tx/0x519520e9c911be6afb7d3999b28d6e9bf016ed166155fe4345abd6568ae66796)  | 0.20 s | 1.62 s |
| 2 | shield | `approve` | [0x7cc84d7f…](https://testnet.snowtrace.io/tx/0x7cc84d7ff5f8010cf8684dd75fa41b501c59172d5d9899ad1a3261e66f31288c)  | 0.80 s | 1.86 s |
| 3 | shield | `deposit` | [0x279fd13c…](https://testnet.snowtrace.io/tx/0x279fd13ca5f02b6e61b07be9881c5b4bc579ea155c37a5d335972f9c67cb42a2)  | 0.22 s | 1.89 s |
| 4 | send private | `transfer` | [0x466fb83e…](https://testnet.snowtrace.io/tx/0x466fb83e2438adf8b0dbee3147f8d25a76a5999a8d8fb50a7c646407eb04cc33)  | 0.13 s | 1.61 s |
| 5 | unshield | `withdraw` | [0x9e2bc866…](https://testnet.snowtrace.io/tx/0x9e2bc86648bb1bc8e897dd4efdba6f9bd7bf83989be63cec429488e536e236e2)  | 0.03 s | 1.61 s |

### Full post flow from the web app at 375 px (12/12 succeeded)

Driven through the web build in headless Chrome by `scripts/qa-flow.ts` with the QA signer (account [`0xB490723D988BD713374D9c6Efd875614B89770fe`](https://testnet.snowtrace.io/address/0xB490723D988BD713374D9c6Efd875614B89770fe)), post `qa-11121113`.

| # | Step | Call | Tx | Final block | Receipt |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | createPost | `createPost` | [0x6455d7c7…](https://testnet.snowtrace.io/tx/0x6455d7c7ad3796b53fc56c5d9b8fc221154d499642edc84b4ccb10762db1e40f)  | 0.14 s | 1.39 s |
| 2 | commit | `commit` | [0x29aed41d…](https://testnet.snowtrace.io/tx/0x29aed41de8a8b8f3e1fa1d81e81bf288a119ba61b4bbeaed6d7c1694a13544bd)  | 0.18 s | 1.97 s |
| 3 | reveal | `reveal` | [0xe20ad400…](https://testnet.snowtrace.io/tx/0xe20ad4002dfc76f05e466472f8f8aa514329c0d57346e91e831270631af3fb2f)  | 0.18 s | 1.60 s |
| 4 | settle | `settle` | [0x43cb619e…](https://testnet.snowtrace.io/tx/0x43cb619ef813487d52b5100a78a67ed4e51a6e9ea0400bcc8afb1e84a49d82ee)  | 0.15 s | 1.63 s |
| 5 | claimRefund | `claimRefund` | [0x549c165a…](https://testnet.snowtrace.io/tx/0x549c165ab0ab0ddaf6d65d6bfc071cd1f008e47a69470e0bd8ccfe2b7030c45b)  | 0.11 s | 1.71 s |
| 6 | buy | `buy` | [0x6b357b25…](https://testnet.snowtrace.io/tx/0x6b357b25cb9d90a8684e2c6ee68088e9f34b9a0781466cc514b626080e0783e4)  | 0.10 s | 1.26 s |
| 7 | sell | `sell` | [0xa0d7349f…](https://testnet.snowtrace.io/tx/0xa0d7349f9645e408c7d0385f0533be683cda8ea32d026271569c6f57bc7bd4c3)  | 0.18 s | 1.61 s |
| 8 | redeem | `redeem` | [0x3243f039…](https://testnet.snowtrace.io/tx/0x3243f039193991ee37de3a10339042fda99c6542ea955eb4889ddf8eb1fab7e5)  | 0.91 s | 2.32 s |
| 9 | submitProof | `submitProof` | [0xd32e55ec…](https://testnet.snowtrace.io/tx/0xd32e55eccb586c9873aeaa15f11ab5954425e7d1b015d2921b6c93fb167d24c6)  | 0.48 s | 1.85 s |
| 10 | vote | `vote` | [0x8f267b31…](https://testnet.snowtrace.io/tx/0x8f267b31e842f30a20d3a7309e2e025ca8684dce61f9a83dd7dd3eb4afc801ba)  | 0.23 s | 1.36 s |
| 11 | finalizeDare | `finalizeDare` | [0x601496cd…](https://testnet.snowtrace.io/tx/0x601496cdd246e36fcde7569acba4c28d1247649d8dc5a80c97e48de5beeb730a)  | 0.16 s | 1.60 s |
| 12 | withdrawEarnings | `withdrawEarnings` | [0x0c01ba00…](https://testnet.snowtrace.io/tx/0x0c01ba00d91166be341720b557beb632a2435fbc38b272dd7713d7b5e9395d27)  | 0.39 s | 1.85 s |

### Full post flow from the web app at 1440 px (12/12 succeeded)

Driven through the web build in headless Chrome by `scripts/qa-flow.ts` with the QA signer (account [`0xB490723D988BD713374D9c6Efd875614B89770fe`](https://testnet.snowtrace.io/address/0xB490723D988BD713374D9c6Efd875614B89770fe)), post `qa-11121108`.

| # | Step | Call | Tx | Final block | Receipt |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | createPost | `createPost` | [0xc8bb6eca…](https://testnet.snowtrace.io/tx/0xc8bb6ecabc6645c1eb51f6c0f25ea563dc72f21a076eabb6b36b38402bd3de93)  | — | 1.41 s |
| 2 | commit | `commit` | [0xaec18301…](https://testnet.snowtrace.io/tx/0xaec183017105ec5693df661623d5fc23685ca08671e1b16ea1d98e3f73f63d07)  | 0.04 s | 1.67 s |
| 3 | reveal | `reveal` | [0x1d63beaa…](https://testnet.snowtrace.io/tx/0x1d63beaa3fcf7df9dc4ff6baf0c3f11ace940bbbdb658298090c7f2a81ebc748)  | 0.39 s | 1.83 s |
| 4 | settle | `settle` | [0xf5381445…](https://testnet.snowtrace.io/tx/0xf5381445799390da11047357f64bf5c513d063adbd88dfb4ce624f8984cffe68)  | 0.74 s | 2.20 s |
| 5 | claimRefund | `claimRefund` | [0x75adda89…](https://testnet.snowtrace.io/tx/0x75adda89f0efa9bdbd0b20310f807ba1472fa40c34d34c602174e9c6d55b92d2)  | 0.19 s | 1.70 s |
| 6 | buy | `buy` | [0x8ce0e651…](https://testnet.snowtrace.io/tx/0x8ce0e651f13c0145abb6db0bb460415f426ea8549963ce108e9b239bc62fbaf3)  | 0.28 s | 1.63 s |
| 7 | sell | `sell` | [0x9e7293e9…](https://testnet.snowtrace.io/tx/0x9e7293e95e01f13d3583fc310202359c98e62ec91618f0a667d182a63943dfd5)  | 0.15 s | 1.86 s |
| 8 | redeem | `redeem` | [0xddcdc50f…](https://testnet.snowtrace.io/tx/0xddcdc50ff3327b49b27eb7713151dbb2e2a1cf8c51f90d9f720763a3feed2d99)  | 0.27 s | 2.09 s |
| 9 | submitProof | `submitProof` | [0x9a86c6e0…](https://testnet.snowtrace.io/tx/0x9a86c6e03cc7d37f68ef10bbd5696c9fff4dcd2427ae49c02838832688ba1d46)  | 0.68 s | 2.23 s |
| 10 | vote | `vote` | [0x52ea30a4…](https://testnet.snowtrace.io/tx/0x52ea30a48a4215ac11d49e856333d5b100d6c492a12e281db61d8f8c2ba467f9)  | 0.20 s | 1.63 s |
| 11 | finalizeDare | `finalizeDare` | [0xe654ea7a…](https://testnet.snowtrace.io/tx/0xe654ea7a3ca79147fee97d32252ce1d3298a4d73e4304ba505354e851904517f)  | 0.49 s | 1.86 s |
| 12 | withdrawEarnings | `withdrawEarnings` | [0x68ad3589…](https://testnet.snowtrace.io/tx/0x68ad3589970bbd61911913ccfe71b8a1399b65f3c6bc975784be1704dc8f6681)  | 0.70 s | 2.08 s |

### eERC vault on Fuji (27 transactions, 0 failed)

Deployed and seeded by `scripts/eerc/fuji.ts` with proofs from snarkjs and the production zkeys.

| # | Step | From | Tx | Gas |
| ---: | --- | --- | --- | ---: |
| 1 | deploy RegistrationVerifier | deployer | [0xf2715dec…](https://testnet.snowtrace.io/tx/0xf2715deca40ff6af49e6e703344ca7e2eed7e2469e2089754a25aa9d97fb4c74) | 425,936 |
| 2 | deploy MintVerifier | deployer | [0x1ba36989…](https://testnet.snowtrace.io/tx/0x1ba369897f59dc110bbd457f1ac4c41edda48de9ceea056c23a5c9b40b3f213e) | 813,961 |
| 3 | deploy WithdrawVerifier | deployer | [0xc0fde28c…](https://testnet.snowtrace.io/tx/0xc0fde28c515d15c2ca10c2ef6c39ef0c0fe110b0f29438c980ffd29c1d20f30a) | 649,853 |
| 4 | deploy TransferVerifier | deployer | [0xc38b612b…](https://testnet.snowtrace.io/tx/0xc38b612bdf021ab98cab939089b3fe54744523248c774c0d67c5b70ef8e30fba) | 978,066 |
| 5 | deploy BurnVerifier | deployer | [0xcc8f6bd1…](https://testnet.snowtrace.io/tx/0xcc8f6bd1004088ac9e4be9a167de414000d41863fe70e4560b1e108acd734468) | 711,621 |
| 6 | deploy BabyJubJub | deployer | [0xfcf4340d…](https://testnet.snowtrace.io/tx/0xfcf4340db346fb303b9965289eb053fc90680678860cc3402e598685591709a8) | 435,950 |
| 7 | deploy Registrar | deployer | [0x1deab41e…](https://testnet.snowtrace.io/tx/0x1deab41e6c5e8500366dc1a86791b2a7371abb3c33a7e765aa3740f5d706d416) | 454,935 |
| 8 | deploy EncryptedERC | deployer | [0x5e2467c8…](https://testnet.snowtrace.io/tx/0x5e2467c82e8dcb70e2bc4416f62b7a4a10f6cab363777fb6ca15ede4a6c8a894) | 4,393,214 |
| 9 | auditor registers | auditor | [0xd9b8a6a6…](https://testnet.snowtrace.io/tx/0xd9b8a6a6bda078b6fe09c8df2bc16eb2678d37907ca7b78132d7e2e49a875e9d) | 319,554 |
| 10 | owner sets auditor | deployer | [0xca0326dc…](https://testnet.snowtrace.io/tx/0xca0326dc628e859e5c6f4c0ba859777787c583c61b4435b93a733eb469ef7537) | 103,905 |
| 11 | mira registers | mira | [0xe5094035…](https://testnet.snowtrace.io/tx/0xe50940355d4249a296556379ba0c3051128a0ad8e75175d9f68d7ef3aa3b9a5c) | 319,542 |
| 12 | kai registers | kai | [0x7575a9e3…](https://testnet.snowtrace.io/tx/0x7575a9e3aec3995d81fc7a25853722b380cca79657a538920faefb7089ddb841) | 319,542 |
| 13 | oto registers | oto | [0x144d6268…](https://testnet.snowtrace.io/tx/0x144d62683fad9778805f5c6a89b4d370ca9a604d3d792c9462f6810189223de5) | 319,542 |
| 14 | kai shields 600 PILE-IN approve | kai | [0x75e24096…](https://testnet.snowtrace.io/tx/0x75e240964dd93e96109589a664fcf5aa45b9d1e28a678370c021e241809dbdc0) | 45,936 |
| 15 | kai shields 600 PILE-IN | kai | [0xa38cda41…](https://testnet.snowtrace.io/tx/0xa38cda41582c70846a8c1d443d0eb80811de6508f228793da39cef7fbff46e76) | 653,549 |
| 16 | kai sends PILE-IN to oto privately | kai | [0xbd167cc5…](https://testnet.snowtrace.io/tx/0xbd167cc59c65aff309d69915f27e4a1f869baca49d0198d6774cf39106db4896) | 1,124,165 |
| 17 | oto unshields 50 PILE-IN | oto | [0x1b3c1d08…](https://testnet.snowtrace.io/tx/0x1b3c1d08018ea946b4a4203c1fb082df4ba7db6bf25f96dcbff9a248644bbe9e) | 774,576 |
| 18 | oto redeems 10 unshielded PILE-IN | oto | [0x8da09217…](https://testnet.snowtrace.io/tx/0x8da09217371ef10e90b597e8e6259f784a540d4fcfb41c00085659389961f02f) | 112,242 |
| 19 | oto shields 60 SPROUT approve | oto | [0x2220253b…](https://testnet.snowtrace.io/tx/0x2220253bf981e306ce43b086130e7519a61b2f2ddf39a14795f92ae648907e0b) | 45,924 |
| 20 | oto shields 60 SPROUT | oto | [0x33aa4c86…](https://testnet.snowtrace.io/tx/0x33aa4c860bace8339c5c43b0acf7b4c214650fa9941acf98810743e200a930ab) | 617,805 |
| 21 | oto sends SPROUT to mira privately | oto | [0x3a8bcba9…](https://testnet.snowtrace.io/tx/0x3a8bcba9443fab695be9dc737eb353b4801f6a9aaa9ed69927c268e13875418d) | 1,124,189 |
| 22 | mira unshields 10 SPROUT | mira | [0x84885bf7…](https://testnet.snowtrace.io/tx/0x84885bf785d5da8077d4890e7614e4b56b2940697e0578194c82c486c699212d) | 760,745 |
| 23 | mira sells 5 unshielded SPROUT | mira | [0x730fc8ee…](https://testnet.snowtrace.io/tx/0x730fc8ee44794003fe48a77153565ea9a12a6b5653d9bb67ad8e7b1a71534e09) | 136,080 |
| 24 | mira shields 30 BALLOONS approve | mira | [0x6ea3a2fc…](https://testnet.snowtrace.io/tx/0x6ea3a2fc0ed8bee765d4485c8b4f24e169ddcc94fd4b066b7502da15933be090) | 45,924 |
| 25 | mira shields 30 BALLOONS | mira | [0x152721db…](https://testnet.snowtrace.io/tx/0x152721dba1256719b26b94305ed8e19a63980cbe6ef314198e888b99d70d7b1f) | 613,162 |
| 26 | oto shields 40 GLOW-UP approve | oto | [0x68ff19b1…](https://testnet.snowtrace.io/tx/0x68ff19b1c7b8ec08973ec31bde383537188794194919cb1daab923c498e45537) | 45,924 |
| 27 | oto shields 40 GLOW-UP | oto | [0x5781d168…](https://testnet.snowtrace.io/tx/0x5781d168d2a98ca6d78c56efc80a91d2cf905539a992ac29572b0b8868eae90c) | 608,843 |

### v1.0 run: one full flow from the web app (12/12 succeeded)

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

### Seeded on Fuji (104 transactions, 0 failed)

Three test accounts (mira, kai, oto) created and funded by `scripts/fuji/fund.ts`; every call made by `scripts/fuji/seed.ts`, `seed-more.ts` and `seed-v2.ts`.

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
| 56 | create post sunset-dump | oto | [0x48e8a35f…](https://testnet.snowtrace.io/tx/0x48e8a35fe95ecbdea68706d73dedec109dc30dd9ce54592957015b2202e1861c) | 0.96 s | 2.09 s |
| 57 | create post glow-up | mira | [0xf925f4a1…](https://testnet.snowtrace.io/tx/0xf925f4a1b5ab52e0a160b85501aa7454f2ba1c4de6bae120fc31cf8625a3ee1b) | 0.90 s | 2.32 s |
| 58 | sunset-dump sealed bid mira | mira | [0x9bf4ef4d…](https://testnet.snowtrace.io/tx/0x9bf4ef4d734fbf11e78ff2e4237721b2941016fd462efa11b283be91b4697db0) | 0.19 s | 1.41 s |
| 59 | sunset-dump sealed bid kai | kai | [0x14f70a7e…](https://testnet.snowtrace.io/tx/0x14f70a7eeb82508432f81d8a895c05c70a082a4bfa78cc33f7b5429e134bf1a0) | 0.14 s | 1.60 s |
| 60 | glow-up sealed bid oto | oto | [0x4f9af054…](https://testnet.snowtrace.io/tx/0x4f9af054ee5940e1c6f89db5149d1fae7a90752fabda8cb5b8891ba8f931dd10) | 0.01 s | 1.37 s |
| 61 | glow-up sealed bid kai | kai | [0xf4e3cdb9…](https://testnet.snowtrace.io/tx/0xf4e3cdb9c2649d832bc18365db6548e15ca8eb6d19069d665bb9a1f54db8c749) | 0.10 s | 1.84 s |
| 62 | sunset-dump reveal mira | mira | [0x9c93bfdf…](https://testnet.snowtrace.io/tx/0x9c93bfdf72a48a6efe2cb9f586fe397095c0a9b30ead4ddcb21dc757f199ba04) | — | 1.61 s |
| 63 | sunset-dump reveal kai | kai | [0xf0f0a030…](https://testnet.snowtrace.io/tx/0xf0f0a0309c098309346e2c63d070338d7d8716397de9472ce04818c57cc42b34) | 0.12 s | 1.62 s |
| 64 | glow-up reveal oto | oto | [0x39e6a7c5…](https://testnet.snowtrace.io/tx/0x39e6a7c51e05a96c216a4de92514210dba113e9f72a328f9141584df269c6de8) | 0.56 s | 2.09 s |
| 65 | glow-up reveal kai | kai | [0x75dce533…](https://testnet.snowtrace.io/tx/0x75dce533b3c930f2e655357bc19a3ec70efae925462ad712213cfbf579157d97) | 0.74 s | 2.08 s |
| 66 | sunset-dump settle | oto | [0x2d574d2b…](https://testnet.snowtrace.io/tx/0x2d574d2b436af106318d7ea54f724e445cf29749a445569278533fdaceb7b72f) | 0.18 s | 1.63 s |
| 67 | sunset-dump refund mira | mira | [0x0a5f8ad6…](https://testnet.snowtrace.io/tx/0x0a5f8ad6b7bbb3f2788069fff4c2765d2c7fb60f548c1b93bed2dee704a008d8) | 0.70 s | 2.09 s |
| 68 | sunset-dump refund kai | kai | [0x582944c8…](https://testnet.snowtrace.io/tx/0x582944c8047d51d32eb37a49757edf9400c6ff6160ee4c8ce1af5911ea8458c3) | 0.18 s | 1.85 s |
| 69 | sunset dump buy 20 | mira | [0x7e62f2a4…](https://testnet.snowtrace.io/tx/0x7e62f2a42f841990c1088aeac522dd9e16848ac71e91d7ef6127a61696429780) | 0.53 s | 1.85 s |
| 70 | sunset dump buy 12 | kai | [0x45bf569c…](https://testnet.snowtrace.io/tx/0x45bf569c39b1122954cb14a760c4ec9ad6674f8b96bcd64072f8d324712ae237) | 0.68 s | 60.36 s |
| 71 | glow-up settle | mira | [0x564de254…](https://testnet.snowtrace.io/tx/0x564de254314c4afcf181b8a9944df63b9b1eeb19a1bbb60489dcafbf3fa20e14) | 0.39 s | 2.08 s |
| 72 | glow-up refund oto | oto | [0xb348699a…](https://testnet.snowtrace.io/tx/0xb348699ac418d4a121daf506ccbf6591b0c549fb9df8fa95489f02a7147be946) | 0.19 s | 1.61 s |
| 73 | glow-up refund kai | kai | [0x9d405227…](https://testnet.snowtrace.io/tx/0x9d4052276c4268592116a36066a9dc80b4ba2b3bd63c1f1f8832bce865980cd6) | 0.15 s | 1.62 s |
| 74 | glow up buy 25 | oto | [0xf498678e…](https://testnet.snowtrace.io/tx/0xf498678e89a3a4ab96f51166350448bc24eb97d3d81d8cb82c51cfae97bc96d8) | 0.20 s | 1.85 s |
| 75 | glow up sell 5 | oto | [0x66f42f2c…](https://testnet.snowtrace.io/tx/0x66f42f2c4a2fe711371a8972749f0c0dfb1b7b1c424e2c995c16162a099536c4) | 0.13 s | 1.61 s |
| 76 | create post night-market | kai | [0x617f0995…](https://testnet.snowtrace.io/tx/0x617f09950994f9c8c42873d68bbea267f5c8b852d07ffaf577ade5947a2e1214) | 0.77 s | 2.32 s |
| 77 | create post first-ollie | oto | [0x91d2cb6d…](https://testnet.snowtrace.io/tx/0x91d2cb6d8e7509a1aa7bf3b75e1bd98ea26ddbce8175591881fc2e83625ce562) | 0.08 s | 1.36 s |
| 78 | create post coffee-run | mira | [0x17707649…](https://testnet.snowtrace.io/tx/0x17707649594007ae14e49e911935386ec9b59d4bff2fe199c6e83b02d5e0d95d) | 0.36 s | 1.63 s |
| 79 | night-market sealed bid oto | oto | [0x6c1a7654…](https://testnet.snowtrace.io/tx/0x6c1a7654d34b1eb0e94688847e20fae295c4fe51a20b8cc99fee6d4fa45327be) | 0.35 s | 1.68 s |
| 80 | night-market sealed bid mira | mira | [0xff7ef799…](https://testnet.snowtrace.io/tx/0xff7ef7996393f88c78834b8b070bf8edaac477cd1f9755f229612c85093629bd) | 0.32 s | 1.88 s |
| 81 | first-ollie sealed bid kai | kai | [0x4ded3c09…](https://testnet.snowtrace.io/tx/0x4ded3c09595a3b8a9db05cf9cd3bbfaafe8b039b0db94eb5baee1012a44c946b) | 0.09 s | 1.36 s |
| 82 | first-ollie sealed bid mira | mira | [0xf2f2f5c4…](https://testnet.snowtrace.io/tx/0xf2f2f5c492c6791f7bce3a43665487c33b210505644591a084064780921c45d7) | 0.58 s | 2.09 s |
| 83 | coffee-run sealed bid kai | kai | [0x010daa96…](https://testnet.snowtrace.io/tx/0x010daa96fdbb9029670f197f4459e4cf33615483765eddbce82e510c6b8cba78) | 0.15 s | 1.61 s |
| 84 | night-market reveal oto | oto | [0x42eb1f5d…](https://testnet.snowtrace.io/tx/0x42eb1f5de52d88c8f1b92507b5d5ae1e9386ac73b44da9b0c028beb503b9c1c5) | 0.57 s | 2.09 s |
| 85 | night-market reveal mira | mira | [0xcc5ead8a…](https://testnet.snowtrace.io/tx/0xcc5ead8a11cf685c41b8427c715eb550860640364903d2e84bc1253c45aa3a41) | 0.14 s | 1.62 s |
| 86 | first-ollie reveal kai | kai | [0x0ce0fcfa…](https://testnet.snowtrace.io/tx/0x0ce0fcfa4e197866c72d6495795f565d0c1fc6046855396d3ce96d600fcbf1e5) | 1.08 s | 2.33 s |
| 87 | first-ollie reveal mira | mira | [0x145d0ce9…](https://testnet.snowtrace.io/tx/0x145d0ce9950a0046ae3651d31b555b8549005c49815726b5045b71da31758bc0) | — | 1.61 s |
| 88 | coffee-run reveal kai | kai | [0x7b9921f1…](https://testnet.snowtrace.io/tx/0x7b9921f1c6d99b934187e1d0390d79d060220d85f82a2e8d81ab43320dc5522f) | 0.19 s | 1.61 s |
| 89 | night-market settle | kai | [0xaa327be7…](https://testnet.snowtrace.io/tx/0xaa327be7718ab3898f973e9f420d2ba0a89af8c6c046a656f10de1ba7dead6d5) | 0.86 s | 2.10 s |
| 90 | night-market refund oto | oto | [0x11b6a8cf…](https://testnet.snowtrace.io/tx/0x11b6a8cfa2ca6e477314a74c0d082a46bbbef817ad17c86ba35528c65166f482) | 0.41 s | 1.86 s |
| 91 | night-market refund mira | mira | [0xd6e59406…](https://testnet.snowtrace.io/tx/0xd6e594068043005b83d2196fd71ecb2c212b5c4aafe010aca320b4aba58ec206) | 0.20 s | 1.62 s |
| 92 | night market buy 15 | mira | [0x28ff5cbf…](https://testnet.snowtrace.io/tx/0x28ff5cbfa8fcacdec0e58d0e6c1a6ef5a0ff6283e267072425109d6027cf827e) | 0.95 s | 2.12 s |
| 93 | night market buy 30 | oto | [0xa81e883c…](https://testnet.snowtrace.io/tx/0xa81e883c91f361655ef50f531e1abcfda79616771366ea1a723cb111e0a99cff) | 0.71 s | 2.10 s |
| 94 | night market sell 4 | mira | [0x4089ecf0…](https://testnet.snowtrace.io/tx/0x4089ecf029e4efe2d82e59f1cf8a46e3a3f8490fa390eafeed6fc64de80048a4) | 0.77 s | 2.10 s |
| 95 | first-ollie settle | oto | [0x7a26c340…](https://testnet.snowtrace.io/tx/0x7a26c340732c7631d211f2ab55fd147cf93514ca89f24d86c628e46264aaf38d) | 0.04 s | 1.37 s |
| 96 | first-ollie refund kai | kai | [0x2ce6af1b…](https://testnet.snowtrace.io/tx/0x2ce6af1b67b5522d66c72d7dbf04ea5fdf85b8be081a51df1a5d842529252854) | 0.30 s | 1.84 s |
| 97 | first-ollie refund mira | mira | [0xd594634f…](https://testnet.snowtrace.io/tx/0xd594634f2219d7f1b9bb44833e582fa3c1eadff565f5496fae494fd379ab8530) | 0.31 s | 1.62 s |
| 98 | first ollie buy 40 | kai | [0x9f4417c3…](https://testnet.snowtrace.io/tx/0x9f4417c3b7ee3603f7965d01b0de9f2c1d300014f1fc8e9fb1f3f36fd3e4417f) | 0.28 s | 1.62 s |
| 99 | first ollie buy 10 | mira | [0x42d319e3…](https://testnet.snowtrace.io/tx/0x42d319e39d2eef964e1d85878e330713c0342f75c38dbfaec18370ca9c958b2e) | 0.14 s | 1.62 s |
| 100 | coffee-run settle | mira | [0xdcfd6559…](https://testnet.snowtrace.io/tx/0xdcfd6559dc6c8eb2008b453c4b4bdd70bba78e3409b81d9ef32fa1cfdf2d2b4e) | 0.18 s | 1.61 s |
| 101 | coffee-run refund kai | kai | [0x2eb2882f…](https://testnet.snowtrace.io/tx/0x2eb2882fa904e7edfeaad8a6fbd0735973c269284106cfca7827422a4cf2cc56) | 0.15 s | 1.61 s |
| 102 | coffee run buy 22 | oto | [0x6ad554f9…](https://testnet.snowtrace.io/tx/0x6ad554f9939dff0f4b29d82435102ff2081c382fad40f56b8bc7d6b5a23c5391) | 0.23 s | 1.61 s |
| 103 | coffee run buy 8 | kai | [0x0601b068…](https://testnet.snowtrace.io/tx/0x0601b0689768d8919086123ccb74c3936570f3789dc81867d80c4dd79dea0fd4) | 0.99 s | 2.34 s |
| 104 | coffee run redeem 5 | kai | [0xb9eb2579…](https://testnet.snowtrace.io/tx/0xb9eb2579940186736965d575d1eba10d45643f972e13964af16cf766252bc2a6) | 0.15 s | 1.38 s |

Across the 104 seeded transactions: median **0.25 s** from broadcast to a final block (p90 0.77 s, over the 100 where this machine's clock was not ahead of the block's), and 1.84 s until the public RPC returned the receipt (p90 2.11 s). "Final block" is the including block's `timestampMilliseconds` minus this machine's clock at broadcast.

### Superseded: v1

A first factory, [`0x44b3f36175d7426218a9fcac9ab5eb6f8444e758`](https://testnet.snowtrace.io/address/0x44b3f36175d7426218a9fcac9ab5eb6f8444e758), ran 50 seed transactions and 10 steps of the web flow before a design flaw showed in its own chart: a curve buy right after the auction could undercut the auction's clearing price. v2 (above) prices every buy at the highest of the curve, the floor and the clearing price. The test AVAX in v1 was recovered by redeeming (15 transactions). All v1 transactions are kept in `deployments/fuji.json` → `v1`.

<!-- EVIDENCE:END -->

All of the above is in [deployments/fuji.json](deployments/fuji.json), with gas used, blocks and timings per transaction.

## The app (`web/`)

The Juno Expo Router app, exported as a static web build (`expo export --platform web`), served by any static host with a single-page fallback (`web/vercel.web.json`).

- **Reads:** `web/lib/api.ts` reads the factory's `posts()`, then each post's `market()`, `trades()` and `holders()` through `@juno/sdk` (viem, JSON-RPC batched, two public Fuji RPCs with fallback). Buy quotes come from the contract's `quoteBuy`; sell and redemption quotes from the SDK's mirror of the contract maths.
- **Writes:** `web/lib/wallet.tsx` encodes each call, **simulates it against Fuji with `eth_call` first** (so a refusal shows the contract's reason, mapped to plain words, before the wallet opens), sends it through the person's wallet, and follows it to a receipt, timing it (`lib/tx-status.ts`, `lib/finality.ts`).
- **Screens:** feed (bump order: live auctions first, then latest trade), reels, coin page (chart, auction card with countdown and phase track, floor, graduation, dare card with proof/vote/finalize, activity, holders, details), trade sheet (buy / sell / redeem with a numpad and live quote), launch flow, profile with positions and P&L from the fill logs, trader pages and a leaderboard.
- **Private bags:** `web/lib/vault.ts` reads the vault (token list, the vault's ERC-20 balance per coin, Register/Deposit/Withdraw/PrivateTransfer logs in 49,000-block windows, each bag's ciphertext). `web/lib/prover.web.ts` loads the snarkjs browser build and the circuits from `/eerc/`, which `scripts/copy-eerc-assets.mjs` copies from the pinned submodule at export time with a SHA256SUMS file.
- **Missing values** show "Setup required: NAME". Empty, loading and error states are drawn, nothing is mocked; likes and follows have no contract and are kept on the device only.
- **QA signer:** a web build made with `EXPO_PUBLIC_QA_SIGNER=1` (`dist-qa/`, never deployed) swaps the browser wallet for a signer that only runs on a local port, only signs Juno calls on Fuji (plus the eERC key message for its own account and the four vault calls), and stops at 0.015 test AVAX. A production build refuses to import it (`metro.config.js`).

## Repository

```
contracts/   Foundry: JunoFactory, JunoPost, CurveMath + 70 tests (auction, curve, dare, factory, attacks, invariant)
             lib/EncryptedERC: Ava Labs' eERC, pinned submodule (Ecosystem License), built by FOUNDRY_PROFILE=eerc
sdk/         @juno/sdk: viem reads, ABIs, the contract maths in TypeScript; @juno/sdk/eerc: eERC client crypto
web/         the Juno app (Expo Router, static web export)
scripts/     Fuji keys, funding, deploy, seeding, the web QA flows, evidence tables
             eerc/ (vault deploy, Anvil end-to-end), mainnet/ (guarded deploy), icm/ (relayer probe)
deployments/ fuji.json: addresses and every recorded transaction
docs/        SLIDES.md, WIN-GAP.md
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

**v2.0 (same day, from tag `v1.0`):** the eERC vault (Hide your bag) with its SDK, Anvil test, Fuji deployment, web screen and browser proving; the mainnet deploy script and runbook; the ICM probe; QA runs at 1440 and 375; three more seeded posts; the JSON-RPC batch fix. `git log v1.0..HEAD`.

## Hackathon disclosures

Built for **Build Anything on Avalanche** (Team1 India Speedrun, Nov 2026).

AI tools: built with AI coding agents (Claude Code) under human direction. The eERC contracts and circuits are Ava Labs' own, used unchanged; the 3D art kit was generated earlier with ChatGPT images. All code reviewed and tested; see TESTING.md.

## License

MIT. Copyright (c) 2026 Nivesh Gajengi. See [LICENSE](LICENSE).
