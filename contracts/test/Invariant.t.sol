// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";

contract Handler is Test {
    JunoPost public post;
    address[3] internal actors;

    constructor(JunoPost post_, address a, address b, address c) {
        post = post_;
        actors = [a, b, c];
    }

    function buy(uint256 who, uint256 q) external {
        address a = actors[who % 3];
        if (post.graduated()) return;
        q = bound(q, 1, 80);
        if (post.curveSold() + q > 800) return;
        (uint256 total,,,) = post.quoteBuy(q);
        vm.deal(a, total);
        vm.prank(a);
        post.buy{value: total}(q);
    }

    function sell(uint256 who, uint256 q) external {
        address a = actors[who % 3];
        if (post.graduated()) return;
        uint256 bal = post.balanceOf(a);
        if (bal == 0 || post.curveSold() == 0) return;
        q = bound(q, 1, bal < post.curveSold() ? bal : post.curveSold());
        vm.prank(a);
        post.sell(q, 0);
    }

    function redeem(uint256 who, uint256 q) external {
        address a = actors[who % 3];
        uint256 bal = post.balanceOf(a);
        if (bal == 0) return;
        q = bound(q, 1, bal);
        vm.prank(a);
        post.redeem(q, 0);
    }

    function claim(uint256 who) external {
        address a = actors[who % 3];
        (bool exists, JunoPost.Bid memory b) = post.bidOf(a);
        if (!exists || b.refund == 0) return;
        vm.prank(a);
        post.claimRefund();
    }

    function withdraw() external {
        vm.prank(post.creator());
        post.withdrawEarnings();
    }
}

contract InvariantTest is JunoBase {
    JunoPost internal post;
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        post = launch(mira, "invariant");
        bid(post, kai, 90, 20e12);
        bid(post, oto, 90, 18e12);
        bid(post, eve, 90, 15e12);
        toReveal(post);
        reveal(post, kai, 90, 20e12);
        reveal(post, oto, 90, 18e12);
        reveal(post, eve, 90, 15e12);
        toSettle(post);
        post.settle();
        handler = new Handler(post, kai, oto, eve);
        targetContract(address(handler));
    }

    function invariant_solvent() public view {
        assertSolvent(post);
    }

    function invariant_supplyMatchesAuctionPlusCurve() public view {
        assertLe(post.totalSupply(), 200 + post.curveSold());
        assertLe(post.curveSold(), 800);
    }
}
