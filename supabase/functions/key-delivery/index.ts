// CleartrackApps key delivery (Supabase Edge Function, Deno runtime).
//
// Stripe sends purchase events here. For each paid checkout this function
// creates a license key in ct_license_keys (the same keys the `licenses`
// function checks) and emails it to the buyer through Resend, with a button
// that opens the app with ?key=... so it unlocks in one tap.
//
//   POST /functions/v1/key-delivery/stripe   (Stripe webhook endpoint)
//
// Events handled:
//   checkout.session.completed / checkout.session.async_payment_succeeded
//       -> issue key (once per Checkout Session) + email it
//   customer.subscription.updated / customer.subscription.deleted
//       -> subscription keys follow the subscription (ended = key expires)
//   charge.refunded (full refund of a one-time purchase) -> key disabled
//
// Which app a purchase unlocks: Checkout Session metadata `ct_product`
// (+ optional `ct_variant_id`, `ct_variant_name`; set these on each Stripe
// Payment Link), otherwise the price id looked up in ct_stripe_prices
// (needs STRIPE_SECRET_KEY to read the session's line items).
//
// Secrets: RESEND_API_KEY (function secret). Webhook signing secret:
// STRIPE_WEBHOOK_SECRET function secret, or ct_settings.stripe_webhook_secret.
// Deploy: supabase functions deploy key-delivery --no-verify-jwt
// (Stripe can't send a Supabase login; every request is signature-checked.)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const FROM = "CleartrackApps <keys@cleartrackapps.com>";
const REPLY_TO = "cleartrackapps@gmail.com";
const SITE = "https://cleartrackapps.com";

// Where each app lives, and how its link carries the key.
const APPS: Record<string, { name: string; url: (k: string) => string }> = {
  "budget-tracker": { name: "Budget Tracker", url: (k) => `${SITE}/budget-tracker/?key=${k}` },
  "bootstraps": { name: "Bootstraps", url: (k) => `${SITE}/bootstraps/?key=${k}` },
  "puzzle-pig": { name: "Puzzle Pig", url: (k) => `${SITE}/puzzle-pig/app.html?key=${k}` },
  "cosmetic-surgery-planner": { name: "Cosmetic Surgery Planner", url: (k) => `${SITE}/beauty-procedure-planner/?key=${k}` },
  "pawfolio-complete": { name: "Pawfolio Complete", url: (k) => `${SITE}/pet-care-planner/?key=${k}` },
  "medrecords-max": { name: "MedRecords", url: (k) => `${SITE}/medical-records-keeper/?key=${k}#/max` },
};
const CARE_VARIANT_IDS = [2245604, 2315392];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ---------- Stripe signature (https://docs.stripe.com/webhooks#verify-manually)
async function setting(name: string): Promise<string | null> {
  const { data } = await db.from("ct_settings").select("value").eq("name", name).maybeSingle();
  return data?.value ?? null;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifyStripe(raw: string, header: string | null): Promise<boolean> {
  const secrets = [Deno.env.get("STRIPE_WEBHOOK_SECRET"), await setting("stripe_webhook_secret")].filter(Boolean) as string[];
  if (!header || !secrets.length) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1s = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !v1s.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // replay window
  for (const s of secrets) {
    const want = await hmacHex(s, `${t}.${raw}`);
    if (v1s.some((v) => safeEqual(v, want))) return true;
  }
  return false;
}

async function stripeGet(path: string): Promise<any | null> {
  const sk = Deno.env.get("STRIPE_SECRET_KEY");
  if (!sk) return null;
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${sk}` } });
  return r.ok ? await r.json() : null;
}

// ---------- Which app did they buy?
async function productFor(session: any): Promise<{ product: string; variant_id: number | null; variant_name: string | null } | null> {
  const m = session.metadata || {};
  if (m.ct_product && APPS[m.ct_product]) {
    return { product: m.ct_product, variant_id: m.ct_variant_id ? Number(m.ct_variant_id) : null, variant_name: m.ct_variant_name || null };
  }
  const items = await stripeGet(`checkout/sessions/${session.id}/line_items?limit=10`);
  for (const li of items?.data || []) {
    const { data } = await db.from("ct_stripe_prices").select("*").eq("stripe_price", li.price?.id).maybeSingle();
    if (data) return { product: data.product, variant_id: data.variant_id, variant_name: data.variant_name };
  }
  return null;
}

// ---------- Email
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function appLabel(product: string, variant_id: number | null): string {
  if (product === "medrecords-max") return variant_id && CARE_VARIANT_IDS.includes(variant_id) ? "MedRecords Care" : "MedRecords Max";
  return APPS[product].name;
}

export function keyEmail(k: any, devices: number) {
  const label = appLabel(k.product, k.variant_id);
  const link = APPS[k.product].url(encodeURIComponent(k.key));
  const hi = k.holder_name ? `Hi ${esc(String(k.holder_name).split(" ")[0])},` : "Hi,";
  const subject = `Your ${label} license key`;
  const text = [
    k.holder_name ? `Hi ${String(k.holder_name).split(" ")[0]},` : "Hi,",
    "",
    `Thank you for buying ${label}. Here is your license key:`,
    "",
    `    ${k.key}`,
    "",
    `Open ${label} and unlock it in one tap:`,
    link,
    "",
    `Or open the app, choose Unlock, and paste the key. It works on up to ${devices} devices.`,
    "Keep this email so you can unlock a new phone later.",
    "",
    "Questions? Just reply to this email.",
    "",
    "CleartrackApps",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:16px;line-height:1.5">
<p style="margin:0 0 14px">${hi}</p>
<p style="margin:0 0 18px">Thank you for buying ${esc(label)}. Here is your license key:</p>
<p style="margin:0 0 22px;padding:14px;background:#eef3ef;border-radius:8px;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;letter-spacing:.3px;word-break:break-all;text-align:center">${esc(k.key)}</p>
<p style="margin:0 0 22px;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#3f6b52;color:#ffffff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:8px">Open ${esc(label)} and unlock</a></p>
<p style="margin:0 0 10px;font-size:14px;color:#4a564f">Or open the app, choose Unlock, and paste the key. It works on up to ${devices} devices.</p>
<p style="margin:0 0 10px;font-size:14px;color:#4a564f">Keep this email so you can unlock a new phone later.</p>
<p style="margin:18px 0 0;font-size:14px;color:#4a564f">Questions? Just reply to this email.<br>CleartrackApps</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendKey(k: any): Promise<{ ok: boolean; error?: string }> {
  const rk = Deno.env.get("RESEND_API_KEY");
  if (!rk) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!k.holder_email) return { ok: false, error: "no buyer email" };
  const { data: p } = await db.from("ct_products").select("max_devices").eq("slug", k.product).single();
  const devices = k.max_devices ?? p?.max_devices ?? 3;
  const { subject, text, html } = keyEmail(k, devices);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${rk}`, "content-type": "application/json", "idempotency-key": `key-${k.id}` },
    body: JSON.stringify({ from: FROM, to: [k.holder_email], reply_to: REPLY_TO, subject, text, html }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = `resend ${r.status}: ${body?.message || body?.name || "error"}`.slice(0, 300);
    await db.from("ct_license_keys").update({ email_error: error }).eq("id", k.id);
    return { ok: false, error };
  }
  await db.from("ct_license_keys").update({ emailed_at: new Date().toISOString(), email_id: body.id ?? null, email_error: null }).eq("id", k.id);
  return { ok: true };
}

// ---------- Event handlers (each returns a short outcome string; throw = let Stripe retry)
async function onCheckout(s: any): Promise<string> {
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return "not paid yet";
  let { data: k } = await db.from("ct_license_keys").select("*").eq("stripe_session", s.id).maybeSingle();
  if (!k) {
    const what = await productFor(s);
    if (!what) return "no ct_product for this checkout (left alone)";
    const email = s.customer_details?.email || s.customer_email || null;
    const { data, error } = await db.from("ct_license_keys").insert({
      product: what.product, variant_id: what.variant_id, variant_name: what.variant_name,
      holder_name: s.customer_details?.name || null, holder_email: email ? String(email).toLowerCase() : null,
      source: "stripe", stripe_session: s.id,
      stripe_customer: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
      stripe_subscription: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
      stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
      note: s.livemode ? null : "Stripe test mode",
    }).select("*").single();
    if (error) {
      // A parallel retry may have inserted it first.
      const again = await db.from("ct_license_keys").select("*").eq("stripe_session", s.id).maybeSingle();
      if (!again.data) throw new Error(`insert failed: ${error.message}`);
      k = again.data;
    } else k = data;
  }
  if (k.emailed_at) return "key already emailed";
  const sent = await sendKey(k);
  if (!sent.ok) throw new Error(`key issued, email failed: ${sent.error}`);
  return "key issued and emailed";
}

async function onSubscription(sub: any, deleted: boolean): Promise<string> {
  const ended = deleted || ["canceled", "unpaid", "incomplete_expired"].includes(sub.status);
  const live = ["active", "trialing"].includes(sub.status);
  if (!ended && !live) return `status ${sub.status}: no change`;
  const expires_at = ended ? new Date(((sub.ended_at || sub.canceled_at) ?? Date.now() / 1000) * 1000).toISOString() : null;
  const { data } = await db.from("ct_license_keys").update({ expires_at }).eq("stripe_subscription", sub.id).select("id");
  return `${data?.length ?? 0} key(s) ${ended ? "expired" : "active"}`;
}

async function onRefund(ch: any): Promise<string> {
  if (!ch.refunded) return "partial refund: no change";
  const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
  if (!pi) return "no payment intent";
  const { data } = await db.from("ct_license_keys").update({ status: "disabled", note: "Refunded in Stripe" })
    .eq("stripe_payment_intent", pi).is("stripe_subscription", null).select("id");
  return `${data?.length ?? 0} key(s) disabled`;
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (req.method !== "POST" || !path.endsWith("/stripe")) return json({ error: "not found" }, 404);
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature")))) return json({ error: "bad signature" }, 400);
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const seen = await db.from("ct_stripe_events").select("outcome").eq("id", ev.id).maybeSingle();
  if (seen.data?.outcome) return json({ received: true, duplicate: true });

  let outcome: string;
  try {
    const o = ev.data?.object || {};
    switch (ev.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": outcome = await onCheckout(o); break;
      case "customer.subscription.updated": outcome = await onSubscription(o, false); break;
      case "customer.subscription.deleted": outcome = await onSubscription(o, true); break;
      case "charge.refunded": outcome = await onRefund(o); break;
      default: outcome = "ignored";
    }
  } catch (e) {
    console.error(ev.type, ev.id, String(e));
    await db.from("ct_stripe_events").upsert({ id: ev.id, type: ev.type, outcome: null });
    return json({ error: "temporary failure" }, 500); // Stripe retries
  }
  await db.from("ct_stripe_events").upsert({ id: ev.id, type: ev.type, outcome });
  return json({ received: true, outcome });
});
