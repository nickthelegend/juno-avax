// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {JunoMedia} from "../src/JunoMedia.sol";

contract JunoMediaTest is Test {
    JunoMedia media;

    event Stored(address indexed by, bytes32 indexed hash, uint256 size, bytes4 kind);

    function setUp() public {
        media = new JunoMedia();
    }

    function jpeg(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        b[0] = 0xFF;
        b[1] = 0xD8;
        b[2] = 0xFF;
        b[3] = 0xE0;
        for (uint256 i = 4; i < n; i++) b[i] = bytes1(uint8(i * 7));
    }

    function test_storesAJpegAndEmitsItsHash() public {
        bytes memory img = jpeg(4096);
        address alice = makeAddr("alice");
        vm.expectEmit(true, true, false, true, address(media));
        emit Stored(alice, keccak256(img), 4096, bytes4(0xFFD8FFE0));
        vm.prank(alice);
        bytes32 h = media.store(img);
        assertEq(h, keccak256(img));
    }

    function test_acceptsPngAndWebp() public {
        bytes memory png = new bytes(64);
        (png[0], png[1], png[2], png[3]) = (0x89, 0x50, 0x4E, 0x47);
        media.store(png);
        bytes memory webp = new bytes(64);
        (webp[0], webp[1], webp[2], webp[3]) = (0x52, 0x49, 0x46, 0x46);
        (webp[8], webp[9], webp[10], webp[11]) = (0x57, 0x45, 0x42, 0x50);
        media.store(webp);
    }

    function test_refusesEmptyTooLargeAndNonImages() public {
        vm.expectRevert(JunoMedia.Empty.selector);
        media.store("");
        bytes memory big = jpeg(120_001);
        vm.expectRevert(JunoMedia.TooLarge.selector);
        media.store(big);
        vm.expectRevert(JunoMedia.NotAnImage.selector);
        media.store("short");
        vm.expectRevert(JunoMedia.NotAnImage.selector);
        media.store("<svg xmlns='http://www.w3.org/2000/svg'/>");
        bytes memory riffNotWebp = new bytes(64);
        (riffNotWebp[0], riffNotWebp[1], riffNotWebp[2], riffNotWebp[3]) = (0x52, 0x49, 0x46, 0x46);
        vm.expectRevert(JunoMedia.NotAnImage.selector);
        media.store(riffNotWebp);
    }

    function test_maxSizeFitsAFujiTransaction() public {
        bytes memory img = jpeg(120_000);
        uint256 g = gasleft();
        media.store(img);
        // Execution only (calldata gas is charged on top, ~16 gas a byte): far under Fuji's block limit.
        assertLt(g - gasleft(), 200_000);
    }

    function testFuzz_anyJpegRoundTrips(bytes calldata tail) public {
        vm.assume(tail.length > 8 && tail.length < 5000);
        bytes memory img = bytes.concat(hex"FFD8FFDB", tail);
        assertEq(media.store(img), keccak256(img));
    }
}
