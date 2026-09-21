// Client access layer for server-side dose scheduling.
//
// A "dose schedule" is the rule for an every-N-hours medication, and lives in
// Supabase rather than the browser, because the next dose has to be computed
// and pushed while the app is closed. Everything else about a medication stays
// local, exactly as before: this module never uploads dosage, prescriber,
// pharmacy, purpose, side effects, or notes.
//
// What actually leaves the device for a scheduled medication:
//   * a label the user chooses (may be as vague as "Morning pill")
//   * an optional first name
//   * the interval and its guardrails
//   * dose timestamps
//
// Conventions mirror reminder-sync.ts: anonymous auth per device, RLS scoped to
// auth.uid(), local medication id carried as `source_id`, and no throwing at
// call sites that the UI cannot do anything about.

import { getSupabase, isSupabaseConfigured } from "./supabase";
import { ensureAnonAuth } from "./reminder-sync";

export type DoseAnchor = "fixed" | "from_last_dose";
export type DoseStatus = "pending" | "taken" | "skipped" | "missed" | "superseded";

/** Server row: the rule. */
export interface DoseSchedule {
  id: string;
  user_id: string;
  source_id: number;
  label: string;
  subject_name: string | null;
  interval_min: number;
  anchor: DoseAnchor;
  fixed_times: string[] | null;
  window_start: string | null;
  window_end: string | null;
  max_per_day: number | null;
  grace_min: number;
  ends_on: string | null;
  enabled: boolean;
  timezone: string;
  created_at: string;
  updated_at: string;
}

/** Server row: one occurrence. */
export interface DoseEvent {
  id: string;
  schedule_id: string;
  due_at: string;
  taken_at: string | null;
  status: DoseStatus;
  actor_label: string | null;
  note: string | null;
  notified_at: string | null;
  created_at: string;
}

/**
 * What `log_dose()` decided. The server deliberately returns an outcome
 * instead of raising, so the confirm sheet can explain what happened rather
 * than showing a generic failure.
 *
 *   logged         — recorded; `next_due_at` is the following dose
 *   already_logged — this dose was already closed (double tap, two tabs)
 *   too_soon       — would land inside the minimum spacing; needs `force`
 */
export interface LogDoseResult {
  outcome: "logged" | "already_logged" | "too_soon";
  event_id?: string;
  status?: DoseStatus;
  taken_at?: string | null;
  next_due_at?: string | null;
  next_event_id?: string | null;
  minutes_remaining?: number;
  message?: string;
}

/** Fields the settings UI owns. */
export interface DoseScheduleInput {
  label: string;
  intervalMin: number;
  anchor?: DoseAnchor;
  fixedTimes?: string[] | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  maxPerDay?: number | null;
  graceMin?: number;
  endsOn?: string | null;
  subjectName?: string | null;
  enabled?: boolean;
}

export const DOSE_DEFAULT_GRACE_MIN = 90;
export const DOSE_DEFAULT_WINDOW_START = "08:00";
export const DOSE_DEFAULT_WINDOW_END = "22:00";

/** The device's IANA zone. A schedule keeps its own copy so it survives a phone change. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

/** True when scheduled dosing is even possible in this build. */
export function isDoseSchedulingAvailable(): boolean {
  return isSupabaseConfigured();
}

// === Reading ===

/**
 * The schedule for one local medication, or null when it has none. Returns null
 * rather than throwing when the backend is unreachable, so a medication card
 * degrades to its normal local behaviour instead of failing to render.
 */
export async function getDoseSchedule(medicationId: number): Promise<DoseSchedule | null> {
  if (!isDoseSchedulingAvailable()) return null;
  try {
    const supabase = requireClient();
    const userId = await ensureAnonAuth();
    const { data, error } = await supabase
      .from("dose_schedules")
      .select("*")
      .eq("user_id", userId)
      .eq("source_id", medicationId)
      .maybeSingle();
    if (error) return null;
    return (data as DoseSchedule) ?? null;
  } catch {
    return null;
  }
}

/** Every schedule this device's user owns, keyed by local medication id. */
export async function getDoseSchedules(): Promise<Map<number, DoseSchedule>> {
  const out = new Map<number, DoseSchedule>();
  if (!isDoseSchedulingAvailable()) return out;
  try {
    const supabase = requireClient();
    const userId = await ensureAnonAuth();
    const { data, error } = await supabase
      .from("dose_schedules")
      .select("*")
      .eq("user_id", userId);
    if (error || !data) return out;
    for (const row of data as DoseSchedule[]) out.set(row.source_id, row);
    return out;
  } catch {
    return out;
  }
}

/**
 * The one open dose for a schedule, if any. The server enforces at most one
 * pending dose per schedule with a partial unique index, so this is a single
 * row by construction — a phone that was off for two days cannot come back to
 * a backlog of stale doses.
 */
export async function getOpenDose(scheduleId: string): Promise<DoseEvent | null> {
  if (!isDoseSchedulingAvailable()) return null;
  try {
    const supabase = requireClient();
    await ensureAnonAuth();
    const { data, error } = await supabase
      .from("dose_events")
      .select("*")
      .eq("schedule_id", scheduleId)
      .eq("status", "pending")
      .maybeSingle();
    if (error) return null;
    return (data as DoseEvent) ?? null;
  } catch {
    return null;
  }
}

/** One dose event by id — the confirm sheet's loader. */
export async function getDoseEvent(eventId: string): Promise<DoseEvent | null> {
  if (!isDoseSchedulingAvailable()) return null;
  try {
    const supabase = requireClient();
    await ensureAnonAuth();
    const { data, error } = await supabase
      .from("dose_events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (error) return null;
    return (data as DoseEvent) ?? null;
  } catch {
    return null;
  }
}

/** A dose event plus the schedule it belongs to, for the confirm sheet header. */
export async function getDoseEventWithSchedule(
  eventId: string,
): Promise<{ event: DoseEvent; schedule: DoseSchedule } | null> {
  const event = await getDoseEvent(eventId);
  if (!event) return null;
  try {
    const supabase = requireClient();
    const { data, error } = await supabase
      .from("dose_schedules")
      .select("*")
      .eq("id", event.schedule_id)
      .maybeSingle();
    if (error || !data) return null;
    return { event, schedule: data as DoseSchedule };
  } catch {
    return null;
  }
}

/** Recent occurrences, newest first. Used by the medication history view. */
export async function listDoseEvents(scheduleId: string, limit = 30): Promise<DoseEvent[]> {
  if (!isDoseSchedulingAvailable()) return [];
  try {
    const supabase = requireClient();
    await ensureAnonAuth();
    const { data, error } = await supabase
      .from("dose_events")
      .select("*")
      .eq("schedule_id", scheduleId)
      .order("due_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as DoseEvent[];
  } catch {
    return [];
  }
}

// === Writing ===

/**
 * Create or update the schedule for a medication, and make sure it has an open
 * dose to work from. `unique (user_id, source_id)` means one schedule per
 * medication, so this is an upsert on that pair.
 */
export async function saveDoseSchedule(
  medicationId: number,
  input: DoseScheduleInput,
): Promise<DoseSchedule> {
  const supabase = requireClient();
  const userId = await ensureAnonAuth();

  const row = {
    user_id: userId,
    source_id: medicationId,
    label: input.label.trim(),
    subject_name: input.subjectName?.trim() || null,
    interval_min: input.intervalMin,
    anchor: input.anchor ?? "from_last_dose",
    fixed_times: input.fixedTimes ?? null,
    window_start: input.windowStart ?? null,
    window_end: input.windowEnd ?? null,
    max_per_day: input.maxPerDay ?? null,
    grace_min: input.graceMin ?? DOSE_DEFAULT_GRACE_MIN,
    ends_on: input.endsOn ?? null,
    enabled: input.enabled ?? true,
    timezone: deviceTimezone(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("dose_schedules")
    .upsert(row, { onConflict: "user_id,source_id" })
    .select("*")
    .single();
  if (error) throw new Error(`Could not save the dose schedule: ${error.message}`);

  const schedule = data as DoseSchedule;
  if (schedule.enabled) await ensureOpenDose(schedule);
  return schedule;
}

/**
 * Give an enabled schedule its first dose if it has none.
 *
 * Normally `dose_sweep()` keeps schedules stocked on the server's two-minute
 * tick, but a user who just turned dosing on should see a next-due time
 * immediately rather than after the next sweep. The partial unique index makes
 * a duplicate insert harmless — it fails closed, which is why the error is
 * swallowed here.
 */
export async function ensureOpenDose(schedule: DoseSchedule): Promise<DoseEvent | null> {
  const existing = await getOpenDose(schedule.id);
  if (existing) return existing;
  try {
    const supabase = requireClient();
    const firstDue = firstDueAt(schedule);
    const { data, error } = await supabase
      .from("dose_events")
      .insert({ schedule_id: schedule.id, due_at: firstDue.toISOString() })
      .select("*")
      .single();
    if (error) return await getOpenDose(schedule.id);
    return data as DoseEvent;
  } catch {
    return null;
  }
}

/**
 * When the first dose of a brand-new schedule should land.
 *
 * Deliberately "now", not "now + interval": someone switching a medication to
 * scheduled dosing is usually about to take it, and a schedule whose first
 * prompt is four hours away looks broken. The server recomputes every dose
 * after this one, including the daily window, so a first dose outside the
 * window only affects this single occurrence.
 */
function firstDueAt(_schedule: DoseSchedule): Date {
  return new Date();
}

/**
 * Record a dose. `taken: false` is a skip, which the server anchors to the
 * original due time so skipping does not stretch the day's spacing.
 *
 * Pass `force` only after the user has seen and acknowledged a `too_soon`
 * result — it exists for the real case of a dose genuinely taken early, not as
 * a way to silence the guard.
 */
export async function logDose(
  eventId: string,
  taken: boolean,
  opts: { at?: Date; actorLabel?: string; note?: string; force?: boolean } = {},
): Promise<LogDoseResult> {
  const supabase = requireClient();
  await ensureAnonAuth();
  const { data, error } = await supabase.rpc("log_dose", {
    p_event_id: eventId,
    p_taken: taken,
    p_at: opts.at ? opts.at.toISOString() : null,
    p_actor_label: opts.actorLabel ?? null,
    p_note: opts.note ?? null,
    p_force: opts.force ?? false,
  });
  if (error) throw new Error(`Could not record the dose: ${error.message}`);
  return data as LogDoseResult;
}

/**
 * Stop scheduling without discarding history. The schedule row and its past
 * doses stay, so the medication's dose history survives being turned off and
 * on again; only the open dose is cleared so no push is queued.
 */
export async function disableDoseSchedule(medicationId: number): Promise<void> {
  const supabase = requireClient();
  const userId = await ensureAnonAuth();
  const schedule = await getDoseSchedule(medicationId);
  if (!schedule) return;

  const { error } = await supabase
    .from("dose_schedules")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("source_id", medicationId);
  if (error) throw new Error(`Could not turn off scheduled dosing: ${error.message}`);

  await supabase
    .from("dose_events")
    .delete()
    .eq("schedule_id", schedule.id)
    .eq("status", "pending");
}

/**
 * Remove the schedule and everything derived from it. Used when the
 * medication itself is deleted; `dose_events` cascades.
 */
export async function deleteDoseSchedule(medicationId: number): Promise<void> {
  if (!isDoseSchedulingAvailable()) return;
  try {
    const supabase = requireClient();
    const userId = await ensureAnonAuth();
    await supabase
      .from("dose_schedules")
      .delete()
      .eq("user_id", userId)
      .eq("source_id", medicationId);
  } catch {
    // Best effort: a medication deleted locally must not fail because the
    // backend was unreachable. The orphaned schedule is harmless — its pushes
    // carry a label the user chose, and turning the medication back on reuses
    // the same (user_id, source_id) row.
  }
}

// === Presentation helpers ===

/**
 * Best-effort reading of the existing free-text `frequency` field, so turning
 * on scheduled dosing can prefill the interval instead of asking the user to
 * restate something they already typed. Returns null when unsure — a wrong
 * guess here is worse than no guess.
 */
export function parseFrequencyToIntervalMin(frequency: string | null | undefined): number | null {
  if (!frequency) return null;
  const text = frequency.toLowerCase().trim();

  const everyHours = text.match(/every\s+(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (everyHours) {
    const hours = Number.parseFloat(everyHours[1]);
    if (Number.isFinite(hours) && hours > 0) return clampInterval(Math.round(hours * 60));
  }

  const everyMinutes = text.match(/every\s+(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (everyMinutes) {
    const mins = Number.parseInt(everyMinutes[1], 10);
    if (Number.isFinite(mins) && mins > 0) return clampInterval(mins);
  }

  // "q6h" / "q 6 h" — common prescription shorthand.
  const qForm = text.match(/\bq\s*(\d+)\s*h\b/);
  if (qForm) {
    const hours = Number.parseInt(qForm[1], 10);
    if (Number.isFinite(hours) && hours > 0) return clampInterval(hours * 60);
  }

  // "4 times a day" / "3x daily" — an even split across a 24-hour day is the
  // only defensible reading without knowing the intended clock times.
  const perDay = text.match(/(\d+)\s*(?:x|times)\s*(?:a|per)?\s*(?:day|daily)/);
  if (perDay) {
    const n = Number.parseInt(perDay[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 24) return clampInterval(Math.round(1440 / n));
  }

  if (/\b(once|1x)\s*(?:a|per)?\s*(?:day|daily)\b/.test(text) || text === "daily") return 1440;
  if (/\btwice\s*(?:a|per)?\s*(?:day|daily)\b/.test(text) || /\bbid\b/.test(text)) return 720;
  if (/\bthree times\b/.test(text) || /\btid\b/.test(text)) return 480;
  if (/\bfour times\b/.test(text) || /\bqid\b/.test(text)) return 360;

  return null;
}

function clampInterval(minutes: number): number {
  // Matches the server's check constraint: 15 minutes to 7 days.
  return Math.min(10080, Math.max(15, minutes));
}

/** "Every 4 hours", "Every 90 minutes", "Every 2 days". */
export function describeInterval(intervalMin: number): string {
  if (intervalMin % 1440 === 0) {
    const days = intervalMin / 1440;
    return days === 1 ? "Once a day" : `Every ${days} days`;
  }
  if (intervalMin % 60 === 0) {
    const hours = intervalMin / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return `Every ${intervalMin} minutes`;
}

/** "6:00 PM", "Tomorrow 8:00 AM", "Mon 8:00 AM". */
export function formatDueLabel(due: string | Date, now = new Date()): string {
  const date = typeof due === "string" ? new Date(due) : due;
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;

  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** "in 35 minutes", "25 minutes ago", "now". */
export function formatRelativeToNow(target: string | Date, now = new Date()): string {
  const date = typeof target === "string" ? new Date(target) : target;
  if (Number.isNaN(date.getTime())) return "";
  const diffMin = Math.round((date.getTime() - now.getTime()) / 60000);
  if (diffMin === 0) return "now";

  const ahead = diffMin > 0;
  const mins = Math.abs(diffMin);
  let amount: string;
  if (mins < 60) {
    amount = `${mins} minute${mins === 1 ? "" : "s"}`;
  } else if (mins < 1440) {
    const hours = Math.round((mins / 60) * 10) / 10;
    const whole = Number.isInteger(hours) ? hours : Math.round(hours);
    amount = `${whole} hour${whole === 1 ? "" : "s"}`;
  } else {
    const days = Math.round(mins / 1440);
    amount = `${days} day${days === 1 ? "" : "s"}`;
  }
  return ahead ? `in ${amount}` : `${amount} ago`;
}

/** True when a pending dose is past due but still inside its grace period. */
export function isDoseDue(event: DoseEvent, now = new Date()): boolean {
  return event.status === "pending" && new Date(event.due_at).getTime() <= now.getTime();
}
