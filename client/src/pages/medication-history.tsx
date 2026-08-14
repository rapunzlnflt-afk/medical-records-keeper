import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { subDays, format } from "date-fns";
import { ArrowLeft, CheckCircle2, Clock, Pill, XCircle } from "lucide-react";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMedication, getMedicationLogs } from "@/lib/db";
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

  const sortedLogs = useMemo(() => [...logs].sort((left, right) => (
    localSortKey(right.date, right.time) - localSortKey(left.date, left.time)
  )), [logs]);
  const thirtyDayStart = format(subDays(new Date(), 29), "yyyy-MM-dd");
  const lastThirtyDays = sortedLogs.filter((log) => localDateKey(log.date) >= thirtyDayStart && localDateKey(log.date) <= localTodayKey());
  const takenCount = lastThirtyDays.filter((log) => log.taken === 1).length;
  const skippedCount = lastThirtyDays.filter((log) => log.taken !== 1).length;
  const groups = sortedLogs.reduce<Array<{ dateKey: string; logs: MedicationLog[] }>>((all, log) => {
    const dateKey = localDateKey(log.date);
    const current = all[all.length - 1];
    if (current?.dateKey === dateKey) current.logs.push(log);
    else all.push({ dateKey, logs: [log] });
    return all;
  }, []);

  const historyDocument: HistoryCopyDocument = {
    title: medication ? `${medication.name} dose history` : "Dose history",
    profileName: activePatient?.name || "Patient profile",
    filterLabel: "All logged doses",
    blocks: groups.map((group) => ({
      date: formatHistoryDate(group.dateKey),
      lines: group.logs.map((log) => `${formatDoseTime(log.time)} — ${log.taken === 1 ? "Taken" : "Skipped"}${log.notes ? `\nNotes: ${log.notes}` : ""}`),
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
                    </div>
                    <p className="text-base text-foreground" data-testid="text-adherence-summary">{takenCount} of {lastThirtyDays.length} logged doses taken.</p>
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
                        <Card key={log.id} className="min-w-0 overflow-hidden print-history-entry" data-testid={`dose-log-entry-${log.id}`}>
                          <CardContent className="flex min-w-0 items-start gap-3 p-4 sm:p-5">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${log.taken === 1 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                              {log.taken === 1 ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                            </span>
                            <div className="min-w-0 flex-1"><p className="text-base font-semibold text-foreground">{log.taken === 1 ? "Taken" : "Skipped"}</p><p className="mt-1 text-sm text-muted-foreground">{formatDoseTime(log.time)}</p>{log.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{log.notes}</p>}</div>
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
