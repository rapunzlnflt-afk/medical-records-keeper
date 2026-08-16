import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { updateAppointment } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { NoticeStrip, NOTICE_ACTION_CLASS } from "@/components/notice-strip";
import { NotebookPen } from "lucide-react";
import { format, parseISO } from "date-fns";
import { appointmentHasNotes, hasAppointmentPassed, appointmentStartMs } from "@/lib/appointment-notes";
import { AppointmentNotesDialog, FollowUpOfferDialog } from "@/components/appointment-notes-dialog";
import type { Appointment, Physician } from "@shared/schema";

export function VisitNotesPromptCard({
  appointments,
  physicians,
  patientId,
  onResolved,
}: {
  appointments: Appointment[];
  physicians: Physician[];
  patientId: number;
  onResolved?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Snapshot of the appointment being edited, captured on open so the notes
  // dialog stays stable even if `target` changes underneath it.
  const [editing, setEditing] = useState<Appointment | null>(null);
  // Parent-owned follow-up offer, kept alive independently of `target` so the
  // post-save invalidation (which drops this appointment from the "needs
  // notes" list) can't unmount it.
  const [pendingFollowUp, setPendingFollowUp] = useState<{
    appointment: Appointment;
    date: string;
  } | null>(null);

  // Most recent past appointment that has no notes yet and whose prompt the
  // user hasn't dismissed.
  const target = useMemo(() => {
    return appointments
      .filter(
        (a) =>
          hasAppointmentPassed(a) &&
          a.status !== "cancelled" &&
          !appointmentHasNotes(a) &&
          !a.notesPromptDismissedAt,
      )
      .sort((a, b) => appointmentStartMs(b) - appointmentStartMs(a))[0];
  }, [appointments]);

  const pendingCount = useMemo(
    () =>
      appointments.filter(
        (a) =>
          hasAppointmentPassed(a) &&
          a.status !== "cancelled" &&
          !appointmentHasNotes(a) &&
          !a.notesPromptDismissedAt,
      ).length,
    [appointments],
  );

  const dismissMut = useMutation({
    mutationFn: (id: number) =>
      updateAppointment(id, { notesPromptDismissedAt: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", patientId] });
      onResolved?.();
    },
  });

  const doc = target ? physicians.find((p) => p.id === target.physicianId) : undefined;
  const who = doc ? doc.name : target?.title;
  const when = target?.date ? format(parseISO(target.date), "MMM d") : "";

  return (
    <>
      {target && (
        <NoticeStrip
          icon={NotebookPen}
          title={`How did your ${when ? `${when} ` : ""}appointment with ${who} go?`}
          body={`Add notes while it's fresh.${pendingCount > 1 ? ` ${pendingCount} visits need notes.` : ""}`}
          testId="card-visit-notes-prompt"
          dismissTitle="Not now"
          onDismiss={dismissMut.isPending ? undefined : () => dismissMut.mutate(target.id!)}
          action={
            <Button
              size="sm"
              className={NOTICE_ACTION_CLASS}
              onClick={() => {
                setEditing(target);
                setDialogOpen(true);
              }}
              data-testid="button-visit-notes-add"
            >
              <NotebookPen className="w-3.5 h-3.5 mr-1.5" />
              Add Notes
            </Button>
          }
        />
      )}

      {dialogOpen && editing && (
        <AppointmentNotesDialog
          appointment={editing}
          physicians={physicians}
          patientId={patientId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onFollowUpRequested={(appointment, date) =>
            setPendingFollowUp({ appointment, date })
          }
        />
      )}

      <FollowUpOfferDialog
        appointment={pendingFollowUp?.appointment ?? null}
        date={pendingFollowUp?.date ?? null}
        physicians={physicians}
        patientId={patientId}
        open={pendingFollowUp !== null}
        onOpenChange={(o) => {
          if (!o) setPendingFollowUp(null);
        }}
      />
    </>
  );
}
