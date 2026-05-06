import type { Appointment, Medication, Patient } from "@shared/schema";
import { getSupabase, isSupabaseConfigured, VAPID_PUBLIC_KEY } from "./supabase";

export type PhoneReminderState =
  | { status: "unsupported"; reason: string }
  | { status: "not-configured"; reason: string }
  | { status: "permission-denied" }
  | { status: "permission-default" }
  | { status: "subscribing" }
  | { status: "subscribed"; endpoint: string }
  | { status: "error"; message: string; stage?: string };

const DEVICE_ID_KEY = "mrk-device-id";
const DEVICE_SYNC_KEY = "mrk-device-sync-status";
const REMINDER_SYNC_KEY = "mrk-reminder-sync-status";

export interface SyncStatusRecord {
  ts: string; // ISO
  ok: boolean;
  message: string;
  count?: number;
  stage?: string;
}

function readStatus(key: string): SyncStatusRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as SyncStatusRecord;
  } catch {
    return null;
  }
}

function writeStatus(key: string, value: SyncStatusRecord): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function getLastDeviceSyncStatus(): SyncStatusRecord | null {
  return readStatus(DEVICE_SYNC_KEY);
}

export function getLastReminderSyncStatus(): SyncStatusRecord | null {
  return readStatus(REMINDER_SYNC_KEY);
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export function detectPhoneReminderState(): PhoneReminderState {
  if (typeof window === "undefined") return { status: "unsupported", reason: "No window" };
  if (!("serviceWorker" in navigator)) return { status: "unsupported", reason: "Service workers not supported" };
  if (!("PushManager" in window)) return { status: "unsupported", reason: "Push API not supported" };
  if (!("Notification" in window)) return { status: "unsupported", reason: "Notifications not supported" };
  if (!isSupabaseConfigured() || !VAPID_PUBLIC_KEY) {
    return { status: "not-configured", reason: "Supabase or VAPID not configured" };
  }
  if (Notification.permission === "denied") return { status: "permission-denied" };
  return { status: "permission-default" }; // caller should refresh once subscribed
}

async function ensureAnonAuth(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw new Error(`get session failed: ${sessErr.message}`);
  if (sessionData.session?.user) return sessionData.session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    const hint = /anonymous/i.test(error.message)
      ? " (enable Anonymous sign-ins in Supabase Auth settings)"
      : "";
    throw new Error(`Anonymous sign-in failed: ${error.message}${hint}`);
  }
  if (!data.user) throw new Error("Anonymous sign-in returned no user");
  return data.user.id;
}

async function upsertDevice(): Promise<{ userId: string; endpoint: string }> {
  const userId = await ensureAnonAuth();

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const supabase = getSupabase()!;
  const deviceId = getOrCreateDeviceId();
  const json = sub.toJSON();
  const row = {
    user_id: userId,
    device_id: deviceId,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? null,
    auth: json.keys?.auth ?? null,
    user_agent: navigator.userAgent,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const { data, error } = await supabase
    .from("devices")
    .upsert(row, { onConflict: "user_id,device_id" })
    .select("id");
  if (error) throw new Error(`device upsert failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("device upsert returned no rows (RLS may have hidden it from select)");
  }
  return { userId, endpoint: sub.endpoint };
}

export async function enablePhoneReminders(): Promise<PhoneReminderState> {
  const stamp = (
    ok: boolean,
    message: string,
    stage?: string,
  ): SyncStatusRecord => {
    const rec: SyncStatusRecord = { ts: new Date().toISOString(), ok, message, stage };
    writeStatus(DEVICE_SYNC_KEY, rec);
    return rec;
  };

  try {
    const initial = detectPhoneReminderState();
    if (initial.status === "unsupported" || initial.status === "not-configured") {
      stamp(false, initial.status === "unsupported" ? initial.reason : initial.reason, initial.status);
      return initial;
    }

    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch (err: any) {
      stamp(false, err?.message ?? String(err), "request-permission");
      return { status: "error", message: err?.message ?? String(err), stage: "request-permission" };
    }
    if (permission === "denied") {
      stamp(false, "permission denied", "permission");
      return { status: "permission-denied" };
    }
    if (permission !== "granted") {
      stamp(false, "permission not granted", "permission");
      return { status: "permission-default" };
    }

    const result = await upsertDevice();
    stamp(true, "device registered", "device-upsert");
    return { status: "subscribed", endpoint: result.endpoint };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const stage = /sign-in|session/i.test(message)
      ? "auth"
      : /push|subscribe/i.test(message)
        ? "push-subscribe"
        : /device upsert/i.test(message)
          ? "device-upsert"
          : "unknown";
    stamp(false, message, stage);
    return { status: "error", message, stage };
  }
}

export async function disablePhoneReminders(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});

  const supabase = getSupabase();
  if (supabase) {
    const deviceId = getOrCreateDeviceId();
    await supabase.from("devices").delete().eq("device_id", deviceId);
    await supabase.from("reminders").delete().eq("device_id", deviceId);
  }
}

export interface PhoneReminderDiagnostics {
  notificationPermission: NotificationPermission | "unavailable";
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  notificationApiSupported: boolean;
  isStandalone: boolean;
  displayMode: string;
  origin: string;
  hostname: string;
  protocol: string;
  isSecureContext: boolean;
  supabaseConfigured: boolean;
  vapidConfigured: boolean;
  platform: string;
  isIOS: boolean;
  isSafari: boolean;
  userAgent: string;
  deviceId: string;
  authedUserId: string | null;
  lastDeviceSync: SyncStatusRecord | null;
  lastReminderSync: SyncStatusRecord | null;
}

export async function collectPhoneReminderDiagnostics(): Promise<PhoneReminderDiagnostics> {
  const base = collectStaticDiagnostics();
  let authedUserId: string | null = null;
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      authedUserId = data.session?.user?.id ?? null;
    }
  } catch {
    authedUserId = null;
  }
  return {
    ...base,
    authedUserId,
    lastDeviceSync: getLastDeviceSyncStatus(),
    lastReminderSync: getLastReminderSyncStatus(),
  };
}

function collectStaticDiagnostics(): Omit<
  PhoneReminderDiagnostics,
  "authedUserId" | "lastDeviceSync" | "lastReminderSync"
> {
  if (typeof window === "undefined") {
    return {
      notificationPermission: "unavailable",
      serviceWorkerSupported: false,
      pushManagerSupported: false,
      notificationApiSupported: false,
      isStandalone: false,
      displayMode: "unknown",
      origin: "",
      hostname: "",
      protocol: "",
      isSecureContext: false,
      supabaseConfigured: false,
      vapidConfigured: false,
      platform: "",
      isIOS: false,
      isSafari: false,
      userAgent: "",
      deviceId: "",
    };
  }

  const ua = navigator.userAgent || "";
  const platform = (navigator as any).platform || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);

  const displayModes = ["standalone", "fullscreen", "minimal-ui", "browser"];
  const displayMode = displayModes.find((m) => window.matchMedia(`(display-mode: ${m})`).matches) ?? "unknown";
  const isStandalone = displayMode === "standalone" ||
    (typeof (navigator as any).standalone === "boolean" && (navigator as any).standalone === true);

  let deviceId = "";
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) ?? "";
  } catch {
    deviceId = "";
  }

  return {
    notificationPermission: "Notification" in window ? Notification.permission : "unavailable",
    serviceWorkerSupported: "serviceWorker" in navigator,
    pushManagerSupported: "PushManager" in window,
    notificationApiSupported: "Notification" in window,
    isStandalone,
    displayMode,
    origin: window.location.origin,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    isSecureContext: typeof window.isSecureContext === "boolean" ? window.isSecureContext : false,
    supabaseConfigured: isSupabaseConfigured(),
    vapidConfigured: Boolean(VAPID_PUBLIC_KEY),
    platform,
    isIOS,
    isSafari,
    userAgent: ua,
    deviceId,
  };
}

export async function getCurrentPhoneReminderState(): Promise<PhoneReminderState> {
  const base = detectPhoneReminderState();
  if (base.status !== "permission-default") return base;
  if (Notification.permission !== "granted") return base;
  if (!("serviceWorker" in navigator)) return base;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return { status: "subscribed", endpoint: sub.endpoint };
  return { status: "permission-default" };
}

// ---------------------------------------------------------------------------
// Reminder synchronisation. Walks local Dexie data and writes one row per
// upcoming reminder into Supabase so the Edge Function can deliver them when
// the app is closed. Only the minimum fields needed to render the
// notification cross over — never clinical record bodies.
// ---------------------------------------------------------------------------

export interface SyncedReminder {
  source: "appointment" | "medication";
  source_id: number;
  patient_name: string;
  title: string;
  body: string | null;
  fire_at: string; // ISO UTC
  sound: string | null;
}

function appointmentReminders(appointments: Appointment[], patients: Map<number, Patient>): SyncedReminder[] {
  const out: SyncedReminder[] = [];
  for (const a of appointments) {
    if (!a.reminderDate || a.status !== "upcoming") continue;
    const time = a.reminderTime || "09:00";
    const when = new Date(`${a.reminderDate}T${time}:00`);
    if (Number.isNaN(when.getTime())) continue;
    const patient = patients.get(a.patientId);
    out.push({
      source: "appointment",
      source_id: a.id ?? -1,
      patient_name: patient?.name ?? "",
      title: a.title || "Appointment reminder",
      body: a.location ? `${a.date} · ${a.location}` : a.date,
      fire_at: when.toISOString(),
      sound: null,
    });
  }
  return out.filter((r) => r.source_id > 0);
}

function medicationReminders(medications: Medication[], patients: Map<number, Patient>): SyncedReminder[] {
  // Only refill-date reminders are scheduled centrally; recurring time-of-day
  // dosing is local-only because expanding it server-side would replicate too
  // much patient context. Refill date is a single occurrence.
  const out: SyncedReminder[] = [];
  for (const m of medications) {
    if (!m.refillDate || m.active !== 1) continue;
    const when = new Date(`${m.refillDate}T09:00:00`);
    if (Number.isNaN(when.getTime())) continue;
    const patient = patients.get(m.patientId);
    out.push({
      source: "medication",
      source_id: m.id ?? -1,
      patient_name: patient?.name ?? "",
      title: `Refill ${m.name}`,
      body: m.dosage ? `${m.dosage} · ${m.frequency || ""}`.trim() : null,
      fire_at: when.toISOString(),
      sound: null,
    });
  }
  return out.filter((r) => r.source_id > 0);
}

export async function syncRemindersToSupabase(opts: {
  appointments: Appointment[];
  medications: Medication[];
  patients: Patient[];
}): Promise<{ synced: number } | { skipped: string }> {
  const stamp = (ok: boolean, message: string, count?: number, stage?: string) => {
    writeStatus(REMINDER_SYNC_KEY, {
      ts: new Date().toISOString(),
      ok,
      message,
      count,
      stage,
    });
  };

  const supabase = getSupabase();
  if (!supabase) {
    stamp(false, "supabase not configured", 0, "config");
    return { skipped: "supabase-not-configured" };
  }

  const state = await getCurrentPhoneReminderState();
  if (state.status !== "subscribed") {
    stamp(false, `not subscribed (${state.status})`, 0, "state");
    return { skipped: state.status };
  }

  // Make sure we still have a session — anonymous sessions can be evicted on
  // iOS storage cleanup.
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      const { error: anonErr } = await supabase.auth.signInAnonymously();
      if (anonErr) {
        stamp(false, `re-auth failed: ${anonErr.message}`, 0, "auth");
        throw new Error(`re-auth failed: ${anonErr.message}`);
      }
    }
  } catch (err: any) {
    stamp(false, err?.message ?? String(err), 0, "auth");
    throw err;
  }

  const patientMap = new Map(opts.patients.map((p) => [p.id!, p]));
  const all = [
    ...appointmentReminders(opts.appointments, patientMap),
    ...medicationReminders(opts.medications, patientMap),
  ].filter((r) => new Date(r.fire_at).getTime() > Date.now() - 60 * 60 * 1000);

  const deviceId = getOrCreateDeviceId();

  const { error: delErr } = await supabase
    .from("reminders")
    .delete()
    .eq("device_id", deviceId)
    .is("delivered_at", null);
  if (delErr) {
    stamp(false, `reminder delete failed: ${delErr.message}`, 0, "delete");
    throw new Error(`reminder delete failed: ${delErr.message}`);
  }

  if (all.length === 0) {
    stamp(true, "no upcoming reminders", 0, "empty");
    return { synced: 0 };
  }

  const rows = all.map((r) => ({
    device_id: deviceId,
    source: r.source,
    source_id: r.source_id,
    patient_name: r.patient_name,
    title: r.title,
    body: r.body,
    fire_at: r.fire_at,
    sound: r.sound,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("reminders")
    .insert(rows)
    .select("id");
  if (insErr) {
    stamp(false, `reminder insert failed: ${insErr.message}`, 0, "insert");
    throw new Error(`reminder insert failed: ${insErr.message}`);
  }

  const count = inserted?.length ?? rows.length;
  stamp(true, `synced ${count} reminder${count === 1 ? "" : "s"}`, count, "insert");
  return { synced: count };
}
