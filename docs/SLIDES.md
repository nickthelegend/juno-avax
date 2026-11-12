# Juno on Avalanche — slides (9)

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

> Notes: say plainly this is commit-reveal, not eERC (slide 7).

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

## 6. Live on Fuji, end to end.

- JunoFactory (verified on Snowtrace) and six posts, all read live by the app.
- Every seeded transaction from three test accounts recorded with its timing (README tables).
- One full run driven through the web app in headless Chrome: launch, bid,
  reveal, settle, refund, buy, sell, redeem, proof, vote, finalize, claim.

Visual: the Snowtrace page of the factory and the tx table from the README.

---

## 7. Why Avalanche — what is real, and what is not.

- **Real:** sub-second finality, measured on every trade: time from broadcast
  to a final block (by the block's own millisecond timestamp) and to a
  readable receipt. The seeded run's medians are in the README.
- **Real:** C-Chain contracts, Core wallet first (EIP-6963), Fuji throughout.
- **Not used:** eERC. An auction must read bids to clear them; eERC amounts
  can only be decrypted by their owner and the auditor. Commit-reveal does
  the hiding instead.
- **Not used:** ICM/ICTT. No second chain was needed for this product.

---

## 8. Built properly.

- 70 Forge tests: auction, curve, floor, dare, factory, attacks (reentrancy,
  reveal mismatch, late bids, copied commitments, floor drain) and a
  solvency invariant over 2,560 random calls.
- Shared golden values between Solidity and the TypeScript SDK.
- Every call is simulated against Fuji before the wallet opens.

---

## 9. What's next

- Mainnet C-Chain deployment and Core mobile.
- Graduation into a DEX pool next to the floor.
- Try it: the hosted app link · repo · Snowtrace factory link.

> Notes: end on the live app, not a slide.
