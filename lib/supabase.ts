import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** Null when Supabase env is not configured — callers degrade gracefully. */
export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon, { auth: { persistSession: false } }) : null;

export const supabaseEnabled = !!supabase;
