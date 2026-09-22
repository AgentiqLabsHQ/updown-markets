// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";

/// @notice TESTNET-ONLY settable Chainlink-style price feed for stock tokens and the
/// L2 sequencer-uptime feed. Lets tests drive open/close prices deterministically.
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 private _decimals;
    string private _description;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        _decimals = decimals_;
        _description = description_;
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
        _roundId = 1;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    /// @notice Test helper: set the current answer and bump the round/timestamp.
    function setAnswer(int256 answer_) external {
        _answer = answer_;
        _updatedAt = block.timestamp;
        _roundId += 1;
    }

    /// @notice Test helper: set a stale updatedAt to exercise staleness guards.
    function setUpdatedAt(uint256 ts) external {
        _updatedAt = ts;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        // For a sequencer-uptime feed, answer 0 = up, 1 = down; startedAt = time it changed.
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
