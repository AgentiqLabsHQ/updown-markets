// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Price source for the UPDOWN token in USD, used to size entry capacity.
/// @dev Testnet: a settable mock. Mainnet: a Uniswap v3/v4 TWAP adapter reading the
/// UPDOWN/USDC pool on Robinhood Chain. Always returns USD with 8 decimals.
interface IUpdownPriceOracle {
    /// @return priceUsd8 UPDOWN price in USD scaled to 1e8 (e.g. $0.50 -> 50_000_000).
    function updownPriceUsd() external view returns (uint256 priceUsd8);
}
