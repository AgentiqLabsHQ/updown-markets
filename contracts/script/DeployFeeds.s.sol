// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { MockAggregatorV3 } from "../src/mocks/MockAggregatorV3.sol";

/// @notice Deploy testnet mock feeds for every ticker with a REAL Chainlink settlement feed for
/// Robinhood tokenized equities (33 total — verified against docs.chain.link/data-feeds/
/// tokenized-equity-feeds/robinhood, see contracts/RESEARCH.md). AAPL/TSLA already have feeds
/// deployed (scripts/addresses.json); this deploys the other 31.
///
/// Chainlink does not deploy these feeds on testnet at all (confirmed in RESEARCH.md), so a
/// mock stand-in is required regardless of ticker — this just makes the testnet registry match
/// the real mainnet universe of battle-eligible assets, rather than an arbitrarily smaller list.
/// scripts/keeper.mjs pushes real Yahoo Finance prices into these at lock/settle time, so the
/// starting prices below are rough (order-of-magnitude) placeholders, not live quotes — the one
/// exception is SPCX (SpaceX), which is privately held and has no public quote to pull; the
/// keeper's fallback (drift off the last on-chain price) applies there.
///
/// Anyone can broadcast this (MockAggregatorV3 has no access control) — just needs an account
/// with a little testnet ETH for gas, not the operator key specifically.
///
/// Run:
///   cd contracts && PRIVATE_KEY=0x... forge script script/DeployFeeds.s.sol:DeployFeeds \
///     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
///
/// Then copy the logged addresses into lib/pairs.ts (ASSET_REGISTRY) and scripts/feeds.json —
/// both need to match, same drift that prompted this deploy in the first place.
contract DeployFeeds is Script {
    function run() external {
        vm.startBroadcast();

        MockAggregatorV3 amd = new MockAggregatorV3(8, "AMD/USD", 165e8);
        MockAggregatorV3 amzn = new MockAggregatorV3(8, "AMZN/USD", 225e8);
        MockAggregatorV3 asml = new MockAggregatorV3(8, "ASML/USD", 780e8);
        MockAggregatorV3 baba = new MockAggregatorV3(8, "BABA/USD", 85e8);
        MockAggregatorV3 clsk = new MockAggregatorV3(8, "CLSK/USD", 11e8);
        MockAggregatorV3 coin = new MockAggregatorV3(8, "COIN/USD", 280e8);
        MockAggregatorV3 crcl = new MockAggregatorV3(8, "CRCL/USD", 140e8);
        MockAggregatorV3 crwv = new MockAggregatorV3(8, "CRWV/USD", 85e8);
        MockAggregatorV3 dell = new MockAggregatorV3(8, "DELL/USD", 125e8);
        MockAggregatorV3 ewy = new MockAggregatorV3(8, "EWY/USD", 68e8);
        MockAggregatorV3 gme = new MockAggregatorV3(8, "GME/USD", 24e8);
        MockAggregatorV3 googl = new MockAggregatorV3(8, "GOOGL/USD", 195e8);
        MockAggregatorV3 intc = new MockAggregatorV3(8, "INTC/USD", 24e8);
        MockAggregatorV3 ionq = new MockAggregatorV3(8, "IONQ/USD", 45e8);
        MockAggregatorV3 meta = new MockAggregatorV3(8, "META/USD", 600e8);
        MockAggregatorV3 msft = new MockAggregatorV3(8, "MSFT/USD", 430e8);
        MockAggregatorV3 mstr = new MockAggregatorV3(8, "MSTR/USD", 350e8);
        MockAggregatorV3 mu = new MockAggregatorV3(8, "MU/USD", 105e8);
        MockAggregatorV3 nbis = new MockAggregatorV3(8, "NBIS/USD", 45e8);
        MockAggregatorV3 nvda = new MockAggregatorV3(8, "NVDA/USD", 140e8);
        MockAggregatorV3 orcl = new MockAggregatorV3(8, "ORCL/USD", 180e8);
        MockAggregatorV3 pltr = new MockAggregatorV3(8, "PLTR/USD", 65e8);
        MockAggregatorV3 qqq = new MockAggregatorV3(8, "QQQ/USD", 510e8);
        MockAggregatorV3 rgti = new MockAggregatorV3(8, "RGTI/USD", 15e8);
        MockAggregatorV3 rklb = new MockAggregatorV3(8, "RKLB/USD", 25e8);
        MockAggregatorV3 slv = new MockAggregatorV3(8, "SLV/USD", 28e8);
        MockAggregatorV3 sndk = new MockAggregatorV3(8, "SNDK/USD", 55e8);
        MockAggregatorV3 spcx = new MockAggregatorV3(8, "SPCX/USD", 350e8); // privately held, no public quote
        MockAggregatorV3 spy = new MockAggregatorV3(8, "SPY/USD", 590e8);
        MockAggregatorV3 tsm = new MockAggregatorV3(8, "TSM/USD", 185e8);
        MockAggregatorV3 uso = new MockAggregatorV3(8, "USO/USD", 72e8);

        vm.stopBroadcast();

        console2.log("== New testnet feeds (copy into lib/pairs.ts + scripts/feeds.json) ==");
        console2.log("AMD/USD:", address(amd));
        console2.log("AMZN/USD:", address(amzn));
        console2.log("ASML/USD:", address(asml));
        console2.log("BABA/USD:", address(baba));
        console2.log("CLSK/USD:", address(clsk));
        console2.log("COIN/USD:", address(coin));
        console2.log("CRCL/USD:", address(crcl));
        console2.log("CRWV/USD:", address(crwv));
        console2.log("DELL/USD:", address(dell));
        console2.log("EWY/USD:", address(ewy));
        console2.log("GME/USD:", address(gme));
        console2.log("GOOGL/USD:", address(googl));
        console2.log("INTC/USD:", address(intc));
        console2.log("IONQ/USD:", address(ionq));
        console2.log("META/USD:", address(meta));
        console2.log("MSFT/USD:", address(msft));
        console2.log("MSTR/USD:", address(mstr));
        console2.log("MU/USD:", address(mu));
        console2.log("NBIS/USD:", address(nbis));
        console2.log("NVDA/USD:", address(nvda));
        console2.log("ORCL/USD:", address(orcl));
        console2.log("PLTR/USD:", address(pltr));
        console2.log("QQQ/USD:", address(qqq));
        console2.log("RGTI/USD:", address(rgti));
        console2.log("RKLB/USD:", address(rklb));
        console2.log("SLV/USD:", address(slv));
        console2.log("SNDK/USD:", address(sndk));
        console2.log("SPCX/USD:", address(spcx));
        console2.log("SPY/USD:", address(spy));
        console2.log("TSM/USD:", address(tsm));
        console2.log("USO/USD:", address(uso));
    }
}
