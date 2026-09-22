"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Loader2, Trophy } from "lucide-react";
import AppShell from "@/app/components/app-shell";
import { fmtUsdc, shortAddr } from "@/lib/format";

interface LeaderboardEntry {
  wallet: `0x${string}`;
  totalClaimed: bigint;
  battlesWon: number;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const data = (await res.json()) as { entries: { wallet: `0x${string}`; totalClaimed: string; battlesWon: number }[] };
        if (!cancelled) {
          setEntries(data.entries.map((e) => ({ wallet: e.wallet, totalClaimed: BigInt(e.totalClaimed), battlesWon: e.battlesWon })));
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell title="Leaderboard" eyebrow="All-time claims">
      <Link href="/" className="ud-focus mb-6 inline-flex items-center gap-2 text-sm text-[#aab4af] hover:text-[#e8ece7]">
        <ArrowLeft size={15} /> Back to home
      </Link>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#aab4af]">
          <Loader2 size={16} className="animate-spin" /> Loading claim history…
        </div>
      ) : error ? (
        <Notice
          icon={<AlertTriangle size={18} className="text-[#e0a060]" />}
          title="Couldn't load the leaderboard"
          body="The leaderboard reads settled claims directly from the chain — it may be temporarily unreachable."
        />
      ) : !entries || entries.length === 0 ? (
        <Notice
          icon={<Trophy size={18} className="text-[#74807c]" />}
          title="No claims yet"
          body="Once battles settle and wallets claim their rewards, the top wallets by total claimed will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#2a3235] bg-[#171c1e]">
          <div className="grid grid-cols-[48px_1fr_auto_auto] gap-3 border-b border-[#2a3235] px-5 py-3 font-mono text-[10px] uppercase tracking-[.1em] text-[#74807c]">
            <span>#</span>
            <span>Wallet</span>
            <span>Battles won</span>
            <span className="text-right">Total claimed</span>
          </div>
          <div className="divide-y divide-[#2a3235]">
            {entries.map((e, i) => (
              <div key={e.wallet} className="grid grid-cols-[48px_1fr_auto_auto] items-center gap-3 px-5 py-4">
                <span className={`font-mono text-sm ${i < 3 ? "text-[#c7e85b]" : "text-[#74807c]"}`}>{i + 1}</span>
                <span className="font-mono text-sm text-[#e8ece7]">{shortAddr(e.wallet)}</span>
                <span className="font-mono text-sm text-[#aab4af]">{e.battlesWon}</span>
                <span className="text-right font-mono text-sm font-semibold text-[#c7e85b]">{fmtUsdc(e.totalClaimed)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#2a3235] bg-[#101315]">{icon}</div>
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[#aab4af]">{body}</p>
    </div>
  );
}
