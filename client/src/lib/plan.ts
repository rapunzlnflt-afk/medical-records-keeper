// MedRecords Free / Max.
//
// Free is the everyday app and never expires. Max adds caregiver dose sharing,
// Medical Records (document uploads), Vitals, Timeline and visit notes.
//
// Max comes from one of two places:
//  - Grandfathered: anyone already using MedRecords before Free/Max launched
//    (every Etsy/Gumroad buyer included) keeps Max for good, never re-checked.
//  - A MedRecords Max subscription key from Lemon Squeezy, checked straight
//    from the browser with the License API (no secret needed). Each device is
//    one activation; the product allows 3.
//
// A lapsed plan never hides anything: existing Max records stay visible,
// printable and exportable. Only adding or editing Max records stops.
// Mirrors Pawfolio Complete's license logic.

import { useSyncExternalStore } from "react";
import { hasExistingRecords, readUnlockFlag } from "./license";

const LS_KEY = "mrMaxLicense";
/** Copied into every backup, so a grandfathered person stays Max on a new phone. */
export const GF_KEY = "mrMaxGrandfathered";
const FIRST_SEEN_KEY = "mrkFirstSeen";

/** The day Free/Max reached users. Backups saved before it prove pre-launch use. */
export const TIERS_LAUNCH = "2026-10-15";

export const BUY_URL =
  "https://cleartrackapps.lemonsqueezy.com/checkout/buy/ac094b3b-9ed8-4571-a7d7-a538aff71666";
/** sessionStorage slot for a key handed over in the address bar, read by the Max page. */
export const PENDING_KEY = "mrPendingMaxKey";
export const ORDERS_URL = "https://app.lemonsqueezy.com/my-orders";
const LS_API = "https://api.lemonsqueezy.com/v1/licenses/";
const STORE_ID = 478073;
const PRODUCT_ID = 1438215;
/**
 * MedRecords Care: two price options on the same product (Care monthly and
 * Care yearly). A key on one of these unlocks Care and everything in Max.
 */
export const CARE_VARIANT_IDS = [2245604, 2315392];
const GRACE_DAYS = 30; // keeps working offline for 30 days
const RECHECK_HOURS = 12; // how often an online device re-asks the store

export interface PlanState {
  status?: "free" | "active" | "lapsed";
  grandfathered?: boolean;
  since?: string | null;
  decidedOn?: string;
  key?: string;
  instanceId?: string | null;
  plan?: string | null;
  /** Lemon Squeezy price option the key is on (Care is checked from this). */
  variantId?: number | null;
  storeStatus?: string | null;
  expiresAt?: string | null;
  lastCheck?: string;
}

/* ---------- state + subscription ---------- */

const listeners = new Set<() => void>();
let snapshot = read();

function read(): PlanState {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function write(s: PlanState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* storage refused: state lasts until reload */
  }
  snapshot = s;
  listeners.forEach((l) => l());
}

export function getPlan(): PlanState {
  return snapshot;
}

/** Is the saved key currently good (active, checked recently, not past expiry)? */
function keyActive(l: PlanState): boolean {
  if (l.status !== "active") return false;
  const now = Date.now();
  // Offline grace: a paying customer keeps working without a connection, but
  // not forever. After GRACE_DAYS with no successful check, Max pauses until
  // the next check succeeds.
  if (l.lastCheck && (now - Date.parse(l.lastCheck)) / 86400000 > GRACE_DAYS) return false;
  // A cancelled subscription stays active until expires_at. Three days past
  // that with no newer check, we can't confirm a renewal, so pause.
  if (l.expiresAt && l.lastCheck) {
    const exp = Date.parse(l.expiresAt);
    if (now > exp + 3 * 86400000 && Date.parse(l.lastCheck) < exp) return false;
  }
  return true;
}

function computeMax(l: PlanState): boolean {
  return !!l.grandfathered || keyActive(l);
}

/** Care needs a key on a Care price option. Grandfathering covers Max only. */
function computeCare(l: PlanState): boolean {
  return !!l.key && keyActive(l) && CARE_VARIANT_IDS.includes(Number(l.variantId));
}

export function hasCareLicense(): boolean {
  return computeCare(snapshot);
}

/** Subscribe to plan changes (for hooks outside this file). */
export function subscribePlan(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function hasMax(): boolean {
  return computeMax(snapshot);
}

/** React hook: re-renders when the plan changes (activation, lapse, removal). */
export function useMax(): boolean {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  return computeMax(s);
}

export function usePlan(): PlanState & { max: boolean; care: boolean } {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  return { ...s, max: computeMax(s), care: computeCare(s) };
}

/* ---------- grandfathering ---------- */

function grandfather(since: string | null) {
  const l = read();
  // Keep a key already on this device (for example a Care key).
  const keep = l.key
    ? { key: l.key, instanceId: l.instanceId, plan: l.plan, variantId: l.variantId, storeStatus: l.storeStatus, expiresAt: l.expiresAt, status: l.status }
    : {};
  write({ status: "active", ...keep, grandfathered: true, since, lastCheck: l.lastCheck || new Date().toISOString() });
  try {
    localStorage.setItem(GF_KEY, "1");
  } catch {
    /* ignore */
  }
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Decide once whether this device belongs to someone who was here before
 * Free/Max. Signs of an existing user: an old purchase-gate unlock, a
 * first-seen date before today, or records a brand-new browser can't have.
 * The verdict is saved and not revisited, except that a restored backup can
 * still prove grandfathering later (see noteRestoredBackup).
 */
export async function decidePlan(): Promise<void> {
  const l = read();
  let flagged = false;
  try {
    flagged = localStorage.getItem(GF_KEY) === "1";
  } catch {
    /* ignore */
  }
  if (l.grandfathered) {
    if (!flagged) {
      try {
        localStorage.setItem(GF_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    snapshot = l;
    return;
  }
  const seen = String(localStorage.getItem(FIRST_SEEN_KEY) || "").slice(0, 10);
  const validSeen = /^\d{4}-\d{2}-\d{2}$/.test(seen);
  if (flagged || (validSeen && seen < TIERS_LAUNCH)) return grandfather(validSeen ? seen : null);
  if (l.status) {
    snapshot = l;
    return; // already decided: Free, or a real subscriber
  }
  const today = todayISO();
  const wasHereFirst = validSeen && seen < today;
  if (wasHereFirst || readUnlockFlag() || (await hasExistingRecords())) {
    return grandfather(validSeen ? seen : null);
  }
  write({ status: "free", decidedOn: today });
}

/** Called after a backup restore. Pre-launch backups, or ones from a grandfathered device, grandfather this one. */
export function noteRestoredBackup(data: { exportedAt?: string; mrMaxGrandfathered?: boolean }) {
  if (getPlan().grandfathered) return;
  const at = String(data?.exportedAt || "").slice(0, 10);
  if (data?.mrMaxGrandfathered || (/^\d{4}-\d{2}-\d{2}$/.test(at) && at < TIERS_LAUNCH)) {
    grandfather(at || null);
  }
}

export function isGrandfathered(): boolean {
  return !!getPlan().grandfathered;
}

/* ---------- Lemon Squeezy License API ---------- */

interface LsReply {
  activated?: boolean;
  valid?: boolean;
  error?: string | null;
  license_key?: { status?: string; expires_at?: string | null };
  instance?: { id?: string };
  meta?: { store_id?: number; product_id?: number; variant_id?: number; variant_name?: string };
}

async function lsPost(action: string, fields: Record<string, string>): Promise<LsReply> {
  const res = await fetch(LS_API + action, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return (await res.json().catch(() => ({}))) as LsReply;
}

function ours(meta: LsReply["meta"]) {
  return !!meta && Number(meta.store_id) === STORE_ID && Number(meta.product_id) === PRODUCT_ID;
}

function deviceName() {
  const ua = navigator.userAgent || "";
  const kind = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : "device";
  return "MedRecords on " + kind;
}

function record(key: string, instanceId: string | null, d: LsReply) {
  const lk = d.license_key || {};
  const prev = read();
  write({
    // Grandfathered Max survives any key added on top of it.
    ...(prev.grandfathered ? { grandfathered: true, since: prev.since } : {}),
    status: lk.status === "active" ? "active" : "lapsed",
    storeStatus: lk.status || null,
    key,
    instanceId,
    plan: d.meta?.variant_name || null,
    variantId: d.meta?.variant_id != null ? Number(d.meta.variant_id) : null,
    expiresAt: lk.expires_at || null,
    lastCheck: new Date().toISOString(),
  });
}

function friendly(err?: string | null) {
  const e = String(err || "");
  if (/activation limit/i.test(e))
    return "This key is already in use on 3 devices. Remove one from My Orders at app.lemonsqueezy.com, then try again.";
  if (/not found|invalid/i.test(e)) return "That key wasn't recognized. Copy it again from your receipt email.";
  return e || "That key wasn't recognized.";
}

const NOT_ACTIVE =
  "This subscription isn't active. Renew it from My Orders at app.lemonsqueezy.com, then tap Activate again.";

export async function activateKey(raw: string): Promise<{ ok: boolean; message?: string }> {
  const key = String(raw || "").trim();
  if (!key) return { ok: false, message: "Paste the license key from your receipt email." };
  const l = read();
  // Same key already on this device: re-check instead of using another activation.
  if (l.key === key && l.instanceId) {
    await revalidate(true);
    return keyActive(read()) ? { ok: true } : { ok: false, message: NOT_ACTIVE };
  }
  try {
    const d = await lsPost("activate", { license_key: key, instance_name: deviceName() });
    if (!d || !d.activated) return { ok: false, message: friendly(d?.error) };
    if (!ours(d.meta)) {
      // Free the slot we just took on another product.
      lsPost("deactivate", { license_key: key, instance_id: d.instance?.id || "" }).catch(() => {});
      return { ok: false, message: "That key is for a different product, not MedRecords Max." };
    }
    // Replacing one key with another: free the old key's slot on this device.
    if (l.key && l.instanceId && l.key !== key) {
      lsPost("deactivate", { license_key: l.key, instance_id: l.instanceId }).catch(() => {});
    }
    record(key, d.instance?.id || null, d);
    return keyActive(read()) ? { ok: true } : { ok: false, message: NOT_ACTIVE };
  } catch {
    return { ok: false, message: "Couldn't reach the license server. Check your connection and try again." };
  }
}

/**
 * Re-ask the store about a saved key. Runs at start-up when the last check is
 * older than RECHECK_HOURS, so a cancelled plan pauses within a day and a
 * renewed one comes back on its own. Offline, nothing changes.
 */
export async function revalidate(force = false): Promise<void> {
  const l = read();
  // Grandfathered people are re-checked only for a key they added (Care).
  if (!l.key || !l.instanceId) return;
  const age = l.lastCheck ? (Date.now() - Date.parse(l.lastCheck)) / 3600000 : Infinity;
  const pastExpiry =
    !!l.expiresAt &&
    Date.now() > Date.parse(l.expiresAt) &&
    (!l.lastCheck || Date.parse(l.lastCheck) < Date.parse(l.expiresAt));
  if (!force && !pastExpiry && age < RECHECK_HOURS) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    const d = await lsPost("validate", { license_key: l.key, instance_id: l.instanceId });
    if (!d || (d.valid === undefined && !d.license_key)) return; // unusable reply
    if (d.valid && d.license_key && ours(d.meta)) record(l.key, l.instanceId, d);
    else
      write({
        ...read(),
        status: "lapsed",
        storeStatus: d.license_key?.status || "invalid",
        lastCheck: new Date().toISOString(),
      });
  } catch {
    /* offline or blocked: keep the current state */
  }
}

/** Frees this device's activation and returns it to Free. Records are untouched. */
export async function removeKey(): Promise<void> {
  const l = read();
  if (l.key && l.instanceId) {
    await lsPost("deactivate", { license_key: l.key, instance_id: l.instanceId }).catch(() => {});
  }
  // A grandfathered person goes back to grandfathered Max, not Free.
  if (l.grandfathered) write({ status: "active", grandfathered: true, since: l.since ?? null, lastCheck: new Date().toISOString() });
  else write({ status: "free", decidedOn: todayISO() });
}

/** The receipt's "Open MedRecords" button can carry the key as ?key=... */
export function keyFromUrl(): string | null {
  try {
    const u = new URL(window.location.href);
    const k = u.searchParams.get("key") || u.searchParams.get("license_key");
    if (!k) return null;
    u.searchParams.delete("key");
    u.searchParams.delete("license_key");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    return k.replace(/[^A-Za-z0-9-]/g, "");
  } catch {
    return null;
  }
}
