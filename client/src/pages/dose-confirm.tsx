// Confirm sheet for a single scheduled dose — the landing target for a dose
// notification (`./#/dose/:eventId`).
//
// Why this page exists at all: iOS ignores notification action buttons, so on
// an iPhone the only way to record a dose from a push is to tap the
// notification and land somewhere that can do it in one more tap. That makes
// this page the primary interaction for the whole feature on the platform most
// of these users are on, not a secondary convenience.
//
// It is deliberately a full page rather than a dialog: it has to render
// correctly as a cold start from a notification tap, with no app state behind
// it.

import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  formatDueLabel,
  formatRelativeToNow,
  getDoseEventWithSchedule,
  logDose,
  type DoseEvent,
  type DoseSchedule,
  type LogDoseResult,
} from "@/lib/dose-schedule";
import { createMedicationLog, getMedication } from "@/lib/db";

/**
 * Mirror a server-recorded dose into the local medication log.
 *
 * The server schedules; the browser remains the record of truth. Without this
 * the dose would be missing from the medication's local history, its printout,
 * and its backup — the things the app actually promises to keep. Failure is
 * swallowed: the dose is already recorded server-side and the schedule has
 * moved on, so a local write failure must not present as a failed dose.
 */
async function mirrorDoseLocally(
  schedule: DoseSchedule,
  taken: boolean,
  at: Date,
): Promise<void> {
  try {
    const med = await getMedication(schedule.source_id);
    if (!med) return;
    await createMedicationLog({
      medicationId: schedule.source_id,
      date: format(at, "yyyy-MM-dd"),
      taken: taken ? 1 : 0,
      time: format(at, "HH:mm"),
      notes: null,
    });
  } catch {
    // Intentionally silent — see above.
  }
}

function statusCopy(event: DoseEvent): { title: string; detail: string } {
  const due = formatDueLabel(event.due_at);
  switch (event.status) {
    case "taken":
      return {
        title: "Already recorded",
        detail: event.taken_at
          ? `Taken at ${formatDueLabel(event.taken_at)}.`
          : "This dose is already marked as taken.",
      };
    case "skipped":
      return { title: "Marked as skipped", detail: `This ${due} dose was skipped.` };
    case "missed":
      return {
        title: "Recorded as missed",
        detail: `The ${due} dose passed its grace period, so the next one was scheduled from your usual spacing.`,
      };
    case "superseded":
      return {
        title: "No longer needed",
        detail: "This reminder was replaced by a newer dose.",
      };
    default:
      return { title: "Dose due", detail: "" };
  }
}

export default function DoseConfirm() {
  const [, params] = useRoute("/dose/:eventId");
  const eventId = params?.eventId ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [submitting, setSubmitting] = useState<null | "taken" | "skipped">(null);
  const [result, setResult] = useState<LogDoseResult | null>(null);
  const [tooSoon, setTooSoon] = useState<LogDoseResult | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dose-event", eventId],
    queryFn: () => getDoseEventWithSchedule(eventId),
    enabled: eventId.length > 0,
    // A notification can sit for a while before it is tapped, so never serve
    // this from cache — the dose may already be closed.
    staleTime: 0,
    gcTime: 0,
  });

  // Re-render the "25 minutes ago" line while the page sits open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const event = data?.event ?? null;
  const schedule = data?.schedule ?? null;

  const dueRelative = useMemo(
    () => (event ? formatRelativeToNow(event.due_at) : ""),
    [event],
  );

  async function submit(taken: boolean, force = false) {
    if (!event || !schedule) return;
    setSubmitting(taken ? "taken" : "skipped");
    setTooSoon(null);
    const at = new Date();
    try {
      const outcome = await logDose(event.id, taken, { force });

      if (outcome.outcome === "too_soon" && !force) {
        setTooSoon(outcome);
        return;
      }

      if (outcome.outcome === "logged" && taken) {
        await mirrorDoseLocally(schedule, taken, at);
      } else if (outcome.outcome === "logged" && !taken) {
        await mirrorDoseLocally(schedule, taken, at);
      }

      setResult(outcome);
      queryClient.invalidateQueries({ queryKey: ["medication-logs"] });
      queryClient.invalidateQueries({ queryKey: ["dose-schedules"] });

      if (outcome.outcome === "already_logged") {
        toast({
          title: "Already recorded",
          description: "This dose was logged somewhere else.",
        });
        refetch();
      }
    } catch (err) {
      toast({
        title: "Could not record the dose",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(null);
    }
  }

  const backLink = (
    <Link
      href="/medications"
      className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      data-testid="link-back-to-medications"
    >
      <ArrowLeft className="h-4 w-4" /> Medications
    </Link>
  );

  if (!eventId) {
    return (
      <Shell back={backLink}>
        <EmptyState
          title="No dose selected"
          detail="Open a dose reminder from its notification, or pick the medication from your list."
        />
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell back={backLink}>
        <div className="flex items-center gap-3 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading this dose…</span>
        </div>
      </Shell>
    );
  }

  if (isError || !event || !schedule) {
    return (
      <Shell back={backLink}>
        <EmptyState
          title="This dose could not be found"
          detail="It may have been removed, or this reminder belongs to a different device. Your medication list still has the current schedule."
        />
      </Shell>
    );
  }

  // === Recorded, this visit ===
  if (result && result.outcome !== "already_logged") {
    const takenNow = result.status === "taken";
    return (
      <Shell back={backLink}>
        <Card>
          <CardContent className="space-y-5 p-6 text-center">
            <CheckCircle2
              className="mx-auto h-12 w-12 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold" data-testid="text-dose-recorded">
                {takenNow ? "Dose recorded" : "Dose skipped"}
              </h1>
              <p className="text-muted-foreground">{schedule.label}</p>
            </div>
            {result.next_due_at ? (
              <div className="rounded-lg bg-muted/60 px-4 py-3">
                <p className="text-sm text-muted-foreground">Next dose</p>
                <p className="text-lg font-semibold" data-testid="text-next-due">
                  {formatDueLabel(result.next_due_at)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatRelativeToNow(result.next_due_at)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-course-finished">
                That was the last dose in this course.
              </p>
            )}
            <Button asChild className="w-full h-12 text-base">
              <Link href="/medications">Back to medications</Link>
            </Button>
          </CardContent>
        </Card>
        <Disclaimer />
      </Shell>
    );
  }

  // === Already closed before this visit ===
  if (event.status !== "pending") {
    const copy = statusCopy(event);
    return (
      <Shell back={backLink}>
        <Card>
          <CardContent className="space-y-4 p-6 text-center">
            <Clock className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold" data-testid="text-dose-status">
                {copy.title}
              </h1>
              <p className="text-muted-foreground">{schedule.label}</p>
            </div>
            <p className="text-sm text-muted-foreground">{copy.detail}</p>
            <Button asChild variant="outline" className="w-full h-12 text-base">
              <Link href="/medications">Back to medications</Link>
            </Button>
          </CardContent>
        </Card>
        <Disclaimer />
      </Shell>
    );
  }

  // === Open dose: the main case ===
  // A dose one second past due is not "late" in any sense the user cares about,
  // and the relative line under the time already reads "now" — so a bare
  // timestamp comparison here makes the two lines contradict each other. Only
  // call it overdue once it is late by more than the minute it is displayed in.
  const overdue = new Date(event.due_at).getTime() < Date.now() - 60_000;

  return (
    <Shell back={backLink}>
      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {overdue ? "Dose was due" : "Dose due"}
            </p>
            <h1 className="text-2xl font-semibold break-words" data-testid="text-dose-label">
              {schedule.label}
            </h1>
            {schedule.subject_name && (
              <p className="text-muted-foreground">for {schedule.subject_name}</p>
            )}
            <p className="text-3xl font-semibold tabular-nums" data-testid="text-dose-due-at">
              {formatDueLabel(event.due_at)}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="text-dose-due-relative">
              {dueRelative}
            </p>
          </div>

          {tooSoon && (
            <div
              className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40"
              data-testid="panel-too-soon"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="space-y-3 text-sm">
                <p className="text-amber-900 dark:text-amber-200">
                  {tooSoon.message ??
                    "A dose was recorded very recently, so this one is earlier than the usual spacing."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => submit(true, true)}
                    disabled={submitting !== null}
                    data-testid="button-force-taken"
                  >
                    Record it anyway
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTooSoon(null)}
                    disabled={submitting !== null}
                    data-testid="button-cancel-force"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="h-14 w-full text-base"
              onClick={() => submit(true)}
              disabled={submitting !== null}
              data-testid="button-dose-taken"
            >
              {submitting === "taken" ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Check className="mr-2 h-5 w-5" />
              )}
              I took it
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full text-base"
              onClick={() => submit(false)}
              disabled={submitting !== null}
              data-testid="button-dose-skipped"
            >
              {submitting === "skipped" ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <SkipForward className="mr-2 h-5 w-5" />
              )}
              Skip this dose
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            The next dose is scheduled from the time you record, not from when it
            was due.
          </p>
        </CardContent>
      </Card>
      <Disclaimer />
    </Shell>
  );
}

function Shell({ children, back }: { children: React.ReactNode; back: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-10">
      {back}
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        <Button asChild variant="outline" className="w-full h-12 text-base">
          <Link href="/medications">Back to medications</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Disclaimer() {
  return (
    <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
      This is a reminder tool, not a medical device. Notification delivery is not
      guaranteed — do not rely on it alone for critical medication.
    </p>
  );
}
