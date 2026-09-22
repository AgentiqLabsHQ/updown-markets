// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IUpdownPriceOracle } from "../interfaces/IUpdownPriceOracle.sol";

/// @notice TESTNET-ONLY settable UPDOWN/USD price oracle (1e8). Mainnet uses a Uniswap TWAP adapter.
contract MockUpdownPriceOracle is IUpdownPriceOracle {
    uint256 private _priceUsd8;

    constructor(uint256 initialPriceUsd8) {
        _priceUsd8 = initialPriceUsd8;
    }

    function setPrice(uint256 priceUsd8) external {
        _priceUsd8 = priceUsd8;
    }

    function updownPriceUsd() external view returns (uint256) {
        return _priceUsd8;
    }
}
