// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TESTNET-ONLY 6-decimal USDC stand-in with an open faucet.
/// @dev On mainnet we use the canonical Robinhood Chain USDC address instead.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e6; // 1,000 USDC

    constructor() ERC20("USD Coin (Testnet)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
