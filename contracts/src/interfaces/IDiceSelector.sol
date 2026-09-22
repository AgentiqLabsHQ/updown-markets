// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Verifiable random winner selection for oversubscribed battles (Pyth Entropy).
interface IDiceSelector {
    /// @notice Request selection of `slots` winners out of `candidateCount` for `battleId`.
    /// @dev Payable: forwards the Entropy fee. Result is delivered asynchronously via the
    /// Entropy callback, which then calls BattleManager.finalizeDice(...).
    function requestSelection(uint256 battleId, uint256 candidateCount, uint256 slots)
        external
        payable
        returns (uint64 sequenceNumber);

    /// @notice Current Entropy fee (wei) for a selection request.
    function selectionFee() external view returns (uint256);
}

/// @notice Callback surface DiceSelector uses to hand results back to the BattleManager.
interface IDiceConsumer {
    /// @notice Finalize a battle with the winning candidate indices chosen by Dice.
    function finalizeDice(uint256 battleId, uint256[] calldata winnerIndices) external;
}
