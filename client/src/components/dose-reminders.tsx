// Per-medication dose reminders: the opt-in control, the explainer every new
// setup passes through, the settings form, and the card's next-due block.
//
// Two rules shape this file.
//
// Opt-in per medication. Reminders are off until someone deliberately turns
// them on for one specific medication. Plenty of entries in this app are a
// daily vitamin or a record of something taken years ago, and a notifier for
// every one of them would be noise the user has to go switch off. There is no
// "remind me about everything" path on purpose.
//
// The explainer is not a one-time tip. It appears every time a NEW notifier is
// set up, because the thing that surprises people is specific to the medication
// in front of them: what leaves the device for it, and when its reminders will
// land. Someone who understood it for their antibiotic has not necessarily
// thought it through for a 4-hour painkiller.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock,
  Loader2,
  Moon,
  ShieldAlert,
} from "lucide-react";
import {
  DOSE_DEFAULT_GRACE_MIN,
  DOSE_DEFAULT_WINDOW_END,
  DOSE_DEFAULT_WINDOW_START,
  describeInterval,
  disableDoseSchedule,
  formatDueLabel,
  formatRelativeToNow,
  getDoseSchedule,
  getOpenDose,
  isDoseSchedulingAvailable,
  logDose,
  parseFrequencyToIntervalMin,
  saveDoseSchedule,
  type DoseSchedule,
  type LogDoseResult,
} from "@/lib/dose-schedule";
import { mirrorDoseLocally } from "@/lib/dose-mirror";
import { detectPhoneReminderState } from "@/lib/reminder-sync";
import type { Medication } from "@shared/schema";

// === Shared query plumbing ===

function scheduleKey(medId: number) {
  return ["dose-schedule", medId] as const;
}

function openDoseKey(scheduleId: string) {
  return ["dose-open", scheduleId] as const;
}

function refreshDoseState(medId: number) {
  queryClient.invalidateQueries({ queryKey: ["dose-schedule", medId] });
  queryClient.invalidateQueries({ queryKey: ["dose-open"] });
  queryClient.invalidateQueries({ queryKey: ["medication-logs"] });
}

function useSchedule(medId: number | undefined) {
  return useQuery({
    queryKey: scheduleKey(medId ?? -1),
    queryFn: () => getDoseSchedule(medId as number),
    enabled: isDoseSchedulingAvailable() && typeof medId === "number",
    staleTime: 30_000,
  });
}

// === Interval editing ===

type IntervalUnit = "minutes" | "hours" | "days";

function splitInterval(intervalMin: number): {
  value: number;
  unit: IntervalUnit;
} {
  if (intervalMin % 1440 === 0)
    return { value: intervalMin / 1440, unit: "days" };
  if (intervalMin % 60 === 0) return { value: intervalMin / 60, unit: "hours" };
  return { value: intervalMin, unit: "minutes" };
}

function joinInterval(value: number, unit: IntervalUnit): number {
  const mult = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  return Math.round(value * mult);
}

// Mirrors the server's check constraint so the form can explain a bad value
// instead of letting the insert fail with a Postgres error.
const MIN_INTERVAL_MIN = 15;
const MAX_INTERVAL_MIN = 10080;

// === The opt-in control ===

/**
 * The card's reminder control. Renders nothing at all when the build has no
 * backend configured: a button that cannot work is worse than no button.
 */
export function DoseReminderButton({ med }: { med: Medication }) {
  const [step, setStep] = useState<"closed" | "explainer" | "settings">(
    "closed",
  );
  const { data: schedule } = useSchedule(med.id);

  if (!isDoseSchedulingAvailable() || typeof med.id !== "number") return null;

  const on = Boolean(schedule?.enabled);

  return (
    <>
      <Button
        size="sm"
        variant={on ? "secondary" : "ghost"}
        className="h-11 px-3 text-sm"
        // A brand-new notifier goes through the explainer. Editing one that
        // already exists does not — the user has read it for this medication.
        // Deliberately never disabled while the lookup is in flight. This
        // control depends on a network round trip, and a button that cannot be
        // pressed because the backend is slow or unreachable just looks broken.
        onClick={() => setStep(schedule ? "settings" : "explainer")}
        data-testid={`button-dose-reminders-${med.id}`}
      >
        {on ? (
          <>
            <BellRing className="mr-1 h-3.5 w-3.5" /> Reminders on
          </>
        ) : (
          <>
            <BellOff className="mr-1 h-3.5 w-3.5" /> Remind me
          </>
        )}
      </Button>

      <DoseExplainerDialog
        med={med}
        open={step === "explainer"}
        onCancel={() => setStep("closed")}
        onContinue={() => setStep("settings")}
      />

      <DoseSettingsDialog
        med={med}
        schedule={schedule ?? null}
        open={step === "settings"}
        onClose={() => setStep("closed")}
      />
    </>
  );
}

// === The explainer ===

/**
 * Shown before every new notifier is created. Four things people get wrong,
 * said plainly and in the order they matter:
 *
 *   1. what leaves this device (the app's whole promise is that records stay
 *      local, so scheduling something server-side has to be disclosed here,
 *      not in a settings page nobody opens)
 *   2. that the clock restarts from the dose the user records, not the one the
 *      app asked for
 *   3. that reminders stay inside daytime hours unless told otherwise
 *   4. that a push notification is not a guarantee
 */
function DoseExplainerDialog({
  med,
  open,
  onCancel,
  onContinue,
}: {
  med: Medication;
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const phone = detectPhoneReminderState();
  const needsPhoneSetup = phone.status !== "subscribed";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className={DOSE_DIALOG_CLASS}>
        <div className="border-b border-border px-4 py-4 pr-12 sm:px-6 sm:pr-12">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="font-heading flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Before you turn on reminders
            </DialogTitle>
            <DialogDescription>
              How reminders for{" "}
              <span className="font-medium text-foreground">{med.name}</span>{" "}
              will behave.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                <span className="font-semibold">
                  A reminder has to leave this device.
                </span>{" "}
                Your phone can't wake itself up for a medication while the app
                is closed, so the schedule is stored online: the name you choose
                for the reminder, the times, and nothing else. Your dosage,
                prescriber, pharmacy, purpose, side effects and notes stay in
                this browser, as always. You can name the reminder something
                vague like "morning pill" if you'd rather.
              </span>
            </li>
            <li className="flex gap-2">
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                <span className="font-semibold">
                  The clock restarts when you record a dose.
                </span>{" "}
                Not when the reminder was due. Take a 4-hour medication 40
                minutes late and the next reminder is 4 hours after you took it.
              </span>
            </li>
            <li className="flex gap-2">
              <Moon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                <span className="font-semibold">
                  Reminders stay in daytime hours.
                </span>{" "}
                Otherwise an every-few-hours medication walks steadily around
                the clock and starts waking you at 2 AM. Reminders are held to{" "}
                {formatClock(DOSE_DEFAULT_WINDOW_START)} –{" "}
                {formatClock(DOSE_DEFAULT_WINDOW_END)} unless you change it, and
                you can allow overnight reminders on the next screen if you need
                them.
              </span>
            </li>
            <li className="flex gap-2">
              <BellOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <span className="font-semibold">
                  Don't rely on this alone for a critical medication.
                </span>{" "}
                This is a reminder tool, not a medical device. Notifications can
                be delayed or dropped by your phone, your browser, or the
                network — no app can promise otherwise.
              </span>
            </li>
          </ul>

          {needsPhoneSetup && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Phone reminders aren't switched on for this device yet. You can
              set this schedule up now, but it won't reach your phone until you
              turn on phone reminders in Settings.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border px-4 py-3 sm:gap-2 sm:px-6">
          <Button
            variant="outline"
            className="mt-0 h-11 text-base sm:h-10 sm:text-sm"
            onClick={onCancel}
            data-testid={`button-dose-explainer-cancel-${med.id}`}
          >
            Not now
          </Button>
          <Button
            className="h-11 text-base font-semibold sm:h-10 sm:text-sm"
            onClick={onContinue}
            data-testid={`button-dose-explainer-continue-${med.id}`}
          >
            Set up reminders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Mirrors MED_DIALOG_CLASS on the medications page. The stock dialog is a
// centred box that overflows its own edges on a 390px screen — help text and the
// overnight switch get clipped — so both dose dialogs use the app's established
// full-screen-sheet-on-mobile shape with an inner scroll area instead.
const DOSE_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(560px,calc(100vw-2rem))] sm:max-w-[560px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

/** "08:00" -> "8:00 AM". Falls back to the raw value rather than showing NaN. */
function formatClock(hhmm: string): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm;
  const date = new Date();
  date.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// === The settings form ===

function DoseSettingsDialog({
  med,
  schedule,
  open,
  onClose,
}: {
  med: Medication;
  schedule: DoseSchedule | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const guessed = parseFrequencyToIntervalMin(med.frequency);

  const [label, setLabel] = useState("");
  const [intervalValue, setIntervalValue] = useState(4);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("hours");
  const [overnight, setOvernight] = useState(false);
  const [windowStart, setWindowStart] = useState(DOSE_DEFAULT_WINDOW_START);
  const [windowEnd, setWindowEnd] = useState(DOSE_DEFAULT_WINDOW_END);
  const [maxPerDay, setMaxPerDay] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload from the schedule each time the dialog opens, so a cancelled edit
  // does not leave stale values behind for the next open.
  useEffect(() => {
    if (!open) return;
    const initial = schedule
      ? splitInterval(schedule.interval_min)
      : splitInterval(guessed ?? 240);
    setLabel(schedule?.label ?? med.name ?? "");
    setIntervalValue(initial.value);
    setIntervalUnit(initial.unit);
    const hasWindow = schedule ? Boolean(schedule.window_start) : true;
    setOvernight(!hasWindow);
    setWindowStart(schedule?.window_start ?? DOSE_DEFAULT_WINDOW_START);
    setWindowEnd(schedule?.window_end ?? DOSE_DEFAULT_WINDOW_END);
    setMaxPerDay(schedule?.max_per_day ? String(schedule.max_per_day) : "");
    setEndsOn(schedule?.ends_on ?? "");
    setError(null);
  }, [open, schedule, med.name, guessed]);

  const intervalMin = joinInterval(intervalValue, intervalUnit);
  const intervalBad =
    !Number.isFinite(intervalMin) ||
    intervalMin < MIN_INTERVAL_MIN ||
    intervalMin > MAX_INTERVAL_MIN;
  const windowBad = !overnight && windowStart >= windowEnd;

  async function save() {
    if (!label.trim()) {
      setError(
        "Give the reminder a name — it's what the notification will say.",
      );
      return;
    }
    if (intervalBad) {
      setError("Choose an interval between 15 minutes and 7 days.");
      return;
    }
    if (windowBad) {
      setError("The daily window has to start before it ends.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDoseSchedule(med.id as number, {
        label: label.trim(),
        intervalMin,
        anchor: "from_last_dose",
        windowStart: overnight ? null : windowStart,
        windowEnd: overnight ? null : windowEnd,
        maxPerDay: maxPerDay ? Number(maxPerDay) : null,
        graceMin: DOSE_DEFAULT_GRACE_MIN,
        endsOn: endsOn || null,
        enabled: true,
      });
      refreshDoseState(med.id as number);
      toast({
        title: "Reminders on",
        description: `${describeInterval(intervalMin)}, starting now.`,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the schedule.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function turnOff() {
    setSaving(true);
    setError(null);
    try {
      await disableDoseSchedule(med.id as number);
      refreshDoseState(med.id as number);
      toast({
        title: "Reminders off",
        description: "Your recorded doses are kept.",
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not turn reminders off.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={DOSE_DIALOG_CLASS}>
        <div className="border-b border-border px-4 py-4 pr-12 sm:px-6 sm:pr-12">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="font-heading">Dose reminders</DialogTitle>
            <DialogDescription>
              For{" "}
              <span className="font-medium text-foreground">{med.name}</span>
              {med.dosage ? ` (${med.dosage})` : ""}.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-2">
            <Label htmlFor={`dose-label-${med.id}`}>Notification says</Label>
            <Input
              id={`dose-label-${med.id}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              data-testid={`input-dose-label-${med.id}`}
            />
            <p className="text-xs text-muted-foreground">
              This is the one piece of text that leaves your device. Make it
              vaguer if you'd rather it not show a drug name on your lock
              screen.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Remind me every</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={intervalValue}
                onChange={(e) => setIntervalValue(Number(e.target.value))}
                className="w-24"
                data-testid={`input-dose-interval-${med.id}`}
              />
              <Select
                value={intervalUnit}
                onValueChange={(v) => setIntervalUnit(v as IntervalUnit)}
              >
                <SelectTrigger
                  className="w-36"
                  data-testid={`select-dose-unit-${med.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                  <SelectItem value="days">days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {guessed && !schedule && (
              <p className="text-xs text-muted-foreground">
                Filled in from "{med.frequency}" — change it if that's not
                right.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Counted from the moment you record a dose, not from when the
              reminder was due.
            </p>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor={`dose-overnight-${med.id}`}>
                  Allow overnight reminders
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off means reminders wait until morning instead of waking you.
                </p>
              </div>
              <Switch
                id={`dose-overnight-${med.id}`}
                checked={overnight}
                onCheckedChange={setOvernight}
                data-testid={`switch-dose-overnight-${med.id}`}
              />
            </div>

            {!overnight && (
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor={`dose-window-start-${med.id}`}
                    className="text-xs"
                  >
                    Not before
                  </Label>
                  <Input
                    id={`dose-window-start-${med.id}`}
                    type="time"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className="w-32"
                    data-testid={`input-dose-window-start-${med.id}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`dose-window-end-${med.id}`}
                    className="text-xs"
                  >
                    Not after
                  </Label>
                  <Input
                    id={`dose-window-end-${med.id}`}
                    type="time"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className="w-32"
                    data-testid={`input-dose-window-end-${med.id}`}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`dose-max-${med.id}`}>Most doses in a day</Label>
              <Input
                id={`dose-max-${med.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={24}
                placeholder="No limit"
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(e.target.value)}
                data-testid={`input-dose-max-${med.id}`}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Stops reminding once you've hit this many.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`dose-ends-${med.id}`}>
                Stop reminding after
              </Label>
              <Input
                id={`dose-ends-${med.id}`}
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                data-testid={`input-dose-ends-${med.id}`}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Useful for a course that ends.
              </p>
            </div>
          </div>

          {error && (
            <p
              className="text-sm font-medium text-destructive"
              role="alert"
              data-testid={`text-dose-error-${med.id}`}
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border px-4 py-3 sm:gap-2 sm:px-6">
          {schedule?.enabled && (
            <Button
              variant="outline"
              className="mt-0 h-11 text-base sm:mr-auto sm:h-10 sm:text-sm"
              onClick={turnOff}
              disabled={saving}
              data-testid={`button-dose-turn-off-${med.id}`}
            >
              <BellOff className="mr-1 h-4 w-4" /> Turn off
            </Button>
          )}
          <Button
            variant="ghost"
            className="mt-0 h-11 text-base sm:h-10 sm:text-sm"
            onClick={onClose}
            disabled={saving}
            data-testid={`button-dose-cancel-${med.id}`}
          >
            Cancel
          </Button>
          <Button
            className="h-11 text-base font-semibold sm:h-10 sm:text-sm"
            onClick={save}
            disabled={saving}
            data-testid={`button-dose-save-${med.id}`}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              <>Save</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// === The card's next-due block ===

/**
 * Replaces the once-a-day taken/skipped row for a medication with reminders on.
 *
 * Returns null when there is no enabled schedule, which is how the medication
 * card decides to fall back to its normal local behaviour — a medication
 * without reminders works exactly as it did before any of this existed.
 */
export function DoseNextDue({ med }: { med: Medication }) {
  const { data: schedule } = useSchedule(med.id);
  const [pendingForce, setPendingForce] = useState<LogDoseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const enabled = Boolean(schedule?.enabled);
  const { data: openDose } = useQuery({
    queryKey: openDoseKey(schedule?.id ?? "none"),
    queryFn: () => getOpenDose(schedule!.id),
    enabled: enabled && Boolean(schedule?.id),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!enabled || !schedule) return null;

  async function record(taken: boolean, force = false) {
    // Re-narrowed inside the closure: the guard above runs at render time,
    // this runs on a tap that could land after a refetch cleared either one.
    const sched = schedule;
    if (!openDose || !sched) return;
    setBusy(true);
    try {
      const at = new Date();
      const outcome = await logDose(openDose.id, taken, { at, force });

      if (outcome.outcome === "too_soon") {
        setPendingForce(outcome);
        return;
      }
      if (outcome.outcome === "logged") {
        await mirrorDoseLocally(sched, taken, at);
      }
      refreshDoseState(med.id as number);

      if (outcome.outcome === "already_logged") {
        toast({
          title: "Already recorded",
          description: "This dose was recorded somewhere else.",
        });
      } else if (outcome.next_due_at) {
        toast({
          title: taken ? "Dose recorded" : "Dose skipped",
          description: `Next dose ${formatDueLabel(outcome.next_due_at)}.`,
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't record that dose",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const due = openDose
    ? new Date(openDose.due_at).getTime() <= Date.now()
    : false;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={`dose-next-${med.id}`}
    >
      {openDose ? (
        <>
          <span
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${
              due
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {due ? "Dose due" : "Next dose"} {formatDueLabel(openDose.due_at)}
            <span className="font-normal">
              ({formatRelativeToNow(openDose.due_at)})
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-11 px-4 text-sm"
            onClick={() => record(true)}
            disabled={busy}
            data-testid={`button-dose-take-${med.id}`}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> I took it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-3 text-sm text-muted-foreground"
            onClick={() => record(false)}
            disabled={busy}
            data-testid={`button-dose-skip-${med.id}`}
          >
            Skip
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {describeInterval(schedule.interval_min)} — scheduling the next dose.
        </span>
      )}

      {/* too_soon is not an error. The spacing guard exists to catch a double
          tap or a forgotten dose, but a dose genuinely taken early is a real
          thing, so the user gets told the spacing and allowed to proceed. */}
      <AlertDialog
        open={Boolean(pendingForce)}
        onOpenChange={(o) => !o && setPendingForce(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">
              That's earlier than scheduled
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingForce?.minutes_remaining
                ? `This dose isn't due for another ${pendingForce.minutes_remaining} minute${
                    pendingForce.minutes_remaining === 1 ? "" : "s"
                  }. `
                : "This dose isn't due yet. "}
              Record it anyway only if you actually took it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel
              className="mt-0 h-11 text-base sm:h-10 sm:text-sm"
              data-testid={`button-dose-force-cancel-${med.id}`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 text-base font-semibold sm:h-10 sm:text-sm"
              onClick={() => {
                setPendingForce(null);
                void record(true, true);
              }}
              data-testid={`button-dose-force-confirm-${med.id}`}
            >
              Record it anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** True when this medication has reminders on — the card uses it to choose. */
export function useHasDoseReminders(medId: number | undefined): boolean {
  const { data } = useSchedule(medId);
  return Boolean(data?.enabled);
}
