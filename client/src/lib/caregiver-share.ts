// Caregiver dose sharing (MedRecords Max).
//
// A port of Pawfolio's sitter sharing. The owner makes one link; each
// caregiver who opens it (caregiver.html) enters a first name and can tap
// Given / Skip on the medications the owner switched on here. Caregivers see
// only those medications: the reminder name, the person's first name, and dose
// times. Nothing else in MedRecords leaves the device.
//
// Server side: dose_groups / dose_members (0005_dose_sharing.sql) and the
// dose-share Edge Function. The owner reads and writes their own rows directly
// under RLS; caregivers never touch tables.

import { format } from "date-fns";
import { getSupabase } from "./supabase";
import { currentUserId, ensureAnonAuth } from "./reminder-sync";
import { createMedicationLog, getMedication, getMedicationLogs, getPatient } from "./db";
import type { DoseSchedule, MissedRule } from "./dose-schedule";

export interface CaregiverGroup {
  id: string;
  created_at: string;
}

export interface CaregiverMember {
  id: string;
  label: string;
  joined_at: string;
  last_seen_at: string | null;
  /** Reminders turned on on the caregiver's phone. */
  reminders: boolean;
}

const OWNER_LABEL_KEY = "mrCaregiverOwnerLabel";
const LINK_KEY = "mrCaregiverLink";
const MIRRORED_KEY = "mrCaregiverMirrored";

function client() {
  const c = getSupabase();
  if (!c) throw new Error("Sharing isn't available in this build.");
  return c;
}

// === The owner's first name, shown to caregivers ("Shared by Shauna") ===

export function getOwnerLabel(): string {
  try {
    return localStorage.getItem(OWNER_LABEL_KEY) || "";
  } catch {
    return "";
  }
}

export function setOwnerLabel(name: string): void {
  try {
    localStorage.setItem(OWNER_LABEL_KEY, name.trim().slice(0, 40));
  } catch {
    /* private mode: the name is only a courtesy */
  }
}

/** First word of a name, for "for Mom" on the caregiver page. */
export function firstName(name: string | null | undefined): string | null {
  const w = (name || "").trim().split(/\s+/)[0];
  return w ? w.slice(0, 40) : null;
}

// === The link ===

/** The current link's token, kept on this phone only (the server stores a hash). */
function savedLink(groupId: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LINK_KEY) || "null");
    return v && v.group === groupId ? (v.token as string) : null;
  } catch {
    return null;
  }
}

export function caregiverUrl(token: string): string {
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
  return `${base}caregiver.html#t=${token}`;
}

/** The saved link for this group, if this phone made it. */
export function linkFor(group: CaregiverGroup): string | null {
  const t = savedLink(group.id);
  return t ? caregiverUrl(t) : null;
}

function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function getActiveGroup(): Promise<{ group: CaregiverGroup | null; members: CaregiverMember[] }> {
  if (!getSupabase() || !(await currentUserId())) return { group: null, members: [] };
  const c = client();
  const { data: groups } = await c
    .from("dose_groups")
    .select("id, created_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const group = (groups ?? [])[0] as CaregiverGroup | undefined;
  if (!group) return { group: null, members: [] };
  const { data: rows } = await c
    .from("dose_members")
    .select("id, label, joined_at, last_seen_at, endpoint")
    .eq("group_id", group.id)
    .is("removed_at", null)
    .order("joined_at", { ascending: true });
  const members = (rows ?? []).map((m: any) => ({
    id: m.id,
    label: m.label,
    joined_at: m.joined_at,
    last_seen_at: m.last_seen_at,
    reminders: !!m.endpoint,
  }));
  return { group, members };
}

/** A fresh link. Any earlier link stops working (one link per owner). */
export async function createGroup(): Promise<{ group: CaregiverGroup; url: string }> {
  const c = client();
  await ensureAnonAuth();
  await c.from("dose_groups").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  const token = randomToken();
  const { data, error } = await c
    .from("dose_groups")
    .insert({ owner_label: getOwnerLabel() || null, token_hash: await sha256Hex(token) })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error("Couldn't make a link. Check your connection and try again.");
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify({ group: data.id, token }));
  } catch {
    /* the link still works; this phone just can't show it again */
  }
  return { group: data as CaregiverGroup, url: caregiverUrl(token) };
}

/** Keep the name caregivers see in step with the owner's setting. */
export async function updateGroupLabel(groupId: string): Promise<void> {
  await client().from("dose_groups").update({ owner_label: getOwnerLabel() || null }).eq("id", groupId);
}

export async function stopSharing(groupId: string): Promise<void> {
  const { error } = await client().from("dose_groups").update({ revoked_at: new Date().toISOString() }).eq("id", groupId);
  if (error) throw new Error("Couldn't stop sharing. Try again.");
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {
    /* ignore */
  }
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await client().from("dose_members").update({ removed_at: new Date().toISOString() }).eq("id", memberId);
  if (error) throw new Error("Couldn't remove them. Try again.");
}

// === Which medications are shared ===

export interface ShareableSchedule {
  schedule: DoseSchedule;
  medName: string;
  personName: string | null;
}

/** Every medication with Dose reminders on, with its local name and person. */
export async function listShareableSchedules(): Promise<ShareableSchedule[]> {
  if (!getSupabase() || !(await currentUserId())) return [];
  const { data } = await client()
    .from("dose_schedules")
    .select("*")
    .eq("enabled", true)
    .order("label", { ascending: true });
  const out: ShareableSchedule[] = [];
  for (const s of (data ?? []) as DoseSchedule[]) {
    const med = await getMedication(s.source_id);
    if (!med) continue;
    const patient = await getPatient(med.patientId);
    out.push({ schedule: s, medName: med.name, personName: firstName(patient?.name) });
  }
  return out;
}

/**
 * Share or stop sharing one medication. Sharing also sends the person's first
 * name, so a caregiver helping two people can tell whose dose it is; stopping
 * clears it again, back to the reminder-only default.
 */
export async function setShared(item: ShareableSchedule, shared: boolean): Promise<void> {
  const { error } = await client()
    .from("dose_schedules")
    .update({ shared, subject_name: shared ? item.personName : null, updated_at: new Date().toISOString() })
    .eq("id", item.schedule.id);
  if (error) throw new Error("Couldn't change sharing for this medication. Try again.");
}

export async function setMissedRule(scheduleId: string, rule: MissedRule | null, note: string | null): Promise<void> {
  const { error } = await client()
    .from("dose_schedules")
    .update({
      missed_rule: rule,
      missed_note: rule === "note" ? (note || "").trim().slice(0, 300) || null : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId);
  if (error) throw new Error("Couldn't save that. Try again.");
}

// === Bringing caregiver doses into the local history ===

function mirroredIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MIRRORED_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Copy doses a caregiver logged into this phone's medication log, so they show
 * in History, printouts and backups like any other dose ("Given by Dana").
 * Waits 30 minutes after the tap, which is when the caregiver can no longer
 * Undo or change the time, so only settled doses are copied, once each.
 * Returns how many were added.
 */
export async function syncCaregiverDoses(): Promise<number> {
  if (!getSupabase() || !(await currentUserId())) return 0;
  const settled = new Date(Date.now() - 30 * 60000).toISOString();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await client()
    .from("dose_events")
    .select("id, status, taken_at, logged_at, due_at, actor_label, recorded_late, dose_schedules!inner(source_id)")
    .not("actor_member", "is", null)
    .in("status", ["taken", "skipped"])
    .gte("logged_at", since)
    .lte("logged_at", settled)
    .limit(200);
  if (error || !data) return 0;
  const done = new Set(mirroredIds());
  let added = 0;
  for (const ev of data as any[]) {
    if (done.has(ev.id)) continue;
    try {
      const med = await getMedication(ev.dose_schedules.source_id);
      if (med) {
        const at = new Date(ev.taken_at || ev.due_at);
        const who = (ev.actor_label || "").trim() || "a caregiver";
        const verb = ev.status === "taken" ? "Given" : "Skipped";
        const entry = {
          medicationId: med.id!,
          date: format(at, "yyyy-MM-dd"),
          taken: ev.status === "taken" ? 1 : 0,
          time: format(at, "HH:mm"),
          notes: `${verb} by ${who}${ev.recorded_late ? " (recorded later)" : ""}`,
        };
        // Also matched against the log itself, so a cleared browser or a
        // restored backup can't copy the same dose in twice.
        const existing = await getMedicationLogs(med.id!);
        const dup = existing.some(
          (l) => l.date === entry.date && l.time === entry.time && l.taken === entry.taken && l.notes === entry.notes,
        );
        if (!dup) {
          await createMedicationLog(entry);
          added++;
        }
      }
      done.add(ev.id);
    } catch {
      /* try again next time */
    }
  }
  try {
    localStorage.setItem(MIRRORED_KEY, JSON.stringify(Array.from(done).slice(-1000)));
  } catch {
    /* ignore */
  }
  return added;
}

/** The latest dose a caregiver logged for one schedule, for "Given by Dana at 2:14 PM". */
export async function latestCaregiverDose(
  scheduleId: string,
): Promise<{ status: string; at: string; who: string } | null> {
  if (!getSupabase() || !(await currentUserId())) return null;
  const { data } = await client()
    .from("dose_events")
    .select("status, taken_at, logged_at, due_at, actor_label, actor_member")
    .eq("schedule_id", scheduleId)
    .in("status", ["taken", "skipped"])
    .order("logged_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const ev = (data ?? [])[0] as any;
  if (!ev || !ev.actor_member) return null;
  return { status: ev.status, at: ev.taken_at || ev.logged_at || ev.due_at, who: (ev.actor_label || "").trim() || "a caregiver" };
}
