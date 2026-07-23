import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { updateAppointment } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotebookPen, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { appointmentHasNotes, hasAppointmentPassed, appointmentStartMs } from "@/lib/appointment-notes";
import { AppointmentNotesDialog, FollowUpOfferDialog } from "@/components/appointment-notes-dialog";
import type { Appointment, Physician } from "@shared/schema";

export function VisitNotesPromptCard({
  appointments,
  physicians,
  patientId,
}: {
  appointments: Appointment[];
  physicians: Physician[];
  patientId: number;
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
    },
  });

  const doc = target ? physicians.find((p) => p.id === target.physicianId) : undefined;
  const who = doc ? doc.name : target?.title;
  const when = target?.date ? format(parseISO(target.date), "MMM d") : "";

  return (
    <>
      {target && (
        <Card
          className="border-l-4 border-l-primary bg-primary/5"
          data-testid="card-visit-notes-prompt"
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                <NotebookPen className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0 basis-full sm:basis-auto">
                <p className="font-heading text-sm font-bold">
                  How did your {when ? `${when} ` : ""}appointment with {who} go?
                </p>
                <p className="font-body text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Would you like to add notes from this visit?
                  {pendingCount > 1 ? ` (${pendingCount} visits need notes)` : ""}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(target);
                  setDialogOpen(true);
                }}
                data-testid="button-visit-notes-add"
              >
                <NotebookPen className="w-3.5 h-3.5 mr-1.5" />
                Add Notes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dismissMut.mutate(target.id!)}
                disabled={dismissMut.isPending}
                className="text-muted-foreground"
                data-testid="button-visit-notes-dismiss"
              >
                Not now
              </Button>
            </div>
          </CardContent>
        </Card>
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
