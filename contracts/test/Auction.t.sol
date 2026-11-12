// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";

contract AuctionTest is JunoBase {
    JunoPost internal post;

    function setUp() public override {
        super.setUp();
        post = launch(mira, "sprout");
    }

    function test_oneClearingPriceForEveryWinner() public {
        bid(post, kai, 120, 20e12); // first in, highest price
        vm.warp(block.timestamp + 50);
        bid(post, oto, 120, 15e12); // late in the window, lower price
        toReveal(post);
        reveal(post, kai, 120, 20e12);
        reveal(post, oto, 120, 15e12);
        toSettle(post);
        post.settle();

        // 200 tokens: kai fills 120, oto 80; both pay oto's 15e12.
        assertEq(post.clearingPrice(), 15e12);
        assertEq(post.balanceOf(kai), 120);
        assertEq(post.balanceOf(oto), 80);
        assertEq(post.totalSupply(), 200);
        (, JunoPost.Bid memory k) = post.bidOf(kai);
        (, JunoPost.Bid memory o) = post.bidOf(oto);
        assertEq(k.refund, ESCROW - 120 * 15e12);
        assertEq(o.refund, ESCROW - 80 * 15e12);
        uint256 raised = 200 * 15e12;
        assertEq(post.floorVault(), raised / 2);
        assertEq(post.graduationEscrow(), raised - raised / 2);
        assertEq(post.market().floorPerToken, (raised / 2) / 200);
        assertEq(uint256(post.phase()), uint256(JunoPost.Phase.Curve));
        assertSolvent(post);
    }

    function test_undersubscribedAuctionClearsAtTheLowestBid() public {
        bid(post, kai, 50, 30e12);
        bid(post, oto, 40, 12e12);
        toReveal(post);
        reveal(post, kai, 50, 30e12);
        reveal(post, oto, 40, 12e12);
        toSettle(post);
        post.settle();
        assertEq(post.clearingPrice(), 12e12);
        assertEq(post.totalSupply(), 90);
    }

    function test_tieGoesToTheEarlierCommit() public {
        bid(post, kai, 150, 10e12);
        bid(post, oto, 150, 10e12);
        toReveal(post);
        reveal(post, oto, 150, 10e12);
        reveal(post, kai, 150, 10e12);
        toSettle(post);
        post.settle();
        assertEq(post.balanceOf(kai), 150);
        assertEq(post.balanceOf(oto), 50);
    }

    function test_refundsArePulledOnce() public {
        bid(post, kai, 100, 10e12);
        toReveal(post);
        reveal(post, kai, 100, 10e12);
        toSettle(post);
        post.settle();
        uint256 before = kai.balance;
        vm.prank(kai);
        uint256 refund = post.claimRefund();
        assertEq(refund, ESCROW - 100 * 10e12);
        assertEq(kai.balance, before + refund);
        vm.prank(kai);
        vm.expectRevert(JunoPost.NoRefund.selector);
        post.claimRefund();
        assertSolvent(post);
    }

    function test_noBidsSettlesToAnOpenCurve() public {
        toSettle(post);
        post.settle();
        assertEq(post.clearingPrice(), 0);
        assertEq(post.totalSupply(), 0);
        assertEq(post.floorVault(), 0);
        assertEq(uint256(post.phase()), uint256(JunoPost.Phase.Curve));
        buy(post, kai, 10);
        assertEq(post.balanceOf(kai), 10);
    }

    function test_onlyUnrevealedBidsSettleEmptyAndForfeitOnePercent() public {
        bid(post, kai, 100, 10e12);
        toSettle(post);
        post.settle();
        assertEq(post.totalSupply(), 0);
        (, JunoPost.Bid memory k) = post.bidOf(kai);
        assertEq(k.refund, ESCROW - ESCROW / 100);
        assertEq(post.creatorEarnings(), ESCROW / 100);
        assertSolvent(post);
    }

    function test_refundBeforeSettlementIsRefused() public {
        bid(post, kai, 100, 10e12);
        vm.prank(kai);
        vm.expectRevert(JunoPost.NotSettled.selector);
        post.claimRefund();
    }

    function test_firstBuyAfterTheWindowSettlesTheAuction() public {
        bid(post, kai, 100, 10e12);
        toReveal(post);
        reveal(post, kai, 100, 10e12);
        toSettle(post);
        // The quote before settlement cannot see the auction's supply, so the buyer sends a ceiling.
        uint256 before = oto.balance;
        vm.prank(oto);
        uint256 total = post.buy{value: 1 ether}(5);
        assertTrue(post.settled());
        assertEq(oto.balance, before - total);
        (uint256 now_,,,) = post.quoteBuy(5);
        assertGt(now_, 0);
        assertEq(post.balanceOf(kai), 100);
        assertEq(post.balanceOf(oto), 5);
    }

    function test_settleOnlyOnceAndOnlyAfterReveals() public {
        vm.expectRevert(JunoPost.SettleWindow.selector);
        post.settle();
        toReveal(post);
        vm.expectRevert(JunoPost.SettleWindow.selector);
        post.settle();
        toSettle(post);
        post.settle();
        vm.expectRevert(JunoPost.SettleWindow.selector);
        post.settle();
    }

    function test_escrowIsFixedSoItRevealsNothing() public {
        bytes32 c = post.commitmentOf(kai, 1, 1e12, salt(kai));
        vm.prank(kai);
        vm.expectRevert(JunoPost.FixedEscrow.selector);
        post.commit{value: ESCROW + 1}(c);
    }

    function test_oneBidPerAccount() public {
        bid(post, kai, 10, 1e12);
        bytes32 c = post.commitmentOf(kai, 20, 1e12, salt(kai));
        vm.prank(kai);
        vm.expectRevert(JunoPost.DuplicateBid.selector);
        post.commit{value: ESCROW}(c);
    }

    function test_revealCannotExceedTheEscrow() public {
        bid(post, kai, 200, 30e12); // 200 * 30e12 = 0.006 AVAX > 0.005
        toReveal(post);
        vm.prank(kai);
        vm.expectRevert(JunoPost.EscrowExceeded.selector);
        post.reveal(200, 30e12, salt(kai));
    }

    function test_bidsBelowTheCurveBaseAreRefused() public {
        bid(post, kai, 10, 1e11);
        toReveal(post);
        vm.prank(kai);
        vm.expectRevert(JunoPost.BadBid.selector);
        post.reveal(10, 1e11, salt(kai));
    }

    function test_tokensCannotMoveBeforeSettlement() public {
        vm.prank(kai);
        vm.expectRevert(JunoPost.NotSettled.selector);
        post.transfer(oto, 0);
    }

    function test_cap64Bids() public {
        for (uint256 i; i < 64; ++i) {
            address b = address(uint160(0x1000 + i));
            vm.deal(b, 1 ether);
            bid(post, b, 1, 1e12);
        }
        address extra = address(0x9999);
        vm.deal(extra, 1 ether);
        bytes32 c = post.commitmentOf(extra, 1, 1e12, salt(extra));
        vm.prank(extra);
        vm.expectRevert(JunoPost.TooManyBids.selector);
        post.commit{value: ESCROW}(c);
    }

    /// 64 revealed bids still settle within a sane gas budget.
    function test_fullAuctionSettlesUnderGasCap() public {
        for (uint256 i; i < 64; ++i) {
            address b = address(uint160(0x1000 + i));
            vm.deal(b, 1 ether);
            bid(post, b, 5, 1e12 + i * 1e11);
        }
        toReveal(post);
        for (uint256 i; i < 64; ++i) reveal(post, address(uint160(0x1000 + i)), 5, 1e12 + i * 1e11);
        toSettle(post);
        uint256 g = gasleft();
        post.settle();
        assertLt(g - gasleft(), 8_000_000);
        assertEq(post.totalSupply(), 200);
        // the 40 highest bids fill; clearing is the 40th highest price
        assertEq(post.clearingPrice(), 1e12 + 24 * 1e11);
        assertSolvent(post);
    }
}
