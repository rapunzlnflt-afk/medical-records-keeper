// MedRecords Care: sharing the care log with caregivers.
//
// Caregivers use the same link as dose sharing (caregiver-share.ts). For each
// person the owner switches on, the server keeps only a first name and the
// condition names (when the owner shares conditions). Caregivers log entries
// through the care-share Edge Function; this phone copies each one into the
// local Care Log once it is settled (30 minutes, when the caregiver can no
// longer edit it), so it shows in backups and printouts like any other entry.
//
// Entries the owner logs on this phone stay on this phone.
//
// Server side: care_people / care_entries (0006_care_log.sql).

import type { CareEntry, Patient } from "@shared/schema";
import { getSupabase } from "./supabase";
import { currentUserId, ensureAnonAuth } from "./reminder-sync";
import { createCareEntry, getPatients, hasCareEntrySource } from "./db";
import { firstName } from "./caregiver-share";
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

/** Whether this person's care log is shared. False when sharing was never set up. */
export async function isCareShared(patientId: number): Promise<boolean> {
  if (!getSupabase() || !(await currentUserId())) return false;
  const { data } = await client()
    .from("care_people")
    .select("shared")
    .eq("local_id", patientId)
    .maybeSingle();
  return !!data?.shared;
}

/** Switch care-log sharing on or off for one person. */
export async function setCareShared(p: Patient, shared: boolean): Promise<void> {
  const owner = await ensureAnonAuth();
  const { error } = await client()
    .from("care_people")
    .upsert({ ...personRow(p), owner_user: owner, shared }, { onConflict: "owner_user,local_id" });
  if (error) throw new Error("Couldn't save that. Check your connection and try again.");
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
