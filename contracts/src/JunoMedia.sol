// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title JunoMedia: a post's photo, kept in Avalanche's own history.
/// @notice Juno has no upload server. The phone shrinks the photo (a JPEG, PNG or WebP of at most 120 kB) and sends
///         its bytes as the calldata of `store`. Nothing is written to storage: the bytes live in the transaction,
///         which every Fuji archive node keeps, and the `Stored` event names who stored it and the image's keccak256.
///         The post's `mediaUrl` then points at Juno's API (`/api/media?tx=<hash>`), which reads this transaction
///         back from Fuji, checks it called this contract and that its hash matches the event, and serves the image.
///         Anyone can do the same check with a public RPC; the API is a reader, not the store.
contract JunoMedia {
    uint256 public constant MAX_BYTES = 120_000;

    /// @param kind the image's first four bytes (JPEG FFD8FF.., PNG 89504E47, WebP 52494646 "RIFF").
    event Stored(address indexed by, bytes32 indexed hash, uint256 size, bytes4 kind);

    error Empty();
    error TooLarge();
    error NotAnImage();

    function store(bytes calldata image) external returns (bytes32 hash) {
        uint256 n = image.length;
        if (n == 0) revert Empty();
        if (n > MAX_BYTES) revert TooLarge();
        if (n < 12) revert NotAnImage();
        bytes4 kind = bytes4(image[:4]);
        bool jpeg = image[0] == 0xFF && image[1] == 0xD8 && image[2] == 0xFF;
        bool png = kind == 0x89504E47;
        bool webp = kind == 0x52494646 && bytes4(image[8:12]) == 0x57454250; // "RIFF" .... "WEBP"
        if (!(jpeg || png || webp)) revert NotAnImage();
        hash = keccak256(image);
        emit Stored(msg.sender, hash, n, kind);
    }
}
