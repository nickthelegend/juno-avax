// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoBase} from "./Base.t.sol";
import {JunoFactory} from "../src/JunoFactory.sol";
import {JunoPost} from "../src/JunoPost.sol";

contract FactoryTest is JunoBase {
    function test_createPostDeploysACoin() public {
        JunoPost post = launch(mira, "sprout-2");
        assertEq(factory.postCount(), 1);
        assertEq(factory.posts()[0], address(post));
        assertTrue(factory.isPost(address(post)));
        assertEq(factory.postBySlug(keccak256("sprout-2")), address(post));
        assertEq(post.symbol(), "SPROUT2");
        assertEq(post.name(), "Juno sprout-2");
        assertEq(post.decimals(), 0);
        assertEq(post.creator(), mira);
        assertEq(uint256(post.phase()), uint256(JunoPost.Phase.Commit));
    }

    function test_rejectsBadSlugs() public {
        string[5] memory bad = ["a", "-lead", "trail-", "Upper", "sp ace"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(JunoFactory.Slug.selector);
            factory.createPost(bad[i], "", "/m.webp", "");
        }
    }

    function test_rejectsDuplicateSlug() public {
        launch(mira, "twin");
        vm.expectRevert(JunoFactory.Duplicate.selector);
        vm.prank(kai);
        factory.createPost("twin", "", "/m.webp", "");
    }

    function test_bondNeedsADareAndADareNeedsABond() public {
        vm.prank(mira);
        vm.expectRevert(JunoFactory.DareBond.selector);
        factory.createPost{value: 0.1 ether}("bond-only", "", "/m.webp", "");
        vm.prank(mira);
        vm.expectRevert(JunoFactory.DareBond.selector);
        factory.createPost("dare-only", "", "/m.webp", "do it");
        vm.prank(mira);
        vm.expectRevert(JunoFactory.DareBond.selector);
        factory.createPost{value: 2.1 ether}("too-big", "", "/m.webp", "do it");
    }

    function test_rejectsMissingMedia() public {
        vm.expectRevert(JunoFactory.Metadata.selector);
        factory.createPost("no-media", "", "", "");
    }

    function test_dareBondIsHeldByThePost() public {
        JunoPost post = launchDare(oto, "cap-toss", 0.3 ether);
        assertEq(address(post).balance, 0.3 ether);
        assertEq(post.dareBond(), 0.3 ether);
    }
}
