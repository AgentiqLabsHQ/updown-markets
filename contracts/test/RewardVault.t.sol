// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";

/// @notice Regression coverage for the manager-scoping fix: RewardVault storage is keyed by
/// (manager, battleId), not battleId alone, so a redeployed BattleManager's battle numbering
/// can't collide with a superseded manager's data in the same reused vault. This is exactly the
/// scenario that broke in production — see PRD_AUDIT.md and contracts/deployments/46630-v2.1.json.
contract RewardVaultTest is Test {
    RewardVault vault;
    MockUSDC usdc;
    address managerA = makeAddr("managerA");
    address managerB = makeAddr("managerB");
    address beneficiary = makeAddr("beneficiary");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new RewardVault(address(this), beneficiary);
        vault.setTokenAllowed(address(usdc), true);
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), type(uint256).max);
    }

    /// @dev Simulates exactly what happened live: two different "BattleManager" callers (a
    /// stand-in for pre- and post-redeploy instances) both fund and pay out of "battle #1"
    /// against the same vault, and their balances must never mix.
    function test_sameBattleId_differentManagers_doNotCollide() public {
        vault.setManager(managerA);
        vm.prank(managerA);
        vault.collect(1, address(usdc), address(this), 100e6);

        // "Redeploy" — a new manager takes over. managerA is no longer authorized at all.
        vault.setManager(managerB);
        vm.prank(managerB);
        vault.collect(1, address(usdc), address(this), 50e6);

        // The CURRENT manager's view of battle #1 must be its own contribution only — not
        // managerA's 100 sitting in the same numeric slot.
        assertEq(vault.battleBalance(1), 50e6, "current manager's battle 1 must not include the old manager's funds");
        assertEq(vault.battleBalanceFor(managerA, 1), 100e6, "old manager's battle 1 must still be inspectable on its own");
        assertEq(vault.battleBalanceFor(managerB, 1), 50e6);

        // managerA can no longer touch the vault at all post-redeploy (already true via
        // onlyManager), so its 100 is inert but NOT drainable by managerB's battle #1 either.
        vm.prank(managerB);
        vault.payout(1, alice, 50e6);
        assertEq(usdc.balanceOf(alice), 50e6, "payout must only ever draw from the calling manager's own balance");
        assertEq(vault.battleBalanceFor(managerA, 1), 100e6, "managerA's balance must be completely untouched by managerB's payout");

        vm.prank(managerB);
        vm.expectRevert(RewardVault.InsufficientBattleBalance.selector);
        vault.payout(1, alice, 1); // managerB's own battle 1 is now empty — can't dip into managerA's leftover
    }

    function test_recoverExpired_onlyAffectsCallingManagersBalance() public {
        vault.setManager(managerA);
        vm.prank(managerA);
        vault.collect(7, address(usdc), address(this), 40e6);

        vault.setManager(managerB);
        vm.prank(managerB);
        vault.collect(7, address(usdc), address(this), 10e6);

        vm.prank(managerB);
        vault.recoverExpired(7);
        assertEq(usdc.balanceOf(beneficiary), 10e6, "recovery must only sweep the calling manager's own contribution");
        assertEq(vault.battleBalanceFor(managerA, 7), 40e6, "the other manager's funds must be untouched");
    }
}
