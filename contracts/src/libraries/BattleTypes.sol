// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared enums and structs for the UpdownMarkets battle protocol.
library BattleTypes {
    /// @dev Which side of the pair an entry backs.
    enum Side {
        None,
        A,
        B
    }

    /// @dev Battle lifecycle. Dice states are only reached on oversubscription. `Drawn` is a
    /// normal settlement outcome (exact tie) — distinct from `Cancelled`, which is reserved for
    /// exceptional pre-settlement termination (e.g. a missing/invalid oracle observation).
    enum Status {
        None,
        Open, // accepting entries (openTime <= now < lockTime)
        Locked, // entries closed, open prices snapshotted (lockTime reached)
        AwaitingDice, // settled a winning side but winners > slots; randomness requested
        Settled, // winners finalized; claims open
        Drawn, // exact-tie outcome; no winners, pool recoverable after the claim period
        Cancelled // battle voided pre-settlement; pool recoverable after the claim period
    }

    struct Config {
        address feedA; // Chainlink aggregator for side A stock token
        address feedB; // Chainlink aggregator for side B stock token
        // Underlying Robinhood Stock Token contracts, used only for the optional oraclePaused()
        // corporate-action check. address(0) skips the check (e.g. testnet mocks).
        address tokenA;
        address tokenB;
        uint64 openTime; // entries allowed from this timestamp
        uint64 lockTime; // entries close; open prices snapshotted at/after this
        uint64 settleTime; // close prices read at/after this
        uint32 winnerSlots; // max number of paid winners
        uint32 maxEntriesPerBattle; // battle-wide entry cap (both sides combined)
        address rewardToken; // must be allowlisted on the RewardVault; address(0) = native ETH
    }

    struct Battle {
        Status status;
        BattleTypes.Side winningSide;
        address feedA;
        address feedB;
        address tokenA;
        address tokenB;
        uint64 openTime;
        uint64 lockTime;
        uint64 settleTime;
        uint32 winnerSlots;
        uint32 maxEntriesPerBattle;
        uint32 totalEntries;
        // Locked at publication (createBattle) and immutable thereafter — every entrant uses the
        // same UPDOWN requirement regardless of when, during the entry window, they enter.
        uint256 updownPriceUsd8;
        uint256 requiredUpdownPerEntry;
        int256 openPriceA;
        int256 openPriceB;
        int256 closePriceA;
        int256 closePriceB;
        address rewardToken;
        uint128 rewardPool;
        uint128 perSlotReward; // computed at settlement
        uint32 winnerCount; // number of actual winners (<= winnerSlots)
    }
}
