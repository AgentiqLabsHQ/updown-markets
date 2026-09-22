// Same-origin JSON-RPC proxy to the Robinhood testnet RPC.
// - Keeps the browser CORS-safe and hides the upstream RPC key (server-only env).
// - De-duplicates identical in-flight reads and briefly caches them, so a burst of
//   identical polling reads collapses into one upstream call (stays under rate limits).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.RH_TESTNET_RPC_UPSTREAM ||
  process.env.RH_TESTNET_RPC ||
  "https://rpc.testnet.chain.robinhood.com";

const TTL_MS = 2000;
type Entry = { ts: number; body: string; status: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<{ body: string; status: number }>>();

// Never cache/dedupe writes or gas estimation.
const NO_CACHE = /sendRawTransaction|sendTransaction|estimateGas/i;

async function forward(body: string) {
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return { body: await upstream.text(), status: upstream.status };
}

export async function POST(req: Request) {
  const body = await req.text();
  const cacheable = !NO_CACHE.test(body);
  const key = body;

  try {
    if (cacheable) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.ts < TTL_MS) {
        return json(hit.body, hit.status);
      }
      const pending = inflight.get(key);
      if (pending) {
        const r = await pending;
        return json(r.body, r.status);
      }
      const p = forward(body);
      inflight.set(key, p);
      try {
        const r = await p;
        if (r.status === 200) cache.set(key, { ts: Date.now(), body: r.body, status: r.status });
        return json(r.body, r.status);
      } finally {
        inflight.delete(key);
      }
    }
    const r = await forward(body);
    return json(r.body, r.status);
  } catch {
    return json(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "RPC proxy error" } }),
      502,
    );
  }
}

function json(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
