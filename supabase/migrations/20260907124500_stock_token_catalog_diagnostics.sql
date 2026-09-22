-- Preserve detailed diagnostics for refreshes that could not safely replace the active catalog.
alter table public.market_metadata_syncs
drop constraint if exists market_metadata_syncs_status_check;

alter table public.market_metadata_syncs
add constraint market_metadata_syncs_status_check
check (status in ('running', 'complete', 'partial', 'stale', 'failed')); 

comment on column public.market_metadata_syncs.details is
  'Catalog completeness diagnostics: API totals, unique/stored/logo coverage, skips, failures, pagination, and catalog changes.';

comment on constraint market_metadata_syncs_status_check on public.market_metadata_syncs is
  'A stale sync means the previous validated catalog remains active after a refresh or commit failure.';
