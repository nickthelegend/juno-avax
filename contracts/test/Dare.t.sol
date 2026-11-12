// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";

contract DareTest is JunoBase {
    JunoPost internal post;
    uint256 internal constant BOND = 0.5 ether;

    function setUp() public override {
        super.setUp();
        post = launchDare(oto, "cap-toss", BOND);
        bid(post, mira, 60, 10e12);
        bid(post, kai, 40, 10e12);
        toReveal(post);
        reveal(post, mira, 60, 10e12);
        reveal(post, kai, 40, 10e12);
        toSettle(post);
        post.settle();
    }

    function test_acceptedProofReturnsTheBond() public {
        vm.prank(oto);
        post.submitProof("ipfs://roof-photo");
        vm.prank(mira);
        post.vote(true);
        vm.prank(kai);
        post.vote(false);
        vm.warp(post.dareEnd());
        post.finalizeDare();
        assertTrue(post.dareFinalized());
        assertTrue(post.dareAccepted());
        assertEq(post.dareBond(), 0);
        assertEq(post.creatorEarnings(), BOND);
        assertSolvent(post);
    }

    function test_rejectedProofSendsTheBondToTheFloor() public {
        vm.prank(oto);
        post.submitProof("ipfs://blurry");
        vm.prank(mira);
        post.vote(false);
        vm.prank(kai);
        post.vote(true);
        uint256 vault = post.floorVault();
        vm.warp(post.dareEnd());
        post.finalizeDare();
        assertFalse(post.dareAccepted());
        assertEq(post.floorVault(), vault + BOND);
        // Holders can now redeem their share of the bond.
        uint256 quoted = post.quoteRedeem(60);
        assertGt(quoted, BOND * 60 / 100 * 98 / 100);
        assertSolvent(post);
    }

    function test_missingProofSendsTheBondToTheFloor() public {
        uint256 vault = post.floorVault();
        vm.warp(post.dareEnd());
        post.finalizeDare();
        assertEq(post.floorVault(), vault + BOND);
    }

    function test_tieIsNotAnAcceptance() public {
        vm.prank(oto);
        post.submitProof("ipfs://x");
        vm.prank(mira);
        post.transfer(kai, 10); // 50 / 50
        vm.prank(mira);
        post.vote(true);
        vm.prank(kai);
        post.vote(false);
        vm.warp(post.dareEnd());
        post.finalizeDare();
        assertFalse(post.dareAccepted());
    }

    function test_onlyTheCreatorPostsProofOnceInTheWindow() public {
        vm.prank(mira);
        vm.expectRevert(JunoPost.OnlyCreator.selector);
        post.submitProof("ipfs://fake");
        vm.prank(oto);
        post.submitProof("ipfs://real");
        vm.prank(oto);
        vm.expectRevert(JunoPost.ProofWindow.selector);
        post.submitProof("ipfs://swap");
    }

    function test_proofAfterTheWindowIsRefused() public {
        vm.warp(post.dareEnd());
        vm.prank(oto);
        vm.expectRevert(JunoPost.ProofWindow.selector);
        post.submitProof("ipfs://late");
    }

    function test_onlyHoldersVoteOnce() public {
        vm.prank(oto);
        post.submitProof("ipfs://x");
        vm.prank(eve);
        vm.expectRevert(JunoPost.NotHolder.selector);
        post.vote(true);
        vm.prank(mira);
        post.vote(true);
        vm.prank(mira);
        vm.expectRevert(JunoPost.AlreadyVoted.selector);
        post.vote(false);
    }

    function test_noVoteBeforeProofOrAfterTheWindow() public {
        vm.prank(mira);
        vm.expectRevert(JunoPost.VoteWindow.selector);
        post.vote(true);
        vm.prank(oto);
        post.submitProof("ipfs://x");
        vm.warp(post.dareEnd());
        vm.prank(mira);
        vm.expectRevert(JunoPost.VoteWindow.selector);
        post.vote(true);
    }

    /// Weight is counted at finalization, so passing tokens to another voter cannot count them twice.
    function test_movingTokensBetweenVotersDoesNotDoubleCount() public {
        vm.prank(oto);
        post.submitProof("ipfs://x");
        vm.prank(kai);
        post.vote(true); // 40
        vm.prank(kai);
        post.transfer(eve, 40);
        vm.prank(eve);
        post.vote(true); // the same 40 tokens
        vm.prank(mira);
        post.vote(false); // 60
        (uint256 yes, uint256 no) = post.tally();
        assertEq(yes, 40);
        assertEq(no, 60);
        vm.warp(post.dareEnd());
        post.finalizeDare();
        assertFalse(post.dareAccepted());
    }

    function test_finalizeOnlyOnceAfterTheWindow() public {
        vm.expectRevert(JunoPost.DareWindow.selector);
        post.finalizeDare();
        vm.warp(post.dareEnd());
        post.finalizeDare();
        vm.expectRevert(JunoPost.DareWindow.selector);
        post.finalizeDare();
    }

    function test_failedDareWithNoHoldersReturnsTheBond() public {
        JunoPost lonely = launchDare(oto, "lonely", 0.2 ether);
        vm.warp(lonely.dareEnd());
        lonely.finalizeDare();
        assertTrue(lonely.settled());
        assertEq(lonely.creatorEarnings(), 0.2 ether);
        assertEq(lonely.floorVault(), 0);
    }

    function test_plainPostHasNoDare() public {
        JunoPost plain = launch(mira, "plain");
        vm.prank(mira);
        vm.expectRevert(JunoPost.NoDare.selector);
        plain.submitProof("x");
    }
}
