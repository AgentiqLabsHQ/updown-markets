// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pure math converting UPDOWN holdings into a daily entry allowance.
/// @dev All amounts are fixed-point: updownBalance/requiredUpdownPerEntry are 18-dp UPDOWN,
/// updownPriceUsd8/entryValueUsd8 are USD at 1e8. No floating point anywhere (PRD 2.7 LOCKED).
library EntryCapacity {
    uint256 private constant UPDOWN_WAD = 1e18;

    /// @notice requiredUPDOWN = ceil(entryValueUsd8 / updownPriceUsd8), scaled back to 18dp UPDOWN.
    /// @dev Computed once at battle publication and locked on the Battle — never recomputed
    /// against a live price afterwards (PRD 3.3 non-negotiable invariant).
    function requiredUpdownFor(uint256 entryValueUsd8, uint256 updownPriceUsd8)
        internal
        pure
        returns (uint256)
    {
        require(updownPriceUsd8 > 0, "zero price");
        // entryValueUsd8 is USD at 1e8; multiplying by UPDOWN_WAD keeps 18dp precision in the
        // UPDOWN result before dividing by the (also 1e8-scaled) price.
        uint256 numerator = entryValueUsd8 * UPDOWN_WAD;
        uint256 result = numerator / updownPriceUsd8;
        if (numerator % updownPriceUsd8 != 0) {
            result += 1; // ceil, not floor — rounds in the protocol's favor per the PRD formula
        }
        return result;
    }

    /// @notice Entry capacity against a battle's locked requirement (not a live price).
    function capacityOf(uint256 updownBalance, uint256 requiredUpdownPerEntry)
        internal
        pure
        returns (uint256)
    {
        if (updownBalance == 0 || requiredUpdownPerEntry == 0) return 0;
        return updownBalance / requiredUpdownPerEntry;
    }
}
