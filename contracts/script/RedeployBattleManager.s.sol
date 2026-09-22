// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { BattleManager } from "../src/BattleManager.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUpdownPriceOracle } from "../src/interfaces/IUpdownPriceOracle.sol";
import { IDiceSelector } from "../src/interfaces/IDiceSelector.sol";

/// @notice One-off redeploy of BattleManager to pick up the side-selection fix (a wallet could
/// previously enter both sides of a battle — see PRD_AUDIT.md). Reuses the EXISTING RewardVault
/// and DiceSelector rather than redeploying the whole stack, and rewires both to the new
/// manager. Values below were read directly from the live deployed contract immediately before
/// writing this script (not from memory/notes) so the new instance starts with identical
/// config.
///
/// Run:
///   cd contracts && PRIVATE_KEY=0x... (or MNEMONIC=...) forge script \
///     script/RedeployBattleManager.s.sol:RedeployBattleManager \
///     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
///
/// Must be run by the wallet that owns RewardVault and DiceSelector (Ownable2Step `owner()`) —
/// 0x325cB2956198E54dC6a05348b1712c8a9ea4757a on testnet today. That wallet becomes the new
/// BattleManager's DEFAULT_ADMIN_ROLE/OPERATOR_ROLE holder too (matches the original deploy).
///
/// Note: battle #2 on the OLD BattleManager (one test entry, 100 test USDC funded) becomes
/// unreachable after this — the vault's funds for that battle stay recorded under battleId 2,
/// but the new BattleManager starts its own battle numbering from 0 and the old manager loses
/// vault access once the manager is repointed. Not a real loss (testnet-faucet USDC), just
/// disclosed here rather than silently orphaned.
contract RedeployBattleManager is Script {
    address constant UPDOWN = 0xEb74957E1cE2e5ae63B419a8Fa6D166E067A4Cf2;
    address constant UPDOWN_ORACLE = 0x9231b4835d0a9e70D66D9e1D0F6b231296171B6a;
    address constant VAULT = 0x4871F61e7d382FaeA68F61Bbe309abEA91f2f30c;
    address constant DICE = 0xB928a3D6080900D1a5793A322c2Ccbd331Ff0F79;

    // Read directly from the live BattleManager before writing this script — preserved exactly,
    // not silently changed as part of this fix.
    uint256 constant ENTRY_VALUE_USD8 = 200_000_000; // $2
    uint256 constant PRICE_STALENESS = 30 days; // NOT the 3600s default — testnet mock feeds
        // don't self-update; this is the exact fix from "Fix stale-feed lock/settle failure on
        // testnet" and must be reapplied or lock()/settle() breaks again.

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        BattleManager mgr = new BattleManager(
            deployer,
            IERC20(UPDOWN),
            IUpdownPriceOracle(UPDOWN_ORACLE),
            RewardVault(payable(VAULT)),
            ENTRY_VALUE_USD8
        );
        mgr.setDice(IDiceSelector(DICE));
        mgr.setPriceStaleness(PRICE_STALENESS);

        RewardVault(payable(VAULT)).setManager(address(mgr));
        // DiceSelector.setManager is onlyOwner; call it directly via low-level interface to
        // avoid importing the concrete contract (keeps this script's dependency surface small).
        (bool ok,) = DICE.call(abi.encodeWithSignature("setManager(address)", address(mgr)));
        require(ok, "dice.setManager failed");

        vm.stopBroadcast();

        console2.log("== BattleManager redeployed ==");
        console2.log("New BattleManager:", address(mgr));
        console2.log("RewardVault (reused, manager repointed):", VAULT);
        console2.log("DiceSelector (reused, manager repointed):", DICE);
        console2.log("entryValueUsd8:", ENTRY_VALUE_USD8);
        console2.log("priceStaleness:", PRICE_STALENESS);
    }
}
