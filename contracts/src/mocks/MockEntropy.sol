// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IEntropyV2, IEntropyConsumer } from "../interfaces/IEntropy.sol";

/// @notice TESTNET-ONLY Pyth Entropy stand-in. Records requests and lets a test/keeper
/// deliver the callback with a chosen random number, emulating the real reveal flow.
contract MockEntropy is IEntropyV2 {
    uint64 public sequence;
    uint256 public fee = 0.0001 ether;

    struct Request {
        address requester;
        bool pending;
    }

    mapping(uint64 => Request) public requests;

    event Requested(uint64 indexed sequenceNumber, address indexed requester);
    event Revealed(uint64 indexed sequenceNumber, bytes32 randomNumber);

    function setFee(uint256 newFee) external {
        fee = newFee;
    }

    function requestV2() external payable returns (uint64) {
        return _request();
    }

    function requestV2(uint32) external payable returns (uint64) {
        return _request();
    }

    function requestV2(address, uint32) external payable returns (uint64) {
        return _request();
    }

    function _request() internal returns (uint64) {
        require(msg.value >= fee, "MockEntropy: fee");
        sequence += 1;
        requests[sequence] = Request({ requester: msg.sender, pending: true });
        emit Requested(sequence, msg.sender);
        return sequence;
    }

    function getFeeV2() external view returns (uint256) {
        return fee;
    }

    function getFeeV2(uint32) external view returns (uint256) {
        return fee;
    }

    function getFeeV2(address, uint32) external view returns (uint256) {
        return fee;
    }

    /// @notice Test/keeper helper: deliver the random number to the requester's callback.
    function reveal(uint64 sequenceNumber, bytes32 randomNumber) external {
        Request storage r = requests[sequenceNumber];
        require(r.pending, "MockEntropy: not pending");
        r.pending = false;
        emit Revealed(sequenceNumber, randomNumber);
        IEntropyConsumer(r.requester)._entropyCallback(sequenceNumber, address(this), randomNumber);
    }
}
