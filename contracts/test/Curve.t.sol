// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";
import {CurveMath} from "../src/CurveMath.sol";

contract CurveTest is JunoBase {
    JunoPost internal post;

    function setUp() public override {
        super.setUp();
        post = launch(mira, "pile-in");
        bid(post, kai, 100, 20e12);
        bid(post, oto, 100, 20e12);
        toReveal(post);
        reveal(post, kai, 100, 20e12);
        reveal(post, oto, 100, 20e12);
        toSettle(post);
        post.settle();
    }

    function test_buyChargesCurveFloorShareAndFee() public {
        (uint256 total, uint256 gross, uint256 toFloor, uint256 fee) = post.quoteBuy(25);
        uint256 curve = CurveMath.rangeCost(0, 25, true);
        uint256 floorPart = (post.floorVault() * 25 + post.totalSupply() - 1) / post.totalSupply();
        // A buy never prices below the floor: right after a 20e12 auction the floor (10e12) is above the curve.
        assertEq(gross, curve > floorPart ? curve : floorPart);
        assertGt(floorPart, curve);
        assertEq(toFloor, gross / 5);
        assertEq(fee, gross / 100);
        uint256 vault = post.floorVault();
        uint256 before = eve.balance;
        vm.prank(eve);
        post.buy{value: total + 1 ether}(25); // overpay: the rest comes back
        assertEq(eve.balance, before - total);
        assertEq(post.balanceOf(eve), 25);
        assertEq(post.curveSold(), 25);
        assertEq(post.floorVault(), vault + toFloor);
        assertEq(post.curveReserve(), gross);
        assertEq(post.creatorEarnings(), fee / 2);
        assertSolvent(post);
    }

    function test_underpaidBuyReverts() public {
        (uint256 total,,,) = post.quoteBuy(10);
        vm.prank(eve);
        vm.expectRevert(JunoPost.Payment.selector);
        post.buy{value: total - 1}(10);
    }

    function test_buyingPastTheCurveReverts() public {
        vm.expectRevert(CurveMath.Quantity.selector);
        post.quoteBuy(801);
    }

    function test_sellPaysTheCurveLessOnePercent() public {
        buy(post, eve, 50);
        (uint256 quoted, bool fromFloor) = post.quoteSell(20);
        uint256 gross = CurveMath.rangeCost(30, 20, false);
        uint256 floorGross = post.floorVault() * 20 / post.totalSupply();
        assertEq(fromFloor, gross < floorGross);
        uint256 before = eve.balance;
        vm.prank(eve);
        uint256 paid = post.sell(20, quoted);
        assertEq(paid, quoted);
        assertEq(eve.balance, before + paid);
        assertEq(post.balanceOf(eve), 30);
        assertEq(post.curveSold(), 30);
        assertSolvent(post);
    }

    function test_sellSlippageGuard() public {
        buy(post, eve, 10);
        (uint256 quoted,) = post.quoteSell(10);
        vm.prank(eve);
        vm.expectRevert(JunoPost.Slippage.selector);
        post.sell(10, quoted + 1);
    }

    function test_roundTripAlwaysLoses() public {
        uint256 before = eve.balance;
        buy(post, eve, 40);
        vm.prank(eve);
        post.sell(40, 0);
        assertLt(eve.balance, before);
    }

    /// When the floor per token is above the curve price, a sell is paid from the vault at the floor.
    function test_sellFromTheFloorWhenItIsHigher() public {
        // Auction holders own 200 at 20e12; the floor is 10e12 a token, far above the first curve price.
        buy(post, eve, 5);
        (uint256 quoted, bool fromFloor) = post.quoteSell(5);
        assertTrue(fromFloor);
        uint256 vault = post.floorVault();
        uint256 supply = post.totalSupply();
        vm.prank(kai);
        post.sell(5, quoted);
        uint256 expectedGross = vault * 5 / supply;
        assertEq(post.floorVault(), vault - expectedGross);
        // Floor per token is unchanged (within rounding) for everyone left.
        assertApproxEqAbs(post.floorVault() / post.totalSupply(), vault / supply, 1);
        assertSolvent(post);
    }

    function test_redeemPaysNinetyNinePercentOfTheProRataFloor() public {
        uint256 vault = post.floorVault();
        uint256 supply = post.totalSupply();
        uint256 floorBefore = vault / supply;
        uint256 quoted = post.quoteRedeem(50);
        uint256 before = kai.balance;
        vm.prank(kai);
        uint256 paid = post.redeem(50, quoted);
        uint256 proRata = vault * 50 / supply;
        assertEq(paid, proRata - proRata / 100);
        assertEq(kai.balance, before + paid);
        assertEq(post.totalSupply(), supply - 50);
        // The 1% left behind raises the floor for remaining holders.
        assertGt(post.floorVault() / post.totalSupply(), floorBefore);
        assertSolvent(post);
    }

    function test_redeemMoreThanHeldReverts() public {
        vm.prank(kai);
        vm.expectRevert(JunoPost.Balance.selector);
        post.redeem(101, 0);
    }

    function test_graduationMovesEverythingRaisedIntoTheFloor() public {
        (uint256 total,,,) = post.quoteBuy(800);
        vm.deal(eve, 10 ether);
        vm.prank(eve);
        post.buy{value: total}(800);
        assertTrue(post.graduated());
        assertEq(uint256(post.phase()), uint256(JunoPost.Phase.Graduated));
        assertEq(post.curveReserve(), 0);
        assertEq(post.graduationEscrow(), 0);
        assertEq(post.totalSupply(), 1000);
        // Vault = auction half + 20% floor shares + curve reserve + auction escrow half + escrow fee halves.
        assertGt(post.floorVault(), CurveMath.rangeCost(0, 800, true));
        assertSolvent(post);
    }

    function test_curveClosesAfterGraduationButTheFloorStaysOpen() public {
        (uint256 total,,,) = post.quoteBuy(800);
        vm.prank(eve);
        post.buy{value: total}(800);
        vm.prank(eve);
        vm.expectRevert(JunoPost.CurveClosed.selector);
        post.buy{value: 1 ether}(1);
        vm.prank(eve);
        vm.expectRevert(JunoPost.CurveClosed.selector);
        post.sell(1, 0);
        uint256 quoted = post.quoteRedeem(100);
        vm.prank(eve);
        assertEq(post.redeem(100, 0), quoted);
        assertSolvent(post);
    }

    function test_creatorWithdrawsEarningsOnly() public {
        buy(post, eve, 100);
        uint256 earned = post.creatorEarnings();
        assertGt(earned, 0);
        vm.prank(eve);
        vm.expectRevert(JunoPost.OnlyCreator.selector);
        post.withdrawEarnings();
        uint256 before = mira.balance;
        vm.prank(mira);
        post.withdrawEarnings();
        assertEq(mira.balance, before + earned);
        assertEq(post.creatorEarnings(), 0);
    }

    function test_tradeLogAndHolders() public {
        buy(post, eve, 10);
        vm.prank(eve);
        post.sell(4, 0);
        vm.prank(kai);
        post.redeem(10, 0);
        JunoPost.Trade[] memory t = post.trades();
        assertEq(t.length, 5); // 2 auction fills, buy, sell, redeem
        assertEq(uint256(t[0].kind), uint256(JunoPost.Kind.Auction));
        assertEq(uint256(t[2].kind), uint256(JunoPost.Kind.Buy));
        assertEq(t[2].quantity, 10);
        assertEq(t[2].soldAfter, 10);
        assertEq(uint256(t[3].kind), uint256(JunoPost.Kind.Sell));
        assertEq(uint256(t[4].kind), uint256(JunoPost.Kind.Redeem));
        (address[] memory a, uint256[] memory b) = post.holders();
        assertEq(a.length, 3);
        uint256 sum;
        for (uint256 i; i < b.length; ++i) sum += b[i];
        assertEq(sum, post.totalSupply());
    }

    function test_tradeLogIsARingOf120() public {
        for (uint256 i; i < 130; ++i) buy(post, eve, 1);
        JunoPost.Trade[] memory t = post.trades();
        assertEq(t.length, 120);
        assertEq(post.tradeCount(), 132);
        assertEq(t[119].soldAfter, 130);
        assertEq(t[0].soldAfter, 11);
    }

    function testFuzz_buySellSequenceStaysSolvent(uint8[12] memory sizes, bool[12] memory sides) public {
        for (uint256 i; i < 12; ++i) {
            uint256 q = bound(sizes[i], 1, 60);
            if (sides[i] && post.balanceOf(eve) >= q && post.curveSold() >= q) {
                vm.prank(eve);
                post.sell(q, 0);
            } else if (post.curveSold() + q <= 800) {
                buy(post, eve, q);
            }
            assertSolvent(post);
        }
    }
}
