// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Juno's 16-segment weighted bonding curve, content preset.
/// @notice Port of juno-near/packages/contract/src/curve.rs (itself ported from
/// the juno-wif Stylus curve). 800 whole tokens are sold over 16 linear
/// segments whose sizes follow the weights below; the price rises 100x from
/// BASE to the last token. Prices are in wei per whole token.
/// The price table is the exact output of the Rust/TS table() routine with
/// BASE = 1e12 wei (0.000001 AVAX); test/CurveMath.t.sol recomputes it.
library CurveMath {
    uint256 internal constant SUPPLY = 800;
    uint256 internal constant BASE = 1e12;

    error Quantity();

    function prices() internal pure returns (uint256[17] memory p) {
        p = [
            uint256(1000000000000),
            1333521432163,
            1778279410038,
            2371373705660,
            3162277660166,
            4216965034282,
            5623413251898,
            7498942093317,
            9999999999989,
            13335214321618,
            17782794100368,
            23713737056588,
            31622776601645,
            42169650342806,
            56234132518965,
            74989420933152,
            99999999999875
        ];
    }

    function sizes() internal pure returns (uint256[16] memory s) {
        s = [uint256(9), 10, 13, 15, 18, 22, 27, 32, 39, 47, 56, 67, 81, 97, 117, 150];
    }

    /// @notice Cost of the tokens from position `sold` to `sold + quantity`.
    /// @param up Round up (what a buyer pays) or down (what a seller receives),
    /// so a buy then a sell of the same range can never pay out more than it took in.
    function rangeCost(uint256 sold, uint256 quantity, bool up) internal pure returns (uint256 total) {
        if (quantity == 0 || sold + quantity > SUPPLY) revert Quantity();
        uint256[17] memory p = prices();
        uint256[16] memory s = sizes();
        uint256 from = sold;
        uint256 to = sold + quantity;
        uint256 start;
        for (uint256 k; k < 16; ++k) {
            if (start >= to) break;
            uint256 end = start + s[k];
            if (end > from) {
                uint256 lo = from > start ? from : start;
                uint256 hi = to < end ? to : end;
                uint256 x = hi - lo;
                uint256 a = lo - start;
                uint256 numerator = (p[k + 1] - p[k]) * x * (2 * a + x);
                uint256 denominator = 2 * s[k];
                total += x * p[k] + (up ? (numerator + denominator - 1) / denominator : numerator / denominator);
            }
            start = end;
        }
    }

    /// @notice Price of the next whole token (the last token's price once sold out).
    function spot(uint256 sold) internal pure returns (uint256) {
        return sold >= SUPPLY ? rangeCost(SUPPLY - 1, 1, true) : rangeCost(sold, 1, true);
    }
}
