-- Updown Markets: per-wallet user profiles (off-chain settings/preferences).
create table if not exists public.profiles (
  wallet text primary key,
  display_name text,
  email text,
  notify_results boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- NOTE (testnet-grade): permissive policies so the anon key can read/upsert.
-- The app only ever writes the connected wallet's row. For production, gate
-- writes by verifying wallet ownership (Privy JWT -> Supabase) so a user can
-- only modify their own row.
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select using (true);
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles for insert with check (true);
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update using (true) with check (true);

grant select, insert, update on public.profiles to anon;

create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();