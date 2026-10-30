// MedRecords Care — caregiver care log (Supabase Edge Function, Deno runtime).
//
// Caregivers use the SAME link as dose sharing (dose_groups / dose_members),
// so a caregiver who already joined for doses is already in. This function is
// separate from dose-share so the live dose flow is never touched.
//
//   peek    { token }                                  -> { care: bool } (no join needed)
//   state   { token, device_id }                       -> shared people + last 48h of entries
//   add     { token, device_id, entry }                -> new entry + state
//   update  { token, device_id, id, entry }            -> own entry, within 30 minutes
//   delete  { token, device_id, id }                   -> own entry, within 30 minutes
//
// Every caregiver on the link sees every caregiver's entries (shift handoff).
// When the owner switches it on for a person, caregivers also see the
// entries she logs herself (owner_local_id set), labeled with her name and
// never editable here.
// Only the person who logged an entry can change it, and only for 30 minutes;
// after that the owner's phone copies it into the family record.
//
// Deploy: supabase functions deploy care-share --no-verify-jwt

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findGroup(token: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const { data } = await supabase
    .from("dose_groups")
    .select("id, owner_user, owner_label, expires_at, revoked_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as { id: string; owner_user: string; owner_label: string | null };
}

async function findMember(groupId: string, deviceId: unknown) {
  if (typeof deviceId !== "string" || deviceId.length < 8 || deviceId.length > 100) return null;
  const { data } = await supabase
    .from("dose_members")
    .select("id, label, removed_at")
    .eq("group_id", groupId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (!data || data.removed_at) return null;
  return data as { id: string; label: string };
}

async function touch(groupId: string, memberId?: string) {
  const exp = new Date(Date.now() + 30 * 86400000).toISOString();
  await supabase.from("dose_groups").update({ expires_at: exp }).eq("id", groupId);
  if (memberId) await supabase.from("dose_members").update({ last_seen_at: new Date().toISOString() }).eq("id", memberId);
}

const EDIT_MS = 30 * 60000;
const WINDOW_MS = 48 * 3600000;

// Keep in step with client/src/lib/care.ts and the table checks in 0006.
const KINDS = ["meal", "therapy", "mood", "awareness", "personal"];
const STATUS = ["done", "partial", "declined"];
const MEALS = ["breakfast", "lunch", "dinner", "snack"];
const AMOUNTS = ["all", "most", "some", "little"];
const THERAPIES = ["PT", "OT"];
const TASKS = ["bathing", "dressing", "toileting", "grooming"];
const HELP = ["none", "some", "full"];
const LEVELS = ["alert", "quiet", "confused-sometimes", "very-confused", "drowsy", "unable"];
const REASONS = ["tired", "pain", "asleep", "refused", "sick", "not-hungry"];

const pick = (list: string[], v: unknown) => (typeof v === "string" && list.includes(v) ? v : null);
const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

/** Validates one entry from the page. Returns the row fields or an error key. */
function cleanEntry(e: any): { row?: Record<string, unknown>; error?: string } {
  if (!e || typeof e !== "object") return { error: "bad_entry" };
  const kind = pick(KINDS, e.kind);
  if (!kind) return { error: "bad_kind" };
  const atMs = typeof e.at === "string" ? Date.parse(e.at) : NaN;
  // Up to 2 days back (yesterday evening, logged this morning), never the future.
  if (isNaN(atMs) || atMs > Date.now() + 5 * 60000 || atMs < Date.now() - WINDOW_MS) return { error: "bad_time" };
  let status = pick(STATUS, e.status) ?? "done";
  const row: Record<string, unknown> = {
    kind, at: new Date(atMs).toISOString(),
    meal: null, amount: null, therapy: null, minutes: null, task: null, help: null,
    score: null, level: null, reason: null,
    details: text(e.details, 300), note: text(e.note, 1000),
  };
  if (kind === "meal") {
    row.meal = pick(MEALS, e.meal);
    if (!row.meal) return { error: "bad_meal" };
    if (status === "partial") status = "done";
    if (status === "done") row.amount = pick(AMOUNTS, e.amount);
  } else if (kind === "therapy") {
    row.therapy = pick(THERAPIES, e.therapy);
    if (!row.therapy) return { error: "bad_therapy" };
    if (status !== "declined") {
      const m = Number(e.minutes);
      row.minutes = Number.isInteger(m) && m >= 1 && m <= 600 ? m : null;
    }
  } else if (kind === "personal") {
    row.task = pick(TASKS, e.task);
    if (!row.task) return { error: "bad_task" };
    if (status === "partial") status = "done";
    if (status === "done") row.help = pick(HELP, e.help);
  } else if (kind === "mood") {
    status = "done";
    const s = Number(e.score);
    if (!Number.isInteger(s) || s < 1 || s > 10) return { error: "bad_score" };
    row.score = s;
  } else if (kind === "awareness") {
    status = "done";
    row.level = pick(LEVELS, e.level);
    if (!row.level) return { error: "bad_level" };
  }
  if (status === "declined") row.reason = pick(REASONS, e.reason);
  row.status = status;
  return { row };
}

async function sharedPeople(ownerUser: string) {
  const { data } = await supabase
    .from("care_people")
    .select("id, name, conditions, share_owner_entries")
    .eq("owner_user", ownerUser)
    .eq("shared", true)
    .order("name");
  return (data ?? []) as { id: string; name: string; conditions: string[]; share_owner_entries: boolean }[];
}

async function buildState(group: { owner_user: string; owner_label: string | null }, memberId: string) {
  const all = await sharedPeople(group.owner_user);
  const ownerOn = new Set(all.filter((p) => p.share_owner_entries).map((p) => p.id));
  const people = all.map(({ share_owner_entries: _s, ...p }) => p);
  let entries: any[] = [];
  if (people.length) {
    const { data } = await supabase
      .from("care_entries")
      .select("id, person_id, member_id, owner_local_id, actor_label, at, kind, status, meal, amount, therapy, minutes, task, help, score, level, reason, details, note, created_at")
      .in("person_id", people.map((p) => p.id))
      .is("deleted_at", null)
      .gte("at", new Date(Date.now() - WINDOW_MS).toISOString())
      .order("at", { ascending: false })
      .limit(400);
    // Member ids stay on the server; the page only learns "you can edit this".
    // The owner's own entries show only while her switch is on for that person.
    entries = ((data ?? []) as any[])
      .filter((e) => e.owner_local_id == null || ownerOn.has(e.person_id))
      .map(({ member_id, owner_local_id, ...e }) => ({
      ...e,
      actor_label: owner_local_id != null ? e.actor_label || group.owner_label || "Family" : e.actor_label,
      mine: member_id === memberId,
      can_edit: member_id === memberId && Date.now() - new Date(e.created_at).getTime() < EDIT_MS,
    }));
  }
  return { owner: group.owner_label || null, people, entries };
}

/** The caller's own entry, still inside the 30-minute window. */
async function ownEntry(id: unknown, memberId: string) {
  if (typeof id !== "string" || id.length > 64) return null;
  const { data } = await supabase
    .from("care_entries")
    .select("id, member_id, created_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.deleted_at || !data.member_id || data.member_id !== memberId) return null;
  if (Date.now() - new Date(data.created_at).getTime() >= EDIT_MS) return null;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = body?.action;

  const group = await findGroup(body?.token);
  if (!group) return json({ error: "link_inactive" }, 403);

  if (action === "peek") {
    return json({ care: (await sharedPeople(group.owner_user)).length > 0 });
  }

  const member = await findMember(group.id, body?.device_id);
  if (!member) return json({ error: "not_joined" }, 403);

  if (action === "state") {
    await touch(group.id, member.id);
    return json({ state: await buildState(group, member.id) });
  }

  if (action === "add") {
    const people = await sharedPeople(group.owner_user);
    const person = people.find((p) => p.id === body?.person_id);
    if (!person) return json({ error: "not_shared" }, 403);
    const { row, error } = cleanEntry(body.entry);
    if (!row) return json({ error }, 400);
    const { error: insErr } = await supabase.from("care_entries").insert({
      ...row, person_id: person.id, owner_user: group.owner_user,
      member_id: member.id, actor_label: member.label,
    });
    if (insErr) return json({ error: "add_failed" }, 500);
    await touch(group.id, member.id);
    return json({ ok: true, state: await buildState(group, member.id) });
  }

  if (action === "update") {
    const own = await ownEntry(body?.id, member.id);
    if (!own) return json({ error: "cannot_edit" }, 403);
    const { row, error } = cleanEntry(body.entry);
    if (!row) return json({ error }, 400);
    const { error: upErr } = await supabase.from("care_entries")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", own.id);
    if (upErr) return json({ error: "update_failed" }, 500);
    await touch(group.id, member.id);
    return json({ ok: true, state: await buildState(group, member.id) });
  }

  if (action === "delete") {
    const own = await ownEntry(body?.id, member.id);
    if (!own) return json({ error: "cannot_edit" }, 403);
    const now = new Date().toISOString();
    await supabase.from("care_entries").update({ deleted_at: now, updated_at: now }).eq("id", own.id);
    await touch(group.id, member.id);
    return json({ ok: true, state: await buildState(group, member.id) });
  }

  return json({ error: "unknown_action" }, 400);
});
