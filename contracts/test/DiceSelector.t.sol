// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { DiceSelector } from "../src/DiceSelector.sol";
import { IEntropyV2 } from "../src/interfaces/IEntropy.sol";

/// @dev Exposes DiceSelector's internal `_pick` for direct testing of the sparse
/// Fisher-Yates + rejection-sampling selection algorithm (PRD 9.9/9.10/9.18).
contract PickHarness is DiceSelector {
    constructor(IEntropyV2 entropy_, address provider_, address owner_) DiceSelector(entropy_, provider_, owner_) { }

    function pick(uint256 battleId, uint256 n, uint256 slots, uint256 seed)
        external
        pure
        returns (uint256[] memory)
    {
        return _pick(battleId, n, slots, seed);
    }
}

contract DiceSelectorTest is Test {
    PickHarness harness;

    function setUp() public {
        harness = new PickHarness(IEntropyV2(address(0xBEEF)), address(0xCAFE), address(this));
    }

    function _assertValidSelection(uint256[] memory chosen, uint256 n, uint256 slots) internal pure {
        assertEq(chosen.length, slots, "must return exactly K indices");
        for (uint256 i = 0; i < chosen.length; i++) {
            assertLt(chosen[i], n, "index must be in [0, n)");
            for (uint256 j = i + 1; j < chosen.length; j++) {
                assertTrue(chosen[i] != chosen[j], "indices must be unique (no replacement)");
            }
        }
    }

    function testFuzz_pick_isValid(uint256 n, uint256 slotsSeed, uint256 seed, uint256 battleId) public view {
        n = bound(n, 1, 500);
        uint256 slots = bound(slotsSeed, 1, n);
        uint256[] memory chosen = harness.pick(battleId, n, slots, seed);
        _assertValidSelection(chosen, n, slots);
    }

    function test_pick_deterministic_for_identical_inputs() public view {
        uint256[] memory a = harness.pick(1, 50, 10, 12345);
        uint256[] memory b = harness.pick(1, 50, 10, 12345);
        assertEq(a.length, b.length);
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(a[i], b[i]);
        }
    }

    function test_pick_differentSeed_generallyDiffers() public view {
        uint256[] memory a = harness.pick(1, 50, 10, 111);
        uint256[] memory b = harness.pick(1, 50, 10, 222);
        bool anyDifferent;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) anyDifferent = true;
        }
        assertTrue(anyDifferent, "different seeds should (almost always) produce a different selection");
    }

    function test_pick_differentBattleId_generallyDiffers() public view {
        // Same seed, different battle ID must not collide — otherwise two battles resolved by
        // the same randomness callback ordering could be predicted from one another.
        uint256[] memory a = harness.pick(1, 50, 10, 999);
        uint256[] memory b = harness.pick(2, 50, 10, 999);
        bool anyDifferent;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) anyDifferent = true;
        }
        assertTrue(anyDifferent, "battle ID must be bound into the derivation");
    }

    function test_pick_KEqualsN_selectsEveryIndex() public view {
        uint256[] memory chosen = harness.pick(1, 7, 7, 42);
        _assertValidSelection(chosen, 7, 7);
        // With K == N every index from 0..6 must appear exactly once.
        bool[] memory seen = new bool[](7);
        for (uint256 i = 0; i < chosen.length; i++) {
            seen[chosen[i]] = true;
        }
        for (uint256 i = 0; i < 7; i++) {
            assertTrue(seen[i], "every index must appear when K == N");
        }
    }

    function test_pick_KEqualsOne() public view {
        uint256[] memory chosen = harness.pick(1, 1000, 1, 7);
        _assertValidSelection(chosen, 1000, 1);
    }
}
