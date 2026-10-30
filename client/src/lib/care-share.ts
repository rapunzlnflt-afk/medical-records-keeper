// MedRecords Care: sharing the care log with caregivers.
//
// Caregivers use the same link as dose sharing (caregiver-share.ts). For each
// person the owner switches on, the server keeps only a first name and the
// condition names (when the owner shares conditions). Caregivers log entries
// through the care-share Edge Function; this phone copies each one into the
// local Care Log once it is settled (30 minutes, when the caregiver can no
// longer edit it), so it shows in backups and printouts like any other entry.
//
// Entries the owner logs on this phone stay on this phone, unless she turns
// on "Caregivers see entries I log" for that person (off by default). Then
// the last two days of her own entries are kept on the server too, marked
// with owner_local_id, so caregivers see them. Turning it off removes them.
//
// Server side: care_people / care_entries (0006_care_log.sql).

import type { CareEntry, Patient } from "@shared/schema";
import { getSupabase } from "./supabase";
import { currentUserId, ensureAnonAuth } from "./reminder-sync";
import { createCareEntry, getCareEntries, getPatients, hasCareEntrySource } from "./db";
import { firstName, getOwnerLabel } from "./caregiver-share";
import { conditionLabels, conditionsShared, localStamp } from "./care";

const MIRRORED_KEY = "mrCareMirrored";
/** Matches EDIT_MS in the care-share function. */
const SETTLE_MS = 30 * 60000;

/** A caregiver entry still on the server, shown live in the Care Log. */
export type CloudCareEntry = CareEntry & { cloudId: string; settled: boolean };

function client() {
  const c = getSupabase();
  if (!c) throw new Error("Sharing isn't available in this build.");
  return c;
}

function personRow(p: Patient) {
  return {
    local_id: p.id!,
    name: firstName(p.name) || "Family member",
    conditions: conditionsShared(p) ? conditionLabels(p).slice(0, 20).map((c) => c.slice(0, 60)) : [],
    updated_at: new Date().toISOString(),
  };
}

export type CareShareState = { shared: boolean; ownerEntries: boolean };

/** Whether this person's care log is shared, and whether the owner's own entries are. */
export async function getCareShare(patientId: number): Promise<CareShareState> {
  if (!getSupabase() || !(await currentUserId())) return { shared: false, ownerEntries: false };
  const { data } = await client()
    .from("care_people")
    .select("shared, share_owner_entries")
    .eq("local_id", patientId)
    .maybeSingle();
  return { shared: !!data?.shared, ownerEntries: !!data?.shared && !!data?.share_owner_entries };
}

/** Whether this person's care log is shared. False when sharing was never set up. */
export async function isCareShared(patientId: number): Promise<boolean> {
  return (await getCareShare(patientId)).shared;
}

/** Switch care-log sharing on or off for one person. */
export async function setCareShared(p: Patient, shared: boolean): Promise<void> {
  const owner = await ensureAnonAuth();
  const { error } = await client()
    .from("care_people")
    .upsert({ ...personRow(p), owner_user: owner, shared }, { onConflict: "owner_user,local_id" });
  if (error) throw new Error("Couldn't save that. Check your connection and try again.");
  // Turning sharing off hides the owner's copies at once; drop them too.
  if (!shared) await syncOwnerEntries(p.id!).catch(() => {});
}

/** "Caregivers see entries I log" for one person. Off removes every copy. */
export async function setOwnerEntriesShared(p: Patient, on: boolean): Promise<void> {
  await ensureAnonAuth();
  const { error } = await client()
    .from("care_people")
    .update({ share_owner_entries: on, updated_at: new Date().toISOString() })
    .eq("local_id", p.id!);
  if (error) throw new Error("Couldn't save that. Check your connection and try again.");
  await syncOwnerEntries(p.id!);
}

/** How far back the owner's entries are kept on the server (matches the caregiver view). */
const OWNER_WINDOW_DAYS = 2;

function ownerRow(e: CareEntry, personId: string, ownerUser: string) {
  const n = <T,>(v: T | undefined) => (v === undefined ? null : v);
  return {
    person_id: personId,
    owner_user: ownerUser,
    owner_local_id: e.id!,
    member_id: null,
    actor_label: ((e.loggedBy || getOwnerLabel() || "").trim() || null)?.slice(0, 40) ?? null,
    at: new Date(e.at).toISOString(),
    kind: e.kind,
    status: e.status,
    meal: n(e.meal) ?? null,
    amount: n(e.amount) ?? null,
    therapy: n(e.therapy) ?? null,
    minutes: n(e.minutes) ?? null,
    task: n(e.task) ?? null,
    help: n(e.help) ?? null,
    score: n(e.score) ?? null,
    level: n(e.level) ?? null,
    reason: n(e.reason) ?? null,
    details: e.details ? e.details.slice(0, 300) : null,
    note: e.note ? e.note.slice(0, 1000) : null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Bring the server copies of the owner's own entries for one person in step
 * with this phone: the last two days when her switch is on, nothing when it
 * is off. Safe to run any time; called after each save or delete, when the
 * switch changes, and when the app opens.
 */
export async function syncOwnerEntries(patientId: number): Promise<void> {
  if (!getSupabase()) return;
  const owner = await currentUserId();
  if (!owner) return;
  const c = client();
  const { data: person } = await c
    .from("care_people")
    .select("id, shared, share_owner_entries")
    .eq("local_id", patientId)
    .maybeSingle();
  if (!person) return;
  const { data: copies } = await c
    .from("care_entries")
    .select("id, owner_local_id")
    .eq("person_id", person.id)
    .not("owner_local_id", "is", null);
  const existing = (copies ?? []) as { id: string; owner_local_id: number }[];

  let keep: CareEntry[] = [];
  if (person.shared && person.share_owner_entries) {
    const from = new Date(Date.now() - OWNER_WINDOW_DAYS * 86400000);
    const to = new Date(Date.now() + 86400000);
    // Only entries logged on this phone; caregiver entries copied here carry a sourceId.
    keep = (await getCareEntries(patientId, localStamp(from), localStamp(to))).filter((e) => !e.sourceId && e.id != null);
  }
  if (keep.length) {
    const { error } = await c
      .from("care_entries")
      .upsert(keep.map((e) => ownerRow(e, person.id, owner)), { onConflict: "person_id,owner_local_id" });
    if (error) throw new Error("Couldn't update what caregivers see.");
  }
  const keepIds = new Set(keep.map((e) => e.id));
  const stale = existing.filter((r) => !keepIds.has(r.owner_local_id)).map((r) => r.id);
  if (stale.length) await c.from("care_entries").delete().in("id", stale);
}

/** syncOwnerEntries for everyone this phone shares a care log for. */
export async function syncAllOwnerEntries(): Promise<void> {
  if (!getSupabase() || !(await currentUserId())) return;
  const { data } = await client().from("care_people").select("local_id");
  for (const r of (data ?? []) as { local_id: number }[]) await syncOwnerEntries(r.local_id).catch(() => {});
}

/**
 * Keep names and conditions on the server in step with this phone (after a
 * Profile edit, and when the app opens). Only touches people already set up;
 * removes rows for people deleted here.
 */
export async function syncCarePeople(): Promise<void> {
  if (!getSupabase() || !(await currentUserId())) return;
  const c = client();
  const { data } = await c.from("care_people").select("id, local_id, name, conditions");
  if (!data?.length) return;
  const patients = await getPatients();
  for (const row of data as { id: string; local_id: number; name: string; conditions: string[] }[]) {
    const p = patients.find((x) => x.id === row.local_id);
    if (!p) {
      // Deleted on this phone: stop sharing and drop the server copy.
      await c.from("care_people").delete().eq("id", row.id);
      continue;
    }
    const next = personRow(p);
    if (next.name !== row.name || next.conditions.join("\u0001") !== (row.conditions || []).join("\u0001")) {
      await c.from("care_people").update(next).eq("id", row.id);
    }
  }
}

function toEntry(r: any, patientId: number): CareEntry {
  const nn = <T,>(v: T | null | undefined) => (v === null ? undefined : v);
  return {
    patientId,
    at: localStamp(new Date(r.at)),
    kind: r.kind,
    status: r.status,
    meal: nn(r.meal),
    amount: r.amount,
    therapy: nn(r.therapy),
    minutes: r.minutes,
    task: nn(r.task),
    help: r.help,
    score: r.score,
    level: r.level,
    reason: r.reason,
    details: r.details,
    note: r.note,
    loggedBy: (r.actor_label || "").trim() || "A caregiver",
    createdAt: r.created_at,
    sourceId: r.id,
  };
}

const ENTRY_COLS = "id, at, kind, status, meal, amount, therapy, minutes, task, help, score, level, reason, details, note, actor_label, created_at";

/**
 * Caregiver entries for one person and local day ("YYYY-MM-DD") that this
 * phone hasn't copied yet, so the Care Log shows them right away.
 */
export async function fetchCaregiverEntries(patientId: number, day: string): Promise<CloudCareEntry[]> {
  if (!getSupabase() || !(await currentUserId())) return [];
  const [y, m, d] = day.split("-").map(Number);
  const from = new Date(y, m - 1, d).toISOString();
  const to = new Date(y, m - 1, d + 1).toISOString();
  const { data, error } = await client()
    .from("care_entries")
    .select(`${ENTRY_COLS}, care_people!inner(local_id)`)
    .eq("care_people.local_id", patientId)
    .is("owner_local_id", null)
    .is("deleted_at", null)
    .gte("at", from)
    .lt("at", to)
    .order("at", { ascending: true })
    .limit(200);
  if (error || !data) return [];
  const out: CloudCareEntry[] = [];
  for (const r of data as any[]) {
    if (await hasCareEntrySource(r.id)) continue;
    out.push({ ...toEntry(r, patientId), cloudId: r.id, settled: Date.now() - new Date(r.created_at).getTime() >= SETTLE_MS });
  }
  return out;
}

function mirroredIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MIRRORED_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Copy settled caregiver entries into the local Care Log, once each. Returns how many were added. */
export async function syncCareEntries(): Promise<number> {
  if (!getSupabase() || !(await currentUserId())) return 0;
  const settled = new Date(Date.now() - SETTLE_MS).toISOString();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await client()
    .from("care_entries")
    .select(`${ENTRY_COLS}, care_people!inner(local_id)`)
    .is("owner_local_id", null)
    .is("deleted_at", null)
    .gte("created_at", since)
    .lte("created_at", settled)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error || !data) return 0;
  const patients = new Set((await getPatients()).map((p) => p.id));
  const done = new Set(mirroredIds());
  let added = 0;
  for (const r of data as any[]) {
    if (done.has(r.id)) continue;
    try {
      const pid = r.care_people?.local_id as number;
      if (patients.has(pid) && !(await hasCareEntrySource(r.id))) {
        await createCareEntry(toEntry(r, pid));
        added++;
      }
      done.add(r.id);
    } catch {
      /* try again next time */
    }
  }
  try {
    localStorage.setItem(MIRRORED_KEY, JSON.stringify(Array.from(done).slice(-2000)));
  } catch {
    /* hasCareEntrySource still prevents doubles */
  }
  return added;
}
