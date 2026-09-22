"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, ArrowUpRight, BarChart3, ChevronRight, Droplets, Home, Menu, Settings, Trophy, Wallet, X } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile";
import { shortAddr } from "@/lib/format";

interface AppShellProps { children: React.ReactNode; title: string; eyebrow?: string; }

const nav = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/battle", label: "Live battle", icon: Activity },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/faucet", label: "Testnet faucet", icon: Droplets },
  { href: "/settings", label: "Settings", icon: Settings },
];

function BrandMark() {
  return <span className="ud-brand-mark" aria-hidden="true"><span /><span /></span>;
}

function Wordmark() {
  return <span className="ud-wordmark"><BrandMark /><span>Updown Markets</span></span>;
}

function ConnectButton() {
  const { ready, isConnected, address, login, logout } = useWallet();
  if (!ready) return <div className="h-11 w-[150px] animate-pulse rounded-xl border border-[#2a3235] bg-[#171c1e]" aria-hidden="true" />;
  return <button aria-label={isConnected ? `Disconnect wallet ${shortAddr(address)}` : "Connect wallet"} onClick={isConnected ? logout : login} className="ud-focus flex min-h-11 min-w-0 max-w-[190px] items-center gap-2 overflow-hidden rounded-xl border border-[#3a4548] bg-[#171c1e] px-3 text-xs font-semibold text-[#e8ece7] transition hover:border-[#c7e85b] sm:max-w-[220px] sm:px-4"><Wallet size={16} className="shrink-0 text-[#c7e85b]" /><span className="truncate">{isConnected ? shortAddr(address) : "Connect wallet"}</span></button>;
}

export default function AppShell({ children, title, eyebrow = "Participant terminal" }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isConnected, address } = useWallet();
  const { profile } = useProfile(address);
  const displayName = profile?.display_name || (address ? shortAddr(address) : "Connect to enter");
  const SideNav = ({ onNav }: { onNav?: () => void }) => <nav className="space-y-1.5" aria-label="Application navigation">{nav.map(({ href, label, icon: Icon }) => { const active = pathname === href; return <Link key={href} href={href} onClick={onNav} aria-current={active ? "page" : undefined} className={`ud-focus group flex min-h-12 items-center gap-3 rounded-xl border px-3 text-sm transition ${active ? "border-[#53632a] bg-[#263116] font-semibold text-[#c7e85b] shadow-[inset_3px_0_0_#c7e85b]" : "border-transparent text-[#aab4af] hover:border-[#2a3235] hover:bg-[#1c2425] hover:text-[#e8ece7]"}`}><Icon size={18} strokeWidth={active ? 2.1 : 1.8} aria-hidden="true" /><span className="min-w-0 truncate">{label}</span>{active && <ChevronRight size={15} className="ml-auto shrink-0" aria-hidden="true" />}</Link>; })}</nav>;
  return <div className="ud-app-shell min-h-screen bg-[#101315] text-[#e8ece7]">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[256px] border-r border-[#2a3235] bg-[#141819] lg:flex lg:flex-col"><div className="flex h-[88px] items-center border-b border-[#2a3235] px-6"><Link href="/" className="ud-focus rounded-md"><Wordmark /></Link></div><div className="px-4 pt-8"><p className="px-3 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#74807c]">Workspace</p><div className="mt-3"><SideNav /></div></div><div className="mt-auto border-t border-[#2a3235] p-4"><div className="rounded-xl border border-[#2a3235] bg-[#171c1e] p-3.5"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? "bg-[#c7e85b] shadow-[0_0_0_3px_rgba(199,232,91,.12)]" : "bg-[#74807c]"}`} /><span className="font-mono text-[10px] uppercase tracking-[.14em] text-[#aab4af]">{isConnected ? "Wallet ready" : "Wallet offline"}</span></div><p className="mt-2 truncate font-mono text-xs text-[#e8ece7]" title={isConnected ? displayName : undefined}>{isConnected ? displayName : "Connect to enter"}</p></div></div></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/60" /><aside className="absolute left-0 top-0 flex h-full w-[min(84vw,320px)] flex-col border-r border-[#2a3235] bg-[#141819] p-5 shadow-2xl"><div className="flex items-center justify-between"><Link href="/" className="ud-focus rounded-md" aria-label="Updown Markets home"><Wordmark /></Link><button className="ud-focus flex h-11 w-11 items-center justify-center rounded-xl border border-[#3a4548]" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button></div><div className="mt-10"><p className="mb-3 px-3 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#74807c]">Workspace</p><SideNav onNav={() => setMobileOpen(false)} /></div><div className="mt-auto border-t border-[#2a3235] pt-4"><p className="truncate font-mono text-xs text-[#aab4af]">{isConnected ? displayName : "Wallet offline"}</p></div></aside></div>}
    <div className="lg:pl-[256px]"><header className="sticky top-0 z-30 flex min-h-[88px] items-center justify-between gap-4 border-b border-[#2a3235] bg-[#101315]/95 px-4 backdrop-blur-md sm:px-6 lg:px-10"><div className="flex min-w-0 items-center gap-3"><button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="ud-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2a3235] lg:hidden"><Menu size={19} /></button><div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#74807c]">{eyebrow}</p><h1 className="mt-1 truncate text-lg font-semibold tracking-[-.02em] sm:text-xl">{title}</h1></div></div><div className="shrink-0"><ConnectButton /></div></header><main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">{children}</main></div>
  </div>;
}

export function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) { return <div className="battle-data-card group rounded-2xl border border-[#2a3235] bg-[#171c1e] p-5 transition-colors hover:border-[#3a4548]"><div className="flex items-center justify-between gap-3"><p className="battle-data-label min-w-0 font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#aab4af]">{label}</p><BarChart3 size={16} className="shrink-0 text-[#74807c] transition-colors group-hover:text-[#c7e85b]" aria-hidden="true" /></div><p className={`battle-data-value mt-4 min-w-0 break-words font-mono text-2xl font-bold tracking-[-.04em] sm:text-[2rem] ${accent ? "text-[#d6b36a]" : "text-[#e8ece7]"}`}>{value}</p>{detail && <p className="battle-data-detail mt-2 text-xs leading-relaxed text-[#aab4af]">{detail}</p>}</div>; }

export { ArrowUpRight };