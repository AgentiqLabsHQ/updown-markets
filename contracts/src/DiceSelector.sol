// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IEntropyV2, IEntropyConsumer } from "./interfaces/IEntropy.sol";
import { IDiceSelector, IDiceConsumer } from "./interfaces/IDiceSelector.sol";

/// @notice "Dice" — verifiable random selection of winners when a battle is oversubscribed
/// (winning entries > winner slots).
///
/// @dev Integrates Dice Protocol's DiceEntropy oracle for Robinhood Chain
/// (https://diceprotocol.world). DiceEntropy exposes the same `IEntropyV2`/`IEntropyConsumer`
/// interface as Pyth Network's Entropy V2 (request now, receive a verifiable random word in an
/// async callback) — verified directly on-chain against the addresses the protocol spec pins:
/// calling `getProviderInfoV2(provider)` on both the mainnet (chain 4663) and testnet (chain
/// 46630) DiceEntropy contracts returns a registered provider whose embedded URI resolves to
/// `tyche.diceprotocol.world` / `diceprotocol.world/testnet` respectively — i.e. this is Dice
/// Protocol's own deployment, not a generic/unrelated Pyth instance. See contracts/RESEARCH.md
/// for the full verification method and addresses.
///
/// Winner selection uses a sparse partial Fisher-Yates shuffle (memory-bounded by the winner
/// count `K`, never allocating an array sized by the candidate count `N`) combined with rejection
/// sampling, so the selection is both unbiased and O(K) rather than O(N).
contract DiceSelector is IDiceSelector, IEntropyConsumer, Ownable2Step {
    IEntropyV2 public immutable entropy;
    /// @notice Explicit Dice Protocol provider address — requests always name this provider
    /// rather than relying on the entropy contract's "default", so the randomness source can't
    /// silently change out from under the protocol.
    address public provider;
    address public manager;
    uint32 public callbackGasLimit = 200_000;

    struct Selection {
        uint256 battleId;
        uint256 candidateCount;
        uint256 slots;
        bool pending;
    }

    mapping(uint64 => Selection) public selections;

    event ManagerUpdated(address indexed manager);
    event ProviderUpdated(address indexed provider);
    event CallbackGasLimitUpdated(uint32 gasLimit);
    event SelectionRequested(
        uint256 indexed battleId, uint64 indexed sequenceNumber, uint256 candidateCount, uint256 slots
    );
    event SelectionRevealed(uint256 indexed battleId, uint64 indexed sequenceNumber);

    error NotManager();
    error ZeroAddress();
    error BadParams();
    error FeeTooLow();

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    constructor(IEntropyV2 entropy_, address provider_, address initialOwner) Ownable(initialOwner) {
        if (
            address(entropy_) == address(0) || provider_ == address(0) || initialOwner == address(0)
        ) revert ZeroAddress();
        entropy = entropy_;
        provider = provider_;
    }

    function setManager(address manager_) external onlyOwner {
        if (manager_ == address(0)) revert ZeroAddress();
        manager = manager_;
        emit ManagerUpdated(manager_);
    }

    function setProvider(address provider_) external onlyOwner {
        if (provider_ == address(0)) revert ZeroAddress();
        provider = provider_;
        emit ProviderUpdated(provider_);
    }

    function setCallbackGasLimit(uint32 gasLimit) external onlyOwner {
        callbackGasLimit = gasLimit;
        emit CallbackGasLimitUpdated(gasLimit);
    }

    /// @inheritdoc IDiceSelector
    function selectionFee() public view returns (uint256) {
        return entropy.getFeeV2(provider, callbackGasLimit);
    }

    /// @inheritdoc IDiceSelector
    function requestSelection(uint256 battleId, uint256 candidateCount, uint256 slots)
        external
        payable
        onlyManager
        returns (uint64 sequenceNumber)
    {
        if (slots == 0 || candidateCount <= slots) revert BadParams();
        uint256 fee = entropy.getFeeV2(provider, callbackGasLimit);
        if (msg.value < fee) revert FeeTooLow();

        sequenceNumber = entropy.requestV2{ value: fee }(provider, callbackGasLimit);
        selections[sequenceNumber] = Selection({
            battleId: battleId,
            candidateCount: candidateCount,
            slots: slots,
            pending: true
        });
        emit SelectionRequested(battleId, sequenceNumber, candidateCount, slots);

        // Refund any fee overpayment to the manager.
        uint256 refund = msg.value - fee;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{ value: refund }("");
            require(ok, "refund failed");
        }
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /// @dev Entropy reveal callback: derive winners and finalize the battle. Replay-safe — a
    /// sequence number can only be consumed once (`pending` is cleared before any external call).
    function entropyCallback(uint64 sequence, address, bytes32 randomNumber) internal override {
        Selection storage s = selections[sequence];
        require(s.pending, "no selection");
        s.pending = false;

        uint256[] memory winners =
            _pick(s.battleId, s.candidateCount, s.slots, uint256(randomNumber));
        emit SelectionRevealed(s.battleId, sequence);
        IDiceConsumer(manager).finalizeDice(s.battleId, winners);
    }

    /// @dev Sparse partial Fisher-Yates with rejection sampling. Picks `slots` unique indices in
    /// [0, n) given `seed`. Memory cost is O(slots), never O(n): instead of a full n-element
    /// permutation array (PRD 9.10 explicitly forbids this), we track only the up-to-`slots`
    /// positions actually touched, via two small parallel arrays searched linearly — cheap
    /// because `slots` is small and bounded, and untouched positions are implicitly identity
    /// (`value(i) == i`). Rejection sampling (PRD 9.9) avoids modulo bias: candidates at or above
    /// the largest multiple of `remaining` that fits in 2^256 are discarded and re-drawn.
    function _pick(uint256 battleId, uint256 n, uint256 slots, uint256 seed)
        internal
        pure
        returns (uint256[] memory chosen)
    {
        // Each of the `slots` iterations can touch up to 2 positions (k and, when k != j, j) —
        // size for the worst case rather than bound-checking on every write.
        uint256[] memory touchedKey = new uint256[](slots * 2);
        uint256[] memory touchedVal = new uint256[](slots * 2);
        uint256 touchedCount = 0;
        chosen = new uint256[](slots);
        uint256 counter = 0;

        for (uint256 k = 0; k < slots; k++) {
            uint256 remaining = n - k;
            // Largest multiple of `remaining` that fits in 2^256 — candidates at/above this are
            // rejected so every remaining index has exactly equal probability.
            uint256 limit = remaining == 0 ? 0 : (type(uint256).max / remaining) * remaining;

            uint256 candidate;
            while (true) {
                candidate = uint256(keccak256(abi.encode(seed, battleId, n, slots, counter)));
                counter++;
                if (limit == 0 || candidate < limit) break;
            }
            uint256 j = k + (candidate % remaining);

            uint256 valK = _valueAt(touchedKey, touchedVal, touchedCount, k);
            uint256 valJ = _valueAt(touchedKey, touchedVal, touchedCount, j);

            // pool[k] = valJ (swap); pool[j] = valK
            touchedKey[touchedCount] = k;
            touchedVal[touchedCount] = valJ;
            touchedCount++;
            if (j != k) {
                touchedKey[touchedCount] = j;
                touchedVal[touchedCount] = valK;
                touchedCount++;
            }

            chosen[k] = valJ;
        }
    }

    /// @dev A position can be written more than once across iterations (once as a `k`, again
    /// later as a `j`), so this must return the *most recent* write for `i`, not the first
    /// match — otherwise a stale, already-superseded value could be returned.
    function _valueAt(uint256[] memory keys, uint256[] memory vals, uint256 count, uint256 i)
        private
        pure
        returns (uint256)
    {
        uint256 result = i;
        for (uint256 idx = 0; idx < count; idx++) {
            if (keys[idx] == i) result = vals[idx];
        }
        return result;
    }
}
