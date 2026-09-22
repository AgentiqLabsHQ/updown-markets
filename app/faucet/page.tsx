"use client";

import { useState } from "react";
import { Check, Coins, Droplets, Loader2 } from "lucide-react";
import AppShell, { Metric } from "@/app/components/app-shell";
import { useWallet } from "@/lib/wallet";
import { useAccountState, useActions } from "@/lib/hooks";
import { fmtUpdown, fmtUsdc } from "@/lib/format";

export default function FaucetPage() {
  const { isConnected, address, login } = useWallet();
  const acct = useAccountState(address);
  const actions = useActions();
  const [busy, setBusy] = useState<"" | "updown" | "usdc">("");
  const [notice, setNotice] = useState("");

  async function drip(kind: "updown" | "usdc") {
    setBusy(kind);
    setNotice(`Minting test ${kind === "updown" ? "UPDOWN" : "USDC"}…`);
    try {
      if (kind === "updown") await actions.faucetUpdown();
      else await actions.faucetUsdc();
      setNotice(`${kind === "updown" ? "1,000 UPDOWN" : "1,000 USDC"} minted ✓`);
      acct.refetch();
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setNotice(`Error: ${err.shortMessage || err.message || "failed"}`);
    } finally {
      setBusy("");
      setTimeout(() => setNotice(""), 5000);
    }
  }

  return (
    <AppShell title="Testnet faucet" eyebrow="Robinhood testnet">
      {notice && (
        <div role="status" className="mb-6 flex items-center gap-2 rounded-md border border-[#53632a] bg-[#263116] px-4 py-3 text-sm text-[#c7e85b]">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{notice}
        </div>
      )}

      {!isConnected ? (
        <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#53632a] bg-[#263116]"><Droplets size={20} className="text-[#c7e85b]" /></div>
          <h2 className="mt-5 text-xl font-semibold">Connect to use the faucet</h2>
          <p className="mt-2 text-sm text-[#aab4af]">Mint free test UPDOWN and USDC on Robinhood testnet to try a battle.</p>
          <button onClick={login} className="ud-focus mt-6 min-h-12 w-full rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Connect wallet</button>
        </div>
      ) : (
        <div className="max-w-3xl space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="UPDOWN balance" value={fmtUpdown(acct.updown)} accent detail="Sets your entry capacity" />
            <Metric label="USDC balance" value={fmtUsdc(acct.usdc)} detail="Pays entry fees" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FaucetCard
              title="UPDOWN"
              subtitle="1,000 UPDOWN per drip"
              body="Your UPDOWN holdings determine how many daily entries you can make ($2 of UPDOWN per entry)."
              busy={busy === "updown"}
              onClick={() => drip("updown")}
            />
            <FaucetCard
              title="USDC"
              subtitle="1,000 USDC per drip"
              body="USDC covers the small per-entry fee and is the currency of the reward pool."
              busy={busy === "usdc"}
              onClick={() => drip("usdc")}
            />
          </div>

          <p className="font-mono text-[11px] text-[#74807c]">
            Testnet mocks only. Real UPDOWN and Robinhood Chain USDC are used on mainnet.
          </p>
        </div>
      )}
    </AppShell>
  );
}

function FaucetCard({ title, subtitle, body, busy, onClick }: { title: string; subtitle: string; body: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="rounded-xl border border-[#2a3235] bg-[#171c1e] p-6">
      <div className="flex items-center gap-2 text-[#c7e85b]"><Coins size={18} /><span className="font-mono text-xs uppercase tracking-[.1em]">{title}</span></div>
      <p className="mt-4 text-lg font-semibold">{subtitle}</p>
      <p className="mt-2 text-sm text-[#aab4af]">{body}</p>
      <button onClick={onClick} disabled={busy} className="ud-focus mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#3a4548] bg-[#101315] px-4 text-sm font-semibold hover:border-[#c7e85b] disabled:opacity-40">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Droplets size={15} className="text-[#c7e85b]" />} Get test {title}
      </button>
    </div>
  );
}
