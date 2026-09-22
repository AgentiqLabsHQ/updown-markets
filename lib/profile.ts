"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Profile {
  wallet: string;
  display_name: string | null;
  email: string | null;
  notify_results: boolean;
}

const empty = (wallet: string): Profile => ({
  wallet,
  display_name: null,
  email: null,
  notify_results: true,
});

/** Load + persist the connected wallet's off-chain profile from Supabase. */
export function useProfile(wallet?: `0x${string}`) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const key = wallet?.toLowerCase();

  const load = useCallback(async () => {
    if (!key) return;
    if (!supabase) {
      setProfile(empty(key));
      return;
    }
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").eq("wallet", key).maybeSingle();
    setProfile((data as Profile) ?? empty(key));
    setLoading(false);
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (patch: Partial<Profile>) => {
      if (!key) throw new Error("No wallet connected");
      if (!supabase) throw new Error("Supabase is not configured");
      const row: Profile = { ...(profile ?? empty(key)), ...patch, wallet: key };
      const { error } = await supabase.from("profiles").upsert(row, { onConflict: "wallet" });
      if (error) throw error;
      setProfile(row);
      return row;
    },
    [key, profile],
  );

  return { profile, loading, save, reload: load };
}
