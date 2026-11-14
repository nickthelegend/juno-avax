# Submission — Build Anything on Avalanche (Team1 India Speedrun)

Deadline: Nov 14, 2026 22:59 UTC. Nick submits; nothing here has been submitted.

## Project name

Juno

## One-liner

Every post is a coin: a social feed on Avalanche where each photo launches its own coin with a one-minute sealed-bid opening at one price, a floor every holder can always redeem, and eERC private bags so whales and bots can't see who holds what.

## Full description

Meme-coin launchpads have two problems people feel straight away. Launches are a sniping contest: bots buy the first block and sell to everyone after them. And exits can be a cliff: when the hype fades there is no buyer at any price.

Juno is a social app where every post is a coin, built so that neither happens.

- **One price for the first minute.** A new post opens with a 60-second sealed-bid auction. A bid is a hash plus the same 0.005 AVAX escrow for everyone, so nobody — not the creator, not a bot reading the mempool — can see or copy it; the hash binds the post, the chain and the bidder. After a minute of reveals anyone settles it, and every winner pays the same clearing price however early they bid.
- **A floor you can always redeem.** Half the auction raise and 20% of every buy go into the post's own vault. Any holder can burn tokens for 99% of their share at any time, even after the post sells out. A buy never prices below that floor.
- **Graduation that protects holders.** When the 800-token curve sells out, everything it raised moves into the floor.
- **Dares.** A creator can stake AVAX on a promise. Holders vote on the proof. If the creator flakes, the bond goes into the holders' floor.
- **Hide your bag.** Every post coin is a public ERC-20, so whale-watchers and copy-trading bots can read exactly who holds how much. Juno adds a private vault built on Ava Labs' eERC (EncryptedERC, converter mode). A holder signs once to open a key on their device, registers it with a zero-knowledge proof built in the browser, and shields any post coin into an encrypted balance. From there they can send part of it privately to another holder and unshield to sell or redeem. The public sees the vault, not the holder. Transfer amounts are hidden from everyone except the two parties and an auditor, whose key every proof must encrypt to. The app shows all three views side by side, and says plainly what stays public: the amounts shielded and unshielded.

- **Try it with nothing installed.** A judge with an empty browser taps *Juno wallet* and gets 0.008 test AVAX from Juno's own on-chain gas station (once per new wallet, signed request, daily caps on-chain) — enough to launch a post, win its sealed-bid opening, buy, sell, redeem and hide the bag. This path ran on the hosted app in a fresh browser at desktop and phone width, 11/11 transactions each.
- **Ask Juno AI.** On any coin, a Claude agent explains how the opening cleared, where the floor sits and who holds it, from live Fuji reads shown as tool chips. It reads; it never trades.
- **Tip the creator privately.** Holders can send the creator part of their bag through the eERC vault; only the two of them and the auditor see the amount.

- **Get the app.** A standalone iOS Simulator build (its own icon and splash, not Expo Go) downloads from the landing with its SHA-256 and a one-line `xcrun simctl install`. That exact zip made a wallet and traded on Fuji. Expo Go publishing is one command once Nick signs in to Expo.

It runs on the Avalanche Fuji C-Chain end to end: a JunoFactory deploys one contract per post (the ERC-20, the auction, the curve, the vault and the dare). The app (web, and iOS/Android through Expo) reads everything from the contracts with no indexer, signs with the person's own wallet (Core first) or the in-app Juno wallet, simulates every call before the wallet opens, and shows how long Avalanche took to make each transaction final — measured from broadcast to the block's own millisecond timestamp.

Live on Fuji:
- the factory (source verified on Snowtrace) and the eERC vault;
- 10 seeded posts plus the posts launched from the web app;
- 104 seeded post transactions and 27 vault transactions;
- the full post flow (launch, bid, reveal, settle, refund, buy, sell, redeem, proof, vote, finalize, claim) and the Hide-your-bag flow (register, shield, send privately, unshield, auditor view), each driven through the web app at desktop and phone width.

A mainnet deploy script is ready, with its cost read from mainnet, and has not been run.

## Tech stack

- **Avalanche C-Chain (Fuji, 43113):** Solidity 0.8.28 contracts (Foundry, OpenZeppelin ERC-20 and ReentrancyGuard), deployed with viem; factory source verified on Snowtrace (Routescan verifier).
- **Avalanche finality in the product:** every trade shows its measured time to a final block (Granite block headers' `timestampMilliseconds`) and to a readable receipt; the app reads Fuji's live block cadence from headers.
- **Wallets:** EIP-6963 discovery with Core listed first, `wallet_switchEthereumChain` / `wallet_addEthereumChain` for Fuji; the Juno wallet (device key) for a zero-setup start.
- **JunoGasStation (Fuji):** starter AVAX for brand-new wallets, signature-bound, once per wallet, daily and per-requester caps enforced on-chain; relayed by Juno's API on Vercel. 21 Forge tests + a judge-path test; 8 live API tests incl. a real drip.
- **Juno AI:** `claude-haiku-5-5` via Juno's API (key server-side only) with five read-only tools over live Fuji; 6 live tests incl. a real answer.
- **App:** Expo Router (React Native for web, Expo SDK 58), static export on Vercel, a standalone iOS Simulator build (download on the landing) and the same app in Expo Go; viem for reads and calldata; `@juno/sdk` mirrors the contract maths.
- **eERC (bonus):** Ava Labs' EncryptedERC ([ava-labs/EncryptedERC@8dc98cd](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1)), unchanged, in converter mode with production verifiers and an auditor. Our client crypto (BabyJubJub ElGamal, Poseidon ciphertexts, proof inputs) is in `sdk/src/eerc.ts`, and Groth16 proofs are built in the browser with snarkjs. 26 checks run on Anvil with real proofs, including replayed, tampered, wrong-sender and wrong-chain attacks.
- **Mainnet readiness:** `scripts/mainnet/deploy.ts` (dry run by default; a guarded broadcast for Nick to run) and `scripts/deploy-mainnet.md`. Not deployed.
- **ICM:** probed only. One Teleporter message from Fuji C-Chain reached Echo through the public relayer, but no ICM/ICTT feature ships, so none is claimed. No own L1.
- The opening auction uses commit-reveal, not eERC: a clearing-price auction must read every bid to settle it.

## Links

- Repo: (GitHub link — Nick to push)
- Live app: https://juno-avax.vercel.app (Fuji testnet)
- iOS Simulator app: https://juno-avax.vercel.app/download/Juno-iOS-Simulator.zip (SHA-256 `c32bdc8e3828fb82bbe7e991c6120d0fee57d03b3827b27e682d14bc637dd1ed`; `xcrun simctl install booted Juno.app`)
- Demo video (2:57, v9): (upload link — Nick to add). Local file: `grokbot/videos/juno-avax/juno-avax-film.mp4` (1080p) and `juno-avax-film-share.mp4` (720p, 9.7 MB). Recorded live on Fuji on Nov 13 in one take on the v4.0.1 iOS Simulator build from the landing (fresh wallet + gas, post SNAPSHOT, one-minute sealed-bid opening with two demo players, reveal, settle at one price, claim, buy, sell, redeem against the floor, each step opened on Snowtrace from the app's receipt, Ask Juno AI), plus the web app's Hide your bag (eERC shield, private send with a browser-built proof, auditor).
- Slides: `docs/SLIDES.md`
- Juno API health (gas station balance, AI configured): https://juno-avax-api.vercel.app/api/health
- JunoGasStation (source verified): https://testnet.snowtrace.io/address/0x45fdcdf64f6fa312b02b98ad248461c6a02e722a
- A judge-path drip: https://testnet.snowtrace.io/tx/0x3e9c7e612eb724c984b427cd09da5eb133328973b5a9f62fb2fd9f817c72c14a
- JunoFactory on Snowtrace: https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539
- Factory deploy tx: https://testnet.snowtrace.io/tx/0xdc72b603c6ab6c4f80aa2db93ad74918216b89a6e21ce6a52cc5c020db712d5c
- eERC vault (EncryptedERC, converter mode): https://testnet.snowtrace.io/address/0xb999d23aebb54a9f2b7e9b043e76501a4eb0aeac
- eERC Registrar: https://testnet.snowtrace.io/address/0x949a55ddff2a85ce1a1bad7c760515903dee0c93
- A private transfer (kai → oto, PILE-IN, amount hidden): https://testnet.snowtrace.io/tx/0xbd167cc59c65aff309d69915f27e4a1f869baca49d0198d6774cf39106db4896
- Graduated post PILE-IN: https://testnet.snowtrace.io/address/0x035a2CF4714fedce1A80AC2790442B2912823b91
- Dare post ROOFTOP (accepted): https://testnet.snowtrace.io/address/0xda23789f6D450793093Bf079c1Dc3B94D0aFce9B
- Dare post NIGHT-SWIM (flaked, bond into the floor): https://testnet.snowtrace.io/address/0x48FCE68864116bA594Ae8C7412759F8BE86E1026
- Every transaction: `deployments/fuji.json` and the tables in README.md

## AI tools used

- **Claude Code**: wrote the Solidity contracts and tests, the SDK (including the eERC client crypto), the Fuji, eERC, mainnet and QA scripts, the EVM port of the app, the Hide-your-bag screen, the gas station, the Juno API, the Juno wallet and the docs, under human direction.
- **Claude (claude-haiku-5-5)**: runs inside the product as Juno AI. The eERC contracts and circuits are Ava Labs' own, used unchanged.
- **Codex** — used on the earlier Juno builds whose app this reuses.
- **ChatGPT images** — the 3D object kit and post art (generated for the earlier Juno builds and reused).

## Prior work

Juno existed before the Speedrun on Solana, Arbitrum, Monad, Arc, Robinhood Chain and NEAR; the app and the auction/floor/dare mechanics are reused from those builds. What was built during the Speedrun is listed in README.md → "What existed before the Speedrun".
