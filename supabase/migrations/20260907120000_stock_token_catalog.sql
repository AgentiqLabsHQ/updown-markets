-- Durable Robinhood Chain Stock Token market metadata.
create table if not exists public.market_metadata (
  stable_identifier text primary key,
  robinhood_identifier text,
  contract_address text,
  symbol text,
  name text,
  icon_url text,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'robinhood-chain-stock-token-api',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists market_metadata_robinhood_identifier_idx
  on public.market_metadata (robinhood_identifier)
  where robinhood_identifier is not null;
create unique index if not exists market_metadata_contract_address_idx
  on public.market_metadata (lower(contract_address))
  where contract_address is not null;
create index if not exists market_metadata_symbol_idx on public.market_metadata (symbol);

alter table public.market_metadata enable row level security;
drop policy if exists "market_metadata_read" on public.market_metadata;
create policy "market_metadata_read" on public.market_metadata for select using (true);
grant select on public.market_metadata to anon;
grant select, insert, update on public.market_metadata to service_role;

create table if not exists public.market_metadata_syncs (
  id bigint generated always as identity primary key,
  status text not null check (status in ('running', 'complete', 'partial', 'failed')),
  fetched integer not null default 0,
  stored integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.market_metadata_syncs enable row level security;
drop policy if exists "market_metadata_syncs_read" on public.market_metadata_syncs;
create policy "market_metadata_syncs_read" on public.market_metadata_syncs for select using (true);
grant select on public.market_metadata_syncs to anon;
grant select, insert, update on public.market_metadata_syncs to service_role;

create or replace function public.market_metadata_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists market_metadata_touch on public.market_metadata;
create trigger market_metadata_touch before update on public.market_metadata
  for each row execute function public.market_metadata_touch_updated_at();
