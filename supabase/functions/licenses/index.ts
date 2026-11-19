// CleartrackApps license keys (Supabase Edge Function, Deno runtime).
//
// Drop-in replacement for the Lemon Squeezy License API used by all six paid
// apps. Same paths, same form-encoded POST bodies, same JSON replies, so an
// app only swaps its API base URL:
//
//   POST /functions/v1/licenses/activate   license_key, instance_name
//   POST /functions/v1/licenses/validate   license_key, instance_id?
//   POST /functions/v1/licenses/deactivate license_key, instance_id
//
// Replies carry meta.store_id / meta.product_id with the old Lemon Squeezy ids
// (see ct_products), so each app's "key belongs to this app" check is unchanged.
//
// Any reply that is NOT an answer about a known key (rate limit, bad request,
// server error) omits `valid` and `license_key`, which every app treats as
// "unusable reply: change nothing".
//
// Deploy: supabase functions deploy licenses --no-verify-jwt
// (no user account on a buyer's phone; keys are 122-bit random).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, accept",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-expose-headers": "retry-after",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", ...extra } });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Failed lookups allowed per connection: generous for typos, hopeless for guessing.
const MISS_WINDOW_S = 600;
const MISS_MAX = 20;

const RE_KEY = /^[A-Za-z0-9-]{8,64}$/;
const RE_INSTANCE = /^[0-9a-f-]{36}$/i;
const ACTIONS = new Set(["activate", "validate", "deactivate"]);

async function readFields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || "";
  const text = (await req.text()).slice(0, 4000);
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(text);
      return Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v ?? "")]));
    } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  if (!ACTIONS.has(action)) return json({ error: "unknown_action" }, 404);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256Hex("ct-licenses:" + ip);

  const since = new Date(Date.now() - MISS_WINDOW_S * 1000).toISOString();
  const { count } = await supabase.from("ct_license_misses").select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= MISS_MAX) return json({ error: "rate_limited" }, 429, { "retry-after": String(MISS_WINDOW_S) });

  const f = await readFields(req);
  const key = (f.license_key || "").trim();
  const instance = (f.instance_id || "").trim();
  if (!RE_KEY.test(key)) return json({ error: "license_key is required." }, 400);
  if (instance && !RE_INSTANCE.test(instance)) return json({ error: "instance_id is invalid." }, 400);

  let rpc: { data: any; error: any };
  if (action === "activate") {
    rpc = await supabase.rpc("ct_license_activate", { p_key: key, p_device: (f.instance_name || "device").slice(0, 120) });
  } else if (action === "validate") {
    rpc = await supabase.rpc("ct_license_validate", { p_key: key, p_instance: instance || null });
  } else {
    if (!instance) return json({ error: "instance_id is required." }, 400);
    rpc = await supabase.rpc("ct_license_deactivate", { p_key: key, p_instance: instance });
  }
  if (rpc.error || !rpc.data) {
    console.error("licenses rpc", action, rpc.error);
    return json({ error: "server_error" }, 500);
  }

  const d = rpc.data;
  if (d.license_key === null) {
    // Unknown key: count it toward this connection's limit, and tidy old rows.
    await supabase.from("ct_license_misses").insert({ ip_hash: ipHash });
    if (Math.random() < 0.05) {
      await supabase.from("ct_license_misses").delete().lt("at", new Date(Date.now() - 86400000).toISOString());
    }
    return json(d, 404);
  }
  return json(d, 200);
});
