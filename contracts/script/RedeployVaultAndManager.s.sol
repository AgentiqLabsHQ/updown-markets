// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { BattleManager } from "../src/BattleManager.sol";
import { RewardVault } from "../src/RewardVault.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUpdownPriceOracle } from "../src/interfaces/IUpdownPriceOracle.sol";
import { IDiceSelector } from "../src/interfaces/IDiceSelector.sol";

/// @notice One-off: redeploys BOTH RewardVault (manager-scoping fix — see PRD_AUDIT.md and
/// RewardVault.sol's storage comment) and BattleManager together, since BattleManager.vault is
/// an immutable reference and can't be repointed at a new vault after the fact. DiceSelector is
/// reused (unaffected by either fix) and its manager repointed.
///
/// Safe to do now: the BattleManager deployed minutes ago for the side-selection fix
/// (0x6d9C10e219F55086777D0a4b81E3e8b9D4016CDd) has battleCount() == 0 — no real battle was ever
/// created on it, so nothing of value is orphaned by superseding it again immediately. USDC and
/// UPDOWN are re-allowlisted on the fresh vault (the old vault's allowlist doesn't carry over —
/// nothing is copied automatically between separate contract instances).
///
/// Run:
///   cd contracts && PRIVATE_KEY=0x... (or MNEMONIC=...) forge script \
///     script/RedeployVaultAndManager.s.sol:RedeployVaultAndManager \
///     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
contract RedeployVaultAndManager is Script {
    address constant UPDOWN = 0xEb74957E1cE2e5ae63B419a8Fa6D166E067A4Cf2;
    address constant UPDOWN_ORACLE = 0x9231b4835d0a9e70D66D9e1D0F6b231296171B6a;
    address constant USDC = 0xCd32BA7c4dD5d384261727B7289b4A9368d85035;
    address constant DICE = 0xB928a3D6080900D1a5793A322c2Ccbd331Ff0F79;

    uint256 constant ENTRY_VALUE_USD8 = 200_000_000; // $2 — preserved, matches the live config
    uint256 constant PRICE_STALENESS = 30 days; // testnet mock feeds don't self-update

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        RewardVault vault = new RewardVault(deployer, deployer); // owner + recovery beneficiary
        vault.setTokenAllowed(USDC, true);
        vault.setTokenAllowed(UPDOWN, true);

        BattleManager mgr = new BattleManager(
            deployer,
            IERC20(UPDOWN),
            IUpdownPriceOracle(UPDOWN_ORACLE),
            vault,
            ENTRY_VALUE_USD8
        );
        mgr.setDice(IDiceSelector(DICE));
        mgr.setPriceStaleness(PRICE_STALENESS);

        vault.setManager(address(mgr));
        (bool ok,) = DICE.call(abi.encodeWithSignature("setManager(address)", address(mgr)));
        require(ok, "dice.setManager failed");

        vm.stopBroadcast();

        console2.log("== Fresh RewardVault + BattleManager deployed ==");
        console2.log("New RewardVault:", address(vault));
        console2.log("New BattleManager:", address(mgr));
        console2.log("DiceSelector (reused, manager repointed):", DICE);
        console2.log("entryValueUsd8:", ENTRY_VALUE_USD8);
        console2.log("priceStaleness:", PRICE_STALENESS);
    }
}
