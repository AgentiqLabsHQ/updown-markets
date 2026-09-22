# Research record

Per the PRD's research-gate requirement (§23.15): source, date checked, finding, implementation
consequence, and any unresolved question, for every external integration this protocol depends
on. Nothing here is considered complete merely because a URL was opened — every address below was
independently confirmed against live on-chain state (`eth_getCode` and/or a direct `eth_call`),
not just quoted from documentation or an AI-summarized page.

## Dice Protocol (randomness)

**Source:** https://diceprotocol.world/, https://github.com/diceprotocol/dice-protocol-docs
**Date checked:** 2026-09-08

**Finding:** Dice Protocol is a real, deployed commit-reveal randomness oracle for Robinhood
Chain (keeper name "Tyche"). Its on-chain interface — `IEntropyConsumer`, `requestV2()`,
`getProviderInfoV2()`, `getFeeV2()` — is Pyth Entropy V2-compatible (same ABI shape), which
initially looked like it might be an AI-summarization artifact (WebFetch's first-pass summary of
diceprotocol.world's docs page reproduced Pyth's real interface almost verbatim). It was not:

- `eth_getCode` on Robinhood Chain mainnet (chain 4663) for `0xd8a0680e7699526b57140ed4eafdcc7219dc0a0c`
  (the address the PRD itself names as "DiceEntropy v10") returns real, non-trivial bytecode.
- `eth_getCode` on Robinhood testnet (chain 46630) for `0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D`
  returns byte-for-byte identical bytecode to the mainnet contract.
- Decoding the function selectors in that bytecode against the public 4byte.directory database
  confirms genuine Entropy-V2-shaped functions: `requestV2(uint32)`, `requestV2(address,uint32)`,
  `getProviderInfoV2(address)`, `getFeeV2(address,uint32)`, `combineRandomValues(...)`,
  `getAccruedFees()`.
- Calling `getProviderInfoV2(0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6)` (the provider address
  the PRD names) directly against both the mainnet and testnet contracts returns a populated,
  registered-provider struct. The struct's embedded URI decodes to
  `https://tyche.diceprotocol.world/v1/chains/4663` (mainnet call) and
  `https://diceprotocol.world/testnet` (testnet call) — i.e. the provider registration itself
  self-identifies as Dice Protocol's own infrastructure, on-chain, independent of any
  documentation page.

**Verified addresses:**
| | Mainnet (4663) | Testnet (46630) |
|---|---|---|
| DiceEntropy | `0xd8a0680e7699526b57140ed4eafdcc7219dc0a0c` (from PRD, bytecode-verified) | `0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D` (bytecode-identical to mainnet, provider-verified) |
| Provider (Tyche) | `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6` | same |
| Fee | dynamic, read via `getFeeV2(provider, gasLimit)` — do not hardcode "0.000025 ETH" | same |

**Implementation consequence:** `DiceSelector.sol` already used the correct interface shape
(it was written against Pyth's SDK, which happens to be interface-compatible) — the actual
defect was that it was deployed against a locally-deployed `MockEntropy`, not any real oracle.
Fixed: `DiceSelector` now stores an explicit `provider` address and always calls the
explicit-provider overloads (`requestV2(provider, gasLimit)` / `getFeeV2(provider, gasLimit)`)
rather than the ambiguous "default provider" overloads, so the randomness source can't silently
change if the entropy contract's own default is ever reconfigured. `Deploy.s.sol` now points
DiceSelector at the real, verified testnet DiceEntropy contract and provider by default
(`USE_MOCK_ENTROPY=true` opts back into a local mock for fully offline testing). The
sparse-Fisher-Yates + rejection-sampling winner-selection algorithm (PRD §9.9/9.10) was
independently fixed regardless of provider — that gap was in our own selection code, not in
which oracle it talks to.

**Unresolved:** The mainnet DiceEntropy address came directly from the PRD and was independently
bytecode-verified; the testnet address did not appear in the PRD and was instead surfaced via a
web search / AI-summarized page, then independently corroborated by (a) identical bytecode to the
verified mainnet contract and (b) its own on-chain provider registration resolving to a
`diceprotocol.world` URI. That's strong corroboration but not the same as an address the client
supplied directly — recommend a final manual cross-check against
https://robinhoodchain-testnet.blockscout.com (or equivalent) before this address is relied on
for anything beyond testnet experimentation.

## Chainlink Robinhood tokenized-equity feeds (settlement oracle)

**Source:** https://docs.robinhood.com/chain/oracles-and-price-feeds,
https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
**Date checked:** 2026-09-08

**Finding:**
- Every Robinhood Stock Token has a real Chainlink feed using the standard `AggregatorV3Interface`
  (`latestRoundData()`), confirmed via live-rendered Chainlink documentation (not a static/cached
  page — required executing the page's JS to page through the actual feed directory widget).
- The feed's `latestRoundData()` answer is **already** multiplier-adjusted (Total Return Value =
  underlying market price × `uiMultiplier()`) — a consumer must NOT re-apply the multiplier.
  Our settlement code was already correct here (it never touched `uiMultiplier()`), so no change
  was needed on that specific point.
- Corporate actions are handled via an `oraclePaused()` flag on the underlying Robinhood Stock
  Token contract (not the feed itself): while `true`, the feed freezes at its last-known-good
  value rather than publishing a value computed from a stale multiplier. Robinhood's docs
  describe this flag as advisory ("not enforced on-chain") — a staleness check on `updatedAt`
  remains the primary guard.
- **Robinhood Chain testnet has no equivalent feeds at all.** Chainlink's own feed directory
  states outright: "Robinhood Chain feeds are not available on testnet." This is not a gap in our
  implementation — there is nothing real to point at on testnet, so a substitute price source is
  structurally necessary there (see scripts/oracle.mjs), not merely a shortcut.
- Confirmed via `eth_getCode` that all four mainnet feed proxy addresses below are real deployed
  contracts (identical 19,144-hex-char bytecode length across all four, consistent with a shared
  proxy implementation).

**Verified mainnet (chain 4663) feed proxy addresses:**
| Symbol | Standard Proxy |
|---|---|
| AAPL | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` |
| TSLA | `0x4A1166a659A55625345e9515b32adECea5547C38` |
| NVDA | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| GOOGL | `0xF6f373a037c30F0e5010d854385cA89185AE638b` |
| MSFT | `0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E` |
| AMZN | `0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C` |

(GOOGL, not GOOG — Robinhood/Chainlink list Alphabet's tokenized equity under GOOGL. Our current
testnet pair rotation used "GOOG" as a label; harmless on testnet since it's a mock feed, but
should be corrected to GOOGL before any mainnet config references real assets.)

**Implementation consequence:** Added an `oraclePaused()` check to `BattleManager._readPrice`
(best-effort — a `staticcall` that's simply skipped if the target doesn't implement the method,
matching the "advisory" framing above and keeping testnet mocks working unmodified). Added
optional `tokenA`/`tokenB` fields to `Battle`/`Config` so this check has an address to call
against; `address(0)` skips it entirely (used for all testnet battles today). The real mainnet
feed addresses above are recorded here for whenever this moves off testnet mock feeds — they are
**not** wired into any deploy script yet, since doing so without also switching away from the
Yahoo-price-push testnet architecture would be misleading.

**Unresolved (HARD GATE, per PRD §7.6/§23.8, not resolved tonight):** Historical round
verification via `getRoundData()` — confirming the exact deployed feed's aggregator/proxy
architecture supports looking up a specific historical round for START_WINDOW/END_MAX_AGE
boundary reconstruction — was not independently verified against the real feed contracts above.
Chainlink's docs describe the standard `AggregatorV3Interface`, which normally includes
`getRoundData(uint80)`, but that needs confirming against the actual deployed Robinhood feed
proxies (not just the generic interface) before it's safe to build the bounded-observation-window
settlement logic (PRD §7.3/§7.4) against them. This remains open.

## Robinhood Stock Token registry

**Source:** https://docs.robinhood.com/chain/contracts/ (live on-chain-generated table)
**Date checked:** 2026-09-08

**Finding:** A public, no-auth, live-rendered registry of every Robinhood Stock Token contract
address exists at this URL (required rendering the page's JS — a plain HTTP fetch shows a
"table failed to load" placeholder). Confirms Section 6's asset-discovery model is real and
public, contrary to an initial assumption that it might require authenticated Robinhood API
access. AssetSyncWorker (PRD §14.3) was not implemented tonight, but this removes the biggest
open question about whether it's even buildable without a Robinhood API key.

**Unresolved:** The `GET https://api.robinhood.com/rhj/assets` API endpoint the PRD names in
§6.2 for richer per-asset metadata (multiplier state, trading capabilities, status) was not
tested — only the public docs registry table was confirmed. Whether that specific API requires
authentication remains open.

## Claim-flow verification against the real deployed contracts (2026-09-09)

**Source:** `forge test --fork-url https://rpc.testnet.chain.robinhood.com` against
`test/TestnetForkClaim.t.sol` (opt-in, `RUN_FORK_TESTS=true`) — a live fork of Robinhood testnet
exercising the actual deployed `BattleManager`/`RewardVault`/`DiceSelector` bytecode at their real
addresses (`scripts/addresses.json`), not a fresh local redeploy. All writes are local to the
fork; nothing touches real testnet state or spends real funds.

**Finding — core claim path: fully verified, works correctly.** Ran a complete
create → 4 entries across 2 wallets/2 sides (one wallet with 2 entries) → lock → settle
(decisive, non-tie price move) → claim lifecycle. Confirmed: per-wallet claim aggregation pays
the correct summed amount in one transaction, `claimable` zeroes out after payment, a second
claim reverts (`NothingToClaim`), the losing side gets nothing, and the vault's remaining balance
exactly matches the unused winner slots (nothing swept anywhere). This is the path every battle
takes as long as winning-side entries don't exceed `winnerSlots` (currently 10) — the common case.

**Finding — Dice oversubscription path: currently blocked by Dice Protocol's testnet
infrastructure, not a bug in this codebase.** Created a battle with `winnerSlots=2` and 4 entries
on the winning side (a genuine oversubscription). `settle()` correctly requests randomness from
the real, verified DiceEntropy contract — but the DiceEntropy contract's own `requestV2()`
reverts with a custom error decoding to `AssertionFailure()`. Isolated this with a direct probe
(`vm.prank` as a plain EOA calling `requestV2` straight against DiceEntropy, bypassing
DiceSelector entirely): **the same revert happens for every caller, both the default-provider and
explicit-provider overloads, from an EOA or a contract.** This is not specific to our integration.

Decoding `getProviderInfoV2(provider)`'s returned struct shows two adjacent small integers (454
and 453) in the position where Pyth's `ProviderInfo` layout carries `endSequenceNumber` and
`sequenceNumber` — consistent with the provider's committed randomness hash-chain being fully
exhausted (next request would need `sequenceNumber` to reach `endSequenceNumber`). This field-
position inference isn't independently source-verified the way the address/interface findings
above are, but it's the most plausible explanation for a universal, caller-independent revert on
every request. If correct, this is an operational matter for Dice Protocol's own keeper ("Tyche")
to commit a fresh batch — nothing in this repository can fix it.

**Practical consequence:** claims work correctly today for any battle where the winning side's
entry count stays at or under `winnerSlots` (10). A battle that gets oversubscribed past that
would currently get stuck `AwaitingDice` until Dice Protocol's provider is topped up externally.
Recommend checking Dice Protocol's status/Discord, or lowering `winnerSlots` expectations, until
this is confirmed resolved on their end.

## What was not re-verified tonight

- Market calendar implementation (holidays/early closes/DST) — still unimplemented; no research
  was done to select/pin a specific calendar library or data source.
- Dexscreener UPDOWN/USD pair — the PRD's locked source for UPDOWN pricing was not researched
  tonight; the codebase's own doc comments describe a Uniswap TWAP as the intended mainnet design
  instead, which is a different (also unresolved) discrepancy — see the PRD audit artifact.
- The real UPDOWN token contract address does not exist yet (per the PRD itself: "provided after
  UPDOWN token creation") — nothing to verify.
