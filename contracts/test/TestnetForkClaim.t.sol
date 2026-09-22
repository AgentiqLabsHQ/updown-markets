// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2, Vm } from "forge-std/Test.sol";
import { BattleManager } from "../src/BattleManager.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { DiceSelector } from "../src/DiceSelector.sol";
import { UpdownToken } from "../src/mocks/UpdownToken.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockAggregatorV3 } from "../src/mocks/MockAggregatorV3.sol";
import { BattleTypes } from "../src/libraries/BattleTypes.sol";

/// @notice End-to-end verification of the claim flow against the REAL deployed contracts on
/// Robinhood testnet (forked, not touching real state) — not a fresh local deploy. Run with:
///   forge test --match-contract TestnetForkClaimTest -vv --fork-url https://rpc.testnet.chain.robinhood.com
contract TestnetForkClaimTest is Test {
    // Real deployed addresses (scripts/addresses.json). Both BattleManager and RewardVault were
    // redeployed together to pick up the manager-scoping fix (PRD_AUDIT.md) — RewardVault.vault
    // is an immutable reference on BattleManager, so the vault fix required redeploying both.
    // DiceSelector was reused and its `manager` repointed here.
    BattleManager mgr = BattleManager(0x27481D71C02ebd54aF6c5B2B4431Cc443a427454);
    RewardVault vault = RewardVault(payable(0x1a0D29Cd5749F74fdE2552c4A8275421a35b554E));
    UpdownToken updown = UpdownToken(0xEb74957E1cE2e5ae63B419a8Fa6D166E067A4Cf2);
    MockUSDC usdc = MockUSDC(0xCd32BA7c4dD5d384261727B7289b4A9368d85035);
    MockAggregatorV3 feedA = MockAggregatorV3(0xC96BCaD2db3B88E4452dcb8B3b89f995B0a33b4d);
    MockAggregatorV3 feedB = MockAggregatorV3(0xB9fE66bB91EAeaFa5027284a24922bFE89ae202B);
    DiceSelector dice = DiceSelector(0xB928a3D6080900D1a5793A322c2Ccbd331Ff0F79);

    // Confirmed on-chain (contracts/RESEARCH.md): the real Dice Protocol DiceEntropy oracle
    // and provider this DiceSelector deployment is actually wired to on Robinhood testnet.
    address constant REAL_DICE_ENTROPY = 0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D;

    // Real address holding OPERATOR_ROLE on-chain (confirmed via RoleGranted event log) —
    // impersonated via vm.prank on the fork, never its actual private key.
    address constant OPERATOR = 0x325cB2956198E54dC6a05348b1712c8a9ea4757a;

    address alice = makeAddr("alice-fork-test");
    address bob = makeAddr("bob-fork-test");
    address carol = makeAddr("carol-fork-test");

    uint256 battleId;
    /// @dev RewardVault.battleBalance is keyed by a raw battle number, not scoped to which
    /// BattleManager created it — after a manager redeploy, a fresh battleId can collide with
    /// whatever a previous manager instance already left in that same slot (confirmed live:
    /// vault.battleBalance(1) already held 100 USDC from the old BattleManager's abandoned
    /// battle #1 before this suite ever ran). Captured so assertions compare deltas, not
    /// absolute values — this is a real architectural note, not a workaround to hide it; see
    /// PRD_AUDIT.md.
    uint256 preexistingVaultBalance;

    function setUp() public {
        // Opt-in only: hits the real live testnet RPC, so it's excluded from the default
        // `forge test` run. Run explicitly with: RUN_FORK_TESTS=true forge test --match-contract
        // TestnetForkClaimTest -vvv --fork-url https://rpc.testnet.chain.robinhood.com
        if (!vm.envOr("RUN_FORK_TESTS", false)) {
            vm.skip(true);
            return;
        }

        // Fork "latest" — writes below are local to this test only, nothing touches real state.
        vm.createSelectFork(vm.envOr("FORK_RPC", string("https://rpc.testnet.chain.robinhood.com")));

        require(address(mgr).code.length > 0, "BattleManager not deployed on this fork");
        require(mgr.hasRole(mgr.OPERATOR_ROLE(), OPERATOR), "expected address lost OPERATOR_ROLE");

        vm.deal(OPERATOR, 1 ether);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.deal(carol, 1 ether);

        vm.startPrank(alice);
        updown.faucet(); // 1,000 UPDOWN
        vm.stopPrank();
        vm.startPrank(bob);
        updown.faucet();
        vm.stopPrank();
        vm.startPrank(carol);
        updown.faucet();
        vm.stopPrank();

        // Fund the operator with reward-pool USDC directly (storage deal — we don't know or
        // need its real balance) and create a fresh battle with a clean window.
        deal(address(usdc), OPERATOR, 1_000e6);
        vm.startPrank(OPERATOR);
        usdc.approve(address(vault), type(uint256).max);

        uint64 openTime = uint64(block.timestamp);
        uint64 lockTime = openTime + 1800;
        uint64 settleTime = lockTime + 300;
        BattleTypes.Config memory cfg = BattleTypes.Config({
            feedA: address(feedA),
            feedB: address(feedB),
            tokenA: address(0),
            tokenB: address(0),
            openTime: openTime,
            lockTime: lockTime,
            settleTime: settleTime,
            winnerSlots: 10,
            maxEntriesPerBattle: 1000,
            rewardToken: address(usdc)
        });
        uint256 predictedId = mgr.battleCount() + 1;
        preexistingVaultBalance = vault.battleBalance(predictedId);
        battleId = mgr.createBattle(cfg, 100e6); // 100 USDC pool, same shape as the live config
        assertEq(battleId, predictedId, "battleId prediction must hold for the balance delta below to be meaningful");
        vm.stopPrank();

        console2.log("Fork block:", block.number);
        console2.log("Created battle id:", battleId);
    }

    /// @notice Proves the side-selection fix on the ACTUAL redeployed contract — not a local
    /// unit test, the real bytecode at the real address the app now points to.
    function test_cannotEnterBothSides_onRealDeployedContract() public {
        vm.prank(alice);
        mgr.enter(battleId, BattleTypes.Side.A);

        vm.prank(alice);
        vm.expectRevert(BattleManager.SideAlreadySelected.selector);
        mgr.enter(battleId, BattleTypes.Side.B);

        // The same side again is still fine.
        vm.prank(alice);
        mgr.enter(battleId, BattleTypes.Side.A);
        assertEq(uint8(mgr.sideOf(battleId, alice)), uint8(BattleTypes.Side.A));
        assertEq(mgr.entriesOf(battleId, alice), 2);
    }

    function test_claim_fullLifecycle_onRealDeployedContracts() public {
        BattleTypes.Battle memory b0 = mgr.getBattle(battleId);
        assertEq(uint8(b0.status), uint8(BattleTypes.Status.Open));
        assertEq(b0.rewardPool, 100e6);

        // alice enters twice on A, bob once on A, carol once on B — proves per-wallet
        // aggregation (alice) alongside a simple single-entry case (bob), with a genuine
        // loser (carol) to confirm losers get nothing.
        vm.prank(alice);
        mgr.enter(battleId, BattleTypes.Side.A);
        vm.prank(alice);
        mgr.enter(battleId, BattleTypes.Side.A);
        vm.prank(bob);
        mgr.enter(battleId, BattleTypes.Side.A);
        vm.prank(carol);
        mgr.enter(battleId, BattleTypes.Side.B);

        (uint256 entriesA, uint256 entriesB) = mgr.entriesCount(battleId);
        assertEq(entriesA, 3, "alice x2 + bob x1");
        assertEq(entriesB, 1, "carol x1");

        // Lock: snapshot open prices.
        vm.warp(b0.lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(100e8);
        mgr.lock(battleId);
        assertEq(uint8(mgr.getBattle(battleId).status), uint8(BattleTypes.Status.Locked));

        // Settle: A moves up, B moves down — A wins decisively, no ambiguity.
        vm.warp(b0.settleTime);
        feedA.setAnswer(115e8); // +15%
        feedB.setAnswer(95e8); // -5%
        mgr.settle(battleId);

        BattleTypes.Battle memory b1 = mgr.getBattle(battleId);
        assertEq(uint8(b1.status), uint8(BattleTypes.Status.Settled), "must settle without needing Dice (3 <= 10 slots)");
        assertEq(uint8(b1.winningSide), uint8(BattleTypes.Side.A));
        assertEq(b1.winnerCount, 3);
        uint256 perSlot = uint256(b1.rewardPool) / b1.winnerSlots; // 100e6 / 10 = 10e6
        assertEq(b1.perSlotReward, perSlot);

        // Claimable amounts are correctly aggregated per wallet.
        assertEq(mgr.claimable(battleId, alice), 2 * perSlot, "alice holds 2 of the 3 winning entries");
        assertEq(mgr.claimable(battleId, bob), perSlot);
        assertEq(mgr.claimable(battleId, carol), 0, "carol backed the losing side");

        // The vault genuinely holds enough of the real reward token to pay out (on top of
        // whatever unrelated balance may already sit in this battleId slot — see
        // preexistingVaultBalance).
        assertEq(vault.battleToken(battleId), address(usdc));
        assertGe(vault.battleBalance(battleId) - preexistingVaultBalance, 3 * perSlot);

        // Alice claims her aggregate reward in ONE transaction and receives real USDC.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        mgr.claim(battleId);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 2 * perSlot, "alice must receive both winning entries in one claim");
        assertEq(mgr.claimable(battleId, alice), 0, "claimable must zero out after paying");

        // Double-claim reverts — no re-entrancy / double-pay possible.
        vm.prank(alice);
        vm.expectRevert(BattleManager.NothingToClaim.selector);
        mgr.claim(battleId);

        // Bob claims his single-entry reward correctly.
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        mgr.claim(battleId);
        assertEq(usdc.balanceOf(bob) - bobBefore, perSlot);

        // Carol (loser) cannot claim anything.
        vm.prank(carol);
        vm.expectRevert(BattleManager.NothingToClaim.selector);
        mgr.claim(battleId);

        // Vault balance for this battle's own contribution reflects exactly what's left
        // unclaimed (the 7 unused winner slots' worth — nothing was ever swept anywhere,
        // matching the no-fee design), on top of whatever pre-existing balance the slot held.
        assertEq(vault.battleBalance(battleId) - preexistingVaultBalance, uint256(b1.rewardPool) - 3 * perSlot);

        console2.log("PASS: full create->enter->lock->settle->claim verified against real deployed contracts");
    }

    /// @notice Verifies the oversubscription path: settle() requests real Dice Protocol
    /// randomness, the (impersonated) DiceEntropy oracle delivers a callback, and exactly
    /// winnerSlots wallets end up with a correct, claimable aggregate — against the real
    /// deployed DiceSelector, wired to the real DiceEntropy contract (confirmed via `entropy()`
    /// returning 0x43c8...a42d, RESEARCH.md's verified testnet address).
    function test_claim_afterDiceOversubscription_onRealDeployedContracts() public {
        vm.deal(OPERATOR, 1 ether);
        deal(address(usdc), OPERATOR, 1_000e6);

        address dan = makeAddr("dan-fork-test");
        address erin = makeAddr("erin-fork-test");
        vm.deal(dan, 1 ether);
        vm.deal(erin, 1 ether);
        vm.prank(dan);
        updown.faucet();
        vm.prank(erin);
        updown.faucet();

        vm.startPrank(OPERATOR);
        usdc.approve(address(vault), type(uint256).max);
        uint64 openTime = uint64(block.timestamp);
        uint64 lockTime = openTime + 1800;
        uint64 settleTime = lockTime + 300;
        BattleTypes.Config memory cfg = BattleTypes.Config({
            feedA: address(feedA),
            feedB: address(feedB),
            tokenA: address(0),
            tokenB: address(0),
            openTime: openTime,
            lockTime: lockTime,
            settleTime: settleTime,
            winnerSlots: 2, // deliberately small so 4 entries oversubscribes it
            maxEntriesPerBattle: 1000,
            rewardToken: address(usdc)
        });
        uint256 id = mgr.createBattle(cfg, 100e6);
        vm.stopPrank();

        // 4 entries on side A (4 > 2 winnerSlots), 0 on side B.
        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(bob);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(dan);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(erin);
        mgr.enter(id, BattleTypes.Side.A);

        // Robinhood testnet's real block cadence is ~0.123s/block. vm.warp alone advances
        // block.timestamp without block.number, and DiceEntropy's real contract appears to
        // assert some internal consistency between the two (confirmed by reproducing a clean
        // AssertionFailure() from the real contract when timestamp jumps ~17k blocks' worth
        // with no matching vm.roll) — so roll proportionally alongside every warp here.
        _warpAndRoll(lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(100e8);
        mgr.lock(id);

        _warpAndRoll(settleTime);
        feedA.setAnswer(110e8); // A wins, B has no entries anyway
        feedB.setAnswer(100e8);

        uint256 fee = dice.selectionFee();
        vm.recordLogs();
        mgr.settle{ value: fee }(id);
        assertEq(uint8(mgr.getBattle(id).status), uint8(BattleTypes.Status.AwaitingDice));

        // Pull the sequence number Dice Protocol actually assigned from the DiceRequested event
        // — this is the real request the real oracle received, not a fabricated value.
        uint64 sequence = _extractSequenceNumber(id);
        console2.log("Dice sequence number:", sequence);

        // Simulate the real DiceEntropy oracle's callback landing (in production this comes
        // from Dice Protocol's off-chain "Tyche" keeper ~1-3s later; a static fork has no such
        // relay, so we deliver it ourselves) — impersonating the REAL, verified entropy
        // contract address is what actually exercises DiceSelector's caller-authentication
        // check (`msg.sender == getEntropy()`), same as a genuine callback would.
        vm.prank(REAL_DICE_ENTROPY);
        dice._entropyCallback(sequence, dice.provider(), keccak256("fork-test-randomness"));

        BattleTypes.Battle memory b = mgr.getBattle(id);
        assertEq(uint8(b.status), uint8(BattleTypes.Status.Settled));
        assertEq(b.winnerCount, 2, "exactly winnerSlots winners, never more");

        // Exactly 2 of the 4 entrants have a nonzero claimable amount, and they sum to the pool.
        address[4] memory entrants = [alice, bob, dan, erin];
        uint256 winners;
        uint256 totalClaimable;
        for (uint256 i = 0; i < entrants.length; i++) {
            uint256 amt = mgr.claimable(id, entrants[i]);
            if (amt > 0) {
                winners++;
                totalClaimable += amt;
                uint256 before = usdc.balanceOf(entrants[i]);
                vm.prank(entrants[i]);
                mgr.claim(id);
                assertEq(usdc.balanceOf(entrants[i]) - before, amt, "claim must pay exactly the claimable amount");
            } else {
                vm.prank(entrants[i]);
                vm.expectRevert(BattleManager.NothingToClaim.selector);
                mgr.claim(id);
            }
        }
        assertEq(winners, 2, "unbiased selection must pick exactly winnerSlots winners, no more no less");
        assertEq(totalClaimable, uint256(b.rewardPool), "2 winners of 2 slots must claim the entire pool, no dust left");

        console2.log("PASS: Dice oversubscription -> callback -> aggregate claim verified against real deployed contracts");
    }

    /// @dev ~0.123s/block measured against Robinhood testnet's real recent block history.
    function _warpAndRoll(uint256 toTimestamp) internal {
        uint256 elapsed = toTimestamp - block.timestamp;
        vm.warp(toTimestamp);
        vm.roll(block.number + elapsed * 1000 / 123);
    }

    function _extractSequenceNumber(uint256 forBattleId) internal returns (uint64) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("DiceRequested(uint256,uint64)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) {
                uint256 loggedBattleId = uint256(logs[i].topics[1]);
                if (loggedBattleId == forBattleId) {
                    return abi.decode(logs[i].data, (uint64));
                }
            }
        }
        revert("DiceRequested event not found");
    }
}
