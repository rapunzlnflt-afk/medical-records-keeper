import type { Appointment, Medication, Patient } from "@shared/schema";
import { getSupabase, isSupabaseConfigured, VAPID_PUBLIC_KEY } from "./supabase";

export type PhoneReminderState =
  | { status: "unsupported"; reason: string }
  | { status: "not-configured"; reason: string }
  | { status: "permission-denied" }
  | { status: "permission-default" }
  | { status: "subscribing" }
  | { status: "subscribed"; endpoint: string }
  | { status: "error"; message: string };

const DEVICE_ID_KEY = "mrk-device-id";

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
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
  if (Notification.permission === "default") return { status: "permission-default" };
  return { status: "permission-default" }; // caller should refresh once subscribed
}

async function ensureAnonAuth(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user.id;
  // Anonymous sign-in (must be enabled in Supabase Auth settings).
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`Anonymous sign-in failed: ${error?.message ?? "unknown"}`);
  return data.user.id;
}

export async function enablePhoneReminders(): Promise<PhoneReminderState> {
  try {
    const initial = detectPhoneReminderState();
    if (initial.status === "unsupported" || initial.status === "not-configured") return initial;

    const permission = await Notification.requestPermission();
    if (permission === "denied") return { status: "permission-denied" };
    if (permission !== "granted") return { status: "permission-default" };

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
    const { error } = await supabase.from("devices").upsert(
      {
        user_id: userId,
        device_id: deviceId,
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? null,
        auth: json.keys?.auth ?? null,
        user_agent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { onConflict: "user_id,device_id" },
    );
    if (error) return { status: "error", message: error.message };

    return { status: "subscribed", endpoint: sub.endpoint };
  } catch (err: any) {
    return { status: "error", message: err?.message ?? String(err) };
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
}

export function collectPhoneReminderDiagnostics(): PhoneReminderDiagnostics {
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
  const supabase = getSupabase();
  if (!supabase) return { skipped: "supabase-not-configured" };

  const state = await getCurrentPhoneReminderState();
  if (state.status !== "subscribed") return { skipped: state.status };

  const patientMap = new Map(opts.patients.map((p) => [p.id!, p]));
  const all = [
    ...appointmentReminders(opts.appointments, patientMap),
    ...medicationReminders(opts.medications, patientMap),
  ].filter((r) => new Date(r.fire_at).getTime() > Date.now() - 60 * 60 * 1000);

  const deviceId = getOrCreateDeviceId();

  // Replace this device's pending reminders atomically: delete then insert.
  // Past reminders the function has already delivered are kept untouched
  // because they have delivered_at != null (Edge Function sets it).
  const { error: delErr } = await supabase
    .from("reminders")
    .delete()
    .eq("device_id", deviceId)
    .is("delivered_at", null);
  if (delErr) throw new Error(`reminder delete failed: ${delErr.message}`);

  if (all.length === 0) return { synced: 0 };

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

  const { error: insErr } = await supabase.from("reminders").insert(rows);
  if (insErr) throw new Error(`reminder insert failed: ${insErr.message}`);

  return { synced: rows.length };
}
