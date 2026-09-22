# UpdownMarkets — Smart Contracts (Phase 1)

Foundry workspace for the on-chain battle protocol on **Robinhood Chain** (Arbitrum L2 · testnet chain `46630` · mainnet chain `4663`).

## Architecture

| Contract | Responsibility |
|---|---|
| `BattleManager` | Hub: battle lifecycle (create→open→enter→lock→settle→claim), entry-capacity checks, Chainlink settlement, roles (`AccessControl`), pausable |
| `RewardVault` | Isolated USDC custody. Only the manager moves funds; owner sweeps platform fees |
| `DiceSelector` | "Dice" — verifiable random winner selection on oversubscription, via **Pyth Entropy** (commit-reveal), Fisher-Yates pick |
| `libraries/EntryCapacity` | `capacity = holdingsUSD / entryValueUSD` from UPDOWN balance × price |
| `libraries/BattleTypes` | Shared enums/structs |
| `interfaces/*` | Chainlink `AggregatorV3`, Pyth `IEntropyV2`/consumer, internal vault/dice/oracle |
| `mocks/*` | Testnet UPDOWN (+faucet), USDC (+faucet), settable price feed, settable UPDOWN oracle, Entropy stand-in |

## Battle lifecycle
1. **create** (operator) — funds the USDC reward pool into the vault
2. **enter** (user) — within `[openTime, lockTime)`, up to capacity; pays USDC entry fee
3. **lock** — after `lockTime`, snapshots Chainlink open prices (sequencer + staleness guards)
4. **settle** — after `settleTime`, reads close prices; higher **% return** wins
   - winners ≤ slots → all paid `pool / slots`; unfilled slots → fees
   - winners > slots → **Dice** requests randomness; `finalizeDice` picks `slots` winners
5. **claim** — winning entries withdraw `perSlotReward`

## Key decisions baked in
- **Randomness = Pyth Entropy** (Chainlink VRF is not on Robinhood Chain). Swappable via `DiceSelector`.
- **Settlement source = Chainlink tokenized-equity feeds** on Robinhood Chain, with an **L2 sequencer-uptime** guard.
- **Entry value = $2** (`ENTRY_VALUE_USD8 = 2e8`), configurable on-chain.
- **USDC** for entry fees + reward pools (6 decimals).

## Build & test
```bash
forge build
forge test -vv
```

## Deploy (testnet — mock-backed, self-contained)
```bash
cp .env.example .env    # set RH_TESTNET_RPC + PRIVATE_KEY (testnet-only)
forge script script/Deploy.s.sol --rpc-url rh_testnet --broadcast
```
On mainnet, swap the mocks for the real Robinhood Chain USDC, Pyth Entropy, Chainlink feeds, and the real UPDOWN token (addresses via `.env`), and point admin at a Safe multisig.

## Status
✅ Phase 1: contracts + mocks + deploy script + tests (capacity math, full lifecycle, dice oversubscription, capacity enforcement) — all passing.
Next: expand test coverage (fuzz/invariants, sequencer/staleness reverts, refunds), Slither, then testnet deploy + indexer.
