// MedRecords Care: the daily care log. Quick taps for meals, therapy, how
// the person is doing, awareness and personal care, with a place to note
// anything that was declined. Everything here stays on this device and is
// included in backups.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Bath, Brain, ChevronLeft, ChevronRight, Dumbbell, Hand, HeartHandshake,
  MoreVertical, Pencil, Shirt, Smile, Sparkles, Trash2, Utensils, Apple, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { usePatient } from "@/lib/patient-context";
import { createCareEntry, deleteCareEntry, getCareEntries, updateCareEntry } from "@/lib/db";
import { getLoggerName, setLoggerName, useCare } from "@/lib/care-plan";
import {
  AMOUNTS, AWARENESS, DECLINE_REASONS, HELP_LEVELS, MEALS, MINUTES, TASKS, THERAPIES,
  bigAwarenessDrop, conditionLabels, conditionsShared, entrySummary, entryTitle, labelOf,
  localDay, localStamp, moodClass, moodWord, shiftDay, timeLabel, type Option,
} from "@/lib/care";
import { formatPersonName } from "@/lib/format-name";
import type { CareEntry } from "@shared/schema";
import { fetchCaregiverEntries, syncOwnerEntries, type CloudCareEntry } from "@/lib/care-share";
import { CareShareCard } from "@/components/care-share-card";

const DIALOG_CLASS =
  "p-0 sm:p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(560px,calc(100vw-2rem))] sm:max-w-[560px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

type Draft = Omit<CareEntry, "id" | "patientId" | "createdAt">;

type QuickLog = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  start: Partial<Draft> & { kind: CareEntry["kind"] };
};

const QUICK: QuickLog[] = [
  { id: "meal", label: "Meal", icon: Utensils, start: { kind: "meal" } },
  { id: "snack", label: "Snack", icon: Apple, start: { kind: "meal", meal: "snack" } },
  { id: "pt", label: "Physical therapy", icon: Dumbbell, start: { kind: "therapy", therapy: "PT" } },
  { id: "ot", label: "Occupational therapy", icon: Hand, start: { kind: "therapy", therapy: "OT" } },
  { id: "mood", label: "How they're doing", icon: Smile, start: { kind: "mood" } },
  { id: "awareness", label: "Awareness", icon: Brain, start: { kind: "awareness" } },
  { id: "bathing", label: "Bathing", icon: Bath, start: { kind: "personal", task: "bathing" } },
  { id: "dressing", label: "Changing clothes", icon: Shirt, start: { kind: "personal", task: "dressing" } },
  { id: "toileting", label: "Toileting / cleaning", icon: Sparkles, start: { kind: "personal", task: "toileting" } },
  { id: "grooming", label: "Grooming", icon: HeartHandshake, start: { kind: "personal", task: "grooming" } },
];

function guessMeal(d = new Date()): string {
  const h = d.getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : "dinner";
}

/* ---------- small controls ---------- */

function Chip({ selected, onClick, children, tone = "primary", testId }: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "primary" | "decline";
  testId?: string;
}) {
  const on =
    tone === "decline"
      ? "border-slate-500 bg-slate-600 text-white dark:bg-slate-300 dark:text-slate-900"
      : "border-primary bg-primary text-primary-foreground";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-11 rounded-full border px-4 py-2 text-[15px] font-semibold leading-tight transition-colors ${
        selected ? on : "border-[hsl(var(--field-border))] bg-[hsl(var(--field))] text-foreground hover:border-primary/60"
      }`}
    >
      {children}
    </button>
  );
}

function ChipRow({ options, value, onChange, testPrefix }: {
  options: Option[];
  value: string | null | undefined;
  onChange: (key: string) => void;
  testPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o.key} selected={value === o.key} onClick={() => onChange(o.key)} testId={`${testPrefix}-${o.key}`}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-base font-semibold text-foreground">{label}</p>
      {children}
    </div>
  );
}

/* ---------- entry form ---------- */

function EntryForm({ initial, previousAwareness, onSave, onCancel, saving }: {
  initial: Draft;
  previousAwareness: string | null;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const declined = d.status === "declined";

  const canSave = (() => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.at)) return false;
    switch (d.kind) {
      case "meal":
        return !!d.meal && (declined || !!d.amount);
      case "therapy":
        return !!d.therapy;
      case "personal":
        return !!d.task && (declined || !!d.help);
      case "mood":
        return !!d.score;
      case "awareness":
        return !!d.level;
    }
  })();

  const drop = d.kind === "awareness" && bigAwarenessDrop(d.level, previousAwareness);
  const canDecline = d.kind === "meal" || d.kind === "therapy" || d.kind === "personal";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-6 bg-muted/20">
        {d.kind === "meal" && (
          <>
            <Field label="Which meal">
              <ChipRow options={MEALS} value={d.meal} onChange={(meal) => set({ meal })} testPrefix="chip-meal" />
            </Field>
            <Field label="How much they ate">
              <div className="flex flex-wrap gap-2">
                {AMOUNTS.map((o) => (
                  <Chip key={o.key} selected={!declined && d.amount === o.key}
                    onClick={() => set({ amount: o.key, status: "done", reason: null })} testId={`chip-amount-${o.key}`}>
                    {o.label}
                  </Chip>
                ))}
                <Chip tone="decline" selected={declined} onClick={() => set({ status: "declined", amount: null })} testId="chip-declined">
                  Declined
                </Chip>
              </div>
            </Field>
            {!declined && (
              <div className="space-y-2">
                <Label htmlFor="care-details" className="text-base font-semibold">What they ate <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="care-details" className="h-12 text-base" value={d.details || ""}
                  onChange={(e) => set({ details: e.target.value })} placeholder="Oatmeal, half a banana, juice" data-testid="input-care-details" />
              </div>
            )}
          </>
        )}

        {d.kind === "therapy" && (
          <>
            <Field label="Type">
              <ChipRow options={THERAPIES} value={d.therapy} onChange={(therapy) => set({ therapy })} testPrefix="chip-therapy" />
            </Field>
            <Field label="How it went">
              <div className="flex flex-wrap gap-2">
                <Chip selected={d.status === "done"} onClick={() => set({ status: "done", reason: null })} testId="chip-status-done">Completed</Chip>
                <Chip selected={d.status === "partial"} onClick={() => set({ status: "partial", reason: null })} testId="chip-status-partial">Partial</Chip>
                <Chip tone="decline" selected={declined} onClick={() => set({ status: "declined", minutes: null })} testId="chip-declined">Declined</Chip>
              </div>
            </Field>
            {!declined && (
              <Field label="How long">
                <div className="flex flex-wrap items-center gap-2">
                  {MINUTES.map((m) => (
                    <Chip key={m} selected={d.minutes === m} onClick={() => set({ minutes: m })} testId={`chip-minutes-${m}`}>{m} min</Chip>
                  ))}
                  <Input
                    aria-label="Other length in minutes" type="number" inputMode="numeric" min={1} max={600}
                    className="h-11 w-24 text-base" placeholder="Other"
                    value={d.minutes && !MINUTES.includes(d.minutes) ? d.minutes : ""}
                    onChange={(e) => set({ minutes: e.target.value ? Math.max(1, Math.min(600, Number(e.target.value))) : null })}
                    data-testid="input-care-minutes"
                  />
                </div>
              </Field>
            )}
            {!declined && (
              <div className="space-y-2">
                <Label htmlFor="care-details" className="text-base font-semibold">Exercises or therapist <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="care-details" className="h-12 text-base" value={d.details || ""}
                  onChange={(e) => set({ details: e.target.value })} placeholder="Walked hallway twice, arm bands" data-testid="input-care-details" />
              </div>
            )}
          </>
        )}

        {d.kind === "personal" && (
          <>
            <Field label="Task">
              <ChipRow options={TASKS} value={d.task} onChange={(task) => set({ task })} testPrefix="chip-task" />
            </Field>
            <Field label="Help needed">
              <div className="flex flex-wrap gap-2">
                {HELP_LEVELS.map((o) => (
                  <Chip key={o.key} selected={!declined && d.help === o.key}
                    onClick={() => set({ help: o.key, status: "done", reason: null })} testId={`chip-help-${o.key}`}>
                    {o.label}
                  </Chip>
                ))}
                <Chip tone="decline" selected={declined} onClick={() => set({ status: "declined", help: null })} testId="chip-declined">Declined</Chip>
              </div>
            </Field>
          </>
        )}

        {d.kind === "mood" && (
          <Field label="How are they doing today?">
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Score from 1 to 10">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n} type="button" role="radio" aria-checked={d.score === n}
                  onClick={() => set({ score: n })} data-testid={`mood-${n}`}
                  className={`h-12 rounded-xl border text-lg font-bold transition-colors ${
                    d.score === n ? `${moodClass(n)} ring-2 ring-offset-1 ring-current` : "border-[hsl(var(--field-border))] bg-[hsl(var(--field))] text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs font-semibold text-muted-foreground px-0.5">
              <span>1 · Hard day</span><span>10 · Great day</span>
            </div>
            {d.score ? (
              <p className={`inline-block rounded-full border px-3 py-1 text-sm font-semibold ${moodClass(d.score)}`} data-testid="text-mood-word">
                {d.score} / 10 · {moodWord(d.score)}
              </p>
            ) : null}
          </Field>
        )}

        {d.kind === "awareness" && (
          <Field label="How alert are they?">
            <div className="grid gap-2" role="radiogroup" aria-label="Awareness">
              {AWARENESS.map((o) => (
                <button
                  key={o.key} type="button" role="radio" aria-checked={d.level === o.key}
                  onClick={() => set({ level: o.key })} data-testid={`awareness-${o.key}`}
                  className={`min-h-12 rounded-xl border px-4 py-2 text-left text-[15px] font-semibold transition-colors ${
                    d.level === o.key ? "border-primary bg-primary text-primary-foreground" : "border-[hsl(var(--field-border))] bg-[hsl(var(--field))] text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {drop && (
              <p className="flex gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" data-testid="text-awareness-drop">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>This is a big change from the last check ({labelOf(AWARENESS, previousAwareness).toLowerCase()}). If it came on suddenly, contact their doctor, or call 911 in an emergency.</span>
              </p>
            )}
          </Field>
        )}

        {canDecline && declined && (
          <Field label="Reason (optional)">
            <div className="flex flex-wrap gap-2">
              {DECLINE_REASONS.filter((r) => r.key !== "not-hungry" || d.kind === "meal").map((o) => (
                <Chip key={o.key} tone="decline" selected={d.reason === o.key}
                  onClick={() => set({ reason: d.reason === o.key ? null : o.key })} testId={`chip-reason-${o.key}`}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2 min-w-0">
            <Label htmlFor="care-time" className="text-base font-semibold">Time</Label>
            <Input id="care-time" type="time" className="h-12 text-base" value={d.at.slice(11, 16)}
              onChange={(e) => e.target.value && set({ at: `${d.at.slice(0, 10)}T${e.target.value}` })} data-testid="input-care-time" />
          </div>
          <div className="space-y-2 min-w-0">
            <Label htmlFor="care-by" className="text-base font-semibold">Logged by <span className="font-normal text-muted-foreground">(first name)</span></Label>
            <Input id="care-by" className="h-12 text-base" value={d.loggedBy || ""} autoComplete="given-name"
              onChange={(e) => set({ loggedBy: e.target.value })} placeholder="Carol" data-testid="input-care-by" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="care-note" className="text-base font-semibold">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea id="care-note" rows={3} className="text-base" value={d.note || ""}
            onChange={(e) => set({ note: e.target.value })}
            placeholder={d.kind === "mood" ? "Slept well, enjoyed a visit from the grandkids" : "Anything worth remembering"}
            data-testid="input-care-note" />
        </div>
      </div>
      <div className="shrink-0 flex gap-3 border-t bg-card px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="outline" className="h-12 flex-1 text-base" onClick={onCancel} data-testid="button-care-cancel">Cancel</Button>
        <Button
          className="h-12 flex-1 text-base gradient-primary text-white border-none"
          disabled={!canSave || saving}
          onClick={() => onSave({
            ...d,
            details: d.details?.trim() || null,
            note: d.note?.trim() || null,
            loggedBy: d.loggedBy?.trim() ? formatPersonName(d.loggedBy.trim()) : null,
          })}
          data-testid="button-care-save"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/* ---------- day summary ---------- */

function DaySummary({ entries }: { entries: CareEntry[] }) {
  const meals = entries.filter((e) => e.kind === "meal");
  const ate = meals.filter((e) => e.status !== "declined").length;
  const mealsDeclined = meals.length - ate;
  const therapy = entries.filter((e) => e.kind === "therapy");
  const mood = entries.find((e) => e.kind === "mood"); // newest first
  const aware = entries.find((e) => e.kind === "awareness");
  const personal = entries.filter((e) => e.kind === "personal");

  const therapyText = therapy.length
    ? THERAPIES.map((t) => {
        const list = therapy.filter((e) => e.therapy === t.key);
        if (!list.length) return null;
        const mins = list.reduce((s, e) => s + (e.status === "declined" ? 0 : e.minutes || 0), 0);
        const declined = list.every((e) => e.status === "declined");
        return `${t.key} ${declined ? "declined" : mins ? `${mins} min` : "done"}`;
      }).filter(Boolean).join(" · ")
    : null;

  const personalText = personal.length
    ? TASKS.map((t) => {
        const latest = personal.find((e) => e.task === t.key);
        if (!latest) return null;
        return `${t.label}: ${latest.status === "declined" ? "declined" : labelOf(HELP_LEVELS, latest.help).toLowerCase()}`;
      }).filter(Boolean).join(" · ")
    : null;

  const rows: { label: string; value: React.ReactNode; testId: string }[] = [
    {
      label: "Meals",
      testId: "summary-meals",
      value: meals.length ? (
        <>
          {ate > 0 && <span className="whitespace-nowrap">{ate} eaten</span>}
          {ate > 0 && mealsDeclined > 0 && " · "}
          {mealsDeclined > 0 && <span className="whitespace-nowrap font-semibold text-slate-600 dark:text-slate-300">{mealsDeclined} declined</span>}
        </>
      ) : null,
    },
    { label: "Therapy", testId: "summary-therapy", value: therapyText },
    {
      label: "Doing",
      testId: "summary-mood",
      value: mood?.score ? (
        <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-semibold ${moodClass(mood.score)}`}>
          {mood.score} / 10 · {moodWord(mood.score)}
        </span>
      ) : null,
    },
    { label: "Awareness", testId: "summary-awareness", value: aware ? labelOf(AWARENESS, aware.level) : null },
    { label: "Personal care", testId: "summary-personal", value: personalText },
  ];

  return (
    <Card className="shadow-sm" data-testid="card-care-summary">
      <CardContent className="p-4 sm:p-5">
        <dl className="divide-y">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3 py-2.5 first:pt-0 last:pb-0 min-w-0" data-testid={r.testId}>
              <dt className="w-[6rem] flex-shrink-0 text-sm font-semibold text-muted-foreground pt-0.5">{r.label}</dt>
              <dd className="min-w-0 flex-1 text-[15px] font-medium break-words">
                {r.value ?? <span className="text-muted-foreground font-normal">Nothing logged</span>}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ---------- page ---------- */

export default function CareLog() {
  const care = useCare();
  const { activePatient, activePatientId: pid } = usePatient();
  const { toast } = useToast();
  const today = localDay();
  const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<{ id?: number; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<CareEntry | null>(null);

  const { data: localEntries = [] } = useQuery<CareEntry[]>({
    queryKey: ["care-entries", pid, day],
    queryFn: () => getCareEntries(pid, `${day}T00:00`, `${shiftDay(day, 1)}T00:00`),
    enabled: care,
  });

  // Caregiver entries not copied to this phone yet (they settle after 30 minutes).
  const { data: cloudEntries = [] } = useQuery<CloudCareEntry[]>({
    queryKey: ["care-entries", pid, day, "caregivers"],
    queryFn: () => fetchCaregiverEntries(pid, day),
    enabled: care,
    refetchInterval: 60000,
  });

  const entries: (CareEntry | CloudCareEntry)[] = useMemo(() => {
    const have = new Set(localEntries.map((e) => e.sourceId).filter(Boolean));
    return [...localEntries, ...cloudEntries.filter((e) => !have.has(e.cloudId))].sort((a, b) => a.at.localeCompare(b.at));
  }, [localEntries, cloudEntries]);

  // Last awareness check before the one being edited, looking back a week.
  const { data: recentAwareness = [] } = useQuery<CareEntry[]>({
    queryKey: ["care-entries", pid, "awareness-week", day],
    queryFn: async () =>
      (await getCareEntries(pid, `${shiftDay(day, -7)}T00:00`, `${shiftDay(day, 1)}T00:00`)).filter((e) => e.kind === "awareness"),
    enabled: care,
  });

  const previousAwareness = useMemo(() => {
    if (!editing || editing.draft.kind !== "awareness") return null;
    const before = recentAwareness.find((e) => e.id !== editing.id && e.at < editing.draft.at);
    return before?.level ?? null;
  }, [editing, recentAwareness]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["care-entries", pid] });
    // Caregivers see the owner's entries only when she has switched that on.
    syncOwnerEntries(pid).catch(() => {});
  };

  const saveMut = useMutation({
    mutationFn: async ({ id, draft }: { id?: number; draft: Draft }) => {
      if (draft.loggedBy) setLoggerName(draft.loggedBy);
      if (id) return updateCareEntry(id, draft);
      return createCareEntry({ ...draft, patientId: pid, createdAt: new Date().toISOString() });
    },
    onSuccess: (_r, vars) => {
      invalidate();
      setEditing(null);
      toast({ title: vars.id ? "Entry updated" : "Saved to the care log" });
    },
    onError: () => toast({ title: "Couldn't save", description: "Please try again.", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteCareEntry(id),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast({ title: "Entry deleted" });
    },
  });

  const startNew = (q: QuickLog) => {
    const now = new Date();
    const at = day === today ? localStamp(now) : `${day}T${localStamp(now).slice(11)}`;
    setEditing({
      draft: {
        status: "done",
        ...(q.start.kind === "meal" && !q.start.meal ? { meal: guessMeal(now) } : {}),
        ...q.start,
        at,
        loggedBy: getLoggerName() || null,
      } as Draft,
    });
  };

  if (!care) {
    return (
      <div className="w-full max-w-4xl min-w-0 p-4 md:p-6 space-y-4">
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Care Log</h1>
        <Card className="border-primary/25 bg-primary/5" data-testid="card-care-lock">
          <CardContent className="p-4 sm:p-5 text-sm text-muted-foreground leading-relaxed">
            The Care Log is part of MedRecords Care, coming soon.
          </CardContent>
        </Card>
      </div>
    );
  }

  const name = activePatient?.name || "this person";
  const conds = activePatient ? conditionLabels(activePatient) : [];
  const dayLabel = (() => {
    const [y, m, dd] = day.split("-").map(Number);
    const date = new Date(y, m - 1, dd);
    if (day === today) return `Today, ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  })();

  return (
    <div className="w-full max-w-4xl min-w-0 overflow-x-hidden p-4 md:p-6 space-y-5">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary -ml-1 px-1 py-1.5" data-testid="link-back-to-dashboard">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Care Log</h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">Daily care for {name}</p>
        {conds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="list-care-conditions">
            {conds.map((c) => (
              <span key={c} className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{c}</span>
            ))}
            <Link href="/profile" className="text-xs font-semibold text-muted-foreground underline underline-offset-2 ml-1">
              {activePatient && conditionsShared(activePatient) ? "Shared with caregivers" : "Not shared"} · Edit
            </Link>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11 flex-shrink-0" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))} data-testid="button-day-prev">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <p className="flex-1 min-w-0 text-center font-heading text-base font-semibold truncate" data-testid="text-care-day">{dayLabel}</p>
        <Button variant="outline" size="icon" className="h-11 w-11 flex-shrink-0" aria-label="Next day" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))} data-testid="button-day-next">
          <ChevronRight className="h-5 w-5" />
        </Button>
        {day !== today && (
          <Button variant="outline" className="h-11 flex-shrink-0" onClick={() => setDay(today)} data-testid="button-day-today">Today</Button>
        )}
      </div>

      <DaySummary entries={entries} />

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Log care</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK.map((q) => (
            <button
              key={q.id} type="button" onClick={() => startNew(q)} data-testid={`button-log-${q.id}`}
              className="flex min-h-[56px] flex-col items-start gap-1.5 rounded-xl border bg-card px-3 py-2.5 text-left text-[15px] min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-2.5 font-semibold leading-tight shadow-sm transition-colors hover:border-primary/60 active:bg-primary/5"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg gradient-primary">
                <q.icon className="h-4 w-4 text-white" />
              </span>
              <span className="min-w-0">{q.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{day === today ? "Today's entries" : "Entries"}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-care-empty">Nothing logged{day === today ? " yet today" : " this day"}.</p>
        ) : (
          <ul className="space-y-2.5" data-testid="list-care-entries">
            {entries.map((e) => (
              <li key={"cloudId" in e ? e.cloudId : e.id} className="rounded-xl border bg-card px-3.5 py-3 shadow-sm" data-testid={"cloudId" in e ? "care-entry-caregiver" : `care-entry-${e.id}`}>
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-[4.25rem] flex-shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground tabular-nums">{timeLabel(e.at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug break-words">{entryTitle(e)}</p>
                    <p className={`text-[15px] leading-snug break-words ${e.status === "declined" ? "font-semibold text-slate-600 dark:text-slate-300" : ""}`}>
                      {e.kind === "mood" && e.score ? (
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-sm font-semibold ${moodClass(e.score)}`}>{entrySummary(e)}</span>
                      ) : entrySummary(e)}
                    </p>
                    {e.details && <p className="mt-0.5 text-sm text-muted-foreground break-words">{e.details}</p>}
                    {e.note && <p className="mt-1 text-sm whitespace-pre-wrap break-words">{e.note}</p>}
                    {e.loggedBy && (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        Logged by {e.loggedBy}
                        {"cloudId" in e ? " from their phone" : ""}
                      </p>
                    )}
                  </div>
                  {!("cloudId" in e) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 -mr-1.5 -mt-1 flex-shrink-0" aria-label="Entry options" data-testid={`button-entry-menu-${e.id}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { const { id, patientId, createdAt, ...draft } = e; setEditing({ id, draft }); }}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(e)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activePatient && <CareShareCard patient={activePatient} />}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
            <DialogTitle className="font-heading text-2xl font-bold text-white">
              {editing ? (editing.id ? "Edit entry" : editing.draft.kind === "mood" ? "How they're doing" : editing.draft.kind === "awareness" ? "Awareness" : editing.draft.kind === "therapy" ? "Therapy" : editing.draft.kind === "personal" ? "Personal care" : editing.draft.meal === "snack" ? "Snack" : "Meal") : ""}
            </DialogTitle>
            <DialogDescription className="text-white/85 text-sm">For {name}</DialogDescription>
          </DialogHeader>
          {editing && (
            <EntryForm
              key={editing.id ?? "new"}
              initial={editing.draft}
              previousAwareness={previousAwareness}
              saving={saveMut.isPending}
              onCancel={() => setEditing(null)}
              onSave={(draft) => saveMut.mutate({ id: editing.id, draft })}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${entryTitle(deleting)} at ${timeLabel(deleting.at)} will be removed from the care log.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting?.id && deleteMut.mutate(deleting.id)} data-testid="button-confirm-delete-entry">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
