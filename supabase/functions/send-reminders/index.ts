// Supabase Edge Function (Deno runtime).
// Schedule this on a 1-minute cron via Supabase Scheduled Triggers or
// pg_cron. It looks up reminders whose fire_at has passed and have not yet
// been delivered, sends a Web Push to every device the owning user has
// registered, and stamps delivered_at.
//
// Required environment variables (set with `supabase secrets set ...`):
//   SUPABASE_URL                — auto-populated for Edge Functions
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key, bypasses RLS
//   VAPID_PUBLIC_KEY            — same value as VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY           — VAPID private key (keep secret)
//   VAPID_SUBJECT               — mailto:you@example.com
//
// Deploy:   supabase functions deploy send-reminders --no-verify-jwt
// Secrets:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
// Schedule: in the Supabase dashboard, add a Scheduled Trigger that POSTs
//           to this function every minute, or use pg_cron + pg_net.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type ReminderSource = "appointment" | "medication" | "daily_meds";

interface ReminderRow {
  id: string;
  user_id: string;
  device_id: string;
  source: ReminderSource;
  source_id: number;
  patient_name: string | null;
  title: string;
  body: string | null;
  fire_at: string;
  sound: string | null;
}

interface DeviceRow {
  device_id: string;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

// ---------------------------------------------------------------------------
// Timezone helpers.
//
// We must decide what "today" is in the *user's* timezone, and turn a local
// wall-clock time into a UTC instant. There is no date library here, so both
// are derived from Intl.DateTimeFormat parts. Nothing in this path formats a
// date for a human — toISOString() is only ever used as the Postgres
// timestamptz wire format for an already-correct instant.
// ---------------------------------------------------------------------------

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type === "literal") continue;
    out[part.type] = Number(part.value);
  }
  // Intl renders midnight as hour 24 in some ICU versions.
  if (out.hour === 24) out.hour = 0;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant at which the given local wall-clock time occurs in
 * `timeZone`. Resolved iteratively so DST transitions land correctly.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  }
  return new Date(ts);
}

function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Daily "Log today's meds?" nudge — server-side recurrence.
//
// `daily_nudges` stores a rule (enabled + local HH:MM), never occurrences.
// Every run we work out today's local date per device and, if the scheduled
// local time has passed, insert exactly one reminders row for that local day.
// The unique partial index on (device_id, source_id) where source='daily_meds'
// makes this safe to run every minute: extra attempts conflict and are
// ignored, so no duplicates and no need to read-before-write.
//
// `source_id` carries the local date as YYYYMMDD.
// ---------------------------------------------------------------------------

const DAILY_NUDGE_TITLE = "MedRecords";
const DAILY_NUDGE_BODY = "Log today's meds?";

// If the function was down (or the phone had no timezone yet) we still send a
// late nudge, but only within this window. Beyond it we skip to tomorrow
// rather than pinging someone at 3am about a 8pm reminder.
const DAILY_NUDGE_CATCH_UP_MS = 2 * 60 * 60 * 1000;

interface DailyNudgeRow {
  user_id: string;
  device_id: string;
  local_time: string;
}

async function materializeDailyNudges(
  now: Date,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  const { data: nudges, error: nudgeErr } = await supabase
    .from("daily_nudges")
    .select("user_id, device_id, local_time")
    .eq("enabled", true)
    .limit(500);
  if (nudgeErr) return { created, skipped, errors: [`daily_nudges lookup: ${nudgeErr.message}`] };
  if (!nudges || nudges.length === 0) return { created, skipped, errors };

  // devices.timezone is the single source of truth for the device's zone.
  const deviceIds = [...new Set((nudges as DailyNudgeRow[]).map((n) => n.device_id))];
  const { data: devices, error: devErr } = await supabase
    .from("devices")
    .select("user_id, device_id, timezone")
    .in("device_id", deviceIds);
  if (devErr) return { created, skipped, errors: [`device timezone lookup: ${devErr.message}`] };

  const zoneByDevice = new Map<string, string | null>();
  for (const d of (devices ?? []) as Array<{ user_id: string; device_id: string; timezone: string | null }>) {
    zoneByDevice.set(`${d.user_id}:${d.device_id}`, d.timezone);
  }

  for (const nudge of nudges as DailyNudgeRow[]) {
    const key = `${nudge.user_id}:${nudge.device_id}`;
    if (!zoneByDevice.has(key)) {
      // No matching device row — the subscription is gone. The FK cascade
      // normally removes these, so treat as a skip rather than an error.
      skipped++;
      continue;
    }
    const rawZone = zoneByDevice.get(key);
    const timeZone = isValidTimeZone(rawZone) ? rawZone : "UTC";

    const [hStr, mStr] = (nudge.local_time ?? "20:00").split(":");
    const hour = Number(hStr);
    const minute = Number(mStr);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      errors.push(`${nudge.device_id}: invalid local_time ${nudge.local_time}`);
      continue;
    }

    // "Today" strictly in the device's own timezone.
    const today = localParts(now, timeZone);
    const fireAt = zonedTimeToUtc(today.year, today.month, today.day, hour, minute, timeZone);
    const elapsed = now.getTime() - fireAt.getTime();
    if (elapsed < 0 || elapsed > DAILY_NUDGE_CATCH_UP_MS) {
      skipped++;
      continue;
    }

    const localDateId = today.year * 10000 + today.month * 100 + today.day;

    const { error: insErr } = await supabase.from("reminders").insert({
      user_id: nudge.user_id,
      device_id: nudge.device_id,
      source: "daily_meds",
      source_id: localDateId,
      patient_name: null, // never sent for this reminder
      title: DAILY_NUDGE_TITLE,
      body: DAILY_NUDGE_BODY,
      fire_at: fireAt.toISOString(),
      sound: null,
    });

    if (insErr) {
      // 23505 = unique violation: today's nudge already exists. Expected on
      // every run after the first, and exactly what keeps this idempotent.
      if ((insErr as any).code === "23505" || /duplicate key/i.test(insErr.message)) {
        skipped++;
        continue;
      }
      errors.push(`${nudge.device_id}: insert failed: ${insErr.message}`);
      continue;
    }
    created++;
  }

  return { created, skipped, errors };
}

async function deliverOne(reminder: ReminderRow): Promise<{ ok: boolean; error?: string }> {
  // The daily nudge is a per-device opt-in, so it goes only to the device that
  // asked for it. Appointment/refill reminders are per-user and still fan out
  // to every phone the user has installed the PWA on.
  const isDailyMeds = reminder.source === "daily_meds";
  let deviceQuery = supabase
    .from("devices")
    .select("device_id, endpoint, p256dh, auth")
    .eq("user_id", reminder.user_id);
  if (isDailyMeds) deviceQuery = deviceQuery.eq("device_id", reminder.device_id);
  const { data: devices, error: devErr } = await deviceQuery;
  if (devErr) return { ok: false, error: `device lookup failed: ${devErr.message}` };
  if (!devices || devices.length === 0) {
    return { ok: false, error: "no devices for user" };
  }

  // The daily nudge is intentionally verbatim: no action-label prefix, no
  // patient name, no medication name. Nothing identifying may reach Apple's
  // push service.
  if (isDailyMeds) {
    return await sendToDevices(devices as DeviceRow[], JSON.stringify({
      title: reminder.title?.trim() || DAILY_NUDGE_TITLE,
      body: reminder.body?.trim() || DAILY_NUDGE_BODY,
      tag: `daily-meds-${reminder.source_id}`,
      url: "./#/medications",
      source: reminder.source,
      sourceId: reminder.source_id,
    }));
  }

  // Title leads with the action category ("Appointment" / "Refill") so the
  // OS banner — which truncates after a few words and may also stack the
  // installed-app label above the title on iOS — never reads as just the
  // patient placeholder ("My Records"). The client already pre-renders the
  // body with the appointment time and location in the user's local
  // timezone; we deliberately do NOT re-format dates server-side, since
  // server locales default to year-first. Patient name is appended only for
  // disambiguation (multi-patient households).
  const isAppointment = reminder.source === "appointment";
  const detailTitle = reminder.title?.trim() ?? "";
  const titleAlreadyPrefixed = /^(appointment|refill)\b/i.test(detailTitle);
  const actionLabel = isAppointment ? "Appointment" : "Refill";
  const composedTitle = detailTitle
    ? (titleAlreadyPrefixed ? detailTitle : `${actionLabel}: ${detailTitle}`)
    : isAppointment
      ? "Appointment reminder"
      : "Medication refill";

  const body = reminder.body?.trim() ?? "";
  const patientName = reminder.patient_name?.trim() ?? "";
  const composedBody = body && patientName
    ? `${body} · for ${patientName}`
    : body || patientName;

  const payload = JSON.stringify({
    title: composedTitle,
    body: composedBody,
    tag: `${reminder.source}-${reminder.source_id}`,
    url: isAppointment ? "./#/appointments" : "./#/medications",
    source: reminder.source,
    sourceId: reminder.source_id,
  });

  return await sendToDevices(devices as DeviceRow[], payload);
}

async function sendToDevices(
  devices: DeviceRow[],
  payload: string,
): Promise<{ ok: boolean; error?: string }> {
  const results = await Promise.allSettled(
    devices.map(async (d) => {
      if (!d.p256dh || !d.auth) throw new Error("missing keys");
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        payload,
      );
    }),
  );

  // Drop expired/invalid subscriptions so the client re-subscribes next open.
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      const status = (r.reason && (r.reason as any).statusCode) || 0;
      if (status === 404 || status === 410) {
        await supabase.from("devices").delete().eq("endpoint", devices[i].endpoint);
      }
    }
  }

  const anySent = results.some((r) => r.status === "fulfilled");
  if (anySent) return { ok: true };
  const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return { ok: false, error: firstErr?.reason?.message ?? "all sends failed" };
}

Deno.serve(async (_req) => {
  const now = new Date();

  // Step 1: expand the daily rules into today's occurrences (idempotent), so
  // the delivery pass below can treat them like any other due reminder.
  const nudges = await materializeDailyNudges(now);

  const nowIso = now.toISOString();
  const { data: due, error } = await supabase
    .from("reminders")
    .select("id, user_id, device_id, source, source_id, patient_name, title, body, fire_at, sound")
    .is("delivered_at", null)
    .lte("fire_at", nowIso)
    .order("fire_at", { ascending: true })
    .limit(200);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ delivered: 0, nudges }), { status: 200 });
  }

  let delivered = 0;
  let failed = 0;
  let expired = 0;
  for (const reminder of due as ReminderRow[]) {
    // A daily nudge that is long overdue (function outage, subscription
    // trouble) must not surface hours later as an out-of-context ping. Retire
    // it instead; tomorrow's occurrence is generated independently.
    if (
      reminder.source === "daily_meds" &&
      now.getTime() - new Date(reminder.fire_at).getTime() > DAILY_NUDGE_CATCH_UP_MS
    ) {
      expired++;
      await supabase
        .from("reminders")
        .update({ delivered_at: new Date().toISOString(), delivery_error: "expired: outside catch-up window" })
        .eq("id", reminder.id);
      continue;
    }

    const result = await deliverOne(reminder);
    if (result.ok) {
      delivered++;
      await supabase
        .from("reminders")
        .update({ delivered_at: new Date().toISOString(), delivery_error: null })
        .eq("id", reminder.id);
    } else {
      failed++;
      await supabase
        .from("reminders")
        .update({ delivery_error: result.error ?? "unknown" })
        .eq("id", reminder.id);
    }
  }

  return new Response(JSON.stringify({ delivered, failed, expired, considered: due.length, nudges }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
});
