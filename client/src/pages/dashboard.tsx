import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Pill, Stethoscope, FileText, HeartPulse, Phone, Clock, AlertCircle, Bell, Sparkles, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import type { Appointment, Medication, Physician, MedicalRecord, Vital, EmergencyContact } from "@shared/schema";
import { usePatient } from "@/lib/patient-context";
import { getAppointments, getMedications, getPhysicians, getMedicalRecords, getVitals, getEmergencyContacts } from "@/lib/db";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";

function StatCard({ title, value, icon: Icon, href, gradient }: {
  title: string; value: number; icon: any; href: string; gradient?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className={`hover-elevate cursor-pointer ${gradient ? "gradient-primary text-white border-none" : ""}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className={`text-xs font-body ${gradient ? "text-white/80" : "text-muted-foreground"}`}>{title}</p>
              <p className={`text-2xl font-heading font-bold mt-1 ${gradient ? "text-white" : ""}`}>{value}</p>
            </div>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${gradient ? "bg-white/20" : "gradient-primary"}`}>
              <Icon className={`w-5 h-5 ${gradient ? "text-white" : "text-white"}`} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { activePatientId, activePatient } = usePatient();
  const pid = activePatientId;
  const { data: appointments = [] } = useQuery<Appointment[]>({ queryKey: ["appointments", pid], queryFn: () => getAppointments(pid) });
  const { data: medications = [] } = useQuery<Medication[]>({ queryKey: ["medications", pid], queryFn: () => getMedications(pid) });
  const { data: physicians = [] } = useQuery<Physician[]>({ queryKey: ["physicians", pid], queryFn: () => getPhysicians(pid) });
  const { data: records = [] } = useQuery<MedicalRecord[]>({ queryKey: ["medicalRecords", pid], queryFn: () => getMedicalRecords(pid) });
  const { data: vitals = [] } = useQuery<Vital[]>({ queryKey: ["vitals", pid], queryFn: () => getVitals(pid) });
  const { data: contacts = [] } = useQuery<EmergencyContact[]>({ queryKey: ["emergencyContacts", pid], queryFn: () => getEmergencyContacts(pid) });

  const today = new Date().toISOString().split("T")[0];
  const upcoming = appointments.filter(
    (a) => a.status === "upcoming" && a.date >= today
  ).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const activeMeds = medications.filter((m) => m.active === 1);
  const refillSoon = activeMeds.filter((m) => {
    if (!m.refillDate) return false;
    const refill = parseISO(m.refillDate);
    return isBefore(refill, addDays(new Date(), 7)) && isAfter(refill, addDays(new Date(), -1));
  });

  const reminders = appointments.filter((a) => {
    if (!a.reminderDate || a.status !== "upcoming") return false;
    return a.reminderDate <= today;
  }).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="font-heading text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">
          {activePatient ? `${activePatient.name.endsWith('s') ? activePatient.name + "'" : activePatient.name + "'s"} health overview` : "Your health overview at a glance"}
        </p>
      </div>

      {physicians.length === 0 && appointments.length === 0 && medications.length === 0 && records.length === 0 && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-heading text-sm font-bold">Welcome to Medical Records Keeper</h2>
                <p className="text-xs text-muted-foreground mt-1.5 font-body leading-relaxed">
                  The best way to get started is to add your physicians first. Their names will then appear in dropdown menus when you add appointments, medications, and medical records.
                </p>
                <div className="mt-3 space-y-1.5">
                  <Link href="/physicians" className="flex items-center gap-2 text-xs font-semibold text-primary hover:underline" data-testid="link-get-started-physicians">
                    <Stethoscope className="w-3.5 h-3.5" /> Step 1: Add your physicians <ChevronRight className="w-3 h-3" />
                  </Link>
                  <Link href="/appointments" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary hover:underline">
                    <CalendarDays className="w-3.5 h-3.5" /> Step 2: Schedule appointments
                  </Link>
                  <Link href="/medications" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary hover:underline">
                    <Pill className="w-3.5 h-3.5" /> Step 3: Add your medications
                  </Link>
                  <Link href="/records" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary hover:underline">
                    <FileText className="w-3.5 h-3.5" /> Step 4: Upload medical records
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard title="Appointments" value={appointments.filter(a => a.status === "upcoming").length} icon={CalendarDays} href="/appointments" gradient />
        <StatCard title="Active Meds" value={activeMeds.length} icon={Pill} href="/medications" />
        <StatCard title="Physicians" value={physicians.length} icon={Stethoscope} href="/physicians" />
        <StatCard title="Records" value={records.length} icon={FileText} href="/records" />
      </div>

      {reminders.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Appointment Reminders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reminders.map((apt) => {
              const doc = physicians.find((p) => p.id === apt.physicianId);
              return (
                <div key={apt.id} className="flex items-center gap-3 p-2 rounded-md bg-card" data-testid={`reminder-apt-${apt.id}`}>
                  <div className="w-10 h-10 rounded-md gradient-primary flex items-center justify-center flex-shrink-0">
                    <Bell className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{apt.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {format(parseISO(apt.date), "MMM d, yyyy")} at {apt.time}
                      {doc ? ` · ${doc.name}` : ""}
                    </p>
                    {apt.location && (
                      <p className="text-xs text-muted-foreground truncate">{apt.location}</p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs flex-shrink-0">{apt.type}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Upcoming Appointments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.length === 0 ? (
              <div className="text-center py-6">
                <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No upcoming appointments</p>
                <Link href="/appointments" className="text-xs text-primary hover:underline mt-1 inline-block">
                  Schedule one
                </Link>
              </div>
            ) : (
              upcoming.map((apt) => {
                const doc = physicians.find((p) => p.id === apt.physicianId);
                return (
                  <div key={apt.id} className="flex items-center gap-3 p-2 rounded-md bg-secondary/50" data-testid={`upcoming-apt-${apt.id}`}>
                    <div className="w-10 h-10 rounded-md gradient-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-heading font-bold">
                        {format(parseISO(apt.date), "dd")}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{apt.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {format(parseISO(apt.date), "MMM d")} at {apt.time}
                        {doc ? ` · ${doc.name}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">{apt.type}</Badge>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <Pill className="w-4 h-4 text-primary" />
              Medication Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {refillSoon.length > 0 && (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 mb-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-xs font-semibold">Refills Needed Soon</p>
                </div>
                {refillSoon.map((m) => (
                  <p key={m.id} className="text-xs text-amber-600 dark:text-amber-400/80 mt-1 ml-6">
                    {m.name} — refill by {format(parseISO(m.refillDate!), "MMM d")}
                  </p>
                ))}
              </div>
            )}
            {activeMeds.length === 0 ? (
              <div className="text-center py-6">
                <Pill className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No active medications</p>
                <Link href="/medications" className="text-xs text-primary hover:underline mt-1 inline-block">
                  Add medication
                </Link>
              </div>
            ) : (
              activeMeds.slice(0, 5).map((med) => (
                <div key={med.id} className="flex items-center gap-3 p-2 rounded-md bg-secondary/50" data-testid={`med-summary-${med.id}`}>
                  <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <Pill className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{med.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {med.dosage} · {med.frequency}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard title="Vitals Logged" value={vitals.length} icon={HeartPulse} href="/vitals" />
        <StatCard title="Emergency Contacts" value={contacts.length} icon={Phone} href="/emergency" />
        <StatCard title="Total Records" value={records.length} icon={FileText} href="/records" />
      </div>
    </div>
  );
}
