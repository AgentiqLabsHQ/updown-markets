import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { CONTRACTS } from "@/lib/contracts";
import { robinhoodTestnet } from "@/lib/chain";

// On-demand "indexer": read Claimed events straight from the chain and aggregate a
// per-wallet leaderboard. No separate Ponder service or database — this serverless route
// (like /api/rpc) uses the same Alchemy upstream. Cheap at testnet scale; if history grows,
// cache the aggregate in Supabase behind this same route.
export const revalidate = 30; // seconds — light caching so repeat views don't re-scan

// Use the public Robinhood RPC for log queries: Alchemy's free tier caps eth_getLogs at a
// 10-block range, whereas the public RPC serves the full history in one call. Override with
// INDEXER_RPC if you later move to a paid provider.
const RPC =
  process.env.INDEXER_RPC?.trim() || "https://rpc.testnet.chain.robinhood.com";
const START_BLOCK = BigInt(process.env.INDEXER_START_BLOCK || "115813133");
const CLAIMED = parseAbiItem(
  "event Claimed(uint256 indexed battleId, address indexed user, uint256 amount)",
);

export async function GET() {
  try {
    const client = createPublicClient({
      chain: robinhoodTestnet,
      transport: http(RPC),
    });
    const logs = await client.getLogs({
      address: CONTRACTS.battleManager as `0x${string}`,
      event: CLAIMED,
      fromBlock: START_BLOCK,
      toBlock: "latest",
    });

    const byWallet = new Map<
      string,
      { wallet: string; totalClaimed: bigint; battlesWon: number }
    >();
    for (const log of logs) {
      const user = (log.args.user as string) ?? "";
      if (!user) continue;
      const key = user.toLowerCase();
      const amount = (log.args.amount as bigint) ?? 0n;
      const existing = byWallet.get(key);
      if (existing) {
        existing.totalClaimed += amount;
        existing.battlesWon += 1;
      } else {
        byWallet.set(key, { wallet: user, totalClaimed: amount, battlesWon: 1 });
      }
    }

    const entries = Array.from(byWallet.values())
      .sort((a, b) =>
        a.totalClaimed > b.totalClaimed ? -1 : a.totalClaimed < b.totalClaimed ? 1 : 0,
      )
      .map((e) => ({
        wallet: e.wallet,
        totalClaimed: e.totalClaimed.toString(),
        battlesWon: e.battlesWon,
      }));

    return NextResponse.json({ entries });
  } catch (err) {
    // Fail soft: an empty leaderboard is a fine fallback, never a 500 to the client.
    return NextResponse.json({ entries: [], error: String(err) });
  }
}
