import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CalendarDays,
  CalendarClock,
  Pill,
  Stethoscope,
  FileText,
  HeartPulse,
  Phone,
  AlertCircle,
  Sparkles,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Link } from "wouter";
import type {
  Appointment,
  Medication,
  Physician,
  MedicalRecord,
  Vital,
  EmergencyContact,
  ReminderSoundPreferences,
} from "@shared/schema";
import { usePatient } from "@/lib/patient-context";
import {
  getAppointments,
  getMedications,
  getPhysicians,
  getMedicalRecords,
  getVitals,
  getEmergencyContacts,
  getReminderSoundPreferences,
} from "@/lib/db";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import { PhoneRemindersCard } from "@/components/phone-reminders-card";
import { BackupReminderCard, FirstVisitNoticeCard } from "@/components/backup-reminder-card";
import { VisitNotesPromptCard } from "@/components/visit-notes-prompt-card";

function StatCard({ title, value, icon: Icon, href, gradient }: {
  title: string; value: number; icon: any; href: string; gradient?: boolean;
}) {
  return (
    <Link href={href} className="block h-full min-w-0">
      <Card
        className={`hover-elevate cursor-pointer h-full ${gradient ? "gradient-primary text-white border-transparent shadow-md" : "shadow-sm"}`}
        data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <CardContent className="relative min-h-[96px] p-4 sm:p-5">
          <p className={`text-[13px] sm:text-sm font-body font-semibold leading-snug pr-12 whitespace-nowrap ${gradient ? "text-white/90" : "text-muted-foreground"}`}>
            {title}
          </p>

          <p className={`absolute left-4 bottom-4 text-3xl sm:text-4xl font-heading font-bold leading-none tabular-nums ${gradient ? "text-white" : ""}`}>
            {value}
          </p>

          <div className={`absolute right-4 bottom-4 w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center ${gradient ? "bg-white/20" : "gradient-primary"}`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
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
  const { data: soundPrefs } = useQuery<ReminderSoundPreferences>({ queryKey: ["reminder-sound-preferences", pid], queryFn: () => getReminderSoundPreferences(pid),
  });

  const reminderAudioRef = useRef<HTMLAudioElement | null>(null);

  const soundFiles = useMemo(
    () => ({
      "soft-chime": "/sounds/soft-chime.mp3",
      "clear-bell": "/sounds/clear-bell.mp3",
      "urgent-tone": "/sounds/urgent-tone.mp3",
    }),
    [],
  );

  // Numeric "start time" for an appointment so the dashboard can both filter
  // out past items and sort the remaining ones next-first using one consistent
  // wall-clock interpretation. End-of-day fallback for missing time keeps
  // all-day items visible until midnight local.
  const appointmentStartMs = (a: Appointment): number => {
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
  };
  const isUpcoming = (a: Appointment) => {
    if (a.status === "cancelled") return false;
    if (a.status === "completed") return false;
    return appointmentStartMs(a) >= Date.now();
  };
  const upcomingAll = appointments.filter(isUpcoming);
  const soonestUpcoming = upcomingAll
    .slice()
    .sort((a, b) => appointmentStartMs(a) - appointmentStartMs(b))[0];
  const soonestDoc = soonestUpcoming
    ? physicians.find((p) => p.id === soonestUpcoming.physicianId)
    : undefined;

  const activeMeds = medications.filter((m) => m.active === 1);
  const refillSoon = activeMeds.filter((m) => {
    if (!m.refillDate) return false;
    const refill = parseISO(m.refillDate);
    return isBefore(refill, addDays(new Date(), 7)) && isAfter(refill, addDays(new Date(), -1));
  });

  const [medSummaryOpen, setMedSummaryOpen] = useState(false);

  const now = new Date();

const reminders = appointments.filter((a) => {
  if (!a.reminderDate || a.status !== "upcoming") return false;

  const reminderDateTime = new Date(
    `${a.reminderDate}T${a.reminderTime || "09:00"}:00`
  );

  return reminderDateTime <= now;
}).sort((a, b) => {
  const aDateTime = `${a.date}T${a.time || "00:00"}:00`;
  const bDateTime = `${b.date}T${b.time || "00:00"}:00`;
  return aDateTime.localeCompare(bDateTime);
});

    useEffect(() => {
  if (!soundPrefs || soundPrefs.appointmentsEnabled !== 1 || reminders.length === 0) return;

  const now = new Date();

  const dueReminders = reminders.filter((appointment) => {
    if (!appointment.reminderDate) return false;

    const reminderDateTime = new Date(
      `${appointment.reminderDate}T${appointment.reminderTime || "09:00"}:00`
    );

    return reminderDateTime <= now;
  });

  if (dueReminders.length === 0) return;

  const nextUnplayedReminder = dueReminders.find((appointment) => {
    const reminderStamp = `${appointment.id}-${appointment.reminderDate}-${appointment.reminderTime || "09:00"}`;
    const playedKey = `mrk-played-reminder-sound-${pid}-${reminderStamp}`;
    return sessionStorage.getItem(playedKey) !== "1";
  });

  if (!nextUnplayedReminder) return;

  const soundValue = soundPrefs.appointmentsSound || "soft-chime";
  const file = soundFiles[soundValue as keyof typeof soundFiles];
  if (!file) return;

  const audio = new Audio(file);
  reminderAudioRef.current = audio;

  const reminderStamp = `${nextUnplayedReminder.id}-${nextUnplayedReminder.reminderDate}-${nextUnplayedReminder.reminderTime || "09:00"}`;
  const playedKey = `mrk-played-reminder-sound-${pid}-${reminderStamp}`;

  audio
    .play()
    .then(() => {
      sessionStorage.setItem(playedKey, "1");
    })
    .catch(() => {
      // Ignore autoplay blocks; user can still test sound manually in settings.
    });
}, [pid, reminders, soundPrefs, soundFiles]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl w-full min-w-0 overflow-x-hidden">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">
          {activePatient ? `${activePatient.name.endsWith('s') ? activePatient.name + "'" : activePatient.name + "'s"} health overview` : "Your health overview at a glance"}
        </p>
      </div>

      <FirstVisitNoticeCard hasData={physicians.length + appointments.length + medications.length + records.length > 0} />
      <BackupReminderCard hasData={physicians.length + appointments.length + medications.length + records.length > 0} />
      <VisitNotesPromptCard appointments={appointments} physicians={physicians} patientId={pid} />

      {physicians.length === 0 && appointments.length === 0 && medications.length === 0 && records.length === 0 && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/5">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-base sm:text-lg font-bold">Welcome to Medical Records Keeper</h2>
                <p className="text-sm text-muted-foreground mt-1.5 font-body leading-relaxed">
                  The best way to get started is to add your physicians first. Their names will then appear in dropdown menus when you add appointments, medications, and medical records.
                </p>
                <div className="mt-4 space-y-2">
                  <Link href="/physicians" className="flex items-center gap-2 text-sm font-semibold text-primary hover:underline" data-testid="link-get-started-physicians">
                    <Stethoscope className="w-4 h-4 flex-shrink-0" /> <span className="min-w-0">Step 1: Add your physicians</span> <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                  </Link>
                  <Link href="/appointments" className="flex items-center gap-2 text-sm text-foreground/80 hover:text-primary hover:underline">
                    <CalendarDays className="w-4 h-4 flex-shrink-0" /> <span className="min-w-0">Step 2: Schedule appointments</span>
                  </Link>
                  <Link href="/medications" className="flex items-center gap-2 text-sm text-foreground/80 hover:text-primary hover:underline">
                    <Pill className="w-4 h-4 flex-shrink-0" /> <span className="min-w-0">Step 3: Add your medications</span>
                  </Link>
                  <Link href="/records" className="flex items-center gap-2 text-sm text-foreground/80 hover:text-primary hover:underline">
                    <FileText className="w-4 h-4 flex-shrink-0" /> <span className="min-w-0">Step 4: Upload medical records</span>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 min-w-0">
        <StatCard title="Appointments" value={upcomingAll.length} icon={CalendarDays} href="/appointments" gradient />
        <StatCard title="Active Meds" value={activeMeds.length} icon={Pill} href="/medications" />
        <StatCard title="Physicians" value={physicians.length} icon={Stethoscope} href="/physicians" />
        <StatCard title="Medical Records" value={records.length} icon={FileText} href="/records" />
      </div>

      {soonestUpcoming && (
        <Link
          href="/appointments"
          className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 hover-elevate px-4 py-2.5 min-w-0"
          data-testid="banner-next-appointment"
        >
          <span className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
            <CalendarClock className="w-4 h-4 text-white" />
          </span>
          <p className="text-sm text-foreground/90 truncate min-w-0">
            <span className="font-semibold">Upcoming:</span>{" "}
            {soonestUpcoming.title}
            {soonestDoc ? ` with ${soonestDoc.name}` : ""}
            {" "}on {format(parseISO(soonestUpcoming.date), "EEE MMM d")}
            {soonestUpcoming.time ? ` at ${soonestUpcoming.time}` : ""}
          </p>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-auto" />
        </Link>
      )}

      <div className="grid gap-4 items-start min-w-0">
        <Card className="shadow-sm">
          <Collapsible open={medSummaryOpen} onOpenChange={setMedSummaryOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full text-left hover-elevate rounded-t-md"
                aria-label={medSummaryOpen ? "Hide Medication Summary" : "Show Medication Summary"}
                data-testid="button-toggle-medication-summary"
              >
                <CardHeader className="pb-3">
                  <CardTitle className="font-heading text-lg font-semibold flex items-center gap-2 flex-wrap min-w-0">
                    <Pill className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="min-w-0">Medication Summary</span>
                    <Badge variant="secondary" className="text-xs font-semibold flex-shrink-0">
                      {activeMeds.length}
                    </Badge>
                    {!medSummaryOpen && refillSoon.length > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-semibold px-2 py-0.5 flex-shrink-0"
                        data-testid="badge-refill-alert"
                      >
                        <AlertCircle className="w-3 h-3" />
                        {refillSoon.length} refill{refillSoon.length === 1 ? "" : "s"} due
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground flex-shrink-0">
                      {medSummaryOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                  </CardTitle>
                </CardHeader>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-2">
                {refillSoon.length > 0 && (
                  <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 mb-3">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="text-sm font-semibold">Refills Needed Soon</p>
                    </div>
                    {refillSoon.map((m) => (
                      <p key={m.id} className="text-sm text-amber-700/90 dark:text-amber-400/85 mt-1 ml-6 truncate">
                        {m.name} — refill by {format(parseISO(m.refillDate!), "MMM d")}
                      </p>
                    ))}
                  </div>
                )}
                {activeMeds.length === 0 ? (
                  <div className="text-center py-6">
                    <Pill className="w-9 h-9 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-base text-muted-foreground">No active medications</p>
                    <Link href="/medications" className="text-sm font-semibold text-primary hover:underline mt-1.5 inline-block">
                      Add medication
                    </Link>
                  </div>
                ) : (
                  activeMeds.slice(0, 5).map((med) => (
                    <div key={med.id} className="flex items-center gap-3 p-2.5 rounded-md bg-secondary/50 min-w-0" data-testid={`med-summary-${med.id}`}>
                      <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                        <Pill className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold truncate leading-tight">{med.name}</p>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {med.dosage} · {med.frequency}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 min-w-0">
        <StatCard title="Vitals Logged" value={vitals.length} icon={HeartPulse} href="/vitals" />
        <StatCard title="Emergency Contacts" value={contacts.length} icon={Phone} href="/emergency" />
      </div>

      <div className="min-[500px]:hidden">
  <PhoneRemindersCard />
</div>
    </div>
  );
}
