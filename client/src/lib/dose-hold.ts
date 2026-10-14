// The repeat-dose hold message (log_dose's too_soon outcome), worded as in
// Pawfolio. The server holds a dose taken within half the interval of the last
// one, and says how long ago that was.
import type { LogDoseResult } from "./dose-schedule";

export function holdAgo(r: LogDoseResult | null): string {
  const mins = r?.minutes_ago ?? 0;
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  return `${Math.round(mins / 6) / 10} hours ago`;
}

export function holdTitle(r: LogDoseResult | null): string {
  return `Already taken ${holdAgo(r)}`;
}

export function holdMessage(r: LogDoseResult | null): string {
  const at = r?.last_taken_at ? new Date(r.last_taken_at) : null;
  const when = at ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return `The last dose was recorded${when ? " at " + when : ""}. Record another one now only if it was really taken.`;
}
