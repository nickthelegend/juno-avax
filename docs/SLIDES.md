# Juno on Avalanche — slides (10)

Speaker notes are under each slide. Every number on a slide comes from
`deployments/fuji.json` or the live app; nothing is projected.

---

## 1. Every post is a coin.

Post a photo on Juno and it launches its own coin on Avalanche: a one-minute
sealed-bid opening, a bonding curve in AVAX, and a floor every holder can
always redeem.

Visual: the feed at 375 px, the ROOFTOP post with its floor chip.

> Notes: one line on who it is for — people who post, and people who back
> the posts they believe in.

---

## 2. Launches are a sniping contest. Exits can be a cliff.

- On a normal launchpad the first transaction wins: bots buy block one and
  sell to everyone after them.
- When the hype goes, holders find no buyer at any price.

> Notes: plain words; no jargon. Both are real problems on pump.fun-style
> launchpads, which is the category Juno sits in.

---

## 3. One price for the first minute.

- For 60 seconds anyone can bid. A bid is a hash plus the same 0.005 AVAX
  escrow for everyone, so nobody can read or copy it.
- 60 seconds to reveal, then anyone settles: highest prices fill first and
  every winner pays the same clearing price.
- A bid copied from the mempool cannot be revealed: the hash binds the post,
  the chain and the bidder.

Visual: the auction card mid-countdown (Bid → Reveal → Settle → Trade).

> Notes: the opening uses commit-reveal, because a clearing-price auction has to read every bid. eERC hides something else: the holder's bag (slide 6).

---

## 4. A floor you can always redeem.

- Half the auction raise and 20% of every curve buy go into the post's vault.
- The curve never sells below the auction's clearing price, so winners are not undercut a block later.
- Any holder burns tokens for 99% of their share, any time, even after
  graduation. The 1% left behind raises the floor for everyone else.
- A buy never prices below the floor, so buy-then-redeem always loses (fuzzed).

Visual: PILE-IN's coin page: graduated, its floor per token.

---

## 5. Dares put the creator's money where their mouth is.

- The creator stakes AVAX on a promise and posts proof.
- Holders vote, weighted by what they hold when the dare closes.
- Proof holds → bond back. Flake → the bond goes into the holders' floor.

Visual: ROOFTOP's dare card — bond, proof, vote bar, "Holders accepted".

---

## 6. Hide your bag.

- Every post coin is a public ERC-20, so whale-watchers and copy-trade bots can read who holds how much.
- Shield any post coin into the Juno eERC vault (Ava Labs' EncryptedERC, converter mode). Your balance becomes an ElGamal ciphertext. Send part of it privately to another holder, and unshield to sell or redeem.
- What stays public is said plainly: the amounts you shield and unshield. What happens inside the vault is hidden, except from the auditor, whose key every proof must encrypt to.
- The proofs are built in the browser (snarkjs and the production zkeys). One signature opens your key, and Juno never stores it.

Visual: /vault with the Public view (PILE-IN 63% of supply in private bags), then Your bag (decrypted), then the Auditor view (transfer amounts).

> Notes: the whale kai shielded 600 PILE-IN and slipped 150 to oto. The public sees a transfer with no amount.

---

## 7. Live on Fuji, end to end.

- JunoFactory (verified on Snowtrace), the eERC vault, 10 seeded posts plus the posts launched from the web app. The app reads all of it live.
- Every seeded transaction is recorded with its timing (README tables).
- Driven through the web app in headless Chrome at 1440 px and at 375 px: launch, bid, reveal, settle, refund, buy, sell, redeem, proof, vote, finalize, claim. Then register, shield, send privately, unshield and the auditor view.

Visual: the Snowtrace pages of the factory and the vault, and the tx tables from the README.

---

## 8. Why Avalanche: what is real, and what is not.

- **Real:** sub-second finality, measured on every trade from broadcast to a final block (by the block's own millisecond timestamp).
- **Real:** eERC. Ava Labs' EncryptedERC, unchanged and pinned, with an auditor, used for private bags.
- **Real:** C-Chain contracts, Core wallet first (EIP-6963), a mainnet deploy script with its cost read from mainnet (not deployed).
- **Probed, not claimed:** ICM. One Teleporter message from Fuji reached Echo through the public relayer, but no ICM/ICTT feature ships.

---

## 9. Built properly.

- 70 Forge tests: auction, curve, floor, dare, factory, attacks and a solvency invariant.
- 26 eERC checks on Anvil with real proofs and the production verifiers: replayed, tampered, wrong-sender and wrong-chain proofs all refused.
- Every call is simulated against Fuji before the wallet opens.

---

## 10. What's next

- Mainnet C-Chain (the script and runbook are ready, and the auditor is a product decision), and Core mobile.
- Graduated coins on other Avalanche L1s through ICTT.
- Try it: the hosted app link · repo · Snowtrace links.

> Notes: end on the live app, not a slide.
