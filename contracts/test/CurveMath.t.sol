// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "../src/CurveMath.sol";

contract CurveHarness {
    function cost(uint256 sold, uint256 q, bool up) external pure returns (uint256) {
        return CurveMath.rangeCost(sold, q, up);
    }
}

contract CurveMathTest is Test {
    CurveHarness internal h = new CurveHarness();
    uint256 internal constant WAD = 1e18;

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x < 2) return x;
        uint256 bits;
        for (uint256 y = x; y > 0; y >>= 1) ++bits;
        uint256 r = 1 << ((bits + 1) / 2);
        while (true) {
            uint256 next = (r + x / r) / 2;
            if (next >= r) return r;
            r = next;
        }
    }

    /// The constant table is exactly what the Rust/TypeScript table() routine produces.
    function test_tableMatchesReferenceRoutine() public pure {
        uint256 root = 100 * WAD;
        for (uint256 i; i < 4; ++i) root = _sqrt(root * WAD);
        uint256[17] memory p = CurveMath.prices();
        uint256 expected = CurveMath.BASE;
        assertEq(p[0], expected);
        for (uint256 i = 1; i <= 16; ++i) {
            uint256 rem = root % WAD;
            expected = expected * (root / WAD) + (expected / WAD) * rem + (expected % WAD) * rem / WAD;
            assertEq(p[i], expected);
        }
        uint256[16] memory s = CurveMath.sizes();
        uint256[16] memory w = [uint256(1000000), 1200000, 1440000, 1728000, 2073600, 2488320, 2985984, 3583181, 4299817, 5159780, 6191736, 7430084, 8916100, 10699321, 12839185, 15407022];
        uint256 used;
        for (uint256 i; i < 15; ++i) {
            assertEq(s[i], 800 * w[i] / 87442130);
            used += s[i];
        }
        assertEq(s[15], 800 - used);
    }

    /// Golden values shared with sdk/test/math.test.ts.
    function test_goldenValues() public view {
        assertEq(h.cost(0, 1, true), 1018528968454);
        assertEq(h.cost(799, 1, true), 99916631402986);
        assertEq(h.cost(100, 25, true), 185394639883688);
        assertEq(h.cost(0, 800, true), 33490274361308394);
        assertEq(h.cost(0, 800, false), 33490274361308387);
        assertEq(h.cost(37, 63, true), 282617858392656);
    }

    function test_rejectsEmptyAndOverflowingRanges() public {
        vm.expectRevert(CurveMath.Quantity.selector);
        h.cost(0, 0, true);
        vm.expectRevert(CurveMath.Quantity.selector);
        h.cost(799, 2, true);
    }

    function testFuzz_roundingNeverFavoursTheTrader(uint256 sold, uint256 q) public view {
        sold = bound(sold, 0, 799);
        q = bound(q, 1, 800 - sold);
        assertLe(h.cost(sold, q, false), h.cost(sold, q, true));
    }

    /// Selling a range back in pieces never pays more than buying it in one go cost.
    function testFuzz_splitSellsNeverBeatOneBuy(uint256 sold, uint256 q, uint256 cut) public view {
        sold = bound(sold, 0, 798);
        q = bound(q, 2, 800 - sold);
        cut = bound(cut, 1, q - 1);
        uint256 whole = h.cost(sold, q, true);
        uint256 pieces = h.cost(sold, cut, false) + h.cost(sold + cut, q - cut, false);
        assertLe(pieces, whole);
    }

    function test_priceRisesMonotonically() public view {
        uint256 last;
        for (uint256 s; s < 800; s += 7) {
            uint256 c = h.cost(s, 1, true);
            assertGe(c, last);
            last = c;
        }
    }
}
