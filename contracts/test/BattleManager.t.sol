// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { BattleManager } from "../src/BattleManager.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { DiceSelector } from "../src/DiceSelector.sol";
import { BattleTypes } from "../src/libraries/BattleTypes.sol";
import { EntryCapacity } from "../src/libraries/EntryCapacity.sol";
import { UpdownToken } from "../src/mocks/UpdownToken.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockAggregatorV3 } from "../src/mocks/MockAggregatorV3.sol";
import { MockUpdownPriceOracle } from "../src/mocks/MockUpdownPriceOracle.sol";
import { MockEntropy } from "../src/mocks/MockEntropy.sol";
import { IUpdownPriceOracle } from "../src/interfaces/IUpdownPriceOracle.sol";
import { IDiceSelector } from "../src/interfaces/IDiceSelector.sol";

contract BattleManagerTest is Test {
    BattleManager mgr;
    RewardVault vault;
    DiceSelector dice;
    UpdownToken updown;
    MockUSDC usdc;
    MockAggregatorV3 feedA;
    MockAggregatorV3 feedB;
    MockUpdownPriceOracle oracle;
    MockEntropy entropy;

    address admin = address(this);
    address operator = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address recoveryBeneficiary = makeAddr("beneficiary");
    address diceProvider = makeAddr("diceProvider");

    uint256 constant ENTRY_VALUE_USD8 = 2e8; // $2
    uint256 constant POOL = 100e6; // 100 USDC

    function setUp() public {
        usdc = new MockUSDC();
        updown = new UpdownToken(admin);
        oracle = new MockUpdownPriceOracle(1e8); // UPDOWN = $1.00
        feedA = new MockAggregatorV3(8, "AAPL/USD", 100e8);
        feedB = new MockAggregatorV3(8, "TSLA/USD", 100e8);
        entropy = new MockEntropy();

        vault = new RewardVault(admin, recoveryBeneficiary);
        vault.setTokenAllowed(address(usdc), true);
        mgr = new BattleManager(admin, updown, IUpdownPriceOracle(address(oracle)), vault, ENTRY_VALUE_USD8);
        dice = new DiceSelector(entropy, diceProvider, admin);

        vault.setManager(address(mgr));
        dice.setManager(address(mgr));
        mgr.setDice(IDiceSelector(address(dice)));

        // Fund operator with USDC to seed pools.
        usdc.mint(operator, 1_000e6);
        usdc.approve(address(vault), type(uint256).max);

        // Give players UPDOWN (capacity).
        updown.mint(alice, 100 ether); // 100 UPDOWN @ $1 = $100 -> 50 entries @ $2
        updown.mint(bob, 100 ether);
        updown.mint(carol, 100 ether);
    }

    function _defaultConfig() internal view returns (BattleTypes.Config memory) {
        return BattleTypes.Config({
            feedA: address(feedA),
            feedB: address(feedB),
            tokenA: address(0),
            tokenB: address(0),
            openTime: uint64(block.timestamp),
            lockTime: uint64(block.timestamp + 1 hours),
            settleTime: uint64(block.timestamp + 2 hours),
            winnerSlots: 10,
            maxEntriesPerBattle: 1000,
            rewardToken: address(usdc)
        });
    }

    // ── capacity math ─────────────────────────────────────────────
    function test_capacityMath() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        // 100 UPDOWN @ $1, $2 per entry => 50 entries of raw balance-derived capacity, but the
        // view is clamped to the (default 10) per-wallet cap, matching what enter() will allow.
        assertEq(mgr.capacityOfUser(id, alice), 10);
        assertEq(EntryCapacity.capacityOf(100 ether, 2 ether), 50);
        assertEq(EntryCapacity.capacityOf(0, 2 ether), 0);

        mgr.setMaxEntriesPerWallet(1000);
        assertEq(mgr.capacityOfUser(id, alice), 50, "raw capacity once the wallet cap is raised");
    }

    function test_requiredUpdownFor_rounds_up_not_down() public pure {
        // $2 entry / $1 price = exactly 2 UPDOWN, no rounding needed.
        assertEq(EntryCapacity.requiredUpdownFor(2e8, 1e8), 2 ether);
        // $100 entry / $0.30 price = 333.33... -> ceil, never floor (protocol-favoring rounding).
        uint256 required = EntryCapacity.requiredUpdownFor(100e8, 30e6);
        uint256 floorValue = uint256(100e8) * 1e18 / uint256(30e6);
        assertGt(required, floorValue); // strictly greater than the floor value
    }

    // ── price is locked at creation, not read live at entry time ──
    function test_priceLockedAtCreation() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        BattleTypes.Battle memory b = mgr.getBattle(id);
        assertEq(b.updownPriceUsd8, 1e8);
        assertEq(b.requiredUpdownPerEntry, 2 ether);

        // UPDOWN price moves after creation — this battle's requirement must NOT change.
        oracle.setPrice(4e8); // UPDOWN now $4
        BattleTypes.Battle memory b2 = mgr.getBattle(id);
        assertEq(b2.requiredUpdownPerEntry, 2 ether, "requirement must stay locked");

        // A second battle created after the price move gets a different locked requirement.
        uint256 id2 = mgr.createBattle(_defaultConfig(), POOL);
        assertEq(mgr.getBattle(id2).requiredUpdownPerEntry, 0.5 ether);
    }

    // ── no fee is ever charged to enter ─────────────────────────────
    function test_noEntryFee() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        assertEq(usdc.balanceOf(alice), balBefore, "entering must not move any USDC");
    }

    // ── happy path: A wins, all entrants paid via one aggregate claim ──
    function test_fullLifecycle_allWin_aggregateClaim() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        assertEq(vault.battleBalance(id), POOL);
        assertEq(vault.battleToken(id), address(usdc));

        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(alice); // alice enters twice — must still be ONE aggregate claim
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(bob);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(carol);
        mgr.enter(id, BattleTypes.Side.B);

        vm.warp(mgr.getBattle(id).lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(100e8);
        mgr.lock(id);

        // settle: A +10%, B +5% => A wins
        vm.warp(mgr.getBattle(id).settleTime);
        feedA.setAnswer(110e8);
        feedB.setAnswer(105e8);
        mgr.settle(id);

        BattleTypes.Battle memory b = mgr.getBattle(id);
        assertEq(uint8(b.status), uint8(BattleTypes.Status.Settled));
        assertEq(uint8(b.winningSide), uint8(BattleTypes.Side.A));
        assertEq(b.winnerCount, 3); // 3 winning entries (alice x2, bob x1)
        assertEq(b.perSlotReward, POOL / 10);

        // alice holds 2 winning entries but claims ONCE for the aggregate amount.
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        mgr.claim(id);
        assertEq(usdc.balanceOf(alice) - before, 2 * (POOL / 10));

        vm.prank(bob);
        mgr.claim(id);
        assertEq(usdc.balanceOf(bob), POOL / 10);

        // double claim reverts (nothing left)
        vm.prank(alice);
        vm.expectRevert(BattleManager.NothingToClaim.selector);
        mgr.claim(id);

        // loser (carol, side B) has nothing to claim
        vm.prank(carol);
        vm.expectRevert(BattleManager.NothingToClaim.selector);
        mgr.claim(id);
    }

    // ── oversubscription: Dice picks exactly winnerSlots winners ───
    function test_oversubscription_dice() public {
        BattleTypes.Config memory cfg = _defaultConfig();
        cfg.winnerSlots = 1; // 3 entries on A -> oversubscribed
        uint256 id = mgr.createBattle(cfg, POOL);

        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(bob);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(carol);
        mgr.enter(id, BattleTypes.Side.A);

        vm.warp(mgr.getBattle(id).lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(100e8);
        mgr.lock(id);

        vm.warp(mgr.getBattle(id).settleTime);
        feedA.setAnswer(120e8); // A +20%
        feedB.setAnswer(90e8); // B -10%
        uint256 fee = dice.selectionFee();
        vm.deal(address(this), fee);
        mgr.settle{ value: fee }(id);

        assertEq(uint8(mgr.getBattle(id).status), uint8(BattleTypes.Status.AwaitingDice));

        entropy.reveal(1, keccak256("seed"));
        BattleTypes.Battle memory b = mgr.getBattle(id);
        assertEq(uint8(b.status), uint8(BattleTypes.Status.Settled));
        assertEq(b.winnerCount, 1);
        assertEq(b.perSlotReward, POOL); // 1 slot gets the whole pool

        uint256 winCount;
        address winner;
        for (uint256 i = 0; i < 3; i++) {
            if (mgr.diceWinner(id, i)) {
                winCount++;
                winner = mgr.entryAt(id, BattleTypes.Side.A, i);
            }
        }
        assertEq(winCount, 1, "exactly winnerSlots winners, never more");
        assertGt(mgr.claimable(id, winner), 0);
    }

    // ── a wallet cannot enter both sides of the same battle ─────────
    function test_cannotEnterBothSides() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        vm.startPrank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        vm.expectRevert(BattleManager.SideAlreadySelected.selector);
        mgr.enter(id, BattleTypes.Side.B);
        // Repeating the SAME side is still fine — it's only the opposite side that's blocked.
        mgr.enter(id, BattleTypes.Side.A);
        vm.stopPrank();
        assertEq(uint8(mgr.sideOf(id, alice)), uint8(BattleTypes.Side.A));
        assertEq(mgr.entriesOf(id, alice), 2);
    }

    // ── an exact tie is a DRAW, not a Cancellation ──────────────────
    function test_exactTie_isDrawn_notCancelled() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);

        vm.warp(mgr.getBattle(id).lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(200e8);
        mgr.lock(id);

        vm.warp(mgr.getBattle(id).settleTime);
        feedA.setAnswer(110e8); // +10%
        feedB.setAnswer(220e8); // +10% exactly — a tie
        mgr.settle(id);

        assertEq(uint8(mgr.getBattle(id).status), uint8(BattleTypes.Status.Drawn));
        // The pool must still be sitting in the vault, untouched — not swept anywhere.
        assertEq(vault.battleBalance(id), POOL);
    }

    // ── per-wallet and per-battle entry caps are enforced ───────────
    function test_maxEntriesPerWallet() public {
        mgr.setMaxEntriesPerWallet(2);
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        vm.startPrank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        mgr.enter(id, BattleTypes.Side.A);
        vm.expectRevert(BattleManager.MaxEntriesPerWalletExceeded.selector);
        mgr.enter(id, BattleTypes.Side.A);
        vm.stopPrank();
    }

    function test_maxEntriesPerBattle() public {
        BattleTypes.Config memory cfg = _defaultConfig();
        cfg.maxEntriesPerBattle = 2;
        uint256 id = mgr.createBattle(cfg, POOL);
        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(bob);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(carol);
        vm.expectRevert(BattleManager.MaxEntriesPerBattleExceeded.selector);
        mgr.enter(id, BattleTypes.Side.A);
    }

    // ── a wallet cannot switch sides mid-battle ─────────────────────
    function test_capacityExceeded() public {
        address dan = makeAddr("dan");
        updown.mint(dan, 2 ether); // capacity = 1 entry @ $2/UPDOWN price $1

        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        assertEq(mgr.capacityOfUser(id, dan), 1);

        vm.prank(dan);
        mgr.enter(id, BattleTypes.Side.A);
        vm.prank(dan);
        vm.expectRevert(BattleManager.CapacityExceeded.selector);
        mgr.enter(id, BattleTypes.Side.A);
    }

    // ── unclaimed rewards are only recoverable after the claim period, never before ──
    function test_recovery_onlyAfterClaimPeriod() public {
        uint256 id = mgr.createBattle(_defaultConfig(), POOL);
        vm.prank(alice);
        mgr.enter(id, BattleTypes.Side.A);

        vm.warp(mgr.getBattle(id).lockTime);
        feedA.setAnswer(100e8);
        feedB.setAnswer(100e8);
        mgr.lock(id);
        vm.warp(mgr.getBattle(id).settleTime);
        feedA.setAnswer(110e8);
        feedB.setAnswer(100e8);
        mgr.settle(id);

        vm.expectRevert(BattleManager.ClaimPeriodNotElapsed.selector);
        mgr.recoverUnclaimed(id);

        vm.warp(block.timestamp + 30 days + 1);
        mgr.recoverUnclaimed(id);
        assertEq(usdc.balanceOf(recoveryBeneficiary), POOL);
        assertEq(vault.battleBalance(id), 0);

        // alice never claimed in time — the claim window is closed, with a clear error rather
        // than a confusing vault-level "insufficient balance" revert.
        vm.prank(alice);
        vm.expectRevert(BattleManager.ClaimExpired.selector);
        mgr.claim(id);
    }

    function test_recovery_neverTouchesAnotherBattlesFunds() public {
        uint256 id1 = mgr.createBattle(_defaultConfig(), POOL);
        uint256 id2 = mgr.createBattle(_defaultConfig(), POOL);
        for (uint256 i = 0; i < 2; i++) {
            uint256 id = i == 0 ? id1 : id2;
            vm.warp(mgr.getBattle(id).lockTime);
            feedA.setAnswer(100e8);
            feedB.setAnswer(100e8);
            mgr.lock(id);
            vm.warp(mgr.getBattle(id).settleTime);
            feedA.setAnswer(110e8);
            feedB.setAnswer(100e8);
            mgr.settle(id);
        }
        vm.warp(block.timestamp + 30 days + 1);
        mgr.recoverUnclaimed(id1);
        assertEq(vault.battleBalance(id1), 0);
        assertEq(vault.battleBalance(id2), POOL, "battle 2's funds must be untouched");
    }

    receive() external payable { }
}
