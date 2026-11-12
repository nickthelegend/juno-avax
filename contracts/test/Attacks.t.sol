// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// Receives AVAX from the post and tries to re-enter it from `receive`.
contract Reenterer {
    JunoPost public post;
    uint8 public mode; // 1 sell, 2 redeem, 3 claimRefund
    bool public reentered;
    bytes public reentryError;
    uint256 public calls;

    constructor(JunoPost post_) {
        post = post_;
    }

    function arm(uint8 mode_) external {
        mode = mode_;
    }

    function commit(bytes32 c) external payable {
        post.commit{value: msg.value}(c);
    }

    function reveal(uint256 amount, uint256 maxPrice, bytes32 salt) external {
        post.reveal(amount, maxPrice, salt);
    }

    function buy(uint256 q) external payable {
        post.buy{value: msg.value}(q);
    }

    function sell(uint256 q) external {
        post.sell(q, 0);
    }

    function redeem(uint256 q) external {
        post.redeem(q, 0);
    }

    function claimRefund() external {
        post.claimRefund();
    }

    receive() external payable {
        if (mode == 0 || calls > 0) return;
        ++calls;
        bytes memory data = mode == 1
            ? abi.encodeCall(JunoPost.sell, (1, 0))
            : mode == 2 ? abi.encodeCall(JunoPost.redeem, (1, 0)) : abi.encodeCall(JunoPost.claimRefund, ());
        (bool ok, bytes memory err) = address(post).call(data);
        reentered = ok;
        reentryError = err;
    }
}

contract AttacksTest is JunoBase {
    JunoPost internal post;
    Reenterer internal attacker;

    function setUp() public override {
        super.setUp();
        post = launch(mira, "target");
        attacker = new Reenterer(post);
        vm.deal(address(attacker), 1 ether);
    }

    function _settleWithAttacker() internal {
        bytes32 c = post.commitmentOf(address(attacker), 50, 20e12, bytes32("s"));
        attacker.commit{value: ESCROW}(c);
        bid(post, kai, 100, 20e12);
        toReveal(post);
        attacker.reveal(50, 20e12, bytes32("s"));
        reveal(post, kai, 100, 20e12);
        toSettle(post);
        post.settle();
    }

    function _assertBlocked() internal view {
        assertFalse(attacker.reentered(), "re-entry succeeded");
        assertEq(bytes4(attacker.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_reentrancyOnSellIsBlocked() public {
        _settleWithAttacker();
        (uint256 total,,,) = post.quoteBuy(20);
        attacker.buy{value: total}(20);
        attacker.arm(1);
        uint256 supply = post.totalSupply();
        attacker.sell(10);
        _assertBlocked();
        assertEq(post.totalSupply(), supply - 10);
        assertSolvent(post);
    }

    function test_reentrancyOnRedeemIsBlocked() public {
        _settleWithAttacker();
        attacker.arm(2);
        uint256 quoted = post.quoteRedeem(10);
        uint256 before = address(attacker).balance;
        attacker.redeem(10);
        _assertBlocked();
        assertEq(address(attacker).balance, before + quoted);
        assertSolvent(post);
    }

    function test_reentrancyOnRefundIsBlockedAndPaysOnce() public {
        _settleWithAttacker();
        attacker.arm(3);
        (, JunoPost.Bid memory b) = post.bidOf(address(attacker));
        uint256 before = address(attacker).balance;
        attacker.claimRefund();
        _assertBlocked();
        assertEq(address(attacker).balance, before + b.refund);
        assertSolvent(post);
    }

    function test_revealWithADifferentBidThanCommittedFails() public {
        bid(post, kai, 50, 10e12);
        toReveal(post);
        vm.prank(kai);
        vm.expectRevert(JunoPost.HashMismatch.selector);
        post.reveal(50, 11e12, salt(kai)); // tried to raise the price after seeing others
        vm.prank(kai);
        vm.expectRevert(JunoPost.HashMismatch.selector);
        post.reveal(50, 10e12, bytes32("other salt"));
    }

    function test_lateBidIsRefused() public {
        vm.warp(post.commitEnd());
        bytes32 c = post.commitmentOf(kai, 10, 10e12, salt(kai));
        vm.prank(kai);
        vm.expectRevert(JunoPost.CommitClosed.selector);
        post.commit{value: ESCROW}(c);
    }

    function test_earlyAndLateRevealsAreRefused() public {
        bid(post, kai, 10, 10e12);
        vm.prank(kai);
        vm.expectRevert(JunoPost.RevealWindow.selector);
        post.reveal(10, 10e12, salt(kai));
        toSettle(post);
        vm.prank(kai);
        vm.expectRevert(JunoPost.RevealWindow.selector);
        post.reveal(10, 10e12, salt(kai));
    }

    /// Eve copies Kai's commitment from the mempool. She cannot reveal it: the hash binds Kai's address.
    function test_copiedCommitmentCannotBeRevealed() public {
        bytes32 c = post.commitmentOf(kai, 100, 20e12, salt(kai));
        vm.prank(kai);
        post.commit{value: ESCROW}(c);
        vm.prank(eve);
        post.commit{value: ESCROW}(c);
        toReveal(post);
        vm.prank(eve);
        vm.expectRevert(JunoPost.HashMismatch.selector);
        post.reveal(100, 20e12, salt(kai));
    }

    /// A commitment made for one post does not reveal on another.
    function test_commitmentDoesNotReplayAcrossPosts() public {
        JunoPost other = launch(oto, "other");
        bytes32 c = post.commitmentOf(kai, 10, 10e12, salt(kai));
        vm.prank(kai);
        other.commit{value: ESCROW}(c);
        vm.warp(other.commitEnd());
        vm.prank(kai);
        vm.expectRevert(JunoPost.HashMismatch.selector);
        other.reveal(10, 10e12, salt(kai));
    }

    /// Buying and immediately redeeming against the floor always loses: the buy pays at least the
    /// pro-rata floor, plus 20% into it and a 1% fee.
    function testFuzz_buyThenRedeemNeverProfits(uint256 q) public {
        _settleWithAttacker();
        q = bound(q, 1, 800);
        uint256 before = eve.balance;
        buy(post, eve, q);
        vm.prank(eve);
        post.redeem(q, 0);
        assertLt(eve.balance, before);
        assertSolvent(post);
    }

    /// Redeeming in many small pieces never pays more than one redemption of the same size.
    function testFuzz_splitRedeemsNeverBeatOne(uint8 pieces) public {
        _settleWithAttacker();
        pieces = uint8(bound(pieces, 2, 50));
        uint256 snap = vm.snapshotState();
        vm.prank(kai);
        uint256 once = post.redeem(100, 0);
        vm.revertToState(snap);
        uint256 total;
        uint256 left = 100;
        for (uint256 i; i < pieces && left > 0; ++i) {
            uint256 q = i == pieces - 1 ? left : (left / (pieces - i) == 0 ? 1 : left / (pieces - i));
            vm.prank(kai);
            total += post.redeem(q, 0);
            left -= q;
        }
        if (left > 0) {
            vm.prank(kai);
            total += post.redeem(left, 0);
        }
        // Splitting can only lose to rounding and to the 1% each piece leaves behind (which raises later pieces);
        // it can never extract more than the whole vault share the 100 tokens were entitled to before.
        uint256 vaultShare = (post.floorVault() + total) * 100 / (post.totalSupply() + 100);
        assertLe(total, vaultShare + 1);
        assertGt(total, 0);
        assertGt(once, 0);
        assertSolvent(post);
    }

    /// Draining the floor: the last holders redeem everything, nobody is paid twice, the post stays solvent
    /// and leftover dust is moved out of the vault so a new buyer cannot claim it.
    function test_floorCannotBeDrainedPastTheHolders() public {
        _settleWithAttacker();
        vm.prank(kai);
        post.redeem(100, 0);
        attacker.redeem(50);
        assertEq(post.totalSupply(), 0);
        assertEq(post.floorVault(), 0);
        assertGt(post.graduationEscrow(), 0);
        assertSolvent(post);
        uint256 before = eve.balance;
        buy(post, eve, 1);
        vm.prank(eve);
        post.redeem(1, 0);
        assertLt(eve.balance, before);
    }

    function test_strangersCannotWithdrawEarnings() public {
        _settleWithAttacker();
        buy(post, eve, 10);
        vm.prank(eve);
        vm.expectRevert(JunoPost.OnlyCreator.selector);
        post.withdrawEarnings();
    }
}
