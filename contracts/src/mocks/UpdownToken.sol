// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice TESTNET-ONLY mock of the UPDOWN token with an open faucet.
/// @dev The real UPDOWN token is deployed separately for mainnet; this exists so we can
/// exercise entry-capacity flows on Robinhood testnet. 18 decimals like a standard ERC20.
contract UpdownToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    constructor(address initialOwner) ERC20("Updown (Testnet)", "UPDOWN") Ownable(initialOwner) {}

    /// @notice Mint yourself test UPDOWN (testnet convenience only).
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner mint for seeding test accounts.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
