"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Check, Loader2, Trophy } from "lucide-react";
import AppShell, { Metric } from "@/app/components/app-shell";
import BrandLogo from "@/app/components/brand-logo";
import { useWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile";
import { useActions, useAccountState, useFeedSymbol, useNetwork } from "@/lib/hooks";
import { useMyPositions, type Position } from "@/lib/dashboard";
import { assetFor } from "@/lib/assets";
import { Side, Status } from "@/lib/contracts";
import { fmtUpdown, fmtUsdc, sideLabel, statusLabel } from "@/lib/format";

export default function DashboardPage() {
  const { ready, authenticated, isConnected, address, login } = useWallet();
  const { profile } = useProfile(address);
  const { positions, loading, refresh } = useMyPositions(address);
  const wallet = useAccountState(address);
  const network = useNetwork();
  const [dataError, setDataError] = useState("");
  const claimable = positions.filter((p) => p.isWinner && !p.alreadyClaimed && p.claimableAmount > 0n);
  const claimableTotal = claimable.reduce((s, p) => s + p.claimableAmount, 0n);
  const wins = positions.filter((p) => p.isWinner).length;
  const dataLoading = !ready || (isConnected && loading && wallet.updown === undefined && wallet.usdc === undefined);
  const retryData = () => { setDataError(""); wallet.refetch(); refresh(); };

  return (
    <AppShell title="Overview" eyebrow="Your positions">
      {network.wrongNetwork && isConnected && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#6a5730] bg-[#2b2415] p-4 text-sm text-[#e8c277]" role="alert">
          <span className="min-w-0 flex-1">Wallet connected on an unsupported network. Switch before using balances or transactions.</span>
          <button onClick={() => network.switchToRobinhood()} disabled={network.switching} className="ud-focus flex min-h-10 items-center gap-2 rounded-md border border-[#e8c277] px-3 text-xs font-semibold disabled:opacity-50">{network.switching && <Loader2 size={14} className="animate-spin" />} Switch network</button>
        </div>
      )}
      {dataError && <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#70423e] bg-[#2a1918] p-4 text-sm text-[#f0aaa0]" role="alert"><span className="min-w-0 flex-1">{dataError}</span><button onClick={retryData} className="ud-focus rounded-md border border-[#f0aaa0] px-3 py-2 text-xs font-semibold">Retry data</button></div>}
      {!isConnected ? (
        <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#53632a] bg-[#263116]"><Activity size={20} className="text-[#c7e85b]" /></div>
          <h2 className="mt-5 text-xl font-semibold">{authenticated ? "Finish connecting your wallet" : "Connect to see your positions"}</h2>
          <p className="mt-2 text-sm text-[#aab4af]">{authenticated ? "Your Privy session is ready; reconnect the wallet to load dashboard data." : "Your entries, results, and claimable winnings live here."}</p>
          <button onClick={() => { setDataError(""); login(); }} className="ud-focus mt-6 min-h-12 w-full rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Retry connection</button>
        </div>
      ) : (
        <div className="space-y-6">
          {profile?.display_name && <p className="text-sm text-[#aab4af]">Welcome back, <span className="font-semibold text-[#e8ece7]">{profile.display_name}</span>.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="UPDOWN balance" value={wallet.updown === undefined ? "Loading…" : fmtUpdown(wallet.updown)} detail="Entry capacity token" />
            <Metric label="USDC balance" value={wallet.usdc === undefined ? "Loading…" : fmtUsdc(wallet.usdc)} detail="Available balance" />
            <Metric label="Battles" value={positions.length.toString()} detail="Recent battles" />
            <Metric label="Wins" value={wins.toString()} detail="Winning battles" />
          </div>
          {dataLoading && <div className="flex items-center gap-2 rounded-xl border border-[#2a3235] bg-[#171c1e] p-4 text-sm text-[#aab4af]"><Loader2 size={16} className="animate-spin text-[#c7e85b]" />Loading wallet and dashboard data…</div>}
          {wallet.updown === undefined && wallet.usdc === undefined && !dataLoading && <div className="flex items-center justify-between gap-3 rounded-xl border border-[#70423e] bg-[#2a1918] p-4 text-sm text-[#f0aaa0]">Unable to load wallet balances.<button onClick={retryData} className="ud-focus rounded-md border border-[#f0aaa0] px-3 py-2 text-xs font-semibold">Retry</button></div>}
          <div className="rounded-xl border border-[#2a3235] bg-[#171c1e]">
            <div className="flex items-center justify-between border-b border-[#2a3235] px-5 py-4"><p className="font-mono text-[10px] uppercase tracking-[.12em] text-[#74807c]">Your battles</p>{loading && <Loader2 size={15} className="animate-spin text-[#74807c]" />}</div>
            {positions.length === 0 && !loading ? <div className="px-5 py-12 text-center"><p className="text-sm text-[#aab4af]">No entries yet.</p><Link href="/battle" className="ud-focus mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Enter the live battle</Link></div> : <div className="divide-y divide-[#2a3235]">{positions.map((p) => <PositionRow key={p.battleId.toString()} p={p} onClaimed={refresh} />)}</div>}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function PositionRow({ p, onClaimed }: { p: Position; onClaimed: () => void }) {
  const symbolA = useFeedSymbol(p.feedA) ?? "A";
  const symbolB = useFeedSymbol(p.feedB) ?? "B";
  const actions = useActions();
  const [busy, setBusy] = useState(false);
  const backed = p.side === Side.A ? symbolA : symbolB;
  const backedName = assetFor(backed)?.name ?? "Token";
  const won = p.isWinner;
  const lost = p.status === Status.Settled && !won;
  const pending = p.status === Status.Open || p.status === Status.Locked || p.status === Status.AwaitingDice;
  const canClaim = won && !p.alreadyClaimed && p.claimableAmount > 0n;
  let label = statusLabel(p.status);
  let tone = "text-[#aab4af]";
  if (pending) { label = "Pending"; tone = "text-[#aab4af]"; } else if (won && p.alreadyClaimed) { label = "Claimed"; tone = "text-[#c7e85b]"; } else if (canClaim) { label = "Won — claimable"; tone = "text-[#c7e85b]"; } else if (lost) { label = "Lost"; tone = "text-[#74807c]"; } else if (p.status === Status.Drawn) { label = "Draw"; tone = "text-[#74807c]"; } else if (p.status === Status.Cancelled) { label = "Void"; tone = "text-[#74807c]"; }
  async function claim() { setBusy(true); try { await actions.claim(p.battleId); onClaimed(); } catch { /* surfaced by wallet */ } finally { setBusy(false); } }
  return <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><BrandLogo symbol={backed} size={36} decorative /><div className={`flex h-9 w-9 items-center justify-center rounded-md border ${won ? "border-[#53632a] bg-[#263116]" : "border-[#2a3235] bg-[#101315]"}`}>{won ? <Trophy size={16} className="text-[#c7e85b]" /> : <Activity size={16} className="text-[#74807c]" />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">Battle #{p.battleId.toString()} · {backedName} <span className="font-mono text-xs text-[#74807c]">{backed} (Side {sideLabel(p.side)} · {p.entryCount.toString()} {p.entryCount === 1n ? "entry" : "entries"})</span></p><p className={`font-mono text-xs ${tone}`}>{label}{canClaim ? ` · ${fmtUsdc(p.claimableAmount)}` : ""}</p></div></div>{canClaim && <button onClick={claim} disabled={busy} className="ud-focus flex min-h-10 items-center gap-2 rounded-md bg-[#c7e85b] px-4 text-xs font-semibold text-[#18200f] hover:bg-[#bcdc56] disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Claim {fmtUsdc(p.claimableAmount)}</button>}</div>;
}