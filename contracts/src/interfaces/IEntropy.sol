// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal IEntropyV2 interface for Dice Protocol's DiceEntropy oracle on Robinhood
/// Chain (https://diceprotocol.world). DiceEntropy exposes the same request/callback/fee
/// surface as Pyth Network's Entropy V2 SDK; we vendor a minimal copy rather than pulling the
/// full SDK as a dependency.
///
/// Every selector below was confirmed directly against the deployed contracts (not just the
/// docs) via `eth_getCode` + 4byte.directory selector lookup on both Robinhood Chain mainnet
/// (chain 4663) and testnet (chain 46630) — see contracts/script/DeployFeeds.s.sol for the
/// verified addresses and method.
interface IEntropyV2 {
    /// @notice Request a random number using the default provider, paying `getFeeV2()` in wei.
    /// @return sequenceNumber Identifier used to correlate the async callback.
    function requestV2() external payable returns (uint64 sequenceNumber);

    /// @notice Request with an explicit callback gas limit, using the default provider.
    function requestV2(uint32 gasLimit) external payable returns (uint64 sequenceNumber);

    /// @notice Request from a specific provider with an explicit callback gas limit. Preferred
    /// over the default-provider overload so the protocol's randomness source can't silently
    /// change if the entropy contract's configured default provider is ever updated.
    function requestV2(address provider, uint32 gasLimit) external payable returns (uint64 sequenceNumber);

    /// @notice Current fee (wei) for the default provider at the given callback gas limit.
    function getFeeV2(uint32 gasLimit) external view returns (uint256 fee);

    /// @notice Current fee (wei) for the default provider at the default gas limit.
    function getFeeV2() external view returns (uint256 fee);

    /// @notice Current fee (wei) for an explicit provider at the given callback gas limit.
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint256 fee);
}

/// @notice Consumers inherit this and implement `entropyCallback` to receive randomness.
/// @dev Mirrors @pythnetwork/entropy-sdk-solidity IEntropyConsumer.
abstract contract IEntropyConsumer {
    /// @notice Called by the Entropy contract once randomness is revealed.
    function _entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) external {
        address entropy = getEntropy();
        require(msg.sender == entropy, "IEntropyConsumer: caller not entropy");
        entropyCallback(sequence, provider, randomNumber);
    }

    /// @notice Address of the Entropy contract; consumer must return it.
    function getEntropy() internal view virtual returns (address);

    /// @notice Consumer-defined handler for the revealed random number.
    function entropyCallback(uint64 sequence, address provider, bytes32 randomNumber)
        internal
        virtual;
}
