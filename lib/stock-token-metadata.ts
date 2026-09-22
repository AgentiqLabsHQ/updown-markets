import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface StockTokenMetadata { stableIdentifier: string; robinhoodIdentifier?: string; symbol: string; name?: string; contractAddress?: string; logoUrl?: string; metadata: Record<string, unknown>; }
export interface CatalogSkip { record: number; identifier?: string; reason: string; }
export interface CatalogFailure { scope: string; reason: string; }
export interface CatalogChanges { additions: string[]; removals: string[]; metadataChanges: string[]; }
export interface StockTokenSyncDiagnostics {
  totalApiRecords: number;
  uniqueTokens: number;
  storedRecords: number;
  logoBearingRecords: number;
  missingLogoRecords: number;
  missingLogoIdentifiers: string[];
  skippedRecords: CatalogSkip[];
  failures: CatalogFailure[];
  duplicatePages: number;
  duplicateTokens: number;
  pages: number;
  complete: boolean;
  status: "complete" | "partial" | "stale" | "failed";
  changes: CatalogChanges;
}
export interface StockTokenCatalog { tokens: StockTokenMetadata[]; lastSuccessfulSyncAt?: string; complete: boolean; stale: boolean; warning?: string; diagnostics?: StockTokenSyncDiagnostics; }
export interface StockTokenSyncResult extends StockTokenSyncDiagnostics { status: "complete" | "partial" | "stale" | "failed"; fetched: number; stored: number; updated: number; skipped: number; failed: number; duplicateRecords: number; error?: string; }
interface RobinhoodAssetResponse { id?: unknown; assetId?: unknown; tokenId?: unknown; tokenSymbol?: unknown; symbol?: unknown; ticker?: unknown; name?: unknown; tokenName?: unknown; displayName?: unknown; contractAddress?: unknown; logoUrl?: unknown; logo_url?: unknown; deployments?: unknown; [key: string]: unknown; }
interface CachedRow { stable_identifier: string; robinhood_identifier: string | null; symbol: string; name: string | null; contract_address: string | null; icon_url: string | null; metadata: Record<string, unknown>; }
interface CatalogState { last_successful_sync_at: string | null; complete: boolean; warning: string | null; invalidated_at?: string | null; }

export const ROBINHOOD_STOCK_TOKEN_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
export const ROBINHOOD_STOCK_TOKEN_API_DOCS = "https://docs.robinhood.com/chain/stock-token-apis/";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 10_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function validLogoUrl(value: unknown): string | undefined { const candidate = text(value); if (!candidate || candidate.length > 2048) return undefined; try { const url = new URL(candidate); return url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }
function validContract(value: unknown): string | undefined { const candidate = text(value); return candidate && /^0x[a-fA-F0-9]{40}$/.test(candidate) ? candidate.toLowerCase() : undefined; }
function extractContract(asset: RobinhoodAssetResponse): string | undefined { const direct = validContract(asset.contractAddress); if (direct) return direct; if (Array.isArray(asset.deployments)) for (const deployment of asset.deployments) if (deployment && typeof deployment === "object") { const found = validContract((deployment as { contractAddress?: unknown }).contractAddress); if (found) return found; } return undefined; }
function asAsset(value: unknown): RobinhoodAssetResponse | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as RobinhoodAssetResponse : undefined; }
function pageItems(payload: unknown): { items: unknown[]; next?: string; explicitlyComplete: boolean } {
  if (Array.isArray(payload)) return { items: payload, explicitlyComplete: true };
  if (!payload || typeof payload !== "object") throw new Error("Robinhood assets response is not an object or array");
  const body = payload as { results?: unknown; assets?: unknown; data?: unknown; next?: unknown; nextCursor?: unknown; complete?: unknown; isComplete?: unknown; hasMore?: unknown };
  const items = body.results ?? body.assets ?? body.data;
  if (!Array.isArray(items)) throw new Error("Robinhood assets response has no array of assets");
  const nextValue = body.nextCursor ?? body.next;
  if (nextValue !== undefined && nextValue !== null && typeof nextValue !== "string") throw new Error("Robinhood assets response has malformed continuation data");
  const next = typeof nextValue === "string" && nextValue.trim() ? nextValue.trim() : undefined;
  if (body.hasMore === true && !next) throw new Error("Robinhood assets response says more pages exist but has no continuation");
  return { items, next, explicitlyComplete: body.complete === true || body.isComplete === true || body.hasMore === false || !next };
}
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); }
function identifierFor(asset: RobinhoodAssetResponse, contractAddress?: string): string | undefined { return contractAddress ?? text(asset.id) ?? text(asset.assetId) ?? text(asset.tokenId); }
function emptyDiagnostics(): StockTokenSyncDiagnostics { return { totalApiRecords: 0, uniqueTokens: 0, storedRecords: 0, logoBearingRecords: 0, missingLogoRecords: 0, missingLogoIdentifiers: [], skippedRecords: [], failures: [], duplicatePages: 0, duplicateTokens: 0, pages: 0, complete: false, status: "failed", changes: { additions: [], removals: [], metadataChanges: [] } }; }

/** Pure validator intended for unit tests and replaying captured Robinhood API pages. */
export function validateRobinhoodStockTokenCatalogPages(pages: unknown[]): { tokens: StockTokenMetadata[]; diagnostics: StockTokenSyncDiagnostics } {
  const diagnostics = emptyDiagnostics();
  const tokens = new Map<string, StockTokenMetadata>();
  const identifiers = new Map<string, { contract?: string; symbol: string; name?: string; logo?: string }>();
  const pageFingerprints = new Set<string>();
  const continuationSeen = new Set<string>();
  let sawCompletePage = false;
  pages.forEach((payload, pageIndex) => {
    diagnostics.pages++;
    let parsed: { items: unknown[]; next?: string; explicitlyComplete: boolean };
    try { parsed = pageItems(payload); } catch (error) { diagnostics.failures.push({ scope: `page ${pageIndex + 1}`, reason: error instanceof Error ? error.message : "Malformed page" }); return; }
    const fingerprint = canonical(parsed.items);
    if (pageFingerprints.has(fingerprint)) { diagnostics.duplicatePages++; diagnostics.failures.push({ scope: `page ${pageIndex + 1}`, reason: "Duplicate page payload" }); }
    pageFingerprints.add(fingerprint);
    if (parsed.next && continuationSeen.has(parsed.next)) diagnostics.failures.push({ scope: `page ${pageIndex + 1}`, reason: `Pagination loop at continuation ${parsed.next}` });
    if (parsed.next) continuationSeen.add(parsed.next); else sawCompletePage = parsed.explicitlyComplete;
    parsed.items.forEach((raw) => {
      diagnostics.totalApiRecords++;
      const asset = asAsset(raw);
      if (!asset) { diagnostics.skippedRecords.push({ record: diagnostics.totalApiRecords, reason: "Malformed asset record" }); return; }
      const contractAddress = extractContract(asset);
      const robinhoodIdentifier = text(asset.id) ?? text(asset.assetId) ?? text(asset.tokenId);
      const stableIdentifier = identifierFor(asset, contractAddress);
      const symbol = text(asset.tokenSymbol) ?? text(asset.symbol) ?? text(asset.ticker);
      const name = text(asset.name) ?? text(asset.tokenName) ?? text(asset.displayName);
      const logoUrl = validLogoUrl(asset.logoUrl ?? asset.logo_url);
      if (!stableIdentifier) { diagnostics.skippedRecords.push({ record: diagnostics.totalApiRecords, reason: "No stable contract address or Robinhood identifier" }); return; }
      if (!symbol) { diagnostics.skippedRecords.push({ record: diagnostics.totalApiRecords, identifier: stableIdentifier, reason: "Missing symbol" }); return; }
      const identityKey = robinhoodIdentifier ?? stableIdentifier;
      const priorIdentity = identifiers.get(identityKey);
      if (priorIdentity) {
        diagnostics.duplicateTokens++;
        if (priorIdentity.contract !== contractAddress || priorIdentity.symbol !== symbol.toUpperCase() || priorIdentity.name !== name || priorIdentity.logo !== logoUrl) diagnostics.failures.push({ scope: stableIdentifier, reason: "Duplicate token has inconsistent contract address or metadata" });
      } else identifiers.set(identityKey, { contract: contractAddress, symbol: symbol.toUpperCase(), name, logo: logoUrl });
      const existing = tokens.get(stableIdentifier);
      if (existing && existing.contractAddress !== contractAddress) diagnostics.failures.push({ scope: stableIdentifier, reason: "Inconsistent contract addresses for stable token" });
      if (!existing) tokens.set(stableIdentifier, { stableIdentifier, robinhoodIdentifier, symbol: symbol.toUpperCase(), name, contractAddress, logoUrl, metadata: { ...asset } });
      else if (!existing.logoUrl && logoUrl) tokens.set(stableIdentifier, { ...existing, logoUrl });
    });
  });
  diagnostics.uniqueTokens = tokens.size;
  diagnostics.logoBearingRecords = [...tokens.values()].filter((token) => !!token.logoUrl).length;
  diagnostics.missingLogoIdentifiers = [...tokens.values()].filter((token) => !token.logoUrl).map((token) => token.stableIdentifier);
  diagnostics.missingLogoRecords = diagnostics.missingLogoIdentifiers.length;
  diagnostics.complete = diagnostics.failures.length === 0 && diagnostics.skippedRecords.length === 0 && sawCompletePage;
  diagnostics.status = diagnostics.complete ? "complete" : diagnostics.failures.length ? "failed" : "partial";
  return { tokens: [...tokens.values()], diagnostics };
}

async function fetchPage(url: string, attempt = 0): Promise<unknown> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); try { const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal }); if ((response.status === 429 || response.status >= 500) && attempt < 3) { const retryAfter = Number(response.headers.get("retry-after")); const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8_000) : 500 * 2 ** attempt; await new Promise((resolve) => setTimeout(resolve, delay)); return fetchPage(url, attempt + 1); } if (!response.ok) throw new Error(`Robinhood assets API returned HTTP ${response.status}`); return response.json(); } finally { clearTimeout(timer); } }

export async function fetchRobinhoodStockTokenCatalog(): Promise<{ tokens: StockTokenMetadata[]; diagnostics: StockTokenSyncDiagnostics }> {
  const pages: unknown[] = []; const seenUrls = new Set<string>(); let url: string | undefined = ROBINHOOD_STOCK_TOKEN_ASSETS_URL;
  while (url) { if (pages.length >= MAX_PAGES) { const result = validateRobinhoodStockTokenCatalogPages(pages); result.diagnostics.failures.push({ scope: "pagination", reason: "Pagination exceeded safety limit" }); result.diagnostics.complete = false; result.diagnostics.status = "failed"; return result; } if (seenUrls.has(url)) { const result = validateRobinhoodStockTokenCatalogPages(pages); result.diagnostics.failures.push({ scope: "pagination", reason: `Pagination loop at ${url}` }); result.diagnostics.complete = false; result.diagnostics.status = "failed"; return result; } seenUrls.add(url); const payload = await fetchPage(url); pages.push(payload); const parsed = pageItems(payload); url = parsed.next ? new URL(parsed.next, ROBINHOOD_STOCK_TOKEN_ASSETS_URL).toString() : undefined; }
  return validateRobinhoodStockTokenCatalogPages(pages);
}

function writeClient(): SupabaseClient | null { const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null; }
function rowToToken(row: CachedRow): StockTokenMetadata { return { stableIdentifier: row.stable_identifier, robinhoodIdentifier: row.robinhood_identifier ?? undefined, symbol: row.symbol, name: row.name ?? undefined, contractAddress: row.contract_address ?? undefined, logoUrl: row.icon_url ?? undefined, metadata: row.metadata ?? {} }; }
async function writeSyncLog(db: SupabaseClient, result: StockTokenSyncResult): Promise<void> { await db.from("market_metadata_syncs").insert({ status: result.status, fetched: result.totalApiRecords, stored: result.storedRecords, updated: result.updated, skipped: result.skippedRecords.length, failed: result.failures.length, details: result }); }
async function recordWarning(message: string): Promise<void> { const db = writeClient(); if (!db) return; await db.from("market_metadata_catalog_state").upsert({ catalog_key: "robinhood-chain-stock-tokens", complete: false, warning: message, updated_at: new Date().toISOString() }, { onConflict: "catalog_key" }); }
export async function invalidateStockTokenCatalog(): Promise<void> { const db = writeClient(); if (!db) return; await db.from("market_metadata_catalog_state").upsert({ catalog_key: "robinhood-chain-stock-tokens", invalidated_at: new Date().toISOString(), warning: "Stock-token catalog refresh requested.", updated_at: new Date().toISOString() }, { onConflict: "catalog_key" }); }

export async function getStockTokenCatalog(refreshIfStale = true): Promise<StockTokenCatalog> { if (!supabase) return { tokens: [], complete: false, stale: true, warning: "Market metadata is unavailable until Supabase is configured." }; const [{ data: rows, error: rowsError }, { data: state, error: stateError }] = await Promise.all([supabase.from("market_metadata").select("stable_identifier,robinhood_identifier,symbol,name,contract_address,icon_url,metadata").eq("source", "robinhood-chain-stock-token-api").eq("active", true).order("symbol"), supabase.from("market_metadata_catalog_state").select("last_successful_sync_at,complete,warning,invalidated_at").eq("catalog_key", "robinhood-chain-stock-tokens").maybeSingle()]); if (rowsError || stateError) return { tokens: [], complete: false, stale: true, warning: rowsError?.message ?? stateError?.message ?? "Market metadata read failed." }; const typedState = state as CatalogState | null; const stale = !typedState?.last_successful_sync_at || !typedState.complete || !!typedState.invalidated_at || Date.now() - new Date(typedState.last_successful_sync_at).getTime() > CACHE_TTL_MS; const cached = { tokens: (rows ?? []).map((row) => rowToToken(row as CachedRow)), lastSuccessfulSyncAt: typedState?.last_successful_sync_at ?? undefined, complete: typedState?.complete ?? false, stale, warning: typedState?.warning ?? (stale ? "Showing the last successful stock-token catalog while synchronization is pending." : undefined) }; if (stale && refreshIfStale && writeClient()) { const result = await synchronizeRobinhoodStockTokenCatalog(); if (result.status === "complete") return getStockTokenCatalog(false); return { ...cached, warning: result.error ?? `Stock-token synchronization is ${result.status}; showing the last successful catalog.`, diagnostics: result }; } return cached; }

export async function synchronizeRobinhoodStockTokenCatalog(): Promise<StockTokenSyncResult> {
  const diagnostics = emptyDiagnostics(); const base = { ...diagnostics, fetched: 0, stored: 0, updated: 0, skipped: 0, failed: 0, duplicateRecords: 0 } as StockTokenSyncResult; const db = writeClient();
  if (!db) return { ...base, error: "Supabase service-role configuration is missing" };
  let catalog: { tokens: StockTokenMetadata[]; diagnostics: StockTokenSyncDiagnostics };
  try { catalog = await fetchRobinhoodStockTokenCatalog(); } catch (error) { const message = error instanceof Error ? error.message : "Robinhood catalog request failed"; const result = { ...base, status: "failed" as const, failures: [{ scope: "request", reason: message }], error: message }; await recordWarning(`Stock-token synchronization failed; serving the previous catalog: ${message}`); await writeSyncLog(db, result); return result; }
  const current = await db.from("market_metadata").select("stable_identifier,symbol,name,contract_address,icon_url").eq("source", "robinhood-chain-stock-token-api").eq("active", true);
  if (current.error) { const result = { ...base, ...catalog.diagnostics, status: "failed" as const, failures: [...catalog.diagnostics.failures, { scope: "database", reason: current.error.message }], error: current.error.message }; await writeSyncLog(db, result); return result; }
  const existing = new Map((current.data ?? []).map((row) => [row.stable_identifier, row])); const incoming = new Map(catalog.tokens.map((token) => [token.stableIdentifier, token]));
  catalog.diagnostics.changes.additions = [...incoming.keys()].filter((key) => !existing.has(key));
  catalog.diagnostics.changes.removals = [...existing.keys()].filter((key) => !incoming.has(key));
  catalog.diagnostics.changes.metadataChanges = [...incoming.keys()].filter((key) => { const old = existing.get(key); const next = incoming.get(key); return !!old && !!next && (old.symbol !== next.symbol || old.name !== (next.name ?? null) || old.contract_address?.toLowerCase() !== next.contractAddress?.toLowerCase() || (!!old.icon_url !== !!next.logoUrl)); });
  const retainedMissingLogos = (current.data ?? []).filter((row) => !row.icon_url).map((row) => row.stable_identifier); const incomingMissingLogos = catalog.diagnostics.missingLogoIdentifiers; catalog.diagnostics.missingLogoIdentifiers = [...new Set([...incomingMissingLogos, ...retainedMissingLogos])]; catalog.diagnostics.missingLogoRecords = catalog.diagnostics.missingLogoIdentifiers.length;
  const mergedDiagnostics = { ...catalog.diagnostics, storedRecords: catalog.diagnostics.complete ? catalog.tokens.length : existing.size, status: catalog.diagnostics.complete ? "complete" as const : catalog.diagnostics.status === "failed" ? "failed" as const : "partial" as const };
  if (!catalog.diagnostics.complete) { const result = { ...base, ...mergedDiagnostics, error: "Catalog validation was not complete; the previous active catalog was retained." }; await recordWarning(result.error); await writeSyncLog(db, result); return result; }
  const { data, error } = await db.rpc("replace_market_metadata_catalog", { p_tokens: catalog.tokens, p_fetched: catalog.diagnostics.totalApiRecords, p_pages: catalog.diagnostics.pages, p_duplicate_records: catalog.diagnostics.duplicateTokens, p_docs: ROBINHOOD_STOCK_TOKEN_API_DOCS });
  if (error) { const result = { ...base, ...mergedDiagnostics, status: "stale" as const, storedRecords: existing.size, error: `Catalog commit failed; the previous catalog was retained: ${error.message}` }; await recordWarning(result.error); await writeSyncLog(db, result); return result; }
  const result = { ...base, ...mergedDiagnostics, status: "complete" as const, complete: true, storedRecords: Number((data as { stored?: number } | null)?.stored ?? catalog.tokens.length), stored: Number((data as { stored?: number } | null)?.stored ?? catalog.tokens.length), updated: catalog.diagnostics.changes.metadataChanges.length, error: undefined }; await writeSyncLog(db, result); return result;
}

let catalogRequest: Promise<StockTokenCatalog> | undefined;
export async function getStockTokenMetadata(symbol: string): Promise<StockTokenMetadata | undefined> { const normalized = symbol.trim().toUpperCase(); if (!normalized) return undefined; if (!catalogRequest) catalogRequest = getStockTokenCatalog(true).finally(() => { catalogRequest = undefined; }); return (await catalogRequest).tokens.find((asset) => asset.symbol === normalized); }
