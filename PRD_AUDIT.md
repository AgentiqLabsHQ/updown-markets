# PRD Audit — UpdownMarkets V1

Verified 2026-09-09 against the full 69-page/10-message PRD, re-read in full for this pass (not
from memory). Methodology: fresh reads of every contract and the key backend/frontend files,
cross-checked against live on-chain state on Robinhood testnet where it mattered (not just
"the code looks right" — actual `eth_call`/`eth_getLogs` reads and, for the claim flow, a forked
end-to-end run against the real deployed bytecode). Two real bugs were found and fixed during this
pass; both are called out below with what changed.

Legend: ✅ implemented and verified · ⚠️ partial / deviates from the PRD · ❌ missing · 🚫 explicit
non-goal, correctly not built.

---

## Headline: one critical bug found and fixed this pass

**A wallet could enter both sides of the same battle.** `enter()` only tracked a per-wallet entry
*count*, never *which side* a wallet had committed to — so nothing stopped entering Side A, then
also entering Side B. This directly breaks a requirement stated repeatedly and explicitly as
LOCKED (PRD §4.5, §7, §26 non-negotiable invariants, and a named `SideAlreadySelected` error that
existed in the spec but was never wired into the contract).

Fixed: added `sideOf(battleId, wallet)`, set on first entry, checked on every entry — the same
side can be entered repeatedly (that's the whole point of multiple entries), only the *opposite*
side is now blocked. Regression test added (`test_cannotEnterBothSides`), full suite passes (19
tests, 1 opt-in fork test skipped by default).

**Redeployed and verified live.** New `BattleManager`: `0x6d9C10e219F55086777D0a4b81E3e8b9D4016CDd`
(`RewardVault`/`DiceSelector` reused, `manager` repointed to it). Proved the fix on the actual
deployed bytecode via a forked test against real testnet state
(`test_cannotEnterBothSides_onRealDeployedContract`) — entering the opposite side now reverts
with `SideAlreadySelected`, confirmed against the live contract, not a local copy.

Redeploying surfaced a second finding, since fixed and also redeployed: `RewardVault.battleBalance`
was keyed by a raw battle number, not scoped to which `BattleManager` wrote it, so a fresh
manager's battle numbering colliding with an old manager's leftover data in the same reused vault
was possible (and happened — confirmed on-chain). Fixed by keying vault storage by
`(manager, battleId)` internally (external read signatures unchanged — `battleToken`/
`battleBalance` still take just a `battleId` and resolve against the current manager; added
`battleTokenFor`/`battleBalanceFor` for inspecting a superseded manager's data explicitly).
`BattleManager.vault` is an immutable reference, so this required redeploying both contracts
together — reused `DiceSelector`, unaffected by either fix. Current live addresses:
`BattleManager 0x27481D71C02ebd54aF6c5B2B4431Cc443a427454`,
`RewardVault 0x1a0D29Cd5749F74fdE2552c4A8275421a35b554E`.

Verified live, twice: a dedicated regression test reproducing the exact collision scenario
(`contracts/test/RewardVault.t.sol`) against a fresh local vault, and the full claim-flow +
both-sides fork tests against the real redeployed contracts on testnet — both pass. Full history
in `contracts/deployments/46630-v2.json` / `-v2.1.json` / `-v2.2.json`.

---

## 1. Product Definition (§1)

| Requirement | Status | Notes |
|---|---|---|
| One battle per valid US equity trading session | ✅ | Fixed this session — `scripts/market-calendar.mjs` computes real NYSE sessions (holiday rules, not a yearly list); `keeper.mjs` skips weekends/holidays entirely. Previously used an arbitrary rolling window. |
| Battle compares two Stock Tokens via Chainlink feeds | ✅ | `BattleTypes.Config.feedA/feedB` |
| UPDOWN determines entries, not staked/transferred/burned | ✅ | `enter()` only reads `updown.balanceOf()` — no transfer call anywhere in the entry path |
| Entry is an independent ticket, sequential index | ✅ | `_entriesA`/`_entriesB` arrays, `Entered` event carries `entryIndex` |
| **Wallet picks exactly one side, enforced by contract** | ✅ (fixed this pass) | Was broken; see headline above |
| V1 explicitly an experiment, no unnecessary V2 scope | ✅ | No leverage/lending/secondary-market/order-book code anywhere in the repo |

## 2. Protocol Parameters (§2)

| Requirement | Status | Notes |
|---|---|---|
| Chain IDs 4663 mainnet / 46630 testnet | ✅ | `contracts/script/Deploy.s.sol`, `lib/chain.ts` |
| One battle per session (weekends/holidays excluded, early closes use official time) | ✅ | Same market-calendar fix as above |
| Entry schedule (entryOpen/entryLock/marketStart/marketEnd, 4 distinct timestamps) | ⚠️ | Contract models 3 timestamps (open/lock/settle), not 4 — `lock()` closes entries **and** snapshots the open price in the same instant, rather than closing entries 30 min before market open per the PRD's example defaults (08:00/09:00/09:30 ET). Functionally reasonable simplification, not a rebuild — flagging as a real, disclosed deviation from the literal spec. |
| **ENTRY_VALUE_USD = $100 (LOCKED)** | ⚠️ | Currently configured at **$2** on the deployed contract (`entryValueUsd8`). Config-changeable via `setEntryValueUsd8()` (admin-only), not a contract redeploy — flagged to the user in chat, not yet changed pending their call on whether $2 is intentional for testnet. |
| UPDOWN reference price from a configured Dexscreener pair | ❌ | Not implemented — no Dexscreener integration exists anywhere in the repo. `MockUpdownPriceOracle` (testnet) just returns a static configured price; there's no `UpdownPriceWorker`, no pair-address config, no live price refresh. This is a genuine, unimplemented backend requirement (§15.4/§2.5). |
| Entry formula `ceil(ENTRY_VALUE_USD / P)`, fixed-point, locked at publication | ✅ | `EntryCapacity.requiredUpdownFor()`, verified with a dedicated rounding test; locked into `Battle.requiredUpdownPerEntry` at `createBattle()`, never recomputed |
| MAX_ENTRIES_PER_WALLET (10) / MAX_ENTRIES_PER_BATTLE | ✅ | Both enforced, both tested (`test_maxEntriesPerWallet`, `test_maxEntriesPerBattle`) |
| Winner count > 0, bounded | ✅ | `winnerSlots == 0` rejected at creation |
| Reward token allowlisted | ✅ | `RewardVault.allowedTokens` |
| Claim expiry, default 30 days | ✅ | `claimPeriod`, tested (`test_recovery_onlyAfterClaimPeriod`) |

## 3. Battle Lifecycle (§3)

| Requirement | Status | Notes |
|---|---|---|
| Draft → Publication → post-market → resolution state machine | ⚠️ | Collapsed to `Open → Locked → (AwaitingDice) → Settled/Drawn/Cancelled` — no separate "Draft" (unpublished) state; `createBattle()` publishes immediately. Simpler than spec, not obviously wrong for V1, but a real structural deviation. |
| Pre-publication validation (assets supported/canonical/active, schedule valid, price fresh, reward funded, etc.) | ⚠️ | Contract validates schedule ordering and zero-addresses at creation; does **not** validate "assets are canonical" against a Robinhood registry (no such registry is queried on-chain or off-chain at creation time) |
| Price locking (updownPriceUsd, requiredUpdownPerEntry immutable once published) | ✅ | Verified above and in `test_priceLockedAtCreation` |
| Reward funded directly to RewardVault before publication | ✅ | `createBattle()` calls `vault.collect()` in the same transaction |
| Entry opening/locking by timestamp, no admin transaction needed to transition | ✅ | Pure `block.timestamp` checks |
| Settlement eligible only after `marketEndAt`, requires valid oracle observations | ✅ | `settle()` reverts on stale/invalid price via `_readPrice` |
| Winner selection: Dice only when winning entries > slots | ✅ | `settle()` branches exactly on `candCount <= slots` vs `>` |
| Claims aggregated per wallet, one balance per battle | ✅ | `claimable[battleId][wallet]`, verified end-to-end on a live fork |
| Recovery only after expiry, never touches active claims | ✅ | `recoverUnclaimed()` — tested, and verified it doesn't touch an unrelated battle's funds |

## 4. Entry System (§4)

| Requirement | Status | Notes |
|---|---|---|
| Eligibility checked on-chain against actual balance | ✅ | |
| No escrow — UPDOWN never transferred/staked | ✅ | |
| Balance checked at entry-tx execution time, not before | ✅ | |
| **One side per wallet, enforced by contract** | ✅ (fixed this pass) | |
| Entry indexing sequential, battle-local | ✅ | |
| Contract, not backend, is the source of truth for overspend prevention | ✅ | No backend involved in `enter()` at all — pure on-chain call |

## 5. Market Calendar (§5)

| Requirement | Status | Notes |
|---|---|---|
| Real US equity trading calendar, not `weekday < 5` | ✅ (fixed this pass) | `scripts/market-calendar.mjs` — computed holiday rules (nth-weekday-of-month, Sunday-observed shift, Good Friday via the standard Easter algorithm), not a static list |
| Weekends, full holidays, early closes handled | ✅ | Verified against every 2026 holiday + both 2026 early closes by direct test |
| DST via IANA timezone, never manual hour math | ✅ | Uses `date-fns-tz`; verified against both DST transition boundaries directly (09:30 ET correctly resolves to 13:30 UTC in EDT and 14:30 UTC in EST) |
| Unexpected closures handled via a defined cancellation path | ⚠️ | `cancelBattle()` exists for the operator to void a still-Open battle, but there's no automated detection of an unexpected mid-day closure — this is a manual admin action, not the "authoritative calendar identifies them" automated behavior the PRD describes |

## 6. Robinhood Stock Token Discovery (§6)

| Requirement | Status | Notes |
|---|---|---|
| Assets sourced from the canonical on-chain registry, not invented | ✅ | `lib/pairs.ts` `ASSET_REGISTRY` — all 33 tickers were cross-verified against the real Chainlink tokenized-equity feed directory and the on-chain Robinhood token registry (see `contracts/RESEARCH.md`) |
| `AssetSyncWorker` — live sync of Robinhood asset metadata | ❌ | Not built. The registry is a static, manually-verified list, not a live-syncing worker. Correct data, wrong mechanism relative to spec. |
| Only `ASSET_STATUS_ACTIVE` assets selectable | ❌ | No such status concept exists — the registry has no active/inactive flag at all |
| Corporate-action multiplier monitoring (`CorporateActionWorker`) | ❌ | Not built |

## 7. Price Oracle (§7)

| Requirement | Status | Notes |
|---|---|---|
| Settlement uses canonical Chainlink feed, not REST/DEX/CEX | ✅ | `_readPrice()` only ever calls `latestRoundData()` on the configured feed address |
| Real mainnet Chainlink feed addresses researched and verified | ✅ | 6 verified via `eth_getCode` (AAPL/TSLA/NVDA/GOOGL/MSFT/AMZN); recorded in `contracts/RESEARCH.md` — not wired into any deploy script since testnet has no real feeds to test against |
| Staleness / freshness checks | ✅ | `priceStaleness`, tested |
| Signed answer rejected if ≤ 0 | ✅ | |
| Oracle-pause (corporate action) check | ✅ | `_checkOraclePaused()` — best-effort `staticcall`, matches Robinhood's own "advisory, not enforced on-chain" guidance |
| Historical round verification via `getRoundData` (HARD GATE) | ❌ | Not independently verified against the real deployed Robinhood feed proxies — explicitly flagged as open in `contracts/RESEARCH.md`. This is a named hard gate in the PRD and remains unresolved. |
| START_WINDOW / END_MAX_AGE bounded observation windows | ❌ | Not implemented — the contract reads whatever `latestRoundData()` currently returns at `lock()`/`settle()` time, with only a staleness bound, not a windowed "first/last valid observation within N minutes of market open/close" search. This is a real, structural gap relative to §7.3/§7.4. |
| L2 sequencer uptime check | ✅ | Implemented — not explicitly required by the PRD but matches Robinhood's own documented best practice, confirmed during research |

## 8. Outcome Calculation (§8)

| Requirement | Status | Notes |
|---|---|---|
| `return = (end - start) / start`, percentage not dollar | ✅ | `_winningSide()` |
| Negative returns valid | ✅ | Signed int256 math throughout |
| Exact tie = draw, no random tiebreak | ✅ | `Side.None` branch, tested |
| Integer arithmetic only, overflow-safe | ✅ | Solidity 0.8.28 built-in overflow checks; cross-multiplication avoided in favor of straightforward signed division (simpler than the PRD's suggested cross-multiplication form, same correctness for this comparison) |
| Extreme-value / decimal-mismatch fuzz testing | ⚠️ | Not explicitly fuzz-tested for outcome calculation specifically (the Dice selection fuzz test is separate) |

## 9. Randomness (§9)

| Requirement | Status | Notes |
|---|---|---|
| Dice supplies entropy only, never chooses winners itself | ✅ | |
| Real Dice Protocol integration (not Pyth, not mocked) | ✅ | Verified on-chain: `DiceSelector.entropy()` returns the real, verified DiceEntropy testnet address; provider verified via `getProviderInfoV2` resolving to a `diceprotocol.world` URI |
| No request when draw / winningEntries ≤ winnerCount | ✅ | `settle()` branch logic |
| Callback authentication (caller, provider, request mapping, replay-safe) | ✅ | `msg.sender == entropy` enforced by `IEntropyConsumer`; `pending` flag cleared before any external call |
| Unbiased, without-replacement, deterministic sampling | ✅ | Sparse partial Fisher-Yates + rejection sampling, verified with a 256-run fuzz test plus targeted edge cases (K=1, K=N) |
| O(K) not O(N) selection | ✅ | Memory-bounded by `slots`, never allocates an N-sized array |
| **Live integration actually works end-to-end** | ⚠️ | **Blocked externally.** Forked-mainnet test against the real deployed DiceEntropy contract shows `requestV2()` reverting for *every* caller (verified via a direct probe bypassing our contracts entirely) — consistent with the provider's committed randomness batch being exhausted. Not a bug in this repo; documented in `contracts/RESEARCH.md`. Any battle that gets oversubscribed past `winnerSlots` would currently get stuck `AwaitingDice` until Dice Protocol's provider is topped up. |

## 10. Reward Vault (§10)

| Requirement | Status | Notes |
|---|---|---|
| Separate contract, no market logic | ✅ | |
| Custody, reservations, claimable, expiry, recovery | ✅ | |
| Funded by direct external transfer, no admin "Fund Reward" tx path invented | ✅ | `collect()` pulls via `safeTransferFrom` in the same tx as `createBattle` |
| Reward token allowlist, SafeERC20 | ✅ | |
| Native ETH support via `call{value}` | ✅ | |
| Dust from division remains in vault, not distributed | ✅ | Implicit — `perSlot * winnerCount` is only ever a subset of `rewardPool`; excess is simply never moved |
| Vault invariants (`totalReserved <= balance`, etc.) fuzz-tested | ⚠️ | Covered by targeted unit tests, not formal invariant/fuzz testing across arbitrary sequences |

## 11. Smart Contract Architecture (§11)

| Requirement | Status | Notes |
|---|---|---|
| 4 logical contracts (BattleManager, RewardVault, PriceOracleAdapter, RandomnessAdapter) | ⚠️ | 3 contracts, not 4 — price-oracle logic lives directly in `BattleManager._readPrice()` rather than a separate `PriceOracleAdapter` contract. `DiceSelector` fills the RandomnessAdapter role. Functionally covers the same ground, structurally simpler than spec. |
| Custom errors, not require-strings | ✅ | |
| Events with sufficient indexing | ✅ | |
| Access control: no multisig, Privy + explicit admin allowlist, `Ownable2Step` | ✅ (partial) | `RewardVault`/`DiceSelector` use `Ownable2Step`; `BattleManager` uses `AccessControl` roles (reasonable alternative, not literally Ownable2Step, but matches "no multisig, narrow onchain authority" intent) |
| Narrow, reversible pausing (new publication/entries only) | ✅ | `Pausable` gates `createBattle`/`enter`/`lock`/`settle`, never claims |
| No upgradeability | ✅ | No proxy pattern anywhere |
| ReentrancyGuard on claims/callbacks | ✅ | |
| Permissionless lifecycle progression | ✅ | `lock()`/`settle()`/`recoverUnclaimed()` have no role restriction |

## 12-13. State Machines & Admin System (§12-13)

| Requirement | Status | Notes |
|---|---|---|
| Battle/Randomness/Claims state machines as specified | ✅ (battle), ✅ (claims) | Randomness state lives in `DiceSelector.Selection.pending`, functionally equivalent to NOT_REQUESTED/REQUESTED/FULFILLED but not an explicit enum |
| Admin dashboard: create battle, monitor, forbidden UI controls respected | ✅ | `app/admin-bsdgm6gmtl0kno0l5t2xs/page.tsx` — no price/outcome/winner-setting controls exist anywhere in the UI; operator can only create/lock/settle |
| Admin picks any two assets independently (not a fixed pairs dropdown) | ✅ | Matches the PRD's flat-registry model exactly |
| Exceptions/system-health/activity-log views | ❌ | Not built — the admin page shows the latest battle and lock/settle buttons, nothing resembling the PRD's dedicated exceptions/health/activity-log screens |
| Privy auth + explicit wallet allowlist for admin | ⚠️ | Admin gating is `OPERATOR_ROLE` read from the contract (`useIsOperator`), not a separate off-chain Privy-based allowlist layer — arguably sufficient (on-chain role is the real authority) but not literally what §13.2 describes |

## 14-15. Backend Architecture & External Data (§14-15)

| Requirement | Status | Notes |
|---|---|---|
| Next.js/TypeScript/viem/Privy | ✅ | |
| PostgreSQL/Redis persistence layer | ❌ | Not built — the app is stateless beyond Supabase (profiles only) and direct on-chain reads. No transaction-state tracking, no idempotency ledger, no job queue. |
| The 11 named workers (AssetSync, CorporateAction, UpdownPrice, MarketCalendar, BattleScheduler, FundingWatcher, ChainIndexer, SettlementWorker, DiceMonitor, ClaimMonitor, HealthMonitor) | ⚠️ | One consolidated script (`scripts/keeper.mjs`, now on a GitHub Actions schedule) covers BattleScheduler + SettlementWorker's job. The other 9 do not exist as separate processes. This is a deliberate, disclosed simplification for V1 scope, not an oversight — but it's a real, large gap against the literal spec. |
| Dexscreener UPDOWN pricing | ❌ | Not implemented, as noted in §2.5 above |
| Source separation (never collapse UPDOWN pricing / display / settlement / indexing / randomness into one service) | ✅ | What exists respects this — settlement only ever touches Chainlink, nothing conflates sources — but this is easier to satisfy when most of the sources (Dexscreener, Robinhood REST) simply aren't wired up yet |

## 16-17. Frontend & Data Models (§16-17)

| Requirement | Status | Notes |
|---|---|---|
| Privy wallet connection, wallet as identity | ✅ | |
| Battle card, eligibility, entry, side-locking display | ✅ | `app/battle/page.tsx` |
| Real brand logos, not generic icons/emoji/AI-generated | ✅ | `lib/assets.ts` + `BrandLogo` component, Clearbit domain-based lookup with graceful text fallback (never a generated icon) |
| Landing hero dominated by the live battle, changes daily | ✅ | `app/page.tsx`, driven by `pairForDay()` / live on-chain battle state |
| Three.js hero scene, restrained, semantic-HTML fallback | ✅ | `app/components/battle-scene.tsx`, reduced-motion aware, purely decorative behind real DOM content |
| Confrontational two-sided layout, hover interaction | ✅ | |
| Claims UI, aggregate per battle | ✅ | Both `/battle` and `/dashboard` |
| Never show a confirmed financial action before chain confirmation | ✅ | All write actions `await waitForTransactionReceipt` before updating UI state |
| Data models (Battle/Asset/Entry/etc. as string-typed for financial safety) | ✅ (on-chain), N/A (no DB) | No off-chain DB exists to violate the "never float for money" rule — all financial values are bigint end-to-end from contract to UI |

## 18. Security Threat Model (§18)

Went through each named threat against the actual contract code:

| Threat | Status |
|---|---|
| Admin compromise limited to permitted operations | ✅ — no admin function can set price/outcome/winner/randomness |
| Backend compromise can't fabricate entries/balances/claims | ✅ — no backend involved in any state-changing path |
| Frontend compromise — contracts validate everything | ✅ |
| Dexscreener/Robinhood API/Alchemy compromise can't affect settlement | ✅ (moot for Dexscreener specifically, since it isn't wired up at all) |
| Privy compromise can't change identity (msg.sender is identity) | ✅ |
| **No fallback to weak randomness** (timestamp/blockhash/tx.origin/msg.sender/admin seed) | ✅ — seed comes only from the Dice callback |
| Randomness callback replay protected | ✅ | `pending` flag |
| Randomness provider spoofing — exact configured entropy+provider required | ✅ | |
| Reward token attacks — allowlist + SafeERC20 | ✅ | |
| Reentrancy | ✅ | `nonReentrant` on `settle`/`claim`/`payout`/`recoverExpired` |
| Gas-bounded (wallet/battle/winner/randomness-attempt limits) | ✅ | All four caps exist and are enforced |
| No unbounded user-controlled arrays | ✅ | Sparse Fisher-Yates specifically avoids this |
| Oracle manipulation — no offchain settlement price | ✅ | |
| Published config immutable | ✅ | No setter exists for any field on a published `Battle` |

## 19-20. Failure/Recovery Matrix & Test Specification (§19-20)

| Requirement | Status | Notes |
|---|---|---|
| Contract unit tests (creation, publication, entry edge cases, settlement, draw, reward, claims, expiry, recovery) | ✅ | 19 passing tests cover this ground, including the newly-added side-selection regression |
| Oracle boundary tests (pre/post-start, stale, wrong feed, decimal mismatch, pause) | ❌ | Not present — no dedicated oracle test file exists |
| Outcome tests (all sign combinations, exact tie, extreme values) | ⚠️ | Covered implicitly by lifecycle tests, not as an isolated parametrized suite |
| Randomness property tests (exact K, in-bounds, no duplicates, deterministic, N/K edge cases) | ✅ | `DiceSelectorTest` — 256-run fuzz plus targeted K=1/K=N cases |
| Reward tests (dust, multi-winner, double-claim, over/underfunding) | ⚠️ | Double-claim and multi-winner are covered; explicit over/underfunding tests are not |
| Fuzzing across prices/decimals/timestamps/entry counts/seeds | ⚠️ | Only the Dice selection path is fuzzed; price/outcome fuzzing is not present |
| Invariant tests under fuzzing | ❌ | Not present as formal Foundry invariant tests |
| Full integration flow test | ✅ | Both the local Foundry suite and the forked-mainnet end-to-end test cover create→enter→lock→settle→claim |
| Real end-to-end on testnet | ✅ | Verified this session, including against the actual live deployed contracts (not a fresh redeploy) |
| Gas tests | ❌ | Not present as a dedicated gas-measurement suite (gas is visible in test output but not asserted against bounds) |

## 21. Deployment (§21)

| Requirement | Status | Notes |
|---|---|---|
| Correct chain IDs / RPC URLs | ✅ | |
| Contract deployment order (Vault → OracleAdapter → RandomnessAdapter → Manager) | ✅ (adapted to 3-contract model) | |
| Dice values verified before deployment, not trusted from docs | ✅ | Verified via direct on-chain calls, not just the PRD's stated values |
| Dedicated backend worker signer, not admin frontend wallet | ⚠️ | The GitHub Actions keeper uses the *same* operator wallet as the admin frontend (`0x325c...757a`), not a separate dedicated signer as the PRD recommends — a real, disclosed deviation worth revisiting if this ever handles real value |
| Testnet before mainnet | ✅ | Everything so far is testnet-only |
| Mainnet checklist items (feeds verified, Dice verified, admin allowlist verified) | ⚠️ | Research done and documented, but nothing has actually been deployed to mainnet — checklist is aspirational at this stage, appropriately |

## 22-25. Observability, Research Gates, Decision Registry, Implementation Order

| Requirement | Status | Notes |
|---|---|---|
| Structured logs, metrics, alerting | ❌ | `keeper.log` exists as a plain append-only log; no structured fields, no metrics, no alerting |
| Research record documenting source/date/finding/consequence | ✅ | `contracts/RESEARCH.md` — Dice Protocol, Chainlink feeds, Robinhood registry, all with verification method shown, not just asserted |
| Decision registry LOCKED items | ✅ (mostly) | Cross-checked individually throughout this document; the two real misses are $100 entry value (currently $2) and the Dexscreener UPDOWN pricing gap |

## 26. Non-Negotiable Invariants — explicit line-by-line

| Invariant | Status |
|---|---|
| Backend/frontend cannot create financial entitlement without an on-chain tx | ✅ |
| Admin cannot set winner/price/randomness | ✅ |
| Published battle configuration cannot change | ✅ |
| Entry eligibility checked against actual UPDOWN balance | ✅ |
| UPDOWN not escrowed; later transfers don't invalidate existing entries | ✅ (existing entries are already recorded; nothing re-checks balance retroactively) |
| **A wallet cannot select both sides of one battle** | ✅ (fixed this pass — was broken) |
| Settlement uses canonical Chainlink observations | ✅ |
| Dexscreener/Robinhood REST cannot determine settlement | ✅ (moot — neither is wired to settlement at all) |
| Exact return ties are draws; draws don't request Dice | ✅ |
| Dice used only when necessary; winner selection unbiased, without replacement, deterministic, unique, in-bounds | ✅ |
| Rewards reserved before publication; active reserves can't be withdrawn | ✅ |
| Claims cannot be replayed; claimable cleared before external transfer | ✅ (checks-effects-interactions followed in `claim()`) |
| Expired recovery cannot touch active claims | ✅ (only fires after `claimPeriod` elapses) |
| Arbitrary ERC-20 reward tokens not supported (allowlist only) | ✅ |
| V1 contracts immutable | ✅ |

---

## Summary of what actually needs attention

**Fixed this pass (already committed and pushed):**
1. Wallet could enter both sides of a battle — contract bug, now fixed, needs redeploy.
2. Leaderboard page was wired to dead infrastructure — now uses the real serverless endpoint.

**Real, unimplemented gaps (not touched this pass, flagging for a decision):**
1. UPDOWN/USD pricing is a static testnet mock — no Dexscreener integration at all.
2. No bounded START_WINDOW/END_MAX_AGE observation-window search — reads whatever price is current at lock/settle time (bounded only by staleness).
3. Historical round verification (`getRoundData`) against the real Chainlink feeds — still an open HARD GATE per the PRD's own language.
4. The 11-worker backend architecture is one consolidated script, not 11 processes with PostgreSQL/Redis.
5. No structured logging/metrics/alerting.
6. Entry value is $2, not the PRD's locked $100 (config change only, your call).
7. Keeper runs as the same wallet as the admin, not a dedicated signer.

**Blocked externally, not fixable from this repo:**
- Dice Protocol's testnet randomness provider appears to have exhausted its committed batch — oversubscribed battles would currently get stuck.

Everything else in the checklist above is implemented and, where it mattered, verified against
live on-chain behavior rather than just read and trusted.
