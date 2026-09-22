-- Durable cache state and an atomic replacement operation for the Robinhood catalog.
create table if not exists public.market_metadata_catalog_state (
  catalog_key text primary key default 'robinhood-chain-stock-tokens',
  last_successful_sync_at timestamptz,
  complete boolean not null default false,
  token_count integer not null default 0,
  fetched integer not null default 0,
  pages integer not null default 0,
  duplicate_records integer not null default 0,
  warning text,
  invalidated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.market_metadata_catalog_state enable row level security;
drop policy if exists "market_metadata_catalog_state_read" on public.market_metadata_catalog_state;
create policy "market_metadata_catalog_state_read" on public.market_metadata_catalog_state for select using (true);
grant select on public.market_metadata_catalog_state to anon;
grant select, insert, update on public.market_metadata_catalog_state to service_role;

create or replace function public.replace_market_metadata_catalog(
  p_tokens jsonb,
  p_fetched integer,
  p_pages integer,
  p_duplicate_records integer,
  p_docs text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token jsonb;
  token_key text;
  token_symbol text;
  token_count integer := 0;
begin
  if jsonb_typeof(p_tokens) <> 'array' then
    raise exception 'catalog payload must be an array';
  end if;

  -- Serialize refreshes. No row is changed until the complete payload validates.
  perform pg_advisory_xact_lock(hashtext('robinhood-chain-stock-token-catalog'));
  for token in select value from jsonb_array_elements(p_tokens) loop
    token_key := nullif(trim(token->>'stableIdentifier'), '');
    token_symbol := nullif(trim(token->>'symbol'), '');
    if token_key is null or token_symbol is null then
      raise exception 'catalog contains an invalid token record';
    end if;
    token_count := token_count + 1;
  end loop;

  for token in select value from jsonb_array_elements(p_tokens) loop
    insert into public.market_metadata (
      stable_identifier, robinhood_identifier, contract_address, symbol, name,
      icon_url, metadata, source, active, last_seen_at
    ) values (
      token->>'stableIdentifier', nullif(token->>'robinhoodIdentifier', ''),
      nullif(token->>'contractAddress', ''), token->>'symbol', nullif(token->>'name', ''),
      nullif(token->>'logoUrl', ''), coalesce(token->'metadata', '{}'::jsonb),
      'robinhood-chain-stock-token-api', true, now()
    )
    on conflict (stable_identifier) do update set
      robinhood_identifier = excluded.robinhood_identifier,
      contract_address = excluded.contract_address,
      symbol = excluded.symbol,
      name = excluded.name,
      -- An absent or later-unavailable logo must never erase a known logo.
      icon_url = coalesce(excluded.icon_url, public.market_metadata.icon_url),
      metadata = excluded.metadata,
      source = excluded.source,
      active = true,
      last_seen_at = now();
  end loop;

  -- The caller only invokes this function after validating every page and item.
  update public.market_metadata
     set active = false, updated_at = now()
   where source = 'robinhood-chain-stock-token-api'
     and not exists (
       select 1 from jsonb_array_elements(p_tokens) item
       where item->>'stableIdentifier' = public.market_metadata.stable_identifier
     );

  insert into public.market_metadata_catalog_state (
    catalog_key, last_successful_sync_at, complete, token_count, fetched, pages,
    duplicate_records, warning, invalidated_at, updated_at
  ) values (
    'robinhood-chain-stock-tokens', now(), true, token_count, coalesce(p_fetched, 0),
    coalesce(p_pages, 0), coalesce(p_duplicate_records, 0), null, null, now()
  ) on conflict (catalog_key) do update set
    last_successful_sync_at = excluded.last_successful_sync_at,
    complete = true,
    token_count = excluded.token_count,
    fetched = excluded.fetched,
    pages = excluded.pages,
    duplicate_records = excluded.duplicate_records,
    warning = null,
    invalidated_at = null,
    updated_at = now();

  return jsonb_build_object('stored', token_count, 'complete', true, 'docs', p_docs);
end;
$$;

grant execute on function public.replace_market_metadata_catalog(jsonb, integer, integer, integer, text) to service_role;
