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
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Plus, Trash2, Edit2, MapPin, Clock, CheckCircle2, XCircle, Calendar, Stethoscope, Printer, FileText, BellRing, ClipboardList } from "lucide-react";
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className={labelClass}>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className={controlClass} data-testid="select-apt-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className={labelClass}>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className={controlClass} data-testid="select-apt-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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

export default function Appointments() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [filter, setFilter] = useState<string>("all");
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
  const filtered = appointments.filter((a) => {
    if (filter === "upcoming") return a.status === "upcoming" && a.date >= today;
    if (filter === "past") return a.status === "completed" || a.date < today;
    if (filter === "cancelled") return a.status === "cancelled";
    return true;
  });

  // Simple calendar view data
  const currentMonth = new Date();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const monthAppts = appointments.filter((a) => {
    const d = parseISO(a.date);
    return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Appointments</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Manage your doctor visits and procedures</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 print-button-area" onClick={() => {
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
            filtered.forEach((apt) => {
              const doc = physicians.find((p) => p.id === apt.physicianId);
              w.document.write(`<div class="card"><div class="title">${apt.title} <span class="badge">${apt.type}</span> <span class="badge">${apt.status}</span></div><div class="meta">${apt.date} at ${apt.time}${doc ? ' &mdash; ' + doc.name : ''}${apt.location ? ' &mdash; ' + apt.location : ''}</div>${apt.notes ? '<div class="meta">' + apt.notes + '</div>' : ''}</div>`);
            });
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
              <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-appointment">
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            {format(currentMonth, "MMMM yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-xs font-heading font-semibold text-muted-foreground py-1">{d}</div>
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
                <div key={day} className={`text-xs py-1.5 rounded-md relative ${isToday ? "gradient-primary text-white font-bold" : hasAppt ? "bg-primary/10 font-semibold" : ""}`}>
                  {day}
                  {hasAppt && !isToday && <div className="w-1 h-1 rounded-full gradient-primary mx-auto mt-0.5" />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["all", "upcoming", "past", "cancelled"].map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm"
            className={filter === f ? "gradient-primary text-white border-none" : ""}
            onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3" data-testid="appointments-list">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No appointments found</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((apt) => {
            const doc = physicians.find((p) => p.id === apt.physicianId);
            return (
              <Card key={apt.id} className="hover-elevate" data-testid={`appointment-${apt.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg gradient-primary flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-heading font-bold leading-none">{format(parseISO(apt.date), "MMM")}</span>
                      <span className="text-white text-lg font-heading font-bold leading-none">{format(parseISO(apt.date), "dd")}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-heading text-sm font-semibold">{apt.title}</h3>
                        <Badge variant="secondary" className="text-xs">{apt.type}</Badge>
                        <Badge className={`text-xs ${apt.status === "upcoming" ? "status-upcoming" : apt.status === "completed" ? "status-completed" : "status-cancelled"}`}>
                          {apt.status === "completed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {apt.status === "cancelled" && <XCircle className="w-3 h-3 mr-1" />}
                          {apt.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{apt.time}</span>
                        {doc && <span className="flex items-center gap-1"><Stethoscope className="w-3 h-3" />{doc.name}</span>}
                        {apt.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{apt.location}</span>}
                      </div>
                      {apt.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{apt.notes}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Dialog open={editing?.id === apt.id} onOpenChange={(o) => !o && setEditing(null)}>
                        <DialogTrigger asChild>
                          <Button size="icon" variant="ghost" onClick={() => setEditing(apt)} data-testid={`button-edit-apt-${apt.id}`}>
                            <Edit2 className="w-4 h-4" />
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
                            onSubmit={(data) => updateMut.mutate({ id: apt.id!, data })}
                            onCancel={() => setEditing(null)}
                          />
                        </DialogContent>
                      </Dialog>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(apt.id!)} data-testid={`button-delete-apt-${apt.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
