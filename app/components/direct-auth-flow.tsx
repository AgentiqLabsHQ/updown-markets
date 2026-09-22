"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/hooks";

export default function DirectAuthFlow() {
  const pathname = usePathname();
  const { ready, authenticated, isConnected, login } = useWallet();
  const network = useNetwork();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || !["/dashboard", "/battle"].includes(new URL(link.href).pathname)) return;
      if (ready && authenticated && isConnected && !network.wrongNetwork) return;
      event.preventDefault();
      setError("");
      if (network.wrongNetwork) return;
      setBusy(true);
      Promise.resolve(login()).catch(() => setError("Authentication was rejected. Try again when you are ready.")).finally(() => setBusy(false));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [authenticated, isConnected, login, network.wrongNetwork, ready]);

  const showNetwork = ready && authenticated && isConnected && network.wrongNetwork;
  const showError = Boolean(error);
  if ((!showNetwork && !showError) || pathname === "/signin" || pathname === "/signup") return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[60] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-[#3a4548] bg-[#171c1e] p-4 text-sm text-[#e8ece7] shadow-2xl" role="status">
      {showNetwork ? <AlertTriangle size={17} className="shrink-0 text-[#e8c277]" /> : <RefreshCw size={17} className="shrink-0 text-[#f0aaa0]" />}
      <span className="min-w-0 flex-1">{showNetwork ? "Your wallet is connected on an unsupported network. Switch to Robinhood Chain Testnet to continue." : error}</span>
      {showNetwork ? <button onClick={() => network.switchToRobinhood()} disabled={network.switching} className="ud-focus flex min-h-10 items-center gap-2 rounded-md border border-[#c7e85b] px-3 text-xs font-semibold text-[#c7e85b] disabled:opacity-50">{network.switching && <Loader2 size={14} className="animate-spin" />} Switch network</button> : <button onClick={() => { setError(""); setBusy(true); Promise.resolve(login()).catch(() => setError("Authentication was rejected. Try again when you are ready.")).finally(() => setBusy(false)); }} disabled={busy} className="ud-focus flex min-h-10 items-center gap-2 rounded-md bg-[#c7e85b] px-3 text-xs font-semibold text-[#18200f] disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />} Retry</button>}
    </div>
  );
}
