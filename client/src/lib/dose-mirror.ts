// Mirroring a server-recorded dose back into the local medication log.
//
// Shared by the notification confirm sheet and the medication card, which both
// record doses and must both leave the same local trace. Kept in its own module
// so the two callers cannot drift apart.

import { format } from "date-fns";
import { createMedicationLog, getMedication } from "@/lib/db";
import type { DoseSchedule } from "@/lib/dose-schedule";

/**
 * Mirror a server-recorded dose into the local medication log.
 *
 * The server schedules; the browser remains the record of truth. Without this
 * the dose would be missing from the medication's local history, its printout,
 * and its backup — the things the app actually promises to keep. Failure is
 * swallowed: the dose is already recorded server-side and the schedule has
 * moved on, so a local write failure must not present as a failed dose.
 */
export async function mirrorDoseLocally(
  schedule: DoseSchedule,
  taken: boolean,
  at: Date,
): Promise<void> {
  try {
    const med = await getMedication(schedule.source_id);
    if (!med) return;
    await createMedicationLog({
      medicationId: schedule.source_id,
      date: format(at, "yyyy-MM-dd"),
      taken: taken ? 1 : 0,
      time: format(at, "HH:mm"),
      notes: null,
    });
  } catch {
    // Intentionally silent — see above.
  }
}
