import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { synchronizeRobinhoodStockTokenCatalog } from "@/lib/stock-token-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean { const secret = process.env.STOCK_TOKEN_SYNC_SECRET?.trim() || process.env.CRON_SECRET?.trim(); return !!secret && request.headers.get("authorization") === `Bearer ${secret}`; }

export async function POST(request: Request) { if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const result = await synchronizeRobinhoodStockTokenCatalog(); return NextResponse.json(result, { status: result.status === "complete" ? 200 : 502 }); }

export async function GET(request: Request) { if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); if (!url || !key) return NextResponse.json({ error: "Supabase service-role configuration is missing" }, { status: 503 }); const db = createClient(url, key, { auth: { persistSession: false } }); const { data, error } = await db.from("market_metadata_syncs").select("id,status,fetched,stored,updated,skipped,failed,details,started_at,finished_at").order("id", { ascending: false }).limit(1).maybeSingle(); if (error) return NextResponse.json({ error: error.message }, { status: 503 }); return NextResponse.json({ sync: data }); }