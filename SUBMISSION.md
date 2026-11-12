# Submission — Build Anything on Avalanche (Team1 India Speedrun)

Deadline: Nov 14, 2026 22:59 UTC. Nick submits; nothing here has been submitted.

## Project name

Juno

## One-liner

Every post is a coin: a social feed on Avalanche where each photo launches its own coin with a one-minute sealed-bid opening at one price, a bonding curve, and a floor every holder can always redeem.

## Full description

Meme-coin launchpads have two problems people feel straight away. Launches are a sniping contest: bots buy the first block and sell to everyone after them. And exits can be a cliff: when the hype fades there is no buyer at any price.

Juno is a social app where every post is a coin, built so that neither happens.

- **One price for the first minute.** A new post opens with a 60-second sealed-bid auction. A bid is a hash plus the same 0.005 AVAX escrow for everyone, so nobody — not the creator, not a bot reading the mempool — can see or copy it; the hash binds the post, the chain and the bidder. After a minute of reveals anyone settles it, and every winner pays the same clearing price however early they bid.
- **A floor you can always redeem.** Half the auction raise and 20% of every buy go into the post's own vault. Any holder can burn tokens for 99% of their share at any time, even after the post sells out. A buy never prices below that floor.
- **Graduation that protects holders.** When the 800-token curve sells out, everything it raised moves into the floor.
- **Dares.** A creator can stake AVAX on a promise. Holders vote on the proof; if the creator flakes, the bond goes into the holders' floor.

It runs on the Avalanche Fuji C-Chain end to end: a JunoFactory deploys one contract per post (the ERC-20, the auction, the curve, the vault and the dare). The web app reads everything from the contracts with no server or indexer, signs with the person's own wallet (Core first), simulates every call before the wallet opens, and shows how long Avalanche took to make each transaction final — measured from broadcast to the block's own millisecond timestamp.

Live on Fuji: the factory (source verified on Snowtrace), 7 seeded posts plus the posts launched from the web app, 75 seeded transactions from three test accounts (median 0.24 s from broadcast to a final block), and one full flow driven through the web app (launch, bid, reveal, settle, refund, buy, sell, redeem, proof, vote, finalize, claim).

## Tech stack

- **Avalanche C-Chain (Fuji, 43113):** Solidity 0.8.28 contracts (Foundry, OpenZeppelin ERC-20 and ReentrancyGuard), deployed with viem; factory source verified on Snowtrace (Routescan verifier).
- **Avalanche finality in the product:** every trade shows its measured time to a final block (Granite block headers' `timestampMilliseconds`) and to a readable receipt; the app reads Fuji's live block cadence from headers.
- **Wallets:** EIP-6963 discovery with Core listed first, `wallet_switchEthereumChain` / `wallet_addEthereumChain` for Fuji.
- **App:** Expo Router (React Native for web), static export; viem for reads and calldata; `@juno/sdk` mirrors the contract maths.
- **Not used:** eERC (an auction must read bids to clear them; eERC amounts are decryptable only by the owner and auditor — commit-reveal does the hiding instead), ICM/ICTT (no second chain needed), mainnet, own L1.

## Links

- Repo: (GitHub link — Nick to push)
- Live app: (Vercel link — orchestrator deploys after review)
- Demo video (≤ 3 min): (to record)
- Slides: `docs/SLIDES.md`
- JunoFactory on Snowtrace: https://testnet.snowtrace.io/address/0xac736951c75e849e7db40b333cc0dff2baf88539
- Factory deploy tx: https://testnet.snowtrace.io/tx/0xdc72b603c6ab6c4f80aa2db93ad74918216b89a6e21ce6a52cc5c020db712d5c
- Graduated post PILE-IN: https://testnet.snowtrace.io/address/0x035a2CF4714fedce1A80AC2790442B2912823b91
- Dare post ROOFTOP (accepted): https://testnet.snowtrace.io/address/0xda23789f6D450793093Bf079c1Dc3B94D0aFce9B
- Dare post NIGHT-SWIM (flaked, bond into the floor): https://testnet.snowtrace.io/address/0x48FCE68864116bA594Ae8C7412759F8BE86E1026
- Every transaction: `deployments/fuji.json` and the tables in README.md

## AI tools used

- **Claude Code** — wrote the Solidity contracts and tests, the SDK, the Fuji scripts, the EVM port of the app and the docs, under human direction.
- **Codex** — used on the earlier Juno builds whose app this reuses.
- **ChatGPT images** — the 3D object kit and post art (generated for the earlier Juno builds and reused).

## Prior work

Juno existed before the Speedrun on Solana, Arbitrum, Monad, Arc, Robinhood Chain and NEAR; the app and the auction/floor/dare mechanics are reused from those builds. What was built during the Speedrun is listed in README.md → "What existed before the Speedrun".
