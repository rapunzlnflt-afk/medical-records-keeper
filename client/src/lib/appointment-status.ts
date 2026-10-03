import type { Appointment } from "@shared/schema";

// An appointment's status comes from its date and time. The only thing the
// date can't tell us is a cancellation, so that is the one status the user
// sets. Older data may also hold "completed" or a stale "upcoming"; both are
// read through the date, never shown as-is.

// Numeric sort key for appointments — same wall-clock interpretation the
// dashboard uses so both pages order "next-one-first" identically. Tolerates
// loose time strings ("9:30", " 9:30 ", "") that may exist in legacy data;
// returns +Infinity for unparseable dates so they sink to the bottom rather
// than landing at the top.
export function appointmentStartMs(a: Appointment): number {
  const date = (a.date || "").trim();
  if (!date) return Number.POSITIVE_INFINITY;
  const raw = (a.time || "").trim();
  let hh = 23, mm = 59;
  const m = raw.match(/^(\d{1,2}):(\d{1,2})/);
  if (m) {
    hh = Math.min(23, Math.max(0, Number(m[1])));
    mm = Math.min(59, Math.max(0, Number(m[2])));
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = new Date(`${date}T${pad(hh)}:${pad(mm)}:00`).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export function hasAppointmentPassed(a: Appointment): boolean {
  return appointmentStartMs(a) < Date.now();
}

export type AppointmentState = "upcoming" | "past" | "cancelled";

export function appointmentState(a: Appointment): AppointmentState {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed" || hasAppointmentPassed(a)) return "past";
  return "upcoming";
}

export const APPOINTMENT_STATE_LABEL: Record<AppointmentState, string> = {
  upcoming: "Upcoming",
  past: "Past visit",
  cancelled: "Cancelled",
};

export const APPOINTMENT_STATE_CLASS: Record<AppointmentState, string> = {
  upcoming: "status-upcoming",
  past: "status-completed",
  cancelled: "status-cancelled",
};

export function appointmentStatusLabel(a: Appointment): string {
  return APPOINTMENT_STATE_LABEL[appointmentState(a)];
}
