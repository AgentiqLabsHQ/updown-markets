"use client";

import { useMemo, useState } from "react";
import { maxUint256, parseUnits } from "viem";
import { Check, Loader2, Lock, Plus, ShieldAlert, Sparkles } from "lucide-react";
import AppShell from "@/app/components/app-shell";
import { useWallet } from "@/lib/wallet";
import { useAccountState, useActions, useBattle, useBattleCount, useIsOperator } from "@/lib/hooks";
import { availableAssets, BATTLE_CONFIG, pairForDay } from "@/lib/pairs";
import { nextTradingSession } from "@/lib/market-calendar";
import { CONTRACTS, Status } from "@/lib/contracts";
import { fmtUsdc, statusLabel } from "@/lib/format";

const REWARD_TOKENS = [
  { label: "USDC", address: CONTRACTS.usdc, decimals: 6 },
  { label: "UPDOWN", address: CONTRACTS.updown, decimals: 18 },
] as const;

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function AdminPage() {
  const { isConnected, address, login } = useWallet();
  const isOperator = useIsOperator(address);
  const acct = useAccountState(address);
  const { id, refetch: refetchCount } = useBattleCount();
  const { battle, refetch: refetchBattle } = useBattle(id);
  const actions = useActions();

  const assets = availableAssets();
  const today = pairForDay();
  const [symbolA, setSymbolA] = useState(today.symbolA);
  const [symbolB, setSymbolB] = useState(today.symbolB);
  const [rewardIdx, setRewardIdx] = useState(0);
  const [pool, setPool] = useState("100");
  const [slots, setSlots] = useState("10");
  const [maxEntries, setMaxEntries] = useState(String(BATTLE_CONFIG.maxEntriesPerBattle));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const rewardToken = REWARD_TOKENS[rewardIdx];
  const assetA = assets.find((a) => a.symbol === symbolA);
  const assetB = assets.find((a) => a.symbol === symbolB);
  const sameAsset = symbolA === symbolB;

  // The real next US equity trading session — same calendar the automated keeper uses, so a
  // manually-created battle locks at the actual market open and settles at the actual market
  // close (or official early-close time), never an arbitrary duration.
  const { nyDate, session } = useMemo(() => nextTradingSession(), []);

  async function create() {
    if (!assetA || !assetB || sameAsset) return;
    setBusy("create");
    try {
      const poolWei = parseUnits(pool || "0", rewardToken.decimals);
      setNotice(`Approving ${rewardToken.label} for pool…`);
      await actions.approveToken(rewardToken.address, maxUint256); // no-op if already approved
      acct.refetch();
      const now = BigInt(Math.floor(Date.now() / 1000) - 60);
      const lockT = BigInt(Math.floor(session.marketStartAt.getTime() / 1000));
      const settleT = BigInt(Math.floor(session.marketEndAt.getTime() / 1000));
      const label = `${assetA.symbol} vs ${assetB.symbol}`;
      setNotice(`Creating battle: ${label}…`);
      await actions.createBattle(
        {
          feedA: assetA.feed,
          feedB: assetB.feed,
          tokenA: "0x0000000000000000000000000000000000000000",
          tokenB: "0x0000000000000000000000000000000000000000",
          openTime: now,
          lockTime: lockT,
          settleTime: settleT,
          winnerSlots: Number(slots),
          maxEntriesPerBattle: Number(maxEntries),
          rewardToken: rewardToken.address,
        },
        poolWei,
      );
      setNotice(`Battle created: ${label} ✓`);
      refetchCount();
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setNotice(`Error: ${err.shortMessage || err.message}`);
    } finally {
      setBusy("");
      setTimeout(() => setNotice(""), 6000);
    }
  }

  async function lockNow() {
    if (!id || !battle) return;
    setBusy("lock");
    try {
      setNotice("Locking…");
      // Single tx — feeds stay fresh (30-day staleness on testnet).
      await actions.lock(id);
      setNotice("Locked ✓");
      refetchBattle();
    } catch (e: unknown) {
      setNotice(`Error: ${(e as { shortMessage?: string }).shortMessage || "failed"}`);
    } finally { setBusy(""); setTimeout(() => setNotice(""), 6000); }
  }

  async function settleNow() {
    if (!id || !battle) return;
    setBusy("settle");
    try {
      setNotice("Settling…");
      // No price-setting: the winner is decided by the live feeds (autonomous
      // oracle on testnet, real Chainlink on mainnet). Operator can't pick a side.
      await actions.settle(id, 0n);
      setNotice("Settled ✓");
      refetchBattle();
    } catch (e: unknown) {
      setNotice(`Error: ${(e as { shortMessage?: string }).shortMessage || "failed"}`);
    } finally { setBusy(""); setTimeout(() => setNotice(""), 6000); }
  }

  return (
    <AppShell title="Operator" eyebrow="Battle control">
      {notice && (
        <div role="status" className="mb-6 flex items-center gap-2 rounded-md border border-[#53632a] bg-[#263116] px-4 py-3 text-sm text-[#c7e85b]">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{notice}
        </div>
      )}

      {!isConnected ? (
        <Gate onConnect={login} />
      ) : isOperator === false ? (
        <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#5a3a2a] bg-[#2a1c16]"><ShieldAlert size={20} className="text-[#e0a060]" /></div>
          <h2 className="mt-5 text-xl font-semibold">Operator access required</h2>
          <p className="mt-2 text-sm text-[#aab4af]">This wallet does not hold OPERATOR_ROLE. Battles are created by the protocol operator.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[6fr_5fr]">
          <section className="rounded-xl border border-[#2a3235] bg-[#171c1e] p-6">
            <div className="flex items-center gap-2 text-[#c7e85b]"><Plus size={18} /><span className="font-mono text-xs uppercase tracking-[.1em]">Create battle</span></div>
            <p className="mt-2 text-sm text-[#aab4af]">Today&apos;s rotation pick: <b className="text-[#e8ece7]">{today.label}</b></p>
            <p className="mt-1 text-xs text-[#74807c]">
              {assets.length} of 33 real Chainlink-covered tickers have a testnet feed deployed. No entry fee is charged — entries are free, gated only by UPDOWN capacity.
            </p>

            <div className="mt-4 rounded-md border border-[#2a3235] bg-[#101315] px-4 py-3 font-mono text-xs text-[#aab4af]">
              <span className="text-[#74807c]">Session ({nyDate}{session.earlyClose ? ", early close" : ""}):</span>{" "}
              entries open now → lock <span className="text-[#e8ece7]">{ET_FMT.format(session.marketStartAt)} ET</span> → settle{" "}
              <span className="text-[#e8ece7]">{ET_FMT.format(session.marketEndAt)} ET</span>
            </div>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Asset A">
                  <select value={symbolA} onChange={(e) => setSymbolA(e.target.value)} className="ud-input">
                    {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
                  </select>
                </Field>
                <Field label="Asset B">
                  <select value={symbolB} onChange={(e) => setSymbolB(e.target.value)} className="ud-input">
                    {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
                  </select>
                </Field>
              </div>
              {sameAsset && <p className="text-xs text-[#e0a060]">Asset A and Asset B must be different.</p>}
              <Field label="Reward token">
                <select value={rewardIdx} onChange={(e) => setRewardIdx(Number(e.target.value))} className="ud-input">
                  {REWARD_TOKENS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Pool (${rewardToken.label})`}><input value={pool} onChange={(e) => setPool(e.target.value)} className="ud-input" inputMode="decimal" /></Field>
                <Field label="Winner slots"><input value={slots} onChange={(e) => setSlots(e.target.value)} className="ud-input" inputMode="numeric" /></Field>
                <Field label="Max entries / battle"><input value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} className="ud-input" inputMode="numeric" /></Field>
              </div>
              <button onClick={create} disabled={!!busy || sameAsset || !assetA || !assetB} className="ud-focus flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56] disabled:opacity-40">
                {busy === "create" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Create battle
              </button>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-[#2a3235] bg-[#171c1e] p-6">
              <div className="flex items-center gap-2 text-[#aab4af]"><Lock size={16} /><span className="font-mono text-xs uppercase tracking-[.1em]">Latest battle</span></div>
              {battle && id ? (
                <>
                  <p className="mt-4 text-lg font-semibold">Battle #{id.toString()}</p>
                  <p className="font-mono text-xs text-[#aab4af]">Status: {statusLabel(battle.status)} · Pool {fmtUsdc(battle.rewardPool)}</p>
                  <div className="mt-5 flex gap-3">
                    <button onClick={lockNow} disabled={battle.status !== Status.Open || !!busy} className="ud-focus flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#3a4548] px-4 text-sm font-semibold hover:border-[#c7e85b] disabled:opacity-40">
                      {busy === "lock" ? <Loader2 size={15} className="animate-spin" /> : "Lock"}
                    </button>
                    <button onClick={settleNow} disabled={battle.status !== Status.Locked || !!busy} className="ud-focus flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#3a4548] px-4 text-sm font-semibold hover:border-[#c7e85b] disabled:opacity-40">
                      {busy === "settle" ? <Loader2 size={15} className="animate-spin" /> : "Settle"}
                    </button>
                  </div>
                  <p className="mt-3 font-mono text-[11px] text-[#74807c]">Prices come from the autonomous oracle (real market data) — the operator doesn&apos;t set them. Lock/Settle only trigger the on-chain read, and only once the real session time has actually passed.</p>
                </>
              ) : (
                <p className="mt-4 text-sm text-[#aab4af]">No battle yet — create one.</p>
              )}
            </div>
            <div className="rounded-lg border border-[#2a3235] bg-[#171c1e] px-4 py-3 font-mono text-[11px] text-[#aab4af]">
              Automate this with the cron keeper: <span className="text-[#c7e85b]">node scripts/keeper.mjs</span> (create-if-needed + lock/settle).
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#74807c]">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Gate({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
      <h2 className="text-xl font-semibold">Connect operator wallet</h2>
      <p className="mt-2 text-sm text-[#aab4af]">Sign in with the operator wallet to create and control battles.</p>
      <button onClick={onConnect} className="ud-focus mt-6 min-h-12 w-full rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Connect wallet</button>
    </div>
  );
}
