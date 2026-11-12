// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {JunoFactory} from "../src/JunoFactory.sol";
import {JunoPost} from "../src/JunoPost.sol";

abstract contract JunoBase is Test {
    JunoFactory internal factory;
    address internal mira = makeAddr("mira");
    address internal kai = makeAddr("kai");
    address internal oto = makeAddr("oto");
    address internal eve = makeAddr("eve");
    uint256 internal constant ESCROW = 0.005 ether;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        factory = new JunoFactory();
        vm.deal(mira, 10 ether);
        vm.deal(kai, 10 ether);
        vm.deal(oto, 10 ether);
        vm.deal(eve, 10 ether);
    }

    function launch(address who, string memory slug) internal returns (JunoPost) {
        vm.prank(who);
        return JunoPost(payable(factory.createPost(slug, "caption", "/art/juno-feature-1.webp", "")));
    }

    function launchDare(address who, string memory slug, uint256 bond) internal returns (JunoPost) {
        vm.prank(who);
        return JunoPost(payable(factory.createPost{value: bond}(slug, "caption", "/art/x.webp", "Roof photo by Friday")));
    }

    function salt(address who) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", who));
    }

    function bid(JunoPost post, address who, uint256 amount, uint256 maxPrice) internal {
        bytes32 c = post.commitmentOf(who, amount, maxPrice, salt(who));
        vm.prank(who);
        post.commit{value: ESCROW}(c);
    }

    function reveal(JunoPost post, address who, uint256 amount, uint256 maxPrice) internal {
        vm.prank(who);
        post.reveal(amount, maxPrice, salt(who));
    }

    function toReveal(JunoPost post) internal {
        vm.warp(post.commitEnd());
    }

    function toSettle(JunoPost post) internal {
        vm.warp(post.revealEnd());
    }

    /// A settled post with no auction fills: the curve is open from its first token.
    function openCurve(address who, string memory slug) internal returns (JunoPost post) {
        post = launch(who, slug);
        toSettle(post);
        post.settle();
    }

    function buy(JunoPost post, address who, uint256 quantity) internal returns (uint256 total) {
        (total,,,) = post.quoteBuy(quantity);
        vm.prank(who);
        post.buy{value: total}(quantity);
    }

    /// Everything the post owes someone must be covered by the AVAX it holds.
    function liabilities(JunoPost post) internal view returns (uint256 owed) {
        owed = post.floorVault() + post.curveReserve() + post.graduationEscrow() + post.creatorEarnings() + post.dareBond();
        JunoPost.Bid[] memory list = post.bids();
        for (uint256 i; i < list.length; ++i) {
            owed += post.settled() ? list[i].refund : ESCROW;
        }
    }

    function assertSolvent(JunoPost post) internal view {
        assertGe(address(post).balance, liabilities(post), "post is insolvent");
    }
}
