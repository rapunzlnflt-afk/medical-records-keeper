import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ClipboardPenLine, Flag, NotebookPen } from "lucide-react";
import { HistoryActions, HistoryPrintHeading } from "@/components/history-actions";
import { formatHistoryDate, localDateKey, localSortKey, type HistoryCopyDocument } from "@/lib/history-actions";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  getAppointments,
  getNotes,
  getNoteUpdates,
  getPhysicians,
  noteCategory,
  noteIsFlaggedForDoctor,
} from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import type { Appointment, Note, NoteUpdate, Physician } from "@shared/schema";

type TimelineFilter = "all" | "appointments" | "notes" | "flagged";

type TimelineEntry =
  | {
    kind: "appointment";
    id: number;
    dateKey: string;
    sortKey: number;
    appointment: Appointment;
  }
  | {
    kind: "note";
    id: number;
    dateKey: string;
    sortKey: number;
    note: Note;
    updateCount: number;
    updates: NoteUpdate[];
  };

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "appointments", label: "Appointments" },
  { id: "notes", label: "Notes" },
  { id: "flagged", label: "Flagged for doctor" },
];

function formatAppointmentTime(appointment: Appointment): string {
  const dateLabel = formatHistoryDate(localDateKey(appointment.date));
  return appointment.time?.trim() ? `${dateLabel} · ${appointment.time.trim()}` : dateLabel;
}

function noteTone(category: string): string {
  switch (category) {
    case "Symptom":
    case "Injury":
    case "Illness":
      return "bg-rose-500/10 text-rose-800 ring-rose-500/20 dark:bg-rose-300/15 dark:text-rose-100 dark:ring-rose-300/30";
    case "Medication reaction":
      return "bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:bg-amber-300/15 dark:text-amber-100 dark:ring-amber-300/30";
    case "Behavior / mood":
    case "Sleep":
      return "bg-violet-500/10 text-violet-800 ring-violet-500/20 dark:bg-violet-300/15 dark:text-violet-100 dark:ring-violet-300/30";
    case "Appetite / diet":
    case "Digestion":
      return "bg-emerald-500/10 text-emerald-800 ring-emerald-500/20 dark:bg-emerald-300/15 dark:text-emerald-100 dark:ring-emerald-300/30";
    case "Skin":
      return "bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:bg-sky-300/15 dark:text-sky-100 dark:ring-sky-300/30";
    default:
      return "bg-primary/10 text-primary ring-primary/20 dark:bg-primary/20 dark:text-primary dark:ring-primary/35";
  }
}

function emptyMessage(filter: TimelineFilter): string {
  switch (filter) {
    case "appointments":
      return "No appointments are recorded for this profile yet.";
    case "notes":
      return "No notes are recorded for this profile yet.";
    case "flagged":
      return "No notes are marked to mention at the next appointment.";
    default:
      return "No appointments or notes are recorded for this profile yet.";
  }
}

export default function Timeline() {
  const { activePatientId, activePatient } = usePatient();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [flaggedPhysicianId, setFlaggedPhysicianId] = useState<number | null>(null);
  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery<Appointment[]>({
    queryKey: ["appointments", activePatientId],
    queryFn: () => getAppointments(activePatientId),
  });
  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: ["notes", activePatientId],
    queryFn: () => getNotes(activePatientId),
  });
  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", activePatientId],
    queryFn: () => getPhysicians(activePatientId),
  });
  const noteIds = notes.flatMap((note) => note.id === undefined ? [] : [note.id]);
  const { data: noteUpdates = [] } = useQuery<NoteUpdate[]>({
    queryKey: ["note-updates", activePatientId, noteIds],
    queryFn: () => getNoteUpdates(noteIds),
    enabled: noteIds.length > 0,
  });

  const entries = useMemo(() => {
    const updateCounts = noteUpdates.reduce<Record<number, number>>((counts, update) => {
      counts[update.noteId] = (counts[update.noteId] || 0) + 1;
      return counts;
    }, {});
    const appointmentEntries: TimelineEntry[] = appointments.flatMap((appointment) => (
      appointment.id === undefined
        ? []
        : [{
          kind: "appointment" as const,
          id: appointment.id,
          dateKey: localDateKey(appointment.date),
          sortKey: localSortKey(appointment.date, appointment.time),
          appointment,
        }]
    ));
    const noteEntries: TimelineEntry[] = notes.flatMap((note) => (
      note.id === undefined
        ? []
        : [{
          kind: "note" as const,
          id: note.id,
          dateKey: localDateKey(note.date),
          sortKey: localSortKey(note.date),
          note,
          updateCount: updateCounts[note.id] || 0,
          updates: noteUpdates.filter((update) => update.noteId === note.id),
        }]
    ));

    return [...appointmentEntries, ...noteEntries].sort((left, right) => right.sortKey - left.sortKey);
  }, [appointments, notes, noteUpdates]);

  const filteredEntries = entries.filter((entry) => {
    if (filter === "appointments") return entry.kind === "appointment";
    if (filter === "notes") return entry.kind === "note";
    if (filter === "flagged") {
      return entry.kind === "note"
        && noteIsFlaggedForDoctor(entry.note)
        && (flaggedPhysicianId === null || entry.note.flaggedPhysicianId === flaggedPhysicianId);
    }
    return true;
  });
  const groups = filteredEntries.reduce<Array<{ dateKey: string; entries: TimelineEntry[] }>>((all, entry) => {
    const group = all.find((item) => item.dateKey === entry.dateKey);
    if (group) {
      group.entries.push(entry);
    } else {
      all.push({ dateKey: entry.dateKey, entries: [entry] });
    }
    return all;
  }, []);
  const isLoading = appointmentsLoading || notesLoading;
  const physicianName = (id: number | null | undefined) => physicians.find((physician) => physician.id === id)?.name;
  const filterLabel = filter === "flagged" && flaggedPhysicianId !== null
    ? `Flagged for doctor — ${physicianName(flaggedPhysicianId) || "selected doctor"}`
    : FILTERS.find((item) => item.id === filter)?.label || "All";
  const historyDocument: HistoryCopyDocument = {
    title: "Timeline",
    profileName: activePatient?.name || "Patient profile",
    filterLabel,
    blocks: groups.map((group) => ({
      date: formatHistoryDate(group.dateKey),
      lines: group.entries.flatMap((entry) => {
        if (entry.kind === "appointment") {
          const appointment = entry.appointment;
          return [
            "Appointment",
            appointment.title,
            appointment.type ? `Type: ${appointment.type}` : "",
            appointment.time ? `Time: ${appointment.time}` : "",
            appointment.location ? `Location: ${appointment.location}` : "",
            appointment.status ? `Status: ${appointment.status}` : "",
            appointment.notes ? `Notes: ${appointment.notes}` : "",
            appointment.visitSummary ? `Visit summary: ${appointment.visitSummary}` : "",
            appointment.diagnosisFindings ? `Diagnosis / findings: ${appointment.diagnosisFindings}` : "",
            appointment.providerInstructions ? `Provider instructions: ${appointment.providerInstructions}` : "",
            appointment.medicationChanges ? `Medication changes: ${appointment.medicationChanges}` : "",
            appointment.testsOrdered ? `Tests ordered: ${appointment.testsOrdered}` : "",
            appointment.referrals ? `Referrals: ${appointment.referrals}` : "",
            appointment.followUpDate ? `Follow-up: ${formatHistoryDate(localDateKey(appointment.followUpDate))}` : "",
            appointment.questionsNextTime ? `Questions for next time: ${appointment.questionsNextTime}` : "",
          ].filter(Boolean);
        }
        const note = entry.note;
        const doctor = physicianName(note.flaggedPhysicianId);
        return [
          `Note — ${noteCategory(note)}`,
          note.text,
          noteIsFlaggedForDoctor(note) ? `Flagged for doctor: Yes${doctor ? ` — ${doctor}` : ""}` : "",
          ...entry.updates.flatMap((update) => [
            `Follow-up (${formatHistoryDate(localDateKey(update.date))}):`,
            update.text,
          ]),
        ].filter(Boolean);
      }),
    })),
  };

  return (
    <div className="w-full max-w-4xl min-w-0 overflow-x-hidden p-4 md:p-6" data-testid="timeline-page">
      <div className="space-y-6 min-w-0">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 px-1 py-1.5 text-sm font-semibold text-muted-foreground hover:text-primary"
          data-testid="link-timeline-back-to-dashboard"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <HistoryPrintHeading document={historyDocument} />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Timeline</h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            Appointments and notes together, newest first.
          </p>
        </div>

        <div
          className="no-print max-w-full overflow-x-auto overscroll-x-contain pb-1"
          data-testid="timeline-filter-row"
        >
          <div className="flex w-max min-w-full gap-2" role="group" aria-label="Filter timeline">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFilter(item.id);
                  if (item.id !== "flagged") setFlaggedPhysicianId(null);
                }}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${
                  filter === item.id
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                aria-pressed={filter === item.id}
                data-testid={`filter-timeline-${item.id}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {filter === "flagged" && physicians.length > 0 && (
          <div className="no-print flex min-w-0 items-center gap-2">
            <label htmlFor="timeline-physician-filter" className="shrink-0 text-sm font-semibold text-muted-foreground">
              Doctor
            </label>
            <select
              id="timeline-physician-filter"
              value={flaggedPhysicianId ?? ""}
              onChange={(event) => setFlaggedPhysicianId(event.target.value ? Number(event.target.value) : null)}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="filter-timeline-physician"
            >
              <option value="">Any doctor</option>
              {physicians.map((physician) => (
                <option key={physician.id} value={physician.id}>{physician.name}</option>
              ))}
            </select>
          </div>
        )}

        <HistoryActions document={historyDocument} />

        {isLoading ? (
          <div className="space-y-4" data-testid="timeline-loading">
            {[1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : groups.length === 0 ? (
          <Card data-testid={`timeline-empty-${filter}`}>
            <CardContent className="py-12 text-center">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-base text-muted-foreground">{emptyMessage(filter)}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-7" data-testid="timeline-list">
            {groups.map((group) => (
              <section key={group.dateKey} className="min-w-0" data-testid={`timeline-date-group-${group.dateKey}`}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-foreground sm:text-lg">{formatHistoryDate(group.dateKey)}</h2>
                  <div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
                </div>
                <div className="ml-1 border-l-2 border-primary/20 pl-4 sm:pl-5">
                  <div className="space-y-3">
                    {group.entries.map((entry) => (
                      entry.kind === "appointment" ? (
                        <Link
                          key={`appointment-${entry.id}`}
                          href="/appointments"
                          className="block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print-history-entry"
                          data-testid={`timeline-item-appointment-${entry.id}`}
                        >
                          <Card className="min-w-0 overflow-hidden transition-colors hover:border-primary/35 print-history-entry">
                            <CardContent className="flex min-w-0 gap-3 p-4 sm:p-5">
                              <span
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-800 ring-1 ring-sky-500/20 dark:bg-sky-300/15 dark:text-sky-100 dark:ring-sky-300/30"
                                data-testid={`timeline-appointment-icon-${entry.id}`}
                              >
                                <CalendarDays className="h-5 w-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appointment</span>
                                  {entry.appointment.type && (
                                    <span className="text-xs font-medium text-muted-foreground">{entry.appointment.type}</span>
                                  )}
                                </div>
                                <h3 className="mt-1 break-words text-base font-semibold text-foreground">{entry.appointment.title}</h3>
                                <p className="mt-1 break-words text-sm text-muted-foreground">{formatAppointmentTime(entry.appointment)}</p>
                                {entry.appointment.location && (
                                  <p className="mt-1 break-words text-sm text-muted-foreground">{entry.appointment.location}</p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      ) : (
                        <Link
                          key={`note-${entry.id}`}
                          href="/notes"
                          className="block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print-history-entry"
                          data-testid={`timeline-item-note-${entry.id}`}
                        >
                          <Card className="min-w-0 overflow-hidden transition-colors hover:border-primary/35 print-history-entry">
                            <CardContent className="flex min-w-0 gap-3 p-4 sm:p-5">
                              <span
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${noteTone(noteCategory(entry.note))}`}
                                data-testid={`timeline-note-icon-${entry.id}`}
                              >
                                <NotebookPen className="h-5 w-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${noteTone(noteCategory(entry.note))}`}
                                    data-testid={`timeline-note-category-${entry.id}`}
                                  >
                                    {noteCategory(entry.note)}
                                  </span>
                                  {noteIsFlaggedForDoctor(entry.note) && (
                                    <span
                                      className="inline-flex min-h-7 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                                      data-testid={`timeline-note-flag-${entry.id}`}
                                    >
                                      <Flag className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                      Mention next appointment
                                    </span>
                                  )}
                                  {noteIsFlaggedForDoctor(entry.note) && typeof entry.note.flaggedPhysicianId === "number" && physicians.find((physician) => physician.id === entry.note.flaggedPhysicianId) && (
                                    <span
                                      className="inline-flex min-h-7 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                                      data-testid={`timeline-note-flag-physician-${entry.id}`}
                                    >
                                      For {physicians.find((physician) => physician.id === entry.note.flaggedPhysicianId)!.name}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">{entry.note.text}</p>
                                {entry.updateCount > 0 && (
                                  <p
                                    className="mt-2 inline-flex min-h-7 items-center gap-1 text-sm font-medium text-muted-foreground"
                                    data-testid={`timeline-note-update-count-${entry.id}`}
                                  >
                                    <ClipboardPenLine className="h-4 w-4 text-primary" aria-hidden="true" />
                                    {entry.updateCount} {entry.updateCount === 1 ? "update" : "updates"}
                                  </p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      )
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
