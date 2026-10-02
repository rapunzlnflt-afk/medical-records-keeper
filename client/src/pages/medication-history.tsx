import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { subDays, format } from "date-fns";
import { AlarmClockOff, ArrowLeft, CheckCircle2, Clock, Pill, XCircle } from "lucide-react";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMedication, getMedicationLogs } from "@/lib/db";
import { getDoseSchedule, listDoseEvents } from "@/lib/dose-schedule";
import { usePatient } from "@/lib/patient-context";
import { HistoryActions, HistoryPrintHeading } from "@/components/history-actions";
import { formatHistoryDate, localDateKey, localSortKey, localTodayKey, type HistoryCopyDocument } from "@/lib/history-actions";
import type { MedicationLog } from "@shared/schema";

function formatDoseTime(value: string | null): string {
  if (!value) return "Time not recorded";
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return format(new Date(2000, 0, 1, hours, minutes), "h:mm a");
}

type EntryKind = "taken" | "skipped" | "missed";

/**
 * One row in the history. Taken and skipped doses live in the local log (the
 * dose sheet mirrors them there). A missed dose exists only on the server: it
 * is recorded when nobody answers a reminder before its grace period ends, so
 * no local log is ever written for it.
 */
interface HistoryEntry {
  key: string;
  date: string;
  time: string | null;
  kind: EntryKind;
  notes: string | null;
}

const KIND_LABEL: Record<EntryKind, string> = { taken: "Taken", skipped: "Skipped", missed: "Missed" };

const KIND_STYLE: Record<EntryKind, string> = {
  taken: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  missed: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

function entryTimeLabel(entry: HistoryEntry): string {
  const time = formatDoseTime(entry.time);
  return entry.kind === "missed" ? `Was due ${time}` : time;
}

export default function MedicationHistory() {
  const [, params] = useRoute("/medications/:id");
  const medicationId = Number(params?.id);
  const { activePatient, activePatientId } = usePatient();
  const { data: medication, isLoading: medicationLoading } = useQuery({
    queryKey: ["medication", medicationId],
    queryFn: () => getMedication(medicationId),
    enabled: Number.isInteger(medicationId) && medicationId > 0,
  });
  const { data: logs = [], isLoading: logsLoading } = useQuery<MedicationLog[]>({
    queryKey: ["medication-logs", medicationId],
    queryFn: () => getMedicationLogs(medicationId),
    enabled: Number.isInteger(medicationId) && medicationId > 0,
  });

  // Read-only: getDoseSchedule and listDoseEvents use the existing session and
  // never sign in, so opening History cannot create anything on the server.
  // Offline or with no schedule, both resolve empty and History is local only.
  const { data: missedEvents = [] } = useQuery({
    queryKey: ["dose-missed", medicationId],
    queryFn: async () => {
      const schedule = await getDoseSchedule(medicationId);
      if (!schedule) return [];
      const events = await listDoseEvents(schedule.id, 500);
      return events.filter((event) => event.status === "missed");
    },
    enabled: Number.isInteger(medicationId) && medicationId > 0,
  });

  const sortedLogs = useMemo<HistoryEntry[]>(() => {
    const local: HistoryEntry[] = logs.map((log) => ({
      key: `log-${log.id}`,
      date: log.date,
      time: log.time,
      kind: log.taken === 1 ? "taken" : "skipped",
      notes: log.notes || null,
    }));
    const missed: HistoryEntry[] = missedEvents.map((event) => {
      const due = new Date(event.due_at);
      return { key: `missed-${event.id}`, date: format(due, "yyyy-MM-dd"), time: format(due, "HH:mm"), kind: "missed", notes: event.note };
    });
    return [...local, ...missed].sort((left, right) => (
      localSortKey(right.date, right.time) - localSortKey(left.date, left.time)
    ));
  }, [logs, missedEvents]);
  const thirtyDayStart = format(subDays(new Date(), 29), "yyyy-MM-dd");
  const lastThirtyDays = sortedLogs.filter((log) => localDateKey(log.date) >= thirtyDayStart && localDateKey(log.date) <= localTodayKey());
  const takenCount = lastThirtyDays.filter((log) => log.kind === "taken").length;
  const skippedCount = lastThirtyDays.filter((log) => log.kind === "skipped").length;
  const missedCount = lastThirtyDays.filter((log) => log.kind === "missed").length;
  const groups = sortedLogs.reduce<Array<{ dateKey: string; logs: HistoryEntry[] }>>((all, log) => {
    const dateKey = localDateKey(log.date);
    const current = all[all.length - 1];
    if (current?.dateKey === dateKey) current.logs.push(log);
    else all.push({ dateKey, logs: [log] });
    return all;
  }, []);

  const historyDocument: HistoryCopyDocument = {
    title: medication ? `${medication.name} dose history` : "Dose history",
    profileName: activePatient?.name || "Patient profile",
    filterLabel: "All doses",
    blocks: groups.map((group) => ({
      date: formatHistoryDate(group.dateKey),
      lines: group.logs.map((log) => `${entryTimeLabel(log)} — ${KIND_LABEL[log.kind]}${log.notes ? `\nNotes: ${log.notes}` : ""}`),
    })),
  };

  const unavailable = !medicationLoading && (!medication || medication.patientId !== activePatientId);

  return (
    <div className="w-full max-w-4xl min-w-0 overflow-x-hidden p-4 md:p-6" data-testid="medication-history-page">
      <div className="space-y-6 min-w-0">
        <Link href="/medications" className="no-print inline-flex min-h-11 items-center gap-1.5 px-1 py-1.5 text-sm font-semibold text-muted-foreground hover:text-primary" data-testid="link-medication-history-back">
          <ArrowLeft className="h-4 w-4" /> Back to Medications
        </Link>

        {unavailable ? (
          <Card data-testid="medication-history-unavailable"><CardContent className="py-12 text-center text-muted-foreground">This medication is unavailable for the active profile.</CardContent></Card>
        ) : medicationLoading ? (
          <div className="space-y-4" data-testid="medication-history-loading"><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>
        ) : medication && (
          <>
            <HistoryPrintHeading document={historyDocument} />
            <div className="no-print min-w-0">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full gradient-primary"><Pill className="h-5 w-5 text-white" /></span>
                <div className="min-w-0">
                  <h1 className="break-words font-heading text-2xl font-bold tracking-tight sm:text-3xl">{medication.name}</h1>
                  <p className="mt-1 text-base text-muted-foreground">{medication.dosage}</p>
                </div>
              </div>
            </div>

            <Card data-testid="card-adherence-summary">
              <CardHeader className="pb-2"><CardTitle className="text-lg">Last 30 days</CardTitle></CardHeader>
              <CardContent>
                {lastThirtyDays.length === 0 ? (
                  <p className="text-base text-muted-foreground" data-testid="text-adherence-summary">No doses have been logged in the last 30 days.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
                      <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" /> {takenCount} taken</span>
                      <span className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-300"><XCircle className="h-4 w-4" /> {skippedCount} skipped</span>
                      {missedCount > 0 && <span className="inline-flex items-center gap-1.5 text-rose-800 dark:text-rose-300" data-testid="text-missed-count"><AlarmClockOff className="h-4 w-4" /> {missedCount} missed</span>}
                    </div>
                    <p className="text-base text-foreground" data-testid="text-adherence-summary">{takenCount} of {lastThirtyDays.length} {missedCount > 0 ? "doses" : "logged doses"} taken.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <HistoryActions document={historyDocument} />

            {logsLoading ? (
              <div className="space-y-4" data-testid="dose-history-loading"><div className="h-28 animate-pulse rounded-lg bg-muted" /></div>
            ) : groups.length === 0 ? (
              <Card data-testid="dose-history-empty"><CardContent className="py-12 text-center"><Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" /><p className="text-base text-muted-foreground">No doses have been logged for this medication yet.</p></CardContent></Card>
            ) : (
              <div className="space-y-7" data-testid="dose-history-list">
                {groups.map((group) => (
                  <section key={group.dateKey} className="min-w-0 print-history-entry" data-testid={`dose-date-group-${group.dateKey}`}>
                    <div className="mb-3 flex items-center gap-3"><div className="h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" /><h2 className="min-w-0 break-words text-base font-semibold text-foreground sm:text-lg">{formatHistoryDate(group.dateKey)}</h2><div className="h-px min-w-0 flex-1 bg-border" /></div>
                    <div className="ml-1 border-l-2 border-primary/20 pl-4 sm:pl-5"><div className="space-y-3">
                      {group.logs.map((log) => (
                        <Card key={log.key} className="min-w-0 overflow-hidden print-history-entry" data-testid={`dose-log-entry-${log.key}`}>
                          <CardContent className="flex min-w-0 items-start gap-3 p-4 sm:p-5">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${KIND_STYLE[log.kind]}`}>
                              {log.kind === "taken" ? <CheckCircle2 className="h-5 w-5" /> : log.kind === "missed" ? <AlarmClockOff className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                            </span>
                            <div className="min-w-0 flex-1"><p className="text-base font-semibold text-foreground">{KIND_LABEL[log.kind]}</p><p className="mt-1 text-sm text-muted-foreground">{entryTimeLabel(log)}</p>{log.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{log.notes}</p>}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div></div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
