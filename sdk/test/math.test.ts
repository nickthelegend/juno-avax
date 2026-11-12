import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyQuote, commitment, curveCost, formatAvax, parseAvax, redeemQuote, sellQuote, spotPrice } from '../src/index.ts';

// The same golden values as contracts/test/CurveMath.t.sol.
test('curve maths matches the Solidity golden values', () => {
  assert.equal(curveCost(0n, 1n), 1018528968454n);
  assert.equal(curveCost(799n, 1n), 99916631402986n);
  assert.equal(curveCost(100n, 25n), 185394639883688n);
  assert.equal(curveCost(0n, 800n), 33490274361308394n);
  assert.equal(curveCost(0n, 800n, false), 33490274361308387n);
  assert.equal(curveCost(37n, 63n), 282617858392656n);
  assert.equal(spotPrice(800n), curveCost(799n, 1n));
});

test('buy, sell and redeem quotes', () => {
  const g = curveCost(0n, 10n);
  assert.equal(buyQuote(0n, 10n), g + g / 5n + g / 100n);
  // floor above the curve: the buy pays the floor
  const vault = 10n ** 15n, supply = 100n;
  assert.equal(buyQuote(0n, 10n, vault, supply), 10n ** 14n + 10n ** 14n / 5n + 10n ** 14n / 100n);
  assert.equal(sellQuote(10n, 10n, vault, supply), 10n ** 14n - 10n ** 12n);
  assert.equal(redeemQuote(vault, supply, 10n), 10n ** 14n - 10n ** 12n);
  // the auction's clearing price above both: the buy pays the clearing price
  const clearing = 2n * 10n ** 13n;
  assert.equal(buyQuote(0n, 10n, vault, supply, clearing), 2n * 10n ** 14n + (2n * 10n ** 14n) / 5n + (2n * 10n ** 14n) / 100n);
  assert.throws(() => curveCost(799n, 2n));
});

test('commitment matches JunoPost.commitmentOf', () => {
  // Recorded from `cast call <post> commitmentOf(...)` on a local Anvil deployment (see TESTING.md).
  const c = commitment('0xa16E02E87b7454126E5E10d957A927A7F5B5d2be', 31337, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 50n, 20_000_000_000_000n, `0x${'11'.repeat(32)}`);
  assert.equal(c, '0x42adb1f23b66f3f2aa62196259be186c897e8dfa39ca628f09ba6c471e6cadbe');
});

test('AVAX formatting round-trips', () => {
  assert.equal(formatAvax(parseAvax('1.5'), 2), '1.50');
  assert.equal(parseAvax('0.005'), 5n * 10n ** 15n);
  assert.throws(() => parseAvax('1e5'));
});
