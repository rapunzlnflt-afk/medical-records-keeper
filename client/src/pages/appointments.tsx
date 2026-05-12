import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getAppointments, createAppointment, updateAppointment, deleteAppointment, getPhysicians } from "@/lib/db";
import { requestRemindersSync } from "@/lib/reminder-sync";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Plus, Trash2, Edit2, MapPin, Clock, CheckCircle2, XCircle, Calendar, Stethoscope, Printer, FileText, BellRing, ClipboardList, History, ChevronDown } from "lucide-react";
import type { Appointment, Physician } from "@shared/schema";
import { format, parseISO, isAfter, isBefore } from "date-fns";
const TYPES = ["checkup", "specialist", "lab", "imaging", "procedure", "other"];
const STATUSES = ["upcoming", "completed", "cancelled"];

// 15-minute interval time options (00:00 through 23:45) with 12-hour display labels.
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const period = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const label = `${h12}:${String(m).padStart(2, "0")} ${period}`;
      opts.push({ value, label });
    }
  }
  return opts;
})();

// Snap an arbitrary "HH:MM" string to the nearest 15-minute slot so existing
// records load cleanly into the new selector.
function snapTo15(time: string): string {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return "";
  const [hStr, mStr] = time.split(":");
  let h = Number(hStr);
  let m = Math.round(Number(mStr) / 15) * 15;
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const labelClass = "text-base font-body font-semibold text-foreground";
const controlClass = "h-12 text-base";

function FieldSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 px-4 sm:px-5 pt-4 pb-2">
        <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold leading-tight">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </header>
      <div className="px-4 sm:px-5 pb-5 pt-2 space-y-4">{children}</div>
    </section>
  );
}

function AppointmentForm({ physicians, initial, onSubmit, onCancel, isEdit }: {
  physicians: Physician[];
  initial?: Partial<Appointment>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isEdit: boolean;
}) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    physicianId: initial?.physicianId || null,
    date: initial?.date || "",
    time: snapTo15(initial?.time || ""),
    location: initial?.location || "",
    type: initial?.type || "checkup",
    status: initial?.status || "upcoming",
    notes: initial?.notes || "",
    reminderDate: initial?.reminderDate || "",
    reminderTime: snapTo15(initial?.reminderTime || ""),
  });

  const [showReminderOptions, setShowReminderOptions] = useState(
    Boolean(initial?.reminderDate || initial?.reminderTime)
  );

  const canSubmit = Boolean(form.title && form.date && form.time);

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable form body — sits between the sticky header and sticky footer */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <FieldSection
          icon={ClipboardList}
          title="Appointment Details"
          description="What is this visit about?"
        >
          <div className="space-y-2">
            <Label htmlFor="apt-title" className={labelClass}>Title</Label>
            <Input
              id="apt-title"
              className={controlClass}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Annual checkup"
              data-testid="input-apt-title"
            />
          </div>
          <div className="space-y-2">
            <Label className={labelClass}>Physician</Label>
            <Select value={form.physicianId?.toString() || "none"} onValueChange={(v) => {
              const selectedId = v === "none" ? null : Number(v);
              const doc = physicians.find((p) => p.id === selectedId);
              const docAddress = doc ? [doc.address, doc.city, doc.state, doc.zip].filter(Boolean).join(", ") : "";
              setForm(prev => ({
                ...prev,
                physicianId: selectedId,
                location: prev.location || docAddress,
              }));
            }}>
              <SelectTrigger className={controlClass} data-testid="select-apt-physician">
                <SelectValue placeholder="Select physician" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">None</SelectItem>
                {physicians.map((p) => <SelectItem key={p.id} value={p.id!.toString()}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className={isEdit ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : ""}>
            <div className="space-y-2">
              <Label className={labelClass}>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className={controlClass} data-testid="select-apt-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isEdit && (
              <div className="space-y-2">
                <Label className={labelClass}>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className={controlClass} data-testid="select-apt-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="apt-location" className={labelClass}>Location</Label>
            <Input
              id="apt-location"
              className={controlClass}
              value={form.location || ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="123 Medical Pkwy"
              data-testid="input-apt-location"
            />
          </div>
        </FieldSection>

        <FieldSection
          icon={Calendar}
          title="Schedule"
          description="Date and time of the visit. Time is in 15-minute steps."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="apt-date" className={labelClass}>Date</Label>
              <Input
                id="apt-date"
                type="date"
                className={controlClass}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                data-testid="input-apt-date"
              />
            </div>
            <div className="space-y-2">
              <Label className={labelClass}>Time</Label>
              <Select value={form.time} onValueChange={(v) => setForm({ ...form, time: v })}>
                <SelectTrigger className={controlClass} data-testid="select-apt-time">
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </FieldSection>

        <FieldSection
          icon={BellRing}
          title="Reminder"
          description="Optional alert so this appointment shows up ahead of time."
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground flex-1 min-w-[160px]">
              {showReminderOptions
                ? "Set both an alert date and time."
                : (form.reminderDate || form.reminderTime)
                  ? "Alert is configured."
                  : "No alert set."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 px-4"
              onClick={() => setShowReminderOptions((prev) => !prev)}
            >
              {showReminderOptions ? "Hide" : (form.reminderDate || form.reminderTime) ? "Edit alert" : "Set alert"}
            </Button>
          </div>

          {showReminderOptions && (
            <div className="grid gap-4 sm:grid-cols-2 pt-2">
              <div className="space-y-2">
                <Label htmlFor="apt-reminder-date" className={labelClass}>Alert Date</Label>
                <Input
                  id="apt-reminder-date"
                  type="date"
                  className={controlClass}
                  value={form.reminderDate || ""}
                  onChange={(e) => setForm({ ...form, reminderDate: e.target.value })}
                  data-testid="input-apt-reminder"
                />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Alert Time</Label>
                <Select
                  value={form.reminderTime || ""}
                  onValueChange={(v) => setForm({ ...form, reminderTime: v })}
                >
                  <SelectTrigger className={controlClass} data-testid="input-apt-reminder-time">
                    <SelectValue placeholder="Select time" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {TIME_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(form.reminderDate || form.reminderTime) && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 -ml-2"
                    onClick={() =>
                      setForm({
                        ...form,
                        reminderDate: "",
                        reminderTime: "",
                      })
                    }
                  >
                    Clear alert
                  </Button>
                </div>
              )}
            </div>
          )}
        </FieldSection>

        <FieldSection
          icon={FileText}
          title="Notes"
          description="Anything you want to remember about this visit."
        >
          <Textarea
            className="text-base min-h-[110px]"
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Bring insurance card..."
            rows={4}
            data-testid="input-apt-notes"
          />
        </FieldSection>
      </div>

      {/* Sticky action bar */}
      <div
        className="sticky bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <Button
          variant="outline"
          onClick={onCancel}
          className="h-12 text-base w-full sm:w-auto sm:min-w-[140px]"
        >
          Cancel
        </Button>
        <Button
          onClick={() => onSubmit(form)}
          disabled={!canSubmit}
          className="gradient-primary text-white border-none h-12 text-base font-semibold w-full sm:w-auto sm:min-w-[200px]"
          data-testid="button-apt-save"
        >
          {isEdit ? "Update Appointment" : "Add Appointment"}
        </Button>
      </div>
    </div>
  );
}

// Tailwind classes shared by both the New and Edit dialogs to make the
// appointment modal behave like a near-full-screen sheet on mobile and a
// roomy centered dialog on desktop.
const APT_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

// Considered "past" when its scheduled date+time has already gone by.
// Uses end-of-day if no time is set so all-day items don't expire at midnight.
function hasAppointmentPassed(a: Appointment): boolean {
  return appointmentStartMs(a) < Date.now();
}

// Numeric sort key for appointments — same wall-clock interpretation the
// dashboard uses so both pages order "next-one-first" identically. Tolerates
// loose time strings ("9:30", " 9:30 ", "") that may exist in legacy data;
// returns +Infinity for unparseable dates so they sink to the bottom rather
// than landing at the top.
function appointmentStartMs(a: Appointment): number {
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

export default function Appointments() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { toast } = useToast();

  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ["appointments", pid],
    queryFn: () => getAppointments(pid),
  });
  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", pid],
    queryFn: () => getPhysicians(pid),
  });

  const invalidateAppointments = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments", pid] });
    queryClient.invalidateQueries({ queryKey: ["all-appointments-for-sync"] });
    // Push the new reminder set up to Supabase right away — independent of
    // whether the dashboard is mounted to observe the cache change.
    requestRemindersSync();
  };
  const createMut = useMutation({
    mutationFn: (data: any) => createAppointment({ ...data, patientId: pid }),
    onSuccess: () => { invalidateAppointments(); setOpen(false); toast({ title: "Appointment added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateAppointment(id, data),
    onSuccess: () => { invalidateAppointments(); setEditing(null); toast({ title: "Appointment updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAppointment(id),
    onSuccess: () => { invalidateAppointments(); toast({ title: "Appointment deleted" }); },
  });

  const today = new Date().toISOString().split("T")[0];
  // Active = anything still on the schedule (not yet passed, not cancelled).
  // History = everything else: explicitly completed, explicitly cancelled, or
  // simply in the past.
  const sortAscByDateTime = (a: Appointment, b: Appointment) =>
    appointmentStartMs(a) - appointmentStartMs(b);
  const activeList = appointments
    .filter((a) => a.status !== "cancelled" && a.status !== "completed" && !hasAppointmentPassed(a))
    .sort(sortAscByDateTime);
  // History stays reverse-chronological: most recent past first.
  const historyList = appointments
    .filter((a) => a.status === "cancelled" || a.status === "completed" || hasAppointmentPassed(a))
    .sort((a, b) => -sortAscByDateTime(a, b));

  // Simple calendar view data
  const currentMonth = new Date();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const monthAppts = appointments.filter((a) => {
    const d = parseISO(a.date);
    return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl w-full min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Appointments</h1>
          <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">Manage your doctor visits and procedures</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5 h-10 print-button-area" onClick={() => {
            const printContent = document.querySelector('[data-testid="appointments-list"]');
            if (!printContent) return;
            const w = window.open('', '_blank', 'width=800,height=600');
            if (!w) return;
            w.document.write(`<!DOCTYPE html><html><head><title>Appointments</title><style>
              body { font-family: 'Karla', Arial, sans-serif; padding: 24px; color: #1e293b; }
              h1 { font-family: 'Montserrat', Arial, sans-serif; font-size: 20px; margin-bottom: 16px; }
              .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
              .title { font-weight: 600; font-size: 14px; }
              .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
              .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: #dbeafe; color: #1e40af; margin-left: 6px; }
            </style></head><body><h1>Appointments</h1>`);
            const writeApt = (apt: Appointment) => {
              const doc = physicians.find((p) => p.id === apt.physicianId);
              w.document.write(`<div class="card"><div class="title">${apt.title} <span class="badge">${apt.type}</span> <span class="badge">${apt.status}</span></div><div class="meta">${apt.date} at ${apt.time}${doc ? ' &mdash; ' + doc.name : ''}${apt.location ? ' &mdash; ' + apt.location : ''}</div>${apt.notes ? '<div class="meta">' + apt.notes + '</div>' : ''}</div>`);
            };
            w.document.write('<h2 style="font-family:Montserrat,Arial,sans-serif;font-size:16px;margin:20px 0 10px;">Upcoming</h2>');
            if (activeList.length === 0) w.document.write('<p style="font-size:12px;color:#64748b;">No upcoming appointments.</p>');
            activeList.forEach(writeApt);
            w.document.write('<h2 style="font-family:Montserrat,Arial,sans-serif;font-size:16px;margin:20px 0 10px;">History</h2>');
            if (historyList.length === 0) w.document.write('<p style="font-size:12px;color:#64748b;">No past appointments.</p>');
            historyList.forEach(writeApt);
            w.document.write('</body></html>');
            w.document.close();
            w.focus();
            w.print();
            w.close();
          }} data-testid="button-print-appointments">
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary text-white border-none gap-1.5 h-10" data-testid="button-add-appointment">
                <Plus className="w-4 h-4" /> Add Appointment
              </Button>
            </DialogTrigger>
            <DialogContent className={APT_DIALOG_CLASS}>
              <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
                <DialogTitle className="font-heading text-2xl sm:text-2xl font-bold text-white">
                  New Appointment
                </DialogTitle>
                <DialogDescription className="text-white/85 text-sm">
                  Fill in the visit details. Title, date, and time are required.
                </DialogDescription>
              </DialogHeader>
              <AppointmentForm
                physicians={physicians}
                isEdit={false}
                onSubmit={(data) => createMut.mutate(data)}
                onCancel={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Mini Calendar */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="font-heading text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            {format(currentMonth, "MMMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-xs font-heading font-semibold text-muted-foreground py-1.5">{d}</div>
            ))}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`e-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hasAppt = monthAppts.some((a) => a.date === dateStr);
              const isToday = dateStr === today;
              return (
                <div
                  key={day}
                  className={`text-sm py-2.5 rounded-md relative ${
                    isToday
                      ? "gradient-primary text-white font-bold"
                      : hasAppt
                      ? "bg-primary/10 font-semibold text-foreground"
                      : "text-foreground/85"
                  }`}
                >
                  {day}
                  {hasAppt && !isToday && <div className="w-1.5 h-1.5 rounded-full gradient-primary mx-auto mt-0.5" />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-3" data-testid="appointments-list">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : (
          <>
            {/* Upcoming */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Upcoming
                <Badge variant="secondary" className="text-xs font-semibold">{activeList.length}</Badge>
              </h2>
            </div>

            {activeList.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="py-10 text-center">
                  <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-base text-muted-foreground">No upcoming appointments</p>
                </CardContent>
              </Card>
            ) : (
              activeList.map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  apt={apt}
                  physicians={physicians}
                  editingId={editing?.id ?? null}
                  setEditing={setEditing}
                  onSave={(id, data) => updateMut.mutate({ id, data })}
                  onDelete={(id) => deleteMut.mutate(id)}
                />
              ))
            )}

            {/* History (collapsible) */}
            <Card className="mt-3 shadow-sm">
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-left hover-elevate rounded-md min-h-[3rem]"
                    aria-label={historyOpen ? "Hide Appointment History" : "Show Appointment History"}
                    data-testid="button-toggle-appointment-history"
                  >
                    <CardHeader className="py-3.5">
                      <CardTitle className="font-heading text-lg font-semibold flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" />
                        <span>Appointment History</span>
                        <Badge variant="secondary" className="text-xs font-semibold">{historyList.length}</Badge>
                        <span className="ml-auto text-muted-foreground">
                          <ChevronDown className={`w-5 h-5 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
                        </span>
                      </CardTitle>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    {historyList.length === 0 ? (
                      <p className="text-base text-muted-foreground py-4 text-center">No past appointments yet.</p>
                    ) : (
                      historyList.map((apt) => (
                        <AppointmentCard
                          key={apt.id}
                          apt={apt}
                          physicians={physicians}
                          editingId={editing?.id ?? null}
                          setEditing={setEditing}
                          onSave={(id, data) => updateMut.mutate({ id, data })}
                          onDelete={(id) => deleteMut.mutate(id)}
                          muted
                        />
                      ))
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function AppointmentCard({
  apt, physicians, editingId, setEditing, onSave, onDelete, muted,
}: {
  apt: Appointment;
  physicians: Physician[];
  editingId: number | null;
  setEditing: (a: Appointment | null) => void;
  onSave: (id: number, data: any) => void;
  onDelete: (id: number) => void;
  muted?: boolean;
}) {
  const doc = physicians.find((p) => p.id === apt.physicianId);
  return (
    <Card className={`hover-elevate shadow-sm ${muted ? "opacity-90" : ""}`} data-testid={`appointment-${apt.id}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${muted ? "bg-muted" : "gradient-primary"}`}>
            <span className={`text-[10px] sm:text-xs font-heading font-bold leading-none uppercase tracking-wide ${muted ? "text-muted-foreground" : "text-white/90"}`}>{format(parseISO(apt.date), "MMM")}</span>
            <span className={`text-xl sm:text-2xl font-heading font-bold leading-none mt-1 ${muted ? "text-foreground" : "text-white"}`}>{format(parseISO(apt.date), "dd")}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h3 className="font-heading text-base sm:text-lg font-semibold leading-tight break-words min-w-0">{apt.title}</h3>
              <Badge variant="secondary" className="text-xs font-medium">{apt.type}</Badge>
              <Badge className={`text-xs font-medium ${apt.status === "upcoming" ? "status-upcoming" : apt.status === "completed" ? "status-completed" : "status-cancelled"}`}>
                {apt.status === "completed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {apt.status === "cancelled" && <XCircle className="w-3 h-3 mr-1" />}
                {apt.status}
              </Badge>
            </div>
            <div className="flex items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-1.5 text-sm text-foreground/75 flex-wrap min-w-0">
              <span className="flex items-center gap-1.5 min-w-0"><Clock className="w-3.5 h-3.5 flex-shrink-0" />{apt.time}</span>
              {doc && <span className="flex items-center gap-1.5 min-w-0 truncate"><Stethoscope className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{doc.name}</span></span>}
              {apt.location && <span className="flex items-center gap-1.5 min-w-0 truncate"><MapPin className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{apt.location}</span></span>}
            </div>
            {apt.notes && <p className="text-sm text-foreground/70 mt-1.5 line-clamp-2 break-words">{apt.notes}</p>}
          </div>
          <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
            <Dialog open={editingId === apt.id} onOpenChange={(o) => !o && setEditing(null)}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => setEditing(apt)} data-testid={`button-edit-apt-${apt.id}`}>
                  <Edit2 className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className={APT_DIALOG_CLASS}>
                <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
                  <DialogTitle className="font-heading text-2xl sm:text-2xl font-bold text-white">
                    Edit Appointment
                  </DialogTitle>
                  <DialogDescription className="text-white/85 text-sm">
                    Update the visit details. Changes save when you press Update.
                  </DialogDescription>
                </DialogHeader>
                <AppointmentForm
                  physicians={physicians}
                  initial={apt}
                  isEdit={true}
                  onSubmit={(data) => onSave(apt.id!, data)}
                  onCancel={() => setEditing(null)}
                />
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10"
                  data-testid={`button-delete-apt-${apt.id}`}
                  aria-label={`Delete appointment ${apt.title}`}
                >
                  <Trash2 className="w-5 h-5 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-heading flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-destructive" />
                    Delete appointment?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">{apt.title}</span>
                    {" "}on{" "}
                    <span className="font-medium text-foreground">
                      {format(parseISO(apt.date), "MMM d, yyyy")}
                    </span>
                    {apt.time ? ` at ${apt.time}` : ""}{" "}
                    will be permanently removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-2">
                  <AlertDialogCancel
                    className="h-11 text-base sm:h-10 sm:text-sm mt-0"
                    data-testid={`button-delete-apt-cancel-${apt.id}`}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(apt.id!)}
                    className="h-11 text-base sm:h-10 sm:text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
                    data-testid={`button-delete-apt-confirm-${apt.id}`}
                  >
                    Delete appointment
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
