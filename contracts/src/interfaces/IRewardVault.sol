// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Custody for the protocol's reward pools. Only the BattleManager (`manager`) may move
/// funds. Supports an allowlist of reward tokens (native ETH via address(0), or an allowlisted
/// ERC-20) — one token per battle, fixed at funding time.
interface IRewardVault {
    /// @notice Pull `amount` of `token` from `from` into the vault, credited to `battleId`'s
    /// pool. For native ETH (`token == address(0)`), `amount` must equal `msg.value`.
    function collect(uint256 battleId, address token, address from, uint256 amount) external payable;

    /// @notice Pay `to` `amount` of `battleId`'s reward token from its balance (winner claim).
    function payout(uint256 battleId, address to, uint256 amount) external;

    /// @notice Sweep a battle's entire remaining balance to the configured recovery beneficiary.
    /// Caller (BattleManager) is responsible for enforcing the claim-expiry timing.
    function recoverExpired(uint256 battleId) external;

    /// @notice Reward token held for a given battle (address(0) = native ETH).
    function battleToken(uint256 battleId) external view returns (address);

    /// @notice Remaining balance for a given battle, in its reward token's units.
    function battleBalance(uint256 battleId) external view returns (uint256);
}
