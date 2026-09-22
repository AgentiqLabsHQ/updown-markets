// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";
import { IUpdownPriceOracle } from "./interfaces/IUpdownPriceOracle.sol";
import { IDiceSelector, IDiceConsumer } from "./interfaces/IDiceSelector.sol";
import { RewardVault } from "./RewardVault.sol";
import { BattleTypes } from "./libraries/BattleTypes.sol";
import { EntryCapacity } from "./libraries/EntryCapacity.sol";

/// @title BattleManager
/// @notice Coordinates the daily UpdownMarkets battle lifecycle: create → open → enter →
/// lock → settle → (dice on oversubscription) → claim. Entry allowance is derived from a
/// user's UPDOWN holdings against a requirement locked at battle creation; settlement compares
/// Chainlink % returns for the two stock tokens; reward custody lives in the RewardVault;
/// oversubscription winner selection lives in DiceSelector.
///
/// Entering a battle is free — no protocol fee is charged (PRD: "no fees on entries for now").
contract BattleManager is AccessControl, Pausable, ReentrancyGuard, IDiceConsumer {
    using EntryCapacity for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IERC20 public immutable updown;
    IUpdownPriceOracle public updownOracle;
    RewardVault public immutable vault;
    IDiceSelector public dice;

    /// @notice USD value of a single entry, scaled 1e8 (e.g. $100 -> 100e8).
    uint256 public entryValueUsd8;
    /// @notice Max age (seconds) a Chainlink answer may have before it's considered stale.
    uint256 public priceStaleness = 3600;
    /// @notice Per-wallet entry cap, recommended default 10 (PRD 2.8).
    uint32 public maxEntriesPerWallet = 10;
    /// @notice Days after settlement before an unclaimed pool becomes recoverable (PRD 2.11).
    uint256 public claimPeriod = 30 days;

    /// @notice Optional L2 sequencer-uptime feed (mainnet). If set, prices are rejected while
    /// the sequencer is down or within the grace period after it comes back.
    IAggregatorV3 public sequencerUptimeFeed;
    uint256 public sequencerGracePeriod = 3600;

    uint256 public battleCount;
    mapping(uint256 => BattleTypes.Battle) public battles;

    // Entries per side are append-only address lists; the array index is the entry id.
    mapping(uint256 => address[]) private _entriesA;
    mapping(uint256 => address[]) private _entriesB;
    mapping(uint256 => mapping(address => uint256)) public entriesOf; // per-wallet capacity accounting
    /// @notice The side a wallet has committed to for a battle, once it has any entries there.
    /// Side.None means the wallet hasn't entered yet. A wallet cannot enter the opposite side
    /// once this is set (PRD §4.5/§7, non-negotiable invariant "a wallet cannot select both
    /// sides of one battle").
    mapping(uint256 => mapping(address => BattleTypes.Side)) public sideOf;

    // Winner bookkeeping.
    mapping(uint256 => bool) public allWin;
    mapping(uint256 => mapping(uint256 => bool)) public diceWinner;
    /// @notice Aggregate claimable amount per wallet per battle (one claim covers every winning
    /// entry that wallet holds — PRD 3.14).
    mapping(uint256 => mapping(address => uint256)) public claimable;

    event BattleCreated(uint256 indexed battleId, BattleTypes.Config config, uint256 rewardPool);
    event Entered(uint256 indexed battleId, address indexed user, BattleTypes.Side side, uint256 entryIndex);
    event Locked(uint256 indexed battleId, int256 openPriceA, int256 openPriceB);
    event Settled(uint256 indexed battleId, BattleTypes.Side winningSide, uint256 winnerCount, uint256 perSlotReward);
    event Drawn(uint256 indexed battleId);
    event DiceRequested(uint256 indexed battleId, uint64 sequenceNumber);
    event DiceFinalized(uint256 indexed battleId, uint256[] winnerIndices);
    event Claimed(uint256 indexed battleId, address indexed user, uint256 amount);
    event Cancelled(uint256 indexed battleId);
    event RewardRecovered(uint256 indexed battleId);
    event ConfigUpdated();

    error BadTimes();
    error BadStatus();
    error NotOpenWindow();
    error CapacityExceeded();
    error MaxEntriesPerWalletExceeded();
    error MaxEntriesPerBattleExceeded();
    error SideAlreadySelected();
    error TooEarly();
    error NotDice();
    error NothingToClaim();
    error StalePrice();
    error OraclePausedErr();
    error SequencerDown();
    error ZeroAddress();
    error ClaimPeriodNotElapsed();
    error ClaimExpired();
    error InvalidWinnerCount();
    error UnexpectedValue();

    constructor(
        address admin,
        IERC20 updown_,
        IUpdownPriceOracle updownOracle_,
        RewardVault vault_,
        uint256 entryValueUsd8_
    ) {
        if (
            admin == address(0) || address(updown_) == address(0) || address(updownOracle_) == address(0)
                || address(vault_) == address(0)
        ) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        updown = updown_;
        updownOracle = updownOracle_;
        vault = vault_;
        entryValueUsd8 = entryValueUsd8_;
    }

    // ─────────────────────────── Admin config ───────────────────────────

    function setDice(IDiceSelector dice_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dice = dice_;
        emit ConfigUpdated();
    }

    function setUpdownOracle(IUpdownPriceOracle oracle_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(oracle_) == address(0)) revert ZeroAddress();
        updownOracle = oracle_;
        emit ConfigUpdated();
    }

    function setEntryValueUsd8(uint256 v) external onlyRole(DEFAULT_ADMIN_ROLE) {
        entryValueUsd8 = v;
        emit ConfigUpdated();
    }

    function setPriceStaleness(uint256 s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceStaleness = s;
        emit ConfigUpdated();
    }

    function setMaxEntriesPerWallet(uint32 m) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxEntriesPerWallet = m;
        emit ConfigUpdated();
    }

    function setClaimPeriod(uint256 seconds_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimPeriod = seconds_;
        emit ConfigUpdated();
    }

    function setSequencerFeed(IAggregatorV3 feed, uint256 grace)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        sequencerUptimeFeed = feed;
        sequencerGracePeriod = grace;
        emit ConfigUpdated();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─────────────────────────── Lifecycle ───────────────────────────

    /// @notice Create and publish a battle, funding its reward pool in one step (operator must
    /// hold/approve `rewardPool` of `cfg.rewardToken`, or send it as msg.value for native ETH).
    /// The UPDOWN requirement per entry is locked here, from the oracle price at this moment, and
    /// never recalculated for the lifetime of the battle.
    function createBattle(BattleTypes.Config calldata cfg, uint256 rewardPool)
        external
        payable
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        returns (uint256 battleId)
    {
        if (!(cfg.openTime < cfg.lockTime && cfg.lockTime <= cfg.settleTime)) revert BadTimes();
        if (cfg.feedA == address(0) || cfg.feedB == address(0)) revert ZeroAddress();
        if (cfg.winnerSlots == 0 || cfg.maxEntriesPerBattle == 0) revert BadTimes();
        if (cfg.rewardToken != address(0) && msg.value != 0) revert UnexpectedValue();

        uint256 updownPriceUsd8 = updownOracle.updownPriceUsd();
        uint256 requiredUpdownPerEntry = EntryCapacity.requiredUpdownFor(entryValueUsd8, updownPriceUsd8);

        battleId = ++battleCount;
        BattleTypes.Battle storage b = battles[battleId];
        b.status = BattleTypes.Status.Open;
        b.feedA = cfg.feedA;
        b.feedB = cfg.feedB;
        b.tokenA = cfg.tokenA;
        b.tokenB = cfg.tokenB;
        b.openTime = cfg.openTime;
        b.lockTime = cfg.lockTime;
        b.settleTime = cfg.settleTime;
        b.winnerSlots = cfg.winnerSlots;
        b.maxEntriesPerBattle = cfg.maxEntriesPerBattle;
        b.updownPriceUsd8 = updownPriceUsd8;
        b.requiredUpdownPerEntry = requiredUpdownPerEntry;
        b.rewardToken = cfg.rewardToken;
        b.rewardPool = uint128(rewardPool);

        vault.collect{ value: msg.value }(battleId, cfg.rewardToken, msg.sender, rewardPool);
        emit BattleCreated(battleId, cfg, rewardPool);
    }

    /// @notice Enter a battle on `side`, within capacity and the open window. No fee is charged.
    function enter(uint256 battleId, BattleTypes.Side side) external whenNotPaused {
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.Open) revert BadStatus();
        if (block.timestamp < b.openTime || block.timestamp >= b.lockTime) revert NotOpenWindow();
        if (side != BattleTypes.Side.A && side != BattleTypes.Side.B) revert BadStatus();
        if (b.totalEntries >= b.maxEntriesPerBattle) revert MaxEntriesPerBattleExceeded();

        BattleTypes.Side existingSide = sideOf[battleId][msg.sender];
        if (existingSide != BattleTypes.Side.None && existingSide != side) revert SideAlreadySelected();

        uint256 cap = updown.balanceOf(msg.sender).capacityOf(b.requiredUpdownPerEntry);
        uint256 used = entriesOf[battleId][msg.sender];
        if (used >= cap) revert CapacityExceeded();
        if (used >= maxEntriesPerWallet) revert MaxEntriesPerWalletExceeded();
        entriesOf[battleId][msg.sender] = used + 1;
        sideOf[battleId][msg.sender] = side;
        b.totalEntries += 1;

        uint256 entryIndex;
        if (side == BattleTypes.Side.A) {
            entryIndex = _entriesA[battleId].length;
            _entriesA[battleId].push(msg.sender);
        } else {
            entryIndex = _entriesB[battleId].length;
            _entriesB[battleId].push(msg.sender);
        }

        emit Entered(battleId, msg.sender, side, entryIndex);
    }

    /// @notice Lock a battle after `lockTime`, snapshotting open prices.
    function lock(uint256 battleId) external whenNotPaused {
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.Open) revert BadStatus();
        if (block.timestamp < b.lockTime) revert TooEarly();
        _checkSequencer();
        b.openPriceA = _readPrice(b.feedA, b.tokenA);
        b.openPriceB = _readPrice(b.feedB, b.tokenB);
        b.status = BattleTypes.Status.Locked;
        emit Locked(battleId, b.openPriceA, b.openPriceB);
    }

    /// @notice Settle a battle after `settleTime`. Send `msg.value` >= dice fee to cover an
    /// oversubscription selection; any unused value is refunded via DiceSelector.
    function settle(uint256 battleId) external payable whenNotPaused nonReentrant {
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.Locked) revert BadStatus();
        if (block.timestamp < b.settleTime) revert TooEarly();
        _checkSequencer();

        b.closePriceA = _readPrice(b.feedA, b.tokenA);
        b.closePriceB = _readPrice(b.feedB, b.tokenB);

        BattleTypes.Side winner = _winningSide(b);
        b.winningSide = winner;

        // Exact tie: a normal (non-exceptional) settlement outcome. No winner, no Dice; the pool
        // remains held and becomes recoverable once the claim period elapses (never touched
        // instantly — this is not a "fee").
        if (winner == BattleTypes.Side.None) {
            b.status = BattleTypes.Status.Drawn;
            emit Drawn(battleId);
            return;
        }

        uint256 candCount =
            winner == BattleTypes.Side.A ? _entriesA[battleId].length : _entriesB[battleId].length;
        uint256 slots = b.winnerSlots;

        if (candCount == 0) {
            b.status = BattleTypes.Status.Settled;
            emit Settled(battleId, winner, 0, 0);
            return;
        }

        uint256 perSlot = uint256(b.rewardPool) / slots;
        b.perSlotReward = uint128(perSlot);

        if (candCount <= slots) {
            // Everyone on the winning side is paid a full slot; unfilled slots simply remain
            // unclaimed in the vault (recoverable after expiry — not swept anywhere immediately).
            allWin[battleId] = true;
            b.winnerCount = uint32(candCount);
            address[] storage cands = winner == BattleTypes.Side.A ? _entriesA[battleId] : _entriesB[battleId];
            for (uint256 i = 0; i < cands.length; i++) {
                claimable[battleId][cands[i]] += perSlot;
            }
            b.status = BattleTypes.Status.Settled;
            emit Settled(battleId, winner, candCount, perSlot);
        } else {
            // Oversubscribed → ask Dice to pick `slots` winners.
            b.status = BattleTypes.Status.AwaitingDice;
            uint64 seq = dice.requestSelection{ value: msg.value }(battleId, candCount, slots);
            emit DiceRequested(battleId, seq);
        }
    }

    /// @inheritdoc IDiceConsumer
    function finalizeDice(uint256 battleId, uint256[] calldata winnerIndices) external {
        if (msg.sender != address(dice)) revert NotDice();
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.AwaitingDice) revert BadStatus();
        if (winnerIndices.length != b.winnerSlots) revert InvalidWinnerCount();

        address[] storage cands =
            b.winningSide == BattleTypes.Side.A ? _entriesA[battleId] : _entriesB[battleId];
        uint256 perSlot = b.perSlotReward;
        for (uint256 i = 0; i < winnerIndices.length; i++) {
            uint256 idx = winnerIndices[i];
            diceWinner[battleId][idx] = true;
            claimable[battleId][cands[idx]] += perSlot;
        }
        b.winnerCount = uint32(winnerIndices.length);

        b.status = BattleTypes.Status.Settled;
        emit DiceFinalized(battleId, winnerIndices);
        emit Settled(battleId, b.winningSide, winnerIndices.length, perSlot);
    }

    /// @notice Claim a wallet's full aggregate reward for a battle in one transaction, regardless
    /// of how many winning entries it holds.
    function claim(uint256 battleId) external nonReentrant {
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.Settled) revert BadStatus();
        if (block.timestamp >= b.settleTime + claimPeriod) revert ClaimExpired();

        uint256 amount = claimable[battleId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[battleId][msg.sender] = 0;

        vault.payout(battleId, msg.sender, amount);
        emit Claimed(battleId, msg.sender, amount);
    }

    /// @notice Cancel a battle before it locks (exceptional path only — e.g. a market-session
    /// disruption). The pool remains recoverable after the claim period, same as a draw.
    function cancelBattle(uint256 battleId) external onlyRole(OPERATOR_ROLE) {
        BattleTypes.Battle storage b = battles[battleId];
        if (b.status != BattleTypes.Status.Open) revert BadStatus();
        b.status = BattleTypes.Status.Cancelled;
        emit Cancelled(battleId);
    }

    /// @notice Permissionlessly recover a battle's unclaimed pool once the claim period has
    /// elapsed since settlement. Never touches an active reservation — only callable once the
    /// battle has reached a terminal state and the claim window has actually passed.
    function recoverUnclaimed(uint256 battleId) external {
        BattleTypes.Battle storage b = battles[battleId];
        bool terminal = b.status == BattleTypes.Status.Settled || b.status == BattleTypes.Status.Drawn
            || b.status == BattleTypes.Status.Cancelled;
        if (!terminal) revert BadStatus();
        uint256 elapsedFrom = b.settleTime > 0 ? b.settleTime : b.lockTime;
        if (block.timestamp < elapsedFrom + claimPeriod) revert ClaimPeriodNotElapsed();
        vault.recoverExpired(battleId);
        emit RewardRecovered(battleId);
    }

    // ─────────────────────────── Views ───────────────────────────

    function getBattle(uint256 battleId) external view returns (BattleTypes.Battle memory) {
        return battles[battleId];
    }

    function entriesCount(uint256 battleId) external view returns (uint256 a, uint256 b) {
        return (_entriesA[battleId].length, _entriesB[battleId].length);
    }

    function entryAt(uint256 battleId, BattleTypes.Side side, uint256 index)
        external
        view
        returns (address)
    {
        return side == BattleTypes.Side.A ? _entriesA[battleId][index] : _entriesB[battleId][index];
    }

    function capacityOfUser(uint256 battleId, address user) external view returns (uint256) {
        BattleTypes.Battle storage b = battles[battleId];
        uint256 cap = updown.balanceOf(user).capacityOf(b.requiredUpdownPerEntry);
        return cap < maxEntriesPerWallet ? cap : maxEntriesPerWallet;
    }

    // ─────────────────────────── Internals ───────────────────────────

    function _winningSide(BattleTypes.Battle storage b)
        internal
        view
        returns (BattleTypes.Side)
    {
        // percentage return scaled 1e18: (close - open) / open
        int256 retA = ((b.closePriceA - b.openPriceA) * 1e18) / b.openPriceA;
        int256 retB = ((b.closePriceB - b.openPriceB) * 1e18) / b.openPriceB;
        if (retA > retB) return BattleTypes.Side.A;
        if (retB > retA) return BattleTypes.Side.B;
        return BattleTypes.Side.None; // exact tie
    }

    function _readPrice(address feed, address token) internal view returns (int256) {
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) revert StalePrice();
        if (block.timestamp - updatedAt > priceStaleness) revert StalePrice();
        _checkOraclePaused(token);
        return answer;
    }

    /// @dev Robinhood Stock Tokens expose oraclePaused() during corporate-action processing.
    /// Per Robinhood's own docs this flag is advisory (not enforced on-chain), so we treat a
    /// failed/unsupported call (e.g. a testnet mock) as "not paused" rather than reverting, while
    /// staleness (above) remains the primary guard.
    function _checkOraclePaused(address token) internal view {
        if (token == address(0)) return;
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("oraclePaused()"));
        if (ok && data.length >= 32 && abi.decode(data, (bool))) revert OraclePausedErr();
    }

    function _checkSequencer() internal view {
        IAggregatorV3 feed = sequencerUptimeFeed;
        if (address(feed) == address(0)) return; // not configured (testnet)
        (, int256 answer, uint256 startedAt,,) = feed.latestRoundData();
        // 0 = sequencer up, 1 = down
        if (answer != 0) revert SequencerDown();
        if (block.timestamp - startedAt <= sequencerGracePeriod) revert SequencerDown();
    }
}
