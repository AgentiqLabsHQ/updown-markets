// UpdownMarkets keeper + daily battle scheduler.
//   node scripts/keeper.mjs create [--force]   create today's battle (deterministic pair rotation)
//   node scripts/keeper.mjs run                 lock/settle due battles
//   node scripts/keeper.mjs                      full cycle: create-if-needed + run
// env: RH_TESTNET_RPC, and MNEMONIC or PRIVATE_KEY (operator, testnet-only)
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, maxUint256 } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { tradingSessionFor, nyDateString } from "./market-calendar.mjs";

const RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const here = (p) => new URL(p, import.meta.url);
const C = JSON.parse(fs.readFileSync(here("./addresses.json")));
const CFG = JSON.parse(fs.readFileSync(here("./pairs.json")));
const abi = (n) => JSON.parse(fs.readFileSync(here(`../lib/abis/${n}.json`)));
const BM = abi("BattleManager");
const FEED = abi("MockAggregatorV3");
const USDC = abi("MockUSDC");
const DICE = abi("DiceSelector");

const account = process.env.PRIVATE_KEY
  ? privateKeyToAccount(process.env.PRIVATE_KEY)
  : mnemonicToAccount(process.env.MNEMONIC);
const chain = { id: 46630, name: "RH Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const bm = { address: C.battleManager, abi: BM };

const send = async (params) => {
  const hash = await wallet.writeContract(params);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
};
const dayIndex = (sec) => Math.floor(Number(sec) / 86400);

// ── Real-price feed updates (used only at lock and settle) ──────────────────
// The keeper pushes the REAL market price (Yahoo) into a feed right before it
// locks/settles — never a hand-picked value. So it decides WHEN a battle settles,
// never WHO wins. On mainnet this is deleted and the feeds are real Chainlink.
const FEEDS = JSON.parse(fs.readFileSync(here("./feeds.json")));
const ADDR2SYM = Object.fromEntries(Object.entries(FEEDS).map(([s, a]) => [a.toLowerCase(), s]));
const JITTER = 0.003; // ±0.3% so open != close even when the market is closed

// Mirrors lib/pairs.ts's pairForDay() exactly (same modular-offset algorithm, same registry
// key order) so the battle the keeper actually creates matches what the landing page shows as
// "today's battle". `FEEDS`' key order must match lib/pairs.ts's ASSET_REGISTRY order — both
// start AAPL, TSLA, then the rest alphabetically.
function pairForDay(sec) {
  const assets = Object.entries(FEEDS); // [symbol, feedAddress][]
  const n = assets.length;
  const iA = dayIndex(sec) % n;
  let iB = (dayIndex(sec) * 7 + 13) % n;
  if (iB === iA) iB = (iB + 1) % n;
  const [symbolA, feedA] = assets[iA];
  const [symbolB, feedB] = assets[iB];
  return { label: `${symbolA} vs ${symbolB}`, symbolA, feedA, symbolB, feedB };
}

async function yahooPrice(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json();
  return j.chart.result[0].meta.regularMarketPrice;
}
async function pushRealPrice(feed) {
  const sym = ADDR2SYM[feed.toLowerCase()];
  let base = null;
  try { if (sym) base = await yahooPrice(sym); } catch { /* fall back below */ }
  if (base == null) {
    const [, ans] = await pub.readContract({ address: feed, abi: FEED, functionName: "latestRoundData" });
    base = Number(ans) / 1e8 || 100;
  }
  const noisy = base * (1 + (Math.random() - 0.5) * 2 * JITTER);
  await send({ address: feed, abi: FEED, functionName: "setAnswer", args: [BigInt(Math.round(noisy * 1e8))] });
  console.log(`  ${sym || feed.slice(0, 8)} -> $${noisy.toFixed(2)}`);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function ensureFunded(token, pool) {
  const bal = await pub.readContract({ address: token, abi: USDC, functionName: "balanceOf", args: [account.address] });
  if (bal < pool) {
    try { await send({ address: token, abi: USDC, functionName: "faucet" }); } catch { /* mainnet tokens have no faucet */ }
  }
  const allowance = await pub.readContract({ address: token, abi: USDC, functionName: "allowance", args: [account.address, C.rewardVault] });
  if (allowance < pool) {
    await send({ address: token, abi: USDC, functionName: "approve", args: [C.rewardVault, maxUint256] });
  }
}

async function createDaily(force) {
  const nowSec = (await pub.getBlock()).timestamp;
  const nyDate = nyDateString(Number(nowSec) * 1000);

  const count = await pub.readContract({ ...bm, functionName: "battleCount" });
  if (!force && count > 0n) {
    const latest = await pub.readContract({ ...bm, functionName: "getBattle", args: [count] });
    if (nyDateString(Number(latest.openTime) * 1000) === nyDate) {
      console.log(`create: battle #${count} already exists for today (${nyDate} ET) — skipping`);
      return;
    }
  }

  // Battles track the real US equity trading session (PRD §2.3/§5) — one per valid session,
  // entries lock at the real market open, settlement uses the real market close (or the
  // official early-close time). Weekends and holidays simply don't get a battle.
  const session = tradingSessionFor(nyDate);
  if (!session) {
    console.log(`create: ${nyDate} is not a US equity trading session (weekend/holiday) — no battle today`);
    return;
  }
  const marketStartSec = BigInt(Math.floor(session.marketStartAt.getTime() / 1000));
  const marketEndSec = BigInt(Math.floor(session.marketEndAt.getTime() / 1000));
  if (nowSec >= marketStartSec) {
    console.log(`create: ${nyDate}'s market has already opened (or closed) — too late to open entries for today, waiting for the next session`);
    return;
  }

  const pair = pairForDay(nowSec);
  const pool = BigInt(CFG.poolUsdc);
  const rewardToken = CFG.rewardToken === "updown" ? C.updown : C.usdc;
  await ensureFunded(rewardToken, pool);

  // Entries open now (whenever the keeper actually creates the battle, ahead of market open)
  // and lock exactly at the real market open; settlement uses the real market close.
  const openTime = nowSec;
  const lockTime = marketStartSec;
  const settleTime = marketEndSec;
  const config = {
    feedA: pair.feedA, feedB: pair.feedB,
    tokenA: ZERO_ADDRESS, tokenB: ZERO_ADDRESS, // no real Robinhood Stock Token on testnet
    openTime, lockTime, settleTime,
    winnerSlots: CFG.winnerSlots, maxEntriesPerBattle: CFG.maxEntriesPerBattle,
    rewardToken,
  };
  console.log(`create: ${pair.label} · pool ${Number(pool) / 1e6} ${CFG.rewardToken.toUpperCase()} · no entry fee · session ${nyDate} 09:30-${session.earlyClose ? "13:00 (early close)" : "16:00"} ET`);
  await send({ ...bm, functionName: "createBattle", args: [config, pool] });
  const id = await pub.readContract({ ...bm, functionName: "battleCount" });
  console.log(`create: battle #${id} created (${pair.label})`);
}

async function runLockSettle() {
  const count = await pub.readContract({ ...bm, functionName: "battleCount" });
  const now = (await pub.getBlock()).timestamp;
  for (let id = 1n; id <= count; id++) {
    const b = await pub.readContract({ ...bm, functionName: "getBattle", args: [id] });
    if (b.status === 1 && now >= b.lockTime) {
      // Snapshot the OPEN price = the real market price right now.
      console.log(`#${id}: fetching open prices + locking`);
      await pushRealPrice(b.feedA);
      await pushRealPrice(b.feedB);
      await send({ ...bm, functionName: "lock", args: [id] });
    } else if (b.status === 2 && now >= b.settleTime) {
      // Snapshot the CLOSE price = the real market price right now, then settle.
      // The value pushed is whatever the market says — the operator picks nothing.
      console.log(`#${id}: fetching close prices + settling`);
      await pushRealPrice(b.feedA);
      await pushRealPrice(b.feedB);
      const [ca, cb] = await pub.readContract({ ...bm, functionName: "entriesCount", args: [id] });
      // Winning side is unknown pre-settle; forward the dice fee if EITHER side
      // could be oversubscribed (any overpayment is refunded by DiceSelector).
      const slots = BigInt(b.winnerSlots);
      let value = 0n;
      if (ca > slots || cb > slots) value = await pub.readContract({ address: C.dice, abi: DICE, functionName: "selectionFee" });
      await send({ ...bm, functionName: "settle", args: [id], value });
      console.log(`#${id}: settled`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("--")) || "cycle";
  const force = args.includes("--force");
  console.log(`keeper: ${cmd}${force ? " --force" : ""} as ${account.address}`);
  if (cmd === "create") await createDaily(force);
  else if (cmd === "run") await runLockSettle();
  else { await createDaily(force); await runLockSettle(); }
  console.log("keeper: done");
}

main().catch((e) => { console.error("keeper error:", e.shortMessage || e.message); process.exit(1); });
