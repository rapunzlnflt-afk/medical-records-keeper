// MedRecords Care: the vocabulary for the care log and health conditions.
// Keys are stored in records and backups, so never rename a key; change the
// label instead.

import type { CareEntry, Patient } from "@shared/schema";

export type Option = { key: string; label: string };

export const MEALS: Option[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

export const AMOUNTS: Option[] = [
  { key: "all", label: "Ate all" },
  { key: "most", label: "Most" },
  { key: "some", label: "Some" },
  { key: "little", label: "A little" },
];

export const THERAPIES: Option[] = [
  { key: "PT", label: "Physical therapy" },
  { key: "OT", label: "Occupational therapy" },
];

export const MINUTES = [15, 30, 45, 60];

export const TASKS: Option[] = [
  { key: "bathing", label: "Bathing" },
  { key: "dressing", label: "Changing clothes" },
  { key: "toileting", label: "Toileting / cleaning" },
  { key: "grooming", label: "Grooming" },
];

export const HELP_LEVELS: Option[] = [
  { key: "none", label: "No help" },
  { key: "some", label: "Some help" },
  { key: "full", label: "Full help" },
];

/** Ordered best to most concerning; the index drives the "big change" note. */
export const AWARENESS: Option[] = [
  { key: "alert", label: "Alert and talkative" },
  { key: "quiet", label: "Alert but quiet" },
  { key: "confused-sometimes", label: "Confused at times" },
  { key: "very-confused", label: "Very confused" },
  { key: "drowsy", label: "Drowsy, hard to wake" },
  { key: "unable", label: "Unable to communicate" },
];

export const DECLINE_REASONS: Option[] = [
  { key: "tired", label: "Tired" },
  { key: "pain", label: "In pain" },
  { key: "asleep", label: "Asleep" },
  { key: "refused", label: "Refused" },
  { key: "sick", label: "Felt sick" },
  { key: "not-hungry", label: "Not hungry" },
];

export const CONDITIONS: Option[] = [
  { key: "heart-failure", label: "Heart failure" },
  { key: "kidney", label: "Kidney disease / failure" },
  { key: "stroke", label: "Stroke" },
  { key: "copd", label: "COPD" },
  { key: "asthma", label: "Asthma" },
  { key: "lung-other", label: "Other lung condition" },
  { key: "cancer", label: "Cancer" },
  { key: "dementia", label: "Dementia / memory loss" },
  { key: "diabetes", label: "Diabetes" },
  { key: "parkinsons", label: "Parkinson's" },
  { key: "other", label: "Other" },
];

export const CANCER_TYPES: Option[] = [
  { key: "breast", label: "Breast" },
  { key: "lung", label: "Lung" },
  { key: "prostate", label: "Prostate" },
  { key: "colorectal", label: "Colon / rectal" },
  { key: "pancreatic", label: "Pancreatic" },
  { key: "skin", label: "Skin / melanoma" },
  { key: "blood", label: "Blood (leukemia, lymphoma, myeloma)" },
  { key: "bladder-kidney", label: "Bladder / kidney" },
  { key: "brain", label: "Brain" },
  { key: "ovarian-uterine", label: "Ovarian / uterine" },
  { key: "other", label: "Other" },
];

export function labelOf(list: Option[], key: string | null | undefined): string {
  return list.find((o) => o.key === key)?.label ?? (key || "");
}

/** Readable condition names for one person, cancer with its type. */
export function conditionLabels(p: Pick<Patient, "careConditions" | "cancerType" | "careConditionOther">): string[] {
  return (p.careConditions || []).map((k) => {
    if (k === "cancer" && p.cancerType) {
      const t = labelOf(CANCER_TYPES, p.cancerType);
      return p.cancerType === "other" ? "Cancer" : `Cancer (${t.toLowerCase()})`;
    }
    if (k === "other") {
      const t = p.careConditionOther?.trim();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Other";
    }
    return labelOf(CONDITIONS, k);
  });
}

export function conditionsShared(p: Pick<Patient, "careConditionsShared">): boolean {
  return p.careConditionsShared !== false;
}

/* ---------- mood ---------- */

export function moodBand(score: number): "hard" | "okay" | "good" {
  return score <= 3 ? "hard" : score <= 6 ? "okay" : "good";
}

export function moodWord(score: number): string {
  return { hard: "Hard day", okay: "Okay day", good: "Good day" }[moodBand(score)];
}

export function moodClass(score: number): string {
  switch (moodBand(score)) {
    case "hard":
      return "bg-rose-500/12 text-rose-800 border-rose-500/30 dark:bg-rose-300/15 dark:text-rose-100 dark:border-rose-300/35";
    case "okay":
      return "bg-amber-500/12 text-amber-800 border-amber-600/30 dark:bg-amber-300/15 dark:text-amber-100 dark:border-amber-300/35";
    default:
      return "bg-emerald-500/12 text-emerald-800 border-emerald-600/30 dark:bg-emerald-300/15 dark:text-emerald-100 dark:border-emerald-300/35";
  }
}

/* ---------- time ---------- */

const pad = (n: number) => String(n).padStart(2, "0");

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localStamp(d = new Date()): string {
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + by));
}

export function timeLabel(at: string): string {
  const [h, m] = at.slice(11, 16).split(":").map(Number);
  if (Number.isNaN(h)) return "";
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${pad(m)} ${ap}`;
}

/* ---------- one-line summaries ---------- */

export function entryTitle(e: CareEntry): string {
  switch (e.kind) {
    case "meal":
      return labelOf(MEALS, e.meal);
    case "therapy":
      return labelOf(THERAPIES, e.therapy);
    case "personal":
      return labelOf(TASKS, e.task);
    case "mood":
      return "How they're doing";
    case "awareness":
      return "Awareness";
  }
}

export function entrySummary(e: CareEntry): string {
  const declined = e.reason ? `Declined · ${labelOf(DECLINE_REASONS, e.reason)}` : "Declined";
  switch (e.kind) {
    case "meal":
      if (e.status === "declined") return declined;
      return labelOf(AMOUNTS, e.amount) || "Ate";
    case "therapy": {
      if (e.status === "declined") return declined;
      const mins = e.minutes ? `${e.minutes} min` : "";
      const st = e.status === "partial" ? "Partial session" : "Completed";
      return [st, mins].filter(Boolean).join(" · ");
    }
    case "personal":
      if (e.status === "declined") return declined;
      return labelOf(HELP_LEVELS, e.help) || "Done";
    case "mood":
      return e.score ? `${e.score} / 10 · ${moodWord(e.score)}` : "";
    case "awareness":
      return labelOf(AWARENESS, e.level);
  }
}

/** True when this awareness check is at least two steps worse than the one before it. */
export function bigAwarenessDrop(current: string | null | undefined, previous: string | null | undefined): boolean {
  const a = AWARENESS.findIndex((o) => o.key === current);
  const b = AWARENESS.findIndex((o) => o.key === previous);
  return a >= 0 && b >= 0 && a - b >= 2;
}
