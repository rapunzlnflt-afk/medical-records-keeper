import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Plus, Trash2, Edit2, MapPin, Clock, CheckCircle2, XCircle, Calendar, Stethoscope, Printer } from "lucide-react";
import type { Appointment, Physician } from "@shared/schema";
import { format, parseISO, isAfter, isBefore } from "date-fns";

const TYPES = ["checkup", "specialist", "lab", "imaging", "procedure", "other"];
const STATUSES = ["upcoming", "completed", "cancelled"];

function AppointmentForm({ physicians, initial, onSubmit, onCancel }: {
  physicians: Physician[];
  initial?: Partial<Appointment>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    physicianId: initial?.physicianId || null,
    date: initial?.date || "",
    time: initial?.time || "",
    location: initial?.location || "",
    type: initial?.type || "checkup",
    status: initial?.status || "upcoming",
    notes: initial?.notes || "",
    reminderDate: initial?.reminderDate || "",
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-body">Title</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Annual checkup" data-testid="input-apt-title" />
        </div>
        <div>
          <Label className="text-xs font-body">Physician</Label>
          <Select value={form.physicianId?.toString() || "none"} onValueChange={(v) => setForm({ ...form, physicianId: v === "none" ? null : Number(v) })}>
            <SelectTrigger data-testid="select-apt-physician"><SelectValue placeholder="Select physician" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {physicians.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Date</Label>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-apt-date" />
        </div>
        <div>
          <Label className="text-xs font-body">Time</Label>
          <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} data-testid="input-apt-time" />
        </div>
        <div>
          <Label className="text-xs font-body">Type</Label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger data-testid="select-apt-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="select-apt-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs font-body">Location</Label>
          <Input value={form.location || ""} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="123 Medical Pkwy" data-testid="input-apt-location" />
        </div>
        <div>
          <Label className="text-xs font-body">Reminder Date</Label>
          <Input type="date" value={form.reminderDate || ""} onChange={(e) => setForm({ ...form, reminderDate: e.target.value })} data-testid="input-apt-reminder" />
        </div>
      </div>
      <div>
        <Label className="text-xs font-body">Notes</Label>
        <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Bring insurance card..." rows={2} data-testid="input-apt-notes" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.title || !form.date || !form.time} className="gradient-primary text-white border-none" data-testid="button-apt-save">
          {initial?.id ? "Update" : "Add"} Appointment
        </Button>
      </div>
    </div>
  );
}

export default function Appointments() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({ queryKey: ["/api/appointments"] });
  const { data: physicians = [] } = useQuery<Physician[]>({ queryKey: ["/api/physicians"] });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/appointments", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointments"] }); setOpen(false); toast({ title: "Appointment added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/appointments/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointments"] }); setEditing(null); toast({ title: "Appointment updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/appointments/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointments"] }); toast({ title: "Appointment deleted" }); },
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
          <Button size="sm" variant="outline" className="gap-1 print-button-area" onClick={() => window.print()} data-testid="button-print-appointments">
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-appointment">
                <Plus className="w-4 h-4" /> Add Appointment
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading">New Appointment</DialogTitle></DialogHeader>
            <AppointmentForm physicians={physicians} onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
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
      <div className="space-y-3">
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
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                          <DialogHeader><DialogTitle className="font-heading">Edit Appointment</DialogTitle></DialogHeader>
                          <AppointmentForm physicians={physicians} initial={apt}
                            onSubmit={(data) => updateMut.mutate({ id: apt.id, data })}
                            onCancel={() => setEditing(null)} />
                        </DialogContent>
                      </Dialog>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(apt.id)} data-testid={`button-delete-apt-${apt.id}`}>
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
