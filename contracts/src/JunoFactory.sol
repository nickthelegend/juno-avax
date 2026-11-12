// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JunoPost} from "./JunoPost.sol";

/// @title Juno factory: every post is a coin.
/// @notice `createPost` deploys a JunoPost for a photo or reel. The post opens
/// with a one-minute sealed-bid auction straight away. Any AVAX sent with the
/// call is the dare bond and needs a dare to go with it.
contract JunoFactory {
    uint256 public constant MAX_BOND = 2 ether;

    address[] internal _posts;
    mapping(bytes32 => address) public postBySlug;
    mapping(address => bool) public isPost;

    event PostCreated(address indexed post, address indexed creator, string slug, uint256 dareBond);

    error Slug();
    error Duplicate();
    error Metadata();
    error DareBond();

    function createPost(string calldata slug, string calldata caption, string calldata mediaUrl, string calldata dare)
        external
        payable
        returns (address post)
    {
        bytes memory s = bytes(slug);
        if (s.length < 2 || s.length > 32 || s[0] == "-" || s[s.length - 1] == "-") revert Slug();
        bytes memory symbol = new bytes(s.length < 11 ? s.length : 11);
        uint256 k;
        for (uint256 i; i < s.length; ++i) {
            bytes1 c = s[i];
            bool lower = c >= "a" && c <= "z";
            bool digit = c >= "0" && c <= "9";
            if (!lower && !digit && c != "-") revert Slug();
            if (k < symbol.length && c != "-") symbol[k++] = lower ? bytes1(uint8(c) - 32) : c;
        }
        assembly {
            mstore(symbol, k)
        }
        bytes32 key = keccak256(s);
        if (postBySlug[key] != address(0)) revert Duplicate();
        if (bytes(caption).length > 400 || bytes(mediaUrl).length == 0 || bytes(mediaUrl).length > 300 || bytes(dare).length > 300) {
            revert Metadata();
        }
        if (msg.value > MAX_BOND || (msg.value > 0) != (bytes(dare).length > 0)) revert DareBond();
        post = address(
            new JunoPost{value: msg.value}(slug, string.concat("Juno ", slug), string(symbol), msg.sender, caption, mediaUrl, dare)
        );
        postBySlug[key] = post;
        isPost[post] = true;
        _posts.push(post);
        emit PostCreated(post, msg.sender, slug, msg.value);
    }

    function posts() external view returns (address[] memory) {
        return _posts;
    }

    function postCount() external view returns (uint256) {
        return _posts.length;
    }
}
