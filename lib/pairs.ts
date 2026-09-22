/**
 * Battle asset registry — every ticker with a real Chainlink settlement feed for Robinhood
 * tokenized equities (33 total, verified against docs.chain.link/data-feeds/tokenized-equity-
 * feeds/robinhood — see contracts/RESEARCH.md). This is deliberately NOT a fixed pairs list:
 * the PRD's own asset-discovery model (§6, "AssetSyncWorker") is a flat registry that any two
 * assets can be drawn from, not hardcoded matchups — HOOD in particular has no real settlement
 * feed at all, which broke a fixed "COIN vs HOOD" pairing this app shipped with earlier.
 *
 * `feed` is the TESTNET mock feed address (Chainlink doesn't deploy these tokenized-equity
 * feeds on testnet at all — confirmed in contracts/RESEARCH.md — so testnet always needs a
 * mock stand-in regardless of ticker). The zero address means "not deployed yet on testnet" —
 * `availableAssets()` filters those out, so the app only ever offers pairs it can actually run,
 * and new tickers appear automatically the moment their mock feed address is filled in below.
 *
 * As of 2026-09-09 all 33 tickers have a deployed testnet mock feed — every asset below is live.
 */
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface AssetFeed {
  symbol: string;
  feed: `0x${string}`;
}

export const ASSET_REGISTRY: AssetFeed[] = [
  { symbol: "AAPL", feed: "0xC96BCaD2db3B88E4452dcb8B3b89f995B0a33b4d" },
  { symbol: "TSLA", feed: "0xB9fE66bB91EAeaFa5027284a24922bFE89ae202B" },
  { symbol: "AMD", feed: "0xb3AC81A95f6EE324AaE560638FCFA34d95302d5b" },
  { symbol: "AMZN", feed: "0xa4e1f9464262f243414e0C2784B7bBd974B4f4c9" },
  { symbol: "ASML", feed: "0xDec623647E88b3d1774e0953D32Dd63198310591" },
  { symbol: "BABA", feed: "0x92C41b3F2bb5bA9bA884A5323B7760999a84B89c" },
  { symbol: "CLSK", feed: "0xB930C5626917Fd9493F44FeD7AF9A121CcCc087E" },
  { symbol: "COIN", feed: "0x2Cc2C7b424DEAD7f3552e696FABdc14B727Dea21" },
  { symbol: "CRCL", feed: "0xc451390F9A224FE3c3C2F3F4265016eba1093D63" },
  { symbol: "CRWV", feed: "0x0E9cfb06EB5123AB9Bce4D9ee3297b34127f1C3E" },
  { symbol: "DELL", feed: "0x540fe2e2fdFDF238E34e35e6B67C5930e0a4FF72" },
  { symbol: "EWY", feed: "0xF87876cEd2b068aCE53f1e323f717efDBBA37368" },
  { symbol: "GME", feed: "0xBF2dC4220dc3a783CEe21b846B2e3229B807a089" },
  { symbol: "GOOGL", feed: "0x5C3758F468553eE2FE612272EC12D9FDA1C4A402" },
  { symbol: "INTC", feed: "0xa7C62238FfB287cA5383D26A9Df93b6886976659" },
  { symbol: "IONQ", feed: "0x1a4F8ba5aE6D98fdbceAd95240A647724405083F" },
  { symbol: "META", feed: "0x516a4c09b9F377Df6AD6476426949276e1eDd778" },
  { symbol: "MSFT", feed: "0x69068Cf90e1C443320f6A1D2056a6F3e282b583E" },
  { symbol: "MSTR", feed: "0xe62a2e13f99E6f160C637c4BBd59CC6B539a7F55" },
  { symbol: "MU", feed: "0x933E9987b03D06ee88B676eF0ecc17bA8Aa51099" },
  { symbol: "NBIS", feed: "0x2a898963F5F0F813519EcEFEDEA9dEE2D23206dc" },
  { symbol: "NVDA", feed: "0xb23E812F74F97cC9C443295F938E95e176d0CfD1" },
  { symbol: "ORCL", feed: "0x0b118d284ae430c57D6f2C8e3977be99f51DF395" },
  { symbol: "PLTR", feed: "0x573872419f3DFf73bB49aD55a711E1E256410edF" },
  { symbol: "QQQ", feed: "0x393178bbcf8a3a1F4F13071F5B6f6929b32594Af" },
  { symbol: "RGTI", feed: "0x0FA86075EBc66D651B6B9369350f5699E6910B00" },
  { symbol: "RKLB", feed: "0xAB12e1c65697A836e85e620ec368995543bfEEAD" },
  { symbol: "SLV", feed: "0x64Ba3586Bc674752B867EDF50282FF01398168bA" },
  { symbol: "SNDK", feed: "0xE50D8fBEE26bb26099D88C4fb9D06900492e4B3a" },
  { symbol: "SPCX", feed: "0x75e7Cd652bA45489ab0150E0337fC878B5CB506a" },
  { symbol: "SPY", feed: "0x60B3A07329a88719dA774aE5dA2514c8De6Ef2C5" },
  { symbol: "TSM", feed: "0x58C92b4be57EeA76105CADed40Cf7E46Fb12f34E" },
  { symbol: "USO", feed: "0x3d18ce191c8A3A6925ba08B20e84E9fd611b7582" },
];

// Both the automated keeper (scripts/keeper.mjs + scripts/market-calendar.mjs) and the admin
// page's manual creation flow (lib/market-calendar.ts) schedule battles against the real US
// equity trading session — entries lock at the real market open, settlement uses the real
// market close (or official early-close time), weekends/holidays get no battle. There is no
// arbitrary relative-offset config left; a battle's lock/settle times are always the real
// session's, whether the battle was created by the cron keeper or manually by an operator.
export const BATTLE_CONFIG = {
  poolUsdc: 100_000_000n, // 100 USDC (6dp)
  winnerSlots: 10,
  maxEntriesPerBattle: 1000,
};

/** Only assets with a deployed (non-placeholder) testnet feed can actually be battled. */
export function availableAssets(): AssetFeed[] {
  return ASSET_REGISTRY.filter((a) => a.feed !== ZERO);
}

export interface Pair {
  label: string;
  symbolA: string;
  feedA: `0x${string}`;
  symbolB: string;
  feedB: `0x${string}`;
}

/**
 * Deterministic pair-of-the-day: picks two distinct assets from the available registry using
 * fixed modular offsets (not crypto-grade randomness — this is a display/rotation convenience,
 * not a security boundary). `scripts/keeper.mjs` mirrors this exact algorithm against its own
 * copy of the available registry so the keeper's actual battle matches what the landing page
 * shows as "today's battle" (PRD: the hero must reflect the real current/upcoming battle).
 */
export function pairForDay(now: number = Date.now()): Pair {
  const assets = availableAssets();
  const dayIndex = Math.floor(now / 1000 / 86400);
  const n = assets.length;
  const iA = dayIndex % n;
  let iB = (dayIndex * 7 + 13) % n;
  if (iB === iA) iB = (iB + 1) % n;
  const a = assets[iA];
  const b = assets[iB];
  return { label: `${a.symbol} vs ${b.symbol}`, symbolA: a.symbol, feedA: a.feed, symbolB: b.symbol, feedB: b.feed };
}
