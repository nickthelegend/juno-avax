// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoPost} from "../src/JunoPost.sol";
import {JunoGasStation} from "../src/JunoGasStation.sol";

/// The zero-setup judge path: one drip from JunoGasStation is enough for a brand-new wallet to launch a post, win
/// its sealed-bid opening, buy, sell and redeem against the floor.
contract JudgePathTest is JunoBase {
    JunoGasStation station;
    address relayer = makeAddr("relayer");
    uint256 constant DRIP = 0.008 ether;

    function setUp() public override {
        super.setUp();
        station = new JunoGasStation(relayer, DRIP, 12, 3);
        vm.deal(address(station), 0.1 ether);
    }

    function _drip(uint256 k) internal returns (address judge) {
        judge = vm.addr(k);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", station.digest(judge, deadline)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, m);
        vm.prank(relayer);
        station.drip(payable(judge), deadline, abi.encodePacked(r, s, v), keccak256("judge-ip"));
    }

    function test_oneDripCoversTheWholeJudgeFlow() public {
        address judge = _drip(0xA11CE);
        assertEq(judge.balance, DRIP);

        JunoPost post = launch(judge, "judge-first-post");
        bid(post, judge, 20, 0.0001 ether); // 20 tokens at up to 0.0001 AVAX each, 0.005 AVAX escrow
        toReveal(post);
        reveal(post, judge, 20, 0.0001 ether);
        toSettle(post);
        post.settle();
        vm.prank(judge);
        post.claimRefund();
        assertEq(post.balanceOf(judge), 20, "won the auction");

        uint256 paid = buy(post, judge, 5);
        assertGt(paid, 0);
        vm.startPrank(judge);
        post.sell(2, 0);
        post.redeem(2, 0);
        vm.stopPrank();
        assertEq(post.balanceOf(judge), 21);
        assertGt(judge.balance, 0, "money left after the whole flow");
        assertSolvent(post);
    }

    function test_judgeCannotDripTwice() public {
        address judge = _drip(0xB0B);
        vm.prank(judge);
        payable(address(0xdead)).transfer(judge.balance); // spend it all
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", station.digest(judge, deadline)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, m);
        vm.prank(relayer);
        vm.expectRevert(JunoGasStation.AlreadyDripped.selector);
        station.drip(payable(judge), deadline, abi.encodePacked(r, s, v), keccak256("judge-ip"));
    }
}
