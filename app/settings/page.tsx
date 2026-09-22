"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, LogOut, ShieldCheck, UserRound, Wallet } from "lucide-react";
import AppShell from "@/app/components/app-shell";
import { useWallet } from "@/lib/wallet";
import { useProfile } from "@/lib/profile";
import { supabaseEnabled } from "@/lib/supabase";
import { shortAddr } from "@/lib/format";

export default function SettingsPage() {
  const { isConnected, address, login, logout } = useWallet();
  const { profile, loading, save } = useProfile(address);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // hydrate the form when the profile loads
  useEffect(() => {
    if (profile) {
      setName(profile.display_name ?? "");
      setEmail(profile.email ?? "");
      setNotify(profile.notify_results);
    }
  }, [profile]);

  async function onSave() {
    if (name.trim().length > 80) {
      setStatus({ ok: false, msg: "Display name must be 80 characters or fewer." });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await save({ display_name: name.trim() || null, email: email.trim() || null, notify_results: notify });
      setStatus({ ok: true, msg: "Profile saved." });
    } catch (e: unknown) {
      setStatus({ ok: false, msg: (e as { message?: string }).message || "Save failed." });
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }

  function copy() {
    if (address) navigator.clipboard?.writeText(address);
    setStatus({ ok: true, msg: "Wallet address copied." });
    setTimeout(() => setStatus(null), 2500);
  }

  if (!isConnected) {
    return (
      <AppShell title="Profile & settings">
        <div className="mx-auto max-w-md rounded-xl border border-[#2a3235] bg-[#171c1e] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#53632a] bg-[#263116]"><UserRound size={20} className="text-[#c7e85b]" /></div>
          <h2 className="mt-5 text-xl font-semibold">Connect to manage your profile</h2>
          <p className="mt-2 text-sm text-[#aab4af]">Your display name and preferences are saved to your account.</p>
          <button onClick={login} className="ud-focus mt-6 min-h-12 w-full rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56]">Connect wallet</button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Profile & settings" eyebrow="Account controls">
      <div className="mx-auto max-w-4xl space-y-6">
        {status && (
          <div role="status" className={`flex items-center gap-3 rounded-lg border p-4 text-sm ${status.ok ? "border-[#53632a] bg-[#263116] text-[#c7e85b]" : "border-[#75423c] bg-[#301d1b] text-[#f0aaa0]"}`}>
            <Check size={17} />{status.msg}
          </div>
        )}
        {!supabaseEnabled && (
          <div className="rounded-lg border border-[#75423c] bg-[#301d1b] p-4 text-sm text-[#f0aaa0]">Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.</div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.4fr_.8fr]">
          <div className="rounded-lg border border-[#2a3235] bg-[#171c1e] p-6">
            <div className="flex items-center gap-3 border-b border-[#2a3235] pb-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#263116] text-[#c7e85b]"><UserRound size={20} /></span>
              <div>
                <h3 className="font-semibold">Profile details</h3>
                <p className="text-xs text-[#74807c]">Saved to your account {loading && <Loader2 size={11} className="ml-1 inline animate-spin" />}</p>
              </div>
            </div>
            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Display name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Satoshi" className="ud-input" />
                <span className="mt-2 block text-xs text-[#74807c]">{name.length}/80</span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Email <span className="text-[#74807c]">(optional)</span></span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@wallet.xyz" className="ud-input" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-[#2a3235] p-4">
                <span>
                  <span className="block text-sm font-medium">Battle result notifications</span>
                  <span className="mt-1 block text-xs text-[#74807c]">Get notified when a battle you entered settles.</span>
                </span>
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[#c7e85b]" />
              </label>
              <button onClick={onSave} disabled={saving || !supabaseEnabled} className="ud-focus inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#c7e85b] px-4 text-sm font-semibold text-[#18200f] hover:bg-[#bcdc56] disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save changes
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-[#2a3235] bg-[#171c1e] p-5">
              <div className="flex items-center gap-2"><Wallet size={17} className="text-[#c7e85b]" /><h3 className="font-semibold">Wallet session</h3></div>
              <p className="mt-4 font-mono text-xs text-[#aab4af]">{shortAddr(address)}</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-[#c7e85b]"><span className="h-2 w-2 rounded-full bg-[#c7e85b]" /> Robinhood Chain</p>
              <button onClick={copy} className="ud-focus mt-5 inline-flex min-h-10 items-center gap-2 rounded-md border border-[#3a4548] px-3 text-xs text-[#e8ece7] hover:border-[#c7e85b]"><Copy size={14} /> Copy address</button>
            </div>
            <div className="rounded-lg border border-[#2a3235] bg-[#171c1e] p-5">
              <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#c7e85b]" /><h3 className="font-semibold">Security</h3></div>
              <p className="mt-3 text-xs leading-5 text-[#aab4af]">Wallet signatures authorize actions. Your private keys remain with your wallet provider.</p>
              <button onClick={logout} className="ud-focus mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#75423c] px-3 text-sm text-[#f0aaa0] hover:bg-[#301d1b]"><LogOut size={15} /> Disconnect</button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
