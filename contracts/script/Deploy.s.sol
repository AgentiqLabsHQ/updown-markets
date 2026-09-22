// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { BattleManager } from "../src/BattleManager.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { DiceSelector } from "../src/DiceSelector.sol";
import { UpdownToken } from "../src/mocks/UpdownToken.sol";
import { MockUSDC } from "../src/mocks/MockUSDC.sol";
import { MockAggregatorV3 } from "../src/mocks/MockAggregatorV3.sol";
import { MockUpdownPriceOracle } from "../src/mocks/MockUpdownPriceOracle.sol";
import { MockEntropy } from "../src/mocks/MockEntropy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUpdownPriceOracle } from "../src/interfaces/IUpdownPriceOracle.sol";
import { IEntropyV2 } from "../src/interfaces/IEntropy.sol";
import { IDiceSelector } from "../src/interfaces/IDiceSelector.sol";

/// @notice Deploy: BattleManager + RewardVault + DiceSelector, plus testnet-only mocks for
/// anything not deployable/discoverable on Robinhood testnet.
///
/// Dice Protocol's DiceEntropy oracle IS real and IS deployed on both Robinhood Chain mainnet
/// (4663) and testnet (46630) — verified on-chain (see contracts/src/DiceSelector.sol for the
/// verification method) — so DICE_ENTROPY_ADDRESS/DICE_PROVIDER_ADDRESS default to the real,
/// verified testnet values below and DiceSelector talks to the real oracle even on testnet.
///
/// Chainlink's Robinhood tokenized-equity feeds are NOT deployed on testnet (confirmed via
/// Chainlink's own feed directory: "Robinhood Chain feeds are not available on testnet"), so
/// price feeds remain MockAggregatorV3 on testnet, driven by scripts/oracle.mjs pulling real
/// market prices — there is no real feed to point at until mainnet. The real mainnet feed
/// addresses (AAPL/TSLA/NVDA/GOOGL), also verified on-chain, are recorded in pairs.mainnet.json
/// for when this moves to chain 4663.
contract Deploy is Script {
    // Verified via eth_getCode + getProviderInfoV2() against the live RPCs — see
    // DiceSelector.sol's doc comment for the exact verification steps.
    address constant DICE_ENTROPY_TESTNET = 0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D;
    address constant DICE_PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;

    function run() external {
        uint256 entryValueUsd8 = vm.envOr("ENTRY_VALUE_USD8", uint256(2e8));
        address diceEntropyAddr = vm.envOr("DICE_ENTROPY_ADDRESS", DICE_ENTROPY_TESTNET);
        address diceProviderAddr = vm.envOr("DICE_PROVIDER_ADDRESS", DICE_PROVIDER);
        bool useMockEntropy = vm.envOr("USE_MOCK_ENTROPY", false);

        vm.startBroadcast();
        address deployer = msg.sender;

        // ── Testnet mocks (UPDOWN + faucet, USDC + faucet, price oracle, feeds) ──
        // Chainlink doesn't deploy Robinhood tokenized-equity feeds on testnet, so these stand
        // in, fed by scripts/oracle.mjs pushing real Yahoo Finance prices (see that script and
        // the BUILD_PLAN for the acknowledged testnet-only nature of this substitution).
        UpdownToken updown = new UpdownToken(deployer);
        MockUSDC usdc = new MockUSDC();
        MockUpdownPriceOracle oracle = new MockUpdownPriceOracle(1e8); // UPDOWN = $1.00
        MockAggregatorV3 feedA = new MockAggregatorV3(8, "AAPL/USD", 100e8);
        MockAggregatorV3 feedB = new MockAggregatorV3(8, "TSLA/USD", 100e8);

        // ── Randomness: real Dice Protocol DiceEntropy oracle by default, mock only if
        // explicitly requested (USE_MOCK_ENTROPY=true) for fully offline/local testing ──
        address entropyAddr;
        address providerAddr;
        if (useMockEntropy) {
            MockEntropy mockEntropy = new MockEntropy();
            entropyAddr = address(mockEntropy);
            providerAddr = deployer; // irrelevant for the mock, but must be non-zero
        } else {
            entropyAddr = diceEntropyAddr;
            providerAddr = diceProviderAddr;
        }

        // ── Protocol ──
        RewardVault vault = new RewardVault(deployer, deployer); // owner + recovery beneficiary
        vault.setTokenAllowed(address(usdc), true);
        vault.setTokenAllowed(address(updown), true);

        BattleManager mgr = new BattleManager(
            deployer,
            IERC20(address(updown)),
            IUpdownPriceOracle(address(oracle)),
            vault,
            entryValueUsd8
        );
        DiceSelector dice = new DiceSelector(IEntropyV2(entropyAddr), providerAddr, deployer);

        // ── Wiring ──
        vault.setManager(address(mgr));
        dice.setManager(address(mgr));
        mgr.setDice(IDiceSelector(address(dice)));
        // Testnet mock feeds are static and don't self-update, so the default
        // 1h staleness window is wrong here — widen it. Mainnet keeps ~3600s
        // since real Chainlink feeds update frequently.
        mgr.setPriceStaleness(30 days);

        vm.stopBroadcast();

        console2.log("== UpdownMarkets testnet deployment ==");
        console2.log("UpdownToken (mock):   ", address(updown));
        console2.log("MockUSDC:             ", address(usdc));
        console2.log("UpdownPriceOracle:    ", address(oracle));
        console2.log("Feed A (AAPL/USD):    ", address(feedA));
        console2.log("Feed B (TSLA/USD):    ", address(feedB));
        console2.log("DiceEntropy:          ", entropyAddr, useMockEntropy ? "(mock)" : "(real Dice Protocol)");
        console2.log("Dice provider:        ", providerAddr);
        console2.log("RewardVault:          ", address(vault));
        console2.log("BattleManager:        ", address(mgr));
        console2.log("DiceSelector:         ", address(dice));
    }
}
