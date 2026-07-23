import type { Appointment } from "@shared/schema";

// The eight structured free-text note fields (followUpDate is handled
// separately as a date input). Order here drives the form and read-only view.
export const NOTE_TEXT_FIELDS = [
  {
    key: "visitSummary",
    label: "Visit Summary",
    placeholder: "What happened during this visit?",
  },
  {
    key: "diagnosisFindings",
    label: "Diagnosis & Findings",
    placeholder: "Any diagnoses, results, or findings discussed",
  },
  {
    key: "providerInstructions",
    label: "Provider Instructions",
    placeholder: "What the provider asked you to do",
  },
  {
    key: "medicationChanges",
    label: "Medication Changes",
    placeholder: "New prescriptions, dose changes, or stops",
  },
  {
    key: "testsOrdered",
    label: "Tests Ordered",
    placeholder: "Labs, imaging, or other tests ordered",
  },
  {
    key: "referrals",
    label: "Referrals",
    placeholder: "Specialists or services you were referred to",
  },
  {
    key: "questionsNextTime",
    label: "Questions for Next Time",
    placeholder: "Things to ask at your next visit",
  },
] as const;

export type NoteTextFieldKey = (typeof NOTE_TEXT_FIELDS)[number]["key"];

// Every field that makes an appointment "have notes".
const NOTE_CONTENT_KEYS: (keyof Appointment)[] = [
  ...NOTE_TEXT_FIELDS.map((f) => f.key as keyof Appointment),
  "followUpDate",
];

/** An appointment "has notes" if any structured note field is non-empty. */
export function appointmentHasNotes(a: Appointment): boolean {
  return NOTE_CONTENT_KEYS.some((k) => {
    const v = a[k];
    return typeof v === "string" && v.trim() !== "";
  });
}

// Numeric "start time" for an appointment using the same wall-clock
// interpretation the dashboard and appointments page already use. End-of-day
// fallback for a missing time keeps all-day items from expiring at midnight.
export function appointmentStartMs(a: Appointment): number {
  const date = (a.date || "").trim();
  if (!date) return Number.POSITIVE_INFINITY;
  const raw = (a.time || "").trim();
  let hh = 23,
    mm = 59;
  const m = raw.match(/^(\d{1,2}):(\d{1,2})/);
  if (m) {
    hh = Math.min(23, Math.max(0, Number(m[1])));
    mm = Math.min(59, Math.max(0, Number(m[2])));
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = new Date(`${date}T${pad(hh)}:${pad(mm)}:00`).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** True once an appointment's scheduled date+time has passed. */
export function hasAppointmentPassed(a: Appointment): boolean {
  return appointmentStartMs(a) < Date.now();
}
