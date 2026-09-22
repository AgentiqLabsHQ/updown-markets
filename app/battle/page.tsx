"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Check, Clock3, Droplets, Loader2, ShieldCheck, Trophy } from "lucide-react";
import AppShell, { Metric } from "@/app/components/app-shell";
import BrandLogo from "@/app/components/brand-logo";
import { useWallet } from "@/lib/wallet";
import { useAccountState, useActions, useBattle, useBattleCount, useClaimable, useFeedSymbol, useNetwork, useUserEntries } from "@/lib/hooks";
import { Side, Status } from "@/lib/contracts";
import { assetFor } from "@/lib/assets";
import { fmtCountdown, fmtUsdc, pctReturn, sideLabel, statusLabel } from "@/lib/format";
import { useBlock } from "wagmi";

function useAuthoritativeNow() {
  const block = useBlock({ query: { refetchInterval: 15000 } });
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState<number | undefined>();
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (block.data?.timestamp !== undefined) setClockOffset(Number(block.data.timestamp) * 1000 - Date.now()); }, [block.data?.timestamp]);
  return { now: clockOffset === undefined ? undefined : now + clockOffset, loading: block.isLoading || block.isFetching };
}

export default function BattlePage() {
  const { isConnected, address, login } = useWallet();
  const { id } = useBattleCount();
  const { battle, entriesA, entriesB, refetch } = useBattle(id);
  const acct = useAccountState(address, id);
  const claimable = useClaimable(id, address);
  const net = useNetwork();
  const used = useUserEntries(id, address);
  const symbolA = useFeedSymbol(battle?.feedA) ?? "Token A";
  const symbolB = useFeedSymbol(battle?.feedB) ?? "Token B";
  const actions = useActions();
  const authoritativeNow = useAuthoritativeNow();
  const [side, setSide] = useState<Side>(Side.A);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const status = battle?.status as number | undefined;
  const authoritativeMs = authoritativeNow.now ?? 0;
  const validTimes = battle !== undefined && battle.openTime > 0n && battle.lockTime > 0n && battle.lockTime >= battle.openTime;
  const cutoffReady = validTimes && authoritativeNow.now !== undefined;
  const inWindow = cutoffReady && battle && status === Status.Open && Number(battle.openTime) * 1000 <= authoritativeMs && authoritativeMs < Number(battle.lockTime) * 1000;
  const windowClosed = status === Status.Open && cutoffReady && authoritativeMs >= Number(battle?.lockTime ?? 0n) * 1000;
  const timingUnavailable = status === Status.Open && !validTimes;
  const timingPending = status === Status.Open && validTimes && !cutoffReady;
  const remaining = acct.capacity !== undefined && used !== undefined ? acct.capacity - used > 0n ? acct.capacity - used : 0n : undefined;
  const canEnter = isConnected && inWindow && (remaining ?? 0n) > 0n && !busy;
  const canClaim = status === Status.Settled && (claimable.amount ?? 0n) > 0n;

  async function onEnter() {
    if (!id || !canEnter) return;
    setBusy(true);
    try { setNotice("Submitting entry…"); await actions.enter(id, side); setNotice(`Entry confirmed on ${side === Side.A ? symbolA : symbolB} ✓`); refetch(); acct.refetch(); }
    catch (e: unknown) { const err = e as { shortMessage?: string; message?: string }; setNotice(`Error: ${err.shortMessage || err.message || "transaction failed"}`); }
    finally { setBusy(false); setTimeout(() => setNotice(""), 6000); }
  }
  async function onClaim() {
    if (!id) return;
    setBusy(true);
    try { setNotice("Claiming reward…"); await actions.claim(id); setNotice("Reward claimed ✓"); claimable.refetch(); }
    catch (e: unknown) { const err = e as { shortMessage?: string; message?: string }; setNotice(`Error: ${err.shortMessage || err.message || "claim failed"}`); }
    finally { setBusy(false); setTimeout(() => setNotice(""), 6000); }
  }

  return (
    <AppShell title="Live battle" eyebrow="Daily prediction">
      {notice && <div role="status" className="mb-6 flex items-center gap-2 rounded-md border border-[#53632a] bg-[#263116] px-4 py-3 text-sm text-[#c7e85b]">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{notice}</div>}
      {!id || id === 0n || !battle || status === Status.None ? <EmptyBattle /> : <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
        <section className="space-y-6">
          <div className="matchup-card rounded-xl border border-[#2a3235] bg-[#171c1e] p-4 sm:p-6">
            <div className="matchup-heading flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[.14em] text-[#b5aebb]"><span className="live-dot" aria-hidden="true" /> <span>Battle #{id.toString()}</span><span className="sr-only">Live matchup</span></div>
              <span className={`battle-status-badge rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[.12em] ${inWindow ? "border-[#53632a] bg-[#263116] text-[#c7e85b]" : "border-[#364144] bg-[#1e2527] text-[#aab4af]"}`}><span className="status-ring" aria-hidden="true" />{windowClosed ? "Entries closed" : statusLabel(status)}</span>
            </div>
            <div className="matchup-subtitle mt-4 flex items-center justify-between gap-3 border-b border-white/[.07] pb-4 font-mono text-[10px] uppercase tracking-[.16em] text-[#8f8794]"><span>Choose a side</span><span className="hidden sm:inline">Market matchup · unsettled</span></div>
            <div className="matchup-grid mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] sm:items-stretch">
              {([Side.A, Side.B] as const).map((s, i) => {
                const sym = s === Side.A ? symbolA : symbolB;
                const open = s === Side.A ? battle.openPriceA : battle.openPriceB;
                const close = s === Side.A ? battle.closePriceA : battle.closePriceB;
                const selected = side === s;
                const won = status === Status.Settled && battle.winningSide === s;
                const tokenName = assetFor(sym)?.name ?? "Token";
                return <div key={s} className={`side-column ${i === 1 ? "sm:col-start-3" : ""}`}><button onClick={() => setSide(s)} disabled={!inWindow} aria-pressed={selected} aria-label={`Choose Side ${sideLabel(s)}: ${tokenName} (${sym})`} className={`side-choice ud-focus group w-full rounded-xl border p-4 text-left transition sm:p-5 ${selected ? "side-choice-selected border-[#d6b36a]" : "side-choice-idle border-[#2a3235] hover:border-[#d6b36a]/70"}`}><div className="flex items-center justify-between"><span className={`font-mono text-[10px] font-semibold uppercase tracking-[.16em] ${selected ? "text-[#d6b36a]" : "text-[#8f8794]"}`}>Side {sideLabel(s)}</span>{selected ? <span className="selection-mark" aria-label="Selected">✓</span> : won ? <Trophy size={15} className="text-[#d6b36a]" aria-label="Settled winning side" /> : <span className="side-arrow" aria-hidden="true">↗</span>}</div><div className="mt-5 flex items-center gap-3"><span className={`token-logo-wrap ${selected ? "token-logo-selected" : ""}`}><BrandLogo symbol={sym} size={48} name={tokenName} /></span><div className="min-w-0"><p className="truncate text-xl font-semibold tracking-[-.03em] text-[#f0edf2]">{tokenName}</p><p className="mt-0.5 font-mono text-sm font-semibold tracking-[.08em] text-[#d6b36a]">{sym}</p><p className={`mt-2 font-mono text-[11px] uppercase tracking-[.1em] ${selected ? "text-[#d6b36a]" : "text-[#8f8794]"}`}>{status === Status.Settled ? pctReturn(open, close) : selected ? "Selected side" : "Choose side"}</p></div></div></button></div>;
              })}
              <div className="vs-separator col-span-full flex items-center justify-center gap-3 py-1 sm:col-start-2 sm:col-span-1 sm:row-start-1 sm:flex-col sm:gap-2 sm:py-0" aria-hidden="true"><span className="vs-line" /><span className="vs-label">VS</span><span className="vs-line" /></div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Prize pool" value={fmtUsdc(battle.rewardPool)} accent detail="Pre-funded" /><Metric label="Winner slots" value={battle.winnerSlots.toString()} detail="Fixed reward slots" /><Metric label="Per slot" value={battle.perSlotReward > 0n ? fmtUsdc(battle.perSlotReward) : `${fmtUsdc(battle.rewardPool / BigInt(Math.max(battle.winnerSlots, 1)))}`} detail="Reward per winner" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-[#2a3235] bg-[#171c1e] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] sm:p-6">
              <div className="flex items-center justify-between gap-3"><p className="min-w-0 font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#b5aebb]">Entries</p><BarChart3 size={16} className="shrink-0 text-[#74807c]" aria-hidden="true" /></div>
              <div className="mt-5 min-w-0 break-words font-mono text-base tabular-nums text-[#e8ece7] sm:text-lg"><span>{symbolA} · <b className="text-[#c7e85b]">{(entriesA ?? 0n).toString()}</b></span><span className="mx-2 text-[#74807c]">/</span><span>{symbolB} · <b className="text-[#c7e85b]">{(entriesB ?? 0n).toString()}</b></span></div>
              <p className="mt-3 text-xs leading-relaxed text-[#aab4af]">Token entry counts</p>
            </div>
            <div className={`min-w-0 rounded-2xl border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] sm:p-6 ${windowClosed ? "border-[#70423e] bg-[#2a1918]" : "border-[#d6b36a] bg-[#1c2420]"}`}>
              <div className="flex items-center justify-between gap-3"><p className="min-w-0 font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#d5c9d5]">Entry cutoff</p><Clock3 size={17} className={windowClosed ? "shrink-0 text-[#f0aaa0]" : "shrink-0 text-[#d6b36a]"} aria-hidden="true" /></div>
              <div className="mt-5 flex min-h-14 min-w-0 items-center gap-3" role="timer" tabIndex={0} aria-live="polite" aria-atomic="true" aria-label={windowClosed ? "Entries closed. Late entries are rejected." : "Time remaining before entries close"}><Clock3 size={25} aria-hidden="true" className={`shrink-0 ${windowClosed ? "text-[#f0aaa0]" : "text-[#d6b36a]"}`} /><span className={`min-w-0 break-words font-mono text-2xl font-bold leading-tight tracking-tight tabular-nums sm:text-3xl ${windowClosed ? "text-[#f0aaa0]" : "text-[#e8ece7]"}`}>{timingUnavailable ? "Unavailable" : timingPending ? "Pending authoritative time" : windowClosed ? "CLOSED" : fmtCountdown(battle.lockTime, authoritativeNow.now)}</span></div>
              <p className={`mt-3 min-h-10 font-mono text-xs leading-relaxed ${windowClosed ? "text-[#f0aaa0]" : "text-[#aab4af]"}`}>{timingUnavailable ? "The configured cutoff is invalid; entries are paused." : timingPending ? "Syncing with the battle network clock…" : windowClosed ? "Late entries are rejected. This battle is no longer accepting entries." : "Days · hours · minutes · seconds remaining"}</p>
            </div>
          </div>
        </section>
        <aside className="space-y-4"><div className="entry-panel rounded-xl border border-[#2a3235] bg-[#171c1e] p-5 sm:p-6"><div className="entry-panel-heading flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#8f8794]">Your entry</p><h2 className="mt-2 text-xl font-semibold tracking-[-.03em] text-[#f0edf2]">Make your call</h2></div><span className="entry-side-badge rounded-full border border-[#d6b36a]/50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-[#d6b36a]">Side {sideLabel(side)}</span></div><div className="entry-selection mt-5 flex min-w-0 items-center gap-3 rounded-lg border border-[#d6b36a]/35 bg-[#30291c]/40 p-3"><span className="entry-token-logo"><BrandLogo symbol={side === Side.A ? symbolA : symbolB} size={38} name={assetFor(side === Side.A ? symbolA : symbolB)?.name ?? "Token"} /></span><div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[#8f8794]">Backing</p><p className="truncate text-lg font-semibold text-[#f0edf2]">{side === Side.A ? symbolA : symbolB}</p><p className="font-mono text-[11px] text-[#d6b36a]">Selected side · Side {sideLabel(side)}</p></div><Check size={17} className="ml-auto shrink-0 text-[#d6b36a]" aria-hidden="true" /></div><div className="entry-details mt-4" aria-label="Entry details"><Row label="Backing" value={`Side ${sideLabel(side)} · ${side === Side.A ? symbolA : symbolB}`} /><Row label="Entry fee" value="None" /><Row label="Your capacity" value={acct.capacity !== undefined ? acct.capacity.toString() : "—"} /><Row label="Used / remaining" value={`${(used ?? 0n).toString()} / ${remaining !== undefined ? remaining.toString() : "—"}`} />{canClaim && <Row label="Claimable reward" value={fmtUsdc(claimable.amount)} />}</div><div className="capacity-note mt-4 flex items-start gap-2 rounded-md border border-[#2a3235] bg-[#101315] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#aab4af]"><span className="mt-0.5 text-[#d6b36a]" aria-hidden="true">↳</span><span>{remaining !== undefined ? `${remaining.toString()} ${remaining === 1n ? "entry" : "entries"} remaining from your ${acct.capacity?.toString() ?? "—"} capacity.` : "Checking your entry capacity…"}</span></div>{!isConnected ? <button onClick={login} className="ud-focus entry-action mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Connect to enter <ArrowRight size={16} /></button> : net.wrongNetwork ? <button onClick={() => net.switchToRobinhood()} disabled={net.switching} className="ud-focus entry-action mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-[#c7e85b] px-4 text-sm font-semibold text-[#c7e85b] hover:bg-[#263116] disabled:opacity-50">{net.switching ? <Loader2 size={16} className="animate-spin" /> : null} Switch to Robinhood Testnet</button> : canClaim ? <button onClick={onClaim} disabled={busy} className="ud-focus entry-action mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] transition hover:bg-[#bcdc56] disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : <>Claim {fmtUsdc(claimable.amount)} <ArrowRight size={16} /></>}</button> : status === Status.Open && inWindow ? <button onClick={onEnter} disabled={!canEnter} aria-disabled={!canEnter} className="ud-focus entry-action mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] transition hover:bg-[#bcdc56] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : <>Pick <span className="max-w-[min(52vw,15rem)] truncate">{side === Side.A ? symbolA : symbolB}</span></>} {!busy && <ArrowRight size={16} />}</button> : status === Status.Settled ? <div className="mt-5 rounded-md border border-[#2a3235] bg-[#101315] px-4 py-3 text-center font-mono text-xs text-[#aab4af]">Nothing to claim on this wallet for this battle.</div> : <div className="mt-5 rounded-md border border-[#2a3235] bg-[#101315] px-4 py-3 text-center font-mono text-xs text-[#aab4af]">{windowClosed ? "Entries closed — late entries are rejected" : timingUnavailable ? "Entry cutoff unavailable — entries are paused" : timingPending ? "Waiting for authoritative cutoff time" : `${statusLabel(status)} — entries closed`}</div>}{(remaining ?? 0n) === 0n && isConnected && status === Status.Open && inWindow && <Link href="/faucet" className="ud-focus mt-3 flex items-center justify-center gap-1.5 text-xs text-[#aab4af] hover:text-[#c7e85b]"><Droplets size={13} /> Need capacity? Get test UPDOWN</Link>}</div><div className="flex items-center gap-2 rounded-lg border border-[#2a3235] bg-[#171c1e] px-4 py-3 font-mono text-[11px] text-[#aab4af]"><ShieldCheck size={14} className="text-[#c7e85b]" /> Settled on Robinhood Chain · No entry fee</div></aside>
      </div>}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) { return <div className="entry-row flex items-center justify-between gap-4 border-b border-[#2a3235] py-3 first:pt-0 last:border-0 last:pb-0"><span className="shrink-0 text-[#aab4af]">{label}</span><span className="min-w-0 break-words text-right font-mono text-[#e8ece7]">{value}</span></div>; }
function EmptyBattle() { return <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center"><h2 className="text-xl font-semibold">No open battle right now</h2><p className="mt-2 text-sm text-[#aab4af]">The next daily battle will appear here when it opens. Grab test tokens meanwhile.</p><Link href="/faucet" className="ud-focus mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-[#3a4548] px-4 text-sm font-semibold hover:border-[#c7e85b]"><Droplets size={15} /> Testnet faucet</Link></div>; }