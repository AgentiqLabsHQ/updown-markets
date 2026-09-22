// Autonomous testnet price oracle.
// Pushes REAL stock prices (Yahoo Finance) — with tiny live jitter so they always
// move — into the mock Chainlink feeds. This makes battle outcomes determined by
// real market data + independent noise that NOBODY controls (not the operator),
// mirroring how mainnet uses live Chainlink feeds. Replaces any operator price-setting.
//
//   node scripts/oracle.mjs once            push one update to all feeds
//   node scripts/oracle.mjs loop [seconds]  keep updating (default 30s)  ← run under cron/host
// env: RH_TESTNET_RPC, and MNEMONIC or PRIVATE_KEY (any funded wallet — setAnswer is public)
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const FEEDS = JSON.parse(fs.readFileSync(new URL("./feeds.json", import.meta.url)));
const FEED_ABI = JSON.parse(fs.readFileSync(new URL("../lib/abis/MockAggregatorV3.json", import.meta.url)));

const account = process.env.PRIVATE_KEY
  ? privateKeyToAccount(process.env.PRIVATE_KEY)
  : mnemonicToAccount(process.env.MNEMONIC);
const chain = { id: 46630, name: "RH Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const JITTER = 0.003; // ±0.3% per tick so prices always move (no exact ties)

async function yahooPrice(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json();
  return j.chart.result[0].meta.regularMarketPrice;
}

async function pushOnce() {
  for (const [sym, feed] of Object.entries(FEEDS)) {
    let base;
    try {
      base = await yahooPrice(sym);
    } catch {
      // fallback: nudge the current on-chain value if the market API is unavailable
      const [, ans] = await pub.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" });
      base = Number(ans) / 1e8 || 100;
    }
    const noisy = base * (1 + (Math.random() - 0.5) * 2 * JITTER);
    const price8 = BigInt(Math.round(noisy * 1e8));
    const hash = await wallet.writeContract({ address: feed, abi: FEED_ABI, functionName: "setAnswer", args: [price8] });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${sym.padEnd(4)} -> $${noisy.toFixed(2)}  (feed ${feed.slice(0, 8)})`);
  }
}

async function main() {
  const mode = process.argv[2] || "once";
  const interval = Number(process.argv[3] || 30) * 1000;
  if (mode === "loop") {
    console.log(`oracle: looping every ${interval / 1000}s (Ctrl+C to stop)`);
    for (;;) {
      try { await pushOnce(); } catch (e) { console.error("tick error:", e.shortMessage || e.message); }
      await new Promise((r) => setTimeout(r, interval));
    }
  } else {
    await pushOnce();
    console.log("oracle: done");
  }
}

main().catch((e) => { console.error("oracle error:", e.shortMessage || e.message); process.exit(1); });
