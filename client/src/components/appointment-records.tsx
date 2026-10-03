import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Paperclip, Plus, Link2, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { getMedicalRecords, createMedicalRecord, updateMedicalRecord } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RecordForm } from "@/components/record-form";
import type { Appointment, MedicalRecord, Physician } from "@shared/schema";

// Mirrors Pawfolio's vet-visit attachments: records attached to an appointment show
// as chips on its card (tap to open the record), and "Attach record" lets you add a
// new record already linked to the visit, or link one you already have.

function fmtDate(d?: string | null) {
  if (!d) return "";
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

export function appointmentLabel(apt: Appointment) {
  return `${(apt.title || "Appointment").trim()} · ${fmtDate(apt.date)}`;
}

function useRecords(patientId: number) {
  return useQuery<MedicalRecord[]>({
    queryKey: ["medical-records", patientId],
    queryFn: () => getMedicalRecords(patientId),
  });
}

export function AppointmentRecords({ apt, patientId, physicians, canAttach }: {
  apt: Appointment;
  patientId: number;
  physicians: Physician[];
  canAttach: boolean;
}) {
  const { data: records = [] } = useRecords(patientId);
  const [open, setOpen] = useState(false);
  const attached = records.filter((r) => r.appointmentId === apt.id);
  if (!attached.length && !canAttach) return null;

  return (
    <div className="mt-1.5 min-w-0" data-testid={`apt-records-${apt.id}`}>
      {attached.length > 0 && (
        <div className="space-y-1.5 min-w-0">
          {attached.map((r) => (
            <div key={r.id}>
              <Link
                href={`/records/${r.id}`}
                className="inline-block max-w-full rounded-2xl border border-primary/30 bg-primary/5 px-2.5 py-1 text-sm font-semibold leading-snug text-primary break-words"
                data-testid={`apt-record-chip-${r.id}`}
              >
                <Paperclip className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
                {r.title}
              </Link>
            </div>
          ))}
        </div>
      )}
      {canAttach && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 mt-1.5"
          onClick={() => setOpen(true)}
          data-testid={`button-apt-attach-${apt.id}`}
        >
          <Paperclip className="w-4 h-4 mr-1.5" />
          {attached.length ? "Attach another record" : "Attach record"}
        </Button>
      )}
      {open && (
        <AttachRecordDialog
          apt={apt}
          patientId={patientId}
          physicians={physicians}
          records={records}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}

function AttachRecordDialog({ apt, patientId, physicians, records, open, onOpenChange }: {
  apt: Appointment;
  patientId: number;
  physicians: Physician[];
  records: MedicalRecord[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"choose" | "new">("choose");
  const [pick, setPick] = useState<string>("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["medical-records", patientId] });

  const attached = records.filter((r) => r.appointmentId === apt.id);
  const others = records
    .filter((r) => r.appointmentId !== apt.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const createMut = useMutation({
    mutationFn: (data: any) => createMedicalRecord({ ...data, patientId, appointmentId: apt.id }),
    onSuccess: () => { invalidate(); onOpenChange(false); toast({ title: "Record added to this appointment" }); },
  });
  const linkMut = useMutation({
    mutationFn: (id: number) => updateMedicalRecord(id, { appointmentId: apt.id }),
    onSuccess: () => { invalidate(); setPick(""); toast({ title: "Record attached" }); },
  });
  const unlinkMut = useMutation({
    mutationFn: (id: number) => updateMedicalRecord(id, { appointmentId: null }),
    onSuccess: () => { invalidate(); toast({ title: "Record removed from this appointment" }); },
  });

  const prefill: Partial<MedicalRecord> = {
    title: `${(apt.title || "Visit").trim()} — ${fmtDate(apt.date)}`,
    date: apt.date,
    physicianId: apt.physicianId,
    category: "other",
    notes: `From appointment on ${fmtDate(apt.date)}`,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="font-heading">
            {mode === "new" ? "New record for this appointment" : "Attach a record"}
          </DialogTitle>
          <DialogDescription className="break-words">{appointmentLabel(apt)}</DialogDescription>
        </DialogHeader>

        {mode === "new" ? (
          <RecordForm
            physicians={physicians}
            initial={prefill}
            onSubmit={(data) => createMut.mutate(data)}
            onCancel={() => setMode("choose")}
          />
        ) : (
          <div className="space-y-5">
            <Button
              className="w-full gradient-primary text-white border-none h-11 gap-1.5"
              onClick={() => setMode("new")}
              data-testid="button-attach-new-record"
            >
              <Plus className="w-4 h-4" /> Add a new record
            </Button>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Or attach one you already have</p>
              {others.length === 0 ? (
                <p className="text-sm text-muted-foreground">No other records yet.</p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                  <Select value={pick} onValueChange={setPick}>
                    <SelectTrigger className="w-full sm:flex-1 min-w-0" data-testid="select-attach-existing">
                      <SelectValue placeholder="Choose a record" />
                    </SelectTrigger>
                    <SelectContent>
                      {others.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.title} · {fmtDate(r.date)}{r.appointmentId ? " (on another visit)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="flex-shrink-0 gap-1"
                    disabled={!pick || linkMut.isPending}
                    onClick={() => linkMut.mutate(Number(pick))}
                    data-testid="button-attach-existing"
                  >
                    <Link2 className="w-4 h-4" /> Attach
                  </Button>
                </div>
              )}
            </div>

            {attached.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Attached to this appointment</p>
                <ul className="space-y-1.5">
                  {attached.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 min-w-0 rounded-md border px-3 py-2">
                      <Paperclip className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-sm truncate flex-1 min-w-0">{r.title}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-muted-foreground flex-shrink-0"
                        onClick={() => unlinkMut.mutate(r.id!)}
                        aria-label={`Remove ${r.title} from this appointment`}
                        data-testid={`button-unlink-record-${r.id}`}
                      >
                        <X className="w-4 h-4 mr-1" /> Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Removing only detaches it. The record stays in Medical Records.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Shown on a record's card in Medical Records: which appointment it belongs to,
// with a way to jump there, or to attach it to one.
export function RecordAppointmentLink({ record, appointments, onChange }: {
  record: MedicalRecord;
  appointments: Appointment[];
  onChange: (appointmentId: number | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const apt = appointments.find((a) => a.id === record.appointmentId);
  const sorted = [...appointments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (apt) {
    return (
      <div className="mt-2 space-y-1 min-w-0">
        <Link
          href={`/appointments/${apt.id}`}
          className="inline-block max-w-full text-sm font-semibold leading-snug text-primary underline underline-offset-2 break-words"
          data-testid={`record-apt-link-${record.id}`}
        >
          <Paperclip className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
          From {appointmentLabel(apt)}
        </Link>
        <button
          type="button"
          className="block text-sm text-muted-foreground underline underline-offset-2"
          onClick={() => onChange(null)}
          data-testid={`button-record-unlink-${record.id}`}
        >
          Remove link
        </button>
      </div>
    );
  }
  if (!appointments.length) return null;
  if (!picking) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 mt-2 text-sm font-semibold text-primary underline underline-offset-2"
        onClick={() => setPicking(true)}
        data-testid={`button-record-link-${record.id}`}
      >
        <Link2 className="w-3.5 h-3.5" /> Attach to an appointment
      </button>
    );
  }
  return (
    <div className="flex gap-2 mt-2 min-w-0 flex-wrap">
      <Select value={pick} onValueChange={setPick}>
        <SelectTrigger className="flex-1 min-w-[12rem]" data-testid={`select-record-apt-${record.id}`}>
          <SelectValue placeholder="Choose an appointment" />
        </SelectTrigger>
        <SelectContent>
          {sorted.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>{appointmentLabel(a)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-9" disabled={!pick}
        onClick={() => { onChange(Number(pick)); setPicking(false); setPick(""); }}>
        Attach
      </Button>
      <Button size="sm" variant="ghost" className="h-9" onClick={() => { setPicking(false); setPick(""); }}>
        Cancel
      </Button>
    </div>
  );
}

// Scroll to a card and briefly ring it, so following a chip or link lands clearly.
export function flashCard(testId: string, tries = 20) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) { if (tries > 0) setTimeout(() => flashCard(testId, tries - 1), 100); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.transition = "box-shadow 0.3s";
  el.style.boxShadow = "0 0 0 3px hsl(var(--primary) / 0.55)";
  setTimeout(() => { el.style.boxShadow = ""; }, 1800);
}
