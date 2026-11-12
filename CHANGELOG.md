# Changelog

All notable changes to Juno on Avalanche. Versions are local git tags. Nothing is pushed by the build agent.

## v2.1 — 2026-11-13

### Added
- **Zero-setup start.** `JunoGasStation` on Fuji ([`0x45fdcdf6…`](https://testnet.snowtrace.io/address/0x45fdcdf64f6fa312b02b98ad248461c6a02e722a), source verified): 0.008 AVAX once per brand-new wallet that signed the request, with a daily cap and a per-requester cap on-chain. 21 Forge tests and a judge-path test.
- **Juno API** (`api/`, Vercel `juno-avax-api`): `/api/gas` relays signed gas requests, `/api/ask` runs Juno AI, `/api/health`. 14 live tests.
- **Juno wallet**: a Fuji test key made on the device (localStorage on web, keychain on phones), listed in the sign-in sheet; one tap creates it and gets the starter AVAX. **Get free test AVAX** on the Profile card for any new empty wallet.
- **Juno AI**: Ask Juno AI on coin pages, `claude-haiku-5-5` with read-only Fuji tools shown as chips.
- **Tip the creator privately**: coin page row → vault with the creator picked and Send privately (eERC transfer).
- **Native app**: Expo SDK 58, runs in Expo Go; verified in the iOS Simulator with real Fuji transactions.
- `scripts/qa-hosted-judge.ts`: the zero-setup path on the hosted app; 11/11 at 1440 and 375.

### Fixed
- A shield right after its approval could be refused in simulation by a public RPC node a block behind; the wallet retries a reasonless refusal after a step it just confirmed.
- Phone: sealed-bid salts survive a reload (keychain); seeded art loads from the hosted app; the art grid had zero-height cells; sheet drags under gesture-handler 3; the Ask sheet covered only the scroll view.
- The trade sheet kept the last receipt when you switched Buy/Sell/Redeem.
- The feed card's auction figure ("200 for sale · sealed bids") overflowed its row on phones; it now reads "200 / for sale".
- "Not enough test AVAX" now points at the one-tap starter AVAX.

## v2.0 — 2026-11-12

### Added
- **Hide your bag (eERC).** Ava Labs' official EncryptedERC ([ava-labs/EncryptedERC@8dc98cd](https://github.com/ava-labs/EncryptedERC/tree/8dc98cd4d63ad3aa6d86b70b8f4bbcd70f1e8be1)) runs in converter mode on Fuji as one vault that takes any post coin. Holders register with a browser-built Groth16 proof, shield coins, send them privately with transfer proofs, and unshield to sell or redeem. The app shows the same vault three ways: the public view (vault balance per coin and ciphertext fingerprints), your bag (decrypted on the device after one signature) and the auditor's view (transfer amounts decrypted with the auditor key only).
  - `contracts/lib/EncryptedERC`: the upstream repo as a pinned submodule, built with its own Foundry profile. Upstream code is unchanged.
  - `sdk/src/eerc.ts`: wallet-signature keys, BabyJubJub ElGamal, Poseidon PCTs, balance decryption checked against the on-chain ciphertext, proof inputs and the auditor's view.
  - `scripts/eerc/local-e2e.ts`: 26 checks on Anvil with real proofs and the production verifiers, including replayed, tampered, wrong-sender and wrong-chain proofs.
  - `scripts/eerc/fuji.ts`: vault deployment plus 27 transactions (registrations, shields, two private transfers, unshields, a sell and a redeem).
  - `web/app/vault.tsx`, a "Hide your bag" row on every coin page, and the vault named in holder lists.
  - `scripts/qa-vault.ts`: register, approve, shield, private send and unshield, driven through the web app with the QA signer, followed by the auditor view.
- **Mainnet readiness.** `scripts/mainnet/deploy.ts` (a dry run by default, guarded broadcast) and `scripts/deploy-mainnet.md`, with gas and cost read from mainnet. Nothing has been deployed to mainnet.
- **ICM probe.** `scripts/icm/probe.ts` sent one Teleporter message from Fuji C-Chain to Echo, and the public relayer delivered it. No ICM or ICTT feature is claimed (see README).
- QA runs at 1440 px and 375 px for the full post flow and the vault flow. Screenshots of every route at both widths are in `orchestration/shots/avax-juno/v2/`.
- Three more seeded posts with real auctions and trades (night-market, first-ollie with a live dare, coffee-run).
- `CHANGELOG.md`, `docs/WIN-GAP.md`.

### Changed
- The QA signer may now sign the eERC key message for its own account, and call `register`, `deposit`, `transfer` and `withdraw` on the vault (with no value). It may approve a post coin only to the vault.
- Wallet simulation decodes bare custom-error selectors into plain reasons (eERC errors included).
- `pnpm test` now also runs the eERC Anvil end-to-end test.

## v1.0 — 2026-11-12

The first Speedrun build: JunoFactory and JunoPost (sealed-bid opening, curve, floor, graduation, dare) with 70 Foundry tests, the viem SDK, a Fuji deployment with source verified on Snowtrace, 75 seeded transactions, the Expo web app moved from NEAR to Avalanche, measured finality in the UI, and one 12-step flow driven through the web app.
