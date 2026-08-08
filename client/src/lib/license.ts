import { db } from "./db";

const ENDPOINT = "https://mpanuzarzcfgjbheepmj.supabase.co/functions/v1/verify-license";
const APP = "medrecords";

const DEVICE_ID_KEY = "mr_device_id";
const UNLOCK_KEY = "mr_unlocked";

/**
 * The gate is opt-in at build time. It stays off unless a build sets
 * VITE_ENABLE_GATE=true, so the demo build (and any build that forgets the
 * flag) ships with no gate at all.
 */
export const GATE_ENABLED = import.meta.env.VITE_ENABLE_GATE === "true";

export type UnlockSource = "code" | "gumroad" | "grandfathered" | "existing_data";

export interface UnlockFlag {
  source: UnlockSource;
  at: string;
  /** True when we let the user in locally but the server never confirmed. */
  pending?: boolean;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function readUnlockFlag(): UnlockFlag | null {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnlockFlag;
    return parsed && typeof parsed.source === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeUnlockFlag(source: UnlockSource, pending = false): UnlockFlag {
  const flag: UnlockFlag = { source, at: new Date().toISOString() };
  if (pending) flag.pending = true;
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(flag));
  } catch {
    // A browser that refuses localStorage will simply re-check next launch.
  }
  return flag;
}

interface GateResponse {
  ok: boolean;
  source?: UnlockSource;
  reason?: string;
  since?: string;
}

/**
 * A stalled request must never leave someone staring at a blank screen, so
 * every call gives up on its own rather than waiting for the browser to.
 */
const TIMEOUT_MS = 8000;

async function post(body: Record<string, unknown>): Promise<GateResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: APP, device_id: getDeviceId(), ...body }),
      signal: controller.signal,
    });
    return (await res.json()) as GateResponse;
  } finally {
    clearTimeout(timer);
  }
}

export function verifyCode(code: string): Promise<GateResponse> {
  return post({ code });
}

export function checkStatus(): Promise<GateResponse> {
  return post({ action: "status" });
}

export function requestGrandfather(): Promise<GateResponse> {
  return post({ action: "grandfather" });
}

/**
 * True when this browser holds records a real user would have created.
 *
 * Deliberately excludes `patients` at count 1 and `reminderSoundPreferences`:
 * the app seeds a default patient for every visitor on first load, and reading
 * sound preferences creates the row. Either would match a brand-new browser.
 * `mrkLastExport` only exists after a real "Save my data" export, which the app
 * only offers once there is data to save.
 */
export async function hasExistingRecords(): Promise<boolean> {
  if (localStorage.getItem("mrkLastExport")) return true;
  try {
    const counts = await Promise.all([
      db.physicians.count(),
      db.appointments.count(),
      db.medications.count(),
      db.medicationLogs.count(),
      db.medicalRecords.count(),
      db.vitals.count(),
      db.emergencyContacts.count(),
      db.pharmacies.count(),
    ]);
    if (counts.some((n) => n > 0)) return true;
    return (await db.patients.count()) > 1;
  } catch {
    // If we cannot read the database we cannot prove they are new, so assume
    // they are an existing user rather than risk locking them out.
    return true;
  }
}

const REASON_MESSAGES: Record<string, string> = {
  bad_code: "That key or code wasn't recognised. Check for typos and try again.",
  refunded: "This purchase was refunded, so the key no longer works. Email us if that's a mistake.",
  device_limit: "This key has already been used on the maximum number of devices.",
  gumroad_not_configured: "Gumroad keys can't be checked right now. Email us and we'll unlock you manually.",
  grandfather_closed: "This browser can't be unlocked automatically. Enter your key or code below.",
  not_activated: "This device isn't activated yet.",
};

export function messageForReason(reason: string | undefined): string {
  if (!reason) return "Something went wrong. Please try again.";
  return REASON_MESSAGES[reason] ?? `Couldn't unlock: ${reason}`;
}
