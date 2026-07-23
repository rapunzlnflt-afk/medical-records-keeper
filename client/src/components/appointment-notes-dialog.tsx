import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { updateAppointment, createAppointment } from "@/lib/db";
import { requestRemindersSync } from "@/lib/reminder-sync";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NOTE_TEXT_FIELDS } from "@/lib/appointment-notes";
import { NotebookPen, CalendarPlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Appointment, Physician } from "@shared/schema";

const labelClass = "text-base font-body font-semibold text-foreground";

const NOTES_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

type NotesForm = {
  visitSummary: string;
  diagnosisFindings: string;
  providerInstructions: string;
  medicationChanges: string;
  testsOrdered: string;
  referrals: string;
  questionsNextTime: string;
  followUpDate: string;
};

function toForm(a: Appointment): NotesForm {
  return {
    visitSummary: a.visitSummary || "",
    diagnosisFindings: a.diagnosisFindings || "",
    providerInstructions: a.providerInstructions || "",
    medicationChanges: a.medicationChanges || "",
    testsOrdered: a.testsOrdered || "",
    referrals: a.referrals || "",
    questionsNextTime: a.questionsNextTime || "",
    followUpDate: a.followUpDate || "",
  };
}

export function AppointmentNotesDialog({
  appointment,
  physicians,
  patientId,
  open,
  onOpenChange,
  onFollowUpRequested,
}: {
  appointment: Appointment;
  physicians: Physician[];
  patientId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fired after notes save when a new/changed follow-up date was entered. The
  // parent owns the follow-up offer AlertDialog so it survives this dialog (and
  // this whole component) being unmounted by the post-save query invalidation.
  onFollowUpRequested?: (appointment: Appointment, date: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<NotesForm>(() => toForm(appointment));

  const doc = physicians.find((p) => p.id === appointment.physicianId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments", patientId] });
    queryClient.invalidateQueries({ queryKey: ["all-appointments-for-sync"] });
    requestRemindersSync();
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const now = new Date().toISOString();
      const trimmed = {
        visitSummary: form.visitSummary.trim() || null,
        diagnosisFindings: form.diagnosisFindings.trim() || null,
        providerInstructions: form.providerInstructions.trim() || null,
        medicationChanges: form.medicationChanges.trim() || null,
        testsOrdered: form.testsOrdered.trim() || null,
        referrals: form.referrals.trim() || null,
        questionsNextTime: form.questionsNextTime.trim() || null,
        followUpDate: form.followUpDate || null,
      };
      return updateAppointment(appointment.id!, {
        ...trimmed,
        notesCreatedAt: appointment.notesCreatedAt || now,
        notesUpdatedAt: now,
        // Saving notes clears any pending dashboard prompt.
        notesPromptDismissedAt: appointment.notesPromptDismissedAt || null,
      });
    },
    onSuccess: () => {
      const newDate = form.followUpDate;
      const wantsFollowUp = Boolean(newDate) && newDate !== appointment.followUpDate;
      invalidate();
      toast({ title: "Visit notes saved" });
      // Hand the follow-up offer to the parent BEFORE closing. This component
      // is typically rendered as `{open && <AppointmentNotesDialog/>}` by a
      // parent whose list drops this appointment once it gains notes, so it
      // gets unmounted right after save — the parent must own the offer.
      onOpenChange(false);
      if (wantsFollowUp) onFollowUpRequested?.(appointment, newDate);
    },
  });

  const isEdit = Boolean(appointment.notesUpdatedAt);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={NOTES_DIALOG_CLASS}>
          <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
            <DialogTitle className="font-heading text-2xl font-bold text-white flex items-center gap-2">
              <NotebookPen className="w-6 h-6" />
              {isEdit ? "Edit Visit Notes" : "Add Visit Notes"}
            </DialogTitle>
            <DialogDescription className="text-white/85 text-sm">
              {appointment.title}
              {" · "}
              {appointment.date ? format(parseISO(appointment.date), "MMM d, yyyy") : ""}
              {doc ? ` · ${doc.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-4 bg-muted/20">
            <p className="text-sm text-muted-foreground">
              Fill in whatever is relevant — every field is optional.
            </p>
            {NOTE_TEXT_FIELDS.map((field) => (
              <div className="space-y-2" key={field.key}>
                <Label htmlFor={`note-${field.key}`} className={labelClass}>
                  {field.label}
                </Label>
                <Textarea
                  id={`note-${field.key}`}
                  className="text-base min-h-[90px]"
                  value={form[field.key as keyof NotesForm]}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  rows={3}
                  data-testid={`input-note-${field.key}`}
                />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="note-followUpDate" className={labelClass}>
                Follow-up Date
              </Label>
              <Input
                id="note-followUpDate"
                type="date"
                className="h-12 text-base"
                value={form.followUpDate}
                onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                data-testid="input-note-followUpDate"
              />
              <p className="text-xs text-muted-foreground">
                Setting a follow-up date lets you create a new appointment when you save.
              </p>
            </div>
          </div>

          <div
            className="sticky bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
          >
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-12 text-base w-full sm:w-auto sm:min-w-[140px]"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="gradient-primary text-white border-none h-12 text-base font-semibold w-full sm:w-auto sm:min-w-[200px]"
              data-testid="button-note-save"
            >
              {saveMut.isPending ? "Saving..." : "Save Notes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Follow-up offer AlertDialog. Owned by parents (not by AppointmentNotesDialog)
 * so it survives the post-save query invalidation that can unmount the notes
 * dialog and its host. Parents capture the appointment + date in their own
 * state and render this; it is fully self-contained (owns the create mutation).
 */
export function FollowUpOfferDialog({
  appointment,
  date,
  physicians,
  patientId,
  open,
  onOpenChange,
}: {
  appointment: Appointment | null;
  date: string | null;
  physicians: Physician[];
  patientId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const doc = appointment
    ? physicians.find((p) => p.id === appointment.physicianId)
    : undefined;

  const followUpMut = useMutation({
    mutationFn: (d: string) =>
      createAppointment({
        patientId,
        title: appointment?.title ? `Follow-up: ${appointment.title}` : "Follow-up appointment",
        physicianId: appointment?.physicianId ?? null,
        date: d,
        time: appointment?.time || "09:00",
        location: appointment?.location ?? null,
        type: appointment?.type || "checkup",
        status: "upcoming",
        notes: null,
        reminderDate: null,
        reminderTime: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", patientId] });
      queryClient.invalidateQueries({ queryKey: ["all-appointments-for-sync"] });
      requestRemindersSync();
      toast({ title: "Follow-up appointment created" });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading flex items-center gap-2">
            <CalendarPlus className="w-5 h-5 text-primary" />
            Create follow-up appointment?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Add a follow-up appointment
            {doc ? ` with ${doc.name}` : ""} on{" "}
            <span className="font-medium text-foreground">
              {date ? format(parseISO(date), "MMM d, yyyy") : ""}
            </span>
            ? It will show up under Upcoming appointments.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel
            className="h-11 text-base sm:h-10 sm:text-sm mt-0"
            data-testid="button-followup-decline"
          >
            No thanks
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog mounted until the create mutation resolves so
              // its onSuccess can invalidate queries and refresh Upcoming.
              e.preventDefault();
              if (date) followUpMut.mutate(date);
            }}
            disabled={followUpMut.isPending}
            className="h-11 text-base sm:h-10 sm:text-sm gradient-primary text-white border-none font-semibold"
            data-testid="button-followup-confirm"
          >
            {followUpMut.isPending ? "Creating..." : "Create appointment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Read-only display of an appointment's filled-in structured notes. */
export function AppointmentNotesView({ appointment }: { appointment: Appointment }) {
  const rows = NOTE_TEXT_FIELDS.map((f) => ({
    label: f.label,
    value: (appointment[f.key as keyof Appointment] as string | undefined) || "",
  })).filter((r) => r.value.trim() !== "");

  const hasFollowUp = Boolean(appointment.followUpDate);

  if (rows.length === 0 && !hasFollowUp) {
    return <p className="text-sm text-muted-foreground">No notes recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
            {r.label}
          </p>
          <p className="text-sm text-foreground/90 mt-0.5 whitespace-pre-wrap break-words">
            {r.value}
          </p>
        </div>
      ))}
      {hasFollowUp && (
        <div>
          <p className="text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
            Follow-up Date
          </p>
          <p className="text-sm text-foreground/90 mt-0.5">
            {format(parseISO(appointment.followUpDate!), "MMM d, yyyy")}
          </p>
        </div>
      )}
    </div>
  );
}
