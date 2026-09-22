import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  getMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  getMedicationLogs,
  createMedicationLog,
  getPhysicians,
} from "@/lib/db";
import { requestRemindersSync } from "@/lib/reminder-sync";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Pill,
  Plus,
  Trash2,
  Edit2,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Printer,
  ExternalLink,
  Tag,
  ShieldAlert,
  FileText,
  Stethoscope,
  Calendar,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DoseReminderButton,
  DoseNextDue,
  useHasDoseReminders,
} from "@/components/dose-reminders";
import { deleteDoseSchedule } from "@/lib/dose-schedule";
import type { Medication, MedicationLog, Physician } from "@shared/schema";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { Link, useLocation } from "wouter";

/**
 * A collapsible card holding a short list of outside links (interaction checkers,
 * discount programs). Starts closed so the medication list stays the focus, and the
 * whole header is the tap target.
 */
function LinkListCard({
  title,
  icon: Icon,
  iconClass,
  description,
  links,
  testIdPrefix,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  description: string;
  links: { name: string; url: string }[];
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="h-fit">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-[56px] hover-elevate rounded-lg"
            data-testid={`button-toggle-${testIdPrefix}`}
          >
            <Icon className={`w-5 h-5 flex-shrink-0 ${iconClass}`} />
            <span className="flex-1 min-w-0">
              <span className="block font-heading text-base font-semibold leading-tight">
                {title}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5 break-words">
                {description}
              </span>
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0 text-muted-foreground">
              <Badge variant="secondary" className="text-[10px] font-medium">
                {links.length}
              </Badge>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-3 pt-0 space-y-1">
            {links.map((link) => (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2 text-sm text-primary hover:underline font-body px-1.5 py-1.5 rounded-md hover:bg-primary/5 transition-colors"
                data-testid={`link-${testIdPrefix}-${link.name.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="min-w-0 break-words">{link.name}</span>
              </a>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
const MED_TYPES = ["prescription", "otc", "supplement", "vitamin"];
const FREQUENCIES = [
  "daily",
  "twice-daily",
  "three-times-daily",
  "weekly",
  "bi-weekly",
  "monthly",
  "as-needed",
];
const TIMES_OF_DAY = ["morning", "afternoon", "evening", "bedtime"];

const timeIcon = (t: string | null) => {
  if (t === "morning") return <Sunrise className="w-3 h-3" />;
  if (t === "afternoon") return <Sun className="w-3 h-3" />;
  if (t === "evening") return <Sunset className="w-3 h-3" />;
  if (t === "bedtime") return <Moon className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
};

/**
 * Refill colour has to earn its alarm. A date months out rendered in amber
 * shouted louder than the medication's own name, so this stays plain until the
 * refill is close, turns amber inside two weeks, and goes destructive once the
 * date has passed.
 */
function refillTone(date?: string | null, active = true) {
  if (!date) return null;
  const when = parseISO(date);
  const days = differenceInCalendarDays(when, new Date());
  const on = format(when, "MMM d, yyyy");
  // A discontinued medication does not need refilling, so its date stays quiet
  // however far past it is.
  if (!active)
    return {
      label: `Refill ${on}`,
      className: "text-muted-foreground",
      urgent: false,
    };
  if (days < 0)
    return {
      label: `Refill overdue \u2014 ${on}`,
      className: "text-destructive",
      urgent: true,
    };
  if (days <= 14)
    return {
      label: `Refill ${on}`,
      className:
        "rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      urgent: true,
    };
  return {
    label: `Refill ${on}`,
    className: "text-muted-foreground",
    urgent: false,
  };
}

const medLabelClass = "text-base font-body font-semibold text-foreground";
const medControlClass = "h-12 text-base";

function MedFieldSection({
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
          <h3 className="font-heading text-lg font-semibold leading-tight">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </header>
      <div className="px-4 sm:px-5 pb-5 pt-2 space-y-4">{children}</div>
    </section>
  );
}

// Shared Tailwind classes for the New/Edit Medication dialog so it behaves as
// a full-screen sheet on mobile and a roomy centered dialog on desktop —
// mirrors the appointment modal pattern.
const MED_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

function MedicationForm({
  initial,
  onSubmit,
  onCancel,
  physicians,
  isEdit,
}: {
  initial?: Partial<Medication>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  physicians: Physician[];
  isEdit: boolean;
}) {
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    name: initial?.name || "",
    type: initial?.type || "prescription",
    dosage: initial?.dosage || "",
    frequency: initial?.frequency || "daily",
    timeOfDay: initial?.timeOfDay || "",
    prescribedBy: initial?.prescribedBy || "",
    pharmacy: initial?.pharmacy || "",
    startDate: initial?.startDate || "",
    endDate: initial?.endDate || "",
    refillDate: initial?.refillDate || "",
    purpose: initial?.purpose || "",
    sideEffects: initial?.sideEffects || "",
    notes: initial?.notes || "",
    active: initial?.active ?? 1,
  });

  const canSubmit = Boolean(form.name && form.dosage);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <MedFieldSection
          icon={Pill}
          title="Medication Details"
          description="What you're taking, how strong, and how often."
        >
          <div className="space-y-2">
            <Label htmlFor="med-name" className={medLabelClass}>
              Medication Name
            </Label>
            <Input
              id="med-name"
              className={medControlClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Lisinopril"
              data-testid="input-med-name"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className={medLabelClass}>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger
                  className={medControlClass}
                  data-testid="select-med-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MED_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="med-dosage" className={medLabelClass}>
                Dosage
              </Label>
              <Input
                id="med-dosage"
                className={medControlClass}
                value={form.dosage}
                onChange={(e) => setForm({ ...form, dosage: e.target.value })}
                placeholder="10mg"
                data-testid="input-med-dosage"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="med-purpose" className={medLabelClass}>
              Purpose
            </Label>
            <Input
              id="med-purpose"
              className={medControlClass}
              value={form.purpose || ""}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="Blood pressure"
              data-testid="input-med-purpose"
            />
          </div>
        </MedFieldSection>

        <MedFieldSection
          icon={Clock}
          title="Schedule"
          description="How often you take it and which part of the day."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className={medLabelClass}>Frequency</Label>
              <Select
                value={form.frequency}
                onValueChange={(v) => setForm({ ...form, frequency: v })}
              >
                <SelectTrigger
                  className={medControlClass}
                  data-testid="select-med-freq"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className={medLabelClass}>Time of Day</Label>
              <Select
                value={form.timeOfDay || "none"}
                onValueChange={(v) =>
                  setForm({ ...form, timeOfDay: v === "none" ? "" : v })
                }
              >
                <SelectTrigger
                  className={medControlClass}
                  data-testid="select-med-time"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {TIMES_OF_DAY.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isEdit && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div className="min-w-0">
                <Label className={medLabelClass}>Active</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Turn off to keep this medication in history without dose
                  prompts.
                </p>
              </div>
              <Switch
                checked={form.active === 1}
                onCheckedChange={(c) => setForm({ ...form, active: c ? 1 : 0 })}
                data-testid="switch-med-active"
              />
            </div>
          )}
        </MedFieldSection>

        <MedFieldSection
          icon={Stethoscope}
          title="Provider & Pharmacy"
          description="Optional — helpful for refills and questions."
        >
          <div className="space-y-2">
            <Label className={medLabelClass}>Prescribed By</Label>
            <Select
              value={form.prescribedBy || "none"}
              onValueChange={(v) => {
                if (v === "__add_physician__") {
                  navigate("/physicians");
                  return;
                }
                setForm({ ...form, prescribedBy: v === "none" ? "" : v });
              }}
            >
              <SelectTrigger
                className={medControlClass}
                data-testid="select-med-prescribed"
              >
                <SelectValue placeholder="Select physician" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Not specified</SelectItem>
                {physicians.map((p) => (
                  <SelectItem key={p.id} value={p.name}>
                    {p.name} — {p.specialty}
                  </SelectItem>
                ))}
                <SelectItem
                  value="__add_physician__"
                  className="text-primary font-semibold"
                >
                  + Add Physician
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="med-pharmacy" className={medLabelClass}>
              Pharmacy
            </Label>
            <Input
              id="med-pharmacy"
              className={medControlClass}
              value={form.pharmacy || ""}
              onChange={(e) => setForm({ ...form, pharmacy: e.target.value })}
              placeholder="CVS Main St"
              data-testid="input-med-pharmacy"
            />
          </div>
        </MedFieldSection>

        <MedFieldSection
          icon={Calendar}
          title="Important Dates"
          description="Track when you started, when to stop, and your next refill."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="med-start" className={medLabelClass}>
                Start Date
              </Label>
              <Input
                id="med-start"
                type="date"
                className={medControlClass}
                value={form.startDate || ""}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
                data-testid="input-med-start"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="med-end" className={medLabelClass}>
                End Date
              </Label>
              <Input
                id="med-end"
                type="date"
                className={medControlClass}
                value={form.endDate || ""}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                data-testid="input-med-end"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="med-refill" className={medLabelClass}>
              Refill Date
            </Label>
            <Input
              id="med-refill"
              type="date"
              className={medControlClass}
              value={form.refillDate || ""}
              onChange={(e) => setForm({ ...form, refillDate: e.target.value })}
              data-testid="input-med-refill"
            />
          </div>
        </MedFieldSection>

        <MedFieldSection
          icon={FileText}
          title="Notes & Side Effects"
          description="Anything to remember about this medication."
        >
          <div className="space-y-2">
            <Label htmlFor="med-side" className={medLabelClass}>
              Side Effects
            </Label>
            <Input
              id="med-side"
              className={medControlClass}
              value={form.sideEffects || ""}
              onChange={(e) =>
                setForm({ ...form, sideEffects: e.target.value })
              }
              placeholder="Dizziness, cough..."
              data-testid="input-med-side"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="med-notes" className={medLabelClass}>
              Notes
            </Label>
            <Textarea
              id="med-notes"
              className="text-base min-h-[110px]"
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={4}
              placeholder="Take with food..."
              data-testid="input-med-notes"
            />
          </div>
        </MedFieldSection>
      </div>

      {/* Sticky action bar */}
      <div
        className="sticky bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        }}
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
          data-testid="button-med-save"
        >
          {isEdit ? "Update Medication" : "Add Medication"}
        </Button>
      </div>
    </div>
  );
}

export default function Medications() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [pendingDose, setPendingDose] = useState<{
    medicationId: number;
    taken: boolean;
  } | null>(null);
  const { toast } = useToast();

  const { data: medications = [], isLoading } = useQuery<Medication[]>({
    queryKey: ["medications", pid],
    queryFn: () => getMedications(pid),
  });
  const { data: logs = [] } = useQuery<MedicationLog[]>({
    queryKey: ["medication-logs"],
    queryFn: () => getMedicationLogs(),
  });
  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", pid],
    queryFn: () => getPhysicians(pid),
  });

  const invalidateMeds = () => {
    queryClient.invalidateQueries({ queryKey: ["medications", pid] });
    queryClient.invalidateQueries({ queryKey: ["all-medications-for-sync"] });
    // Push refill reminders up to Supabase right away — independent of
    // whether the dashboard is mounted to observe the cache change.
    requestRemindersSync();
  };
  const createMut = useMutation({
    mutationFn: (data: any) => createMedication({ ...data, patientId: pid }),
    onSuccess: () => {
      invalidateMeds();
      setOpen(false);
      toast({ title: "Medication added" });
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      updateMedication(id, data),
    onSuccess: () => {
      invalidateMeds();
      setEditing(null);
      toast({ title: "Medication updated" });
    },
  });
  const deleteMut = useMutation({
    // The schedule lives on the server, so deleting the medication locally
    // would otherwise leave a notifier still pushing reminders for a record
    // that no longer exists. Best effort inside deleteDoseSchedule: an
    // unreachable backend must not block the local delete.
    mutationFn: async (id: number) => {
      await deleteDoseSchedule(id);
      return deleteMedication(id);
    },
    onSuccess: () => {
      invalidateMeds();
      toast({ title: "Medication deleted" });
    },
  });
  const logMut = useMutation({
    mutationFn: (data: Omit<MedicationLog, "id">) => createMedicationLog(data),
    onSuccess: (created, variables) => {
      // Update the active view immediately, then refetch to keep the cache
      // authoritative. This avoids a successful IndexedDB write looking like
      // a no-op while React Query is waiting to refetch.
      queryClient.setQueryData<MedicationLog[]>(
        ["medication-logs"],
        (current = []) => [
          created,
          ...current.filter(
            (log) =>
              !(
                log.medicationId === created.medicationId &&
                log.date === created.date
              ),
          ),
        ],
      );
      queryClient.invalidateQueries({ queryKey: ["medication-logs"] });
      toast({ title: variables.taken ? "Dose taken" : "Dose skipped" });
    },
    onError: () => {
      toast({
        title: "Couldn't log dose",
        description: "Your dose was not saved. Please try again.",
        variant: "destructive",
      });
    },
  });

  const active = medications.filter((m) => m.active === 1);
  const inactive = medications.filter((m) => m.active !== 1);
  const today = format(new Date(), "yyyy-MM-dd");

  const logDose = (medId: number, taken: boolean) => {
    logMut.mutate({
      medicationId: medId,
      date: today,
      taken: taken ? 1 : 0,
      time: format(new Date(), "HH:mm"),
      notes: null,
    });
  };

  function MedCard({ med }: { med: Medication }) {
    const medLogs = logs.filter((l) => l.medicationId === med.id);
    const todayLog = medLogs.find((l) => l.date === today);
    // With reminders on, this medication is dosed on a schedule and can be
    // taken several times a day, so the once-a-day taken/skipped row would be
    // wrong the moment the second dose came round.
    const scheduled = useHasDoseReminders(med.id);

    const meta = [med.dosage, med.type].filter(Boolean).join(" · ");
    const reference = [
      med.prescribedBy ? `Rx ${med.prescribedBy}` : null,
      med.pharmacy,
    ]
      .filter(Boolean)
      .join(" · ");
    const refill = refillTone(med.refillDate, med.active === 1);

    return (
      <Card className="hover-elevate" data-testid={`medication-${med.id}`}>
        <CardContent className="space-y-1.5 p-4">
          {/* The name owns the first line and edit/delete ride at its right,
              so the actions no longer need a row of their own. */}
          <Link
            href={`/medications/${med.id}`}
            className="block rounded-sm py-1.5 font-heading text-base font-semibold leading-tight text-foreground break-words hover:text-primary sm:text-lg"
            data-testid={`link-medication-history-${med.id}`}
          >
            {med.name}
          </Link>

          {/* `meta` is one string rather than a row of spans and bullet
              elements: separators that are their own elements wrap like words
              and strand a bullet at the end of a line. */}
          {/* edit/delete ride beside the dosage line: the name needs the
              whole width on a narrow phone, and a long one collided with
              these icons when they shared its row. */}
          <div className="flex items-start gap-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-foreground/80">{meta}</span>
              {med.frequency && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {timeIcon(med.timeOfDay)}
                  {med.frequency}
                </span>
              )}
              {!med.active && (
                <Badge variant="outline" className="text-xs font-medium">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="-mt-2 flex shrink-0 items-center">
              <Dialog
                open={editing?.id === med.id}
                onOpenChange={(o) => !o && setEditing(null)}
              >
                <DialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11"
                    onClick={() => setEditing(med)}
                    data-testid={`button-edit-med-${med.id}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className={MED_DIALOG_CLASS}>
                  <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
                    <DialogTitle className="font-heading text-2xl font-bold text-white">
                      Edit Medication
                    </DialogTitle>
                    <DialogDescription className="text-white/85 text-sm">
                      Update the medication details. Changes save when you press
                      Update.
                    </DialogDescription>
                  </DialogHeader>
                  <MedicationForm
                    physicians={physicians}
                    initial={med}
                    isEdit={true}
                    onSubmit={(data) => updateMut.mutate({ id: med.id!, data })}
                    onCancel={() => setEditing(null)}
                  />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11 text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-med-${med.id}`}
                    aria-label={`Delete medication ${med.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-heading flex items-center gap-2">
                      <Trash2 className="w-5 h-5 text-destructive" />
                      Delete medication?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <span className="font-medium text-foreground">
                        {med.name}
                      </span>
                      {med.dosage ? ` (${med.dosage})` : ""} will be permanently
                      removed, along with its dose history. This cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2 sm:gap-2">
                    <AlertDialogCancel
                      className="h-11 text-base sm:h-10 sm:text-sm mt-0"
                      data-testid={`button-delete-med-cancel-${med.id}`}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate(med.id!)}
                      className="h-11 text-base sm:h-10 sm:text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
                      data-testid={`button-delete-med-confirm-${med.id}`}
                    >
                      Delete medication
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {med.purpose && (
            <p className="text-sm text-muted-foreground">{med.purpose}</p>
          )}

          {reference && (
            <p className="text-xs text-muted-foreground">{reference}</p>
          )}

          {refill && (
            <p
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${refill.className}`}
              data-testid={`text-refill-${med.id}`}
            >
              {refill.urgent ? (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Calendar className="h-3.5 w-3.5 shrink-0" />
              )}
              {refill.label}
            </p>
          )}

          {/* Dose actions only: an inactive medication has nothing to log, so
              it ends above rather than carrying an empty ruled row. */}
          {med.active === 1 && (
            <div className="flex items-center gap-1 border-t border-border/50 pt-2">
              <DoseReminderButton med={med} />
              {scheduled ? (
                <DoseNextDue med={med} />
              ) : todayLog ? (
                todayLog.taken ? (
                  <Badge
                    className="status-completed h-9 px-3 text-xs font-semibold"
                    data-testid={`badge-taken-${med.id}`}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Taken
                  </Badge>
                ) : (
                  <Badge
                    className="status-skipped h-9 px-3 text-xs font-semibold"
                    data-testid={`badge-skipped-${med.id}`}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    Skipped
                  </Badge>
                )
              ) : (
                <>
                  <AlertDialog
                    open={
                      pendingDose?.medicationId === med.id &&
                      pendingDose?.taken === true
                    }
                    onOpenChange={(isOpen) => !isOpen && setPendingDose(null)}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 shrink-0 px-3 text-sm"
                      onClick={() =>
                        setPendingDose({ medicationId: med.id!, taken: true })
                      }
                      data-testid={`button-take-${med.id}`}
                    >
                      Take
                    </Button>
                    <AlertDialogContent className="max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="font-heading flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                          Mark as taken?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Record today's dose of{" "}
                          <span className="font-medium text-foreground">
                            {med.name}
                          </span>
                          {med.dosage ? ` (${med.dosage})` : ""}
                          {med.frequency ? `, ${med.frequency}` : ""} as taken.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="gap-2 sm:gap-2">
                        <AlertDialogCancel
                          className="h-11 text-base sm:h-10 sm:text-sm mt-0"
                          data-testid={`button-take-cancel-${med.id}`}
                        >
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => logDose(med.id!, true)}
                          className="h-11 text-base sm:h-10 sm:text-sm bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 font-semibold"
                          data-testid={`button-take-confirm-${med.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Mark as
                          taken
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <AlertDialog
                    open={
                      pendingDose?.medicationId === med.id &&
                      pendingDose?.taken === false
                    }
                    onOpenChange={(isOpen) => !isOpen && setPendingDose(null)}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 shrink-0 px-2.5 text-sm text-muted-foreground"
                      onClick={() =>
                        setPendingDose({
                          medicationId: med.id!,
                          taken: false,
                        })
                      }
                      data-testid={`button-skip-${med.id}`}
                    >
                      Skip
                    </Button>
                    <AlertDialogContent className="max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="font-heading flex items-center gap-2">
                          <XCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                          Skip this dose?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Record today's dose of{" "}
                          <span className="font-medium text-foreground">
                            {med.name}
                          </span>
                          {med.dosage ? ` (${med.dosage})` : ""}
                          {med.frequency ? `, ${med.frequency}` : ""} as
                          skipped. It won't count as taken in your history.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="gap-2 sm:gap-2">
                        <AlertDialogCancel
                          className="h-11 text-base sm:h-10 sm:text-sm mt-0"
                          data-testid={`button-skip-cancel-${med.id}`}
                        >
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => logDose(med.id!, false)}
                          className="h-11 text-base sm:h-10 sm:text-sm bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 font-semibold"
                          data-testid={`button-skip-confirm-${med.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Skip dose
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl w-full min-w-0 overflow-x-hidden">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary -ml-1 px-1 py-1.5"
        data-testid="link-back-to-dashboard"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Medications
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">
            Track prescriptions, supplements, and daily doses
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-11 gap-1 print-button-area"
            onClick={() => {
              const w = window.open("", "_blank", "width=800,height=600");
              if (!w) return;
              w.document
                .write(`<!DOCTYPE html><html><head><title>Medications</title><style>
              body { font-family: 'Karla', Arial, sans-serif; padding: 24px; color: #1e293b; }
              h1 { font-family: 'Montserrat', Arial, sans-serif; font-size: 20px; margin-bottom: 16px; }
              h2 { font-family: 'Montserrat', Arial, sans-serif; font-size: 16px; margin: 16px 0 8px; }
              .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
              .title { font-weight: 600; font-size: 14px; }
              .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
              .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: #dbeafe; color: #1e40af; margin-left: 6px; }
            </style></head><body><h1>Medications</h1>`);
              if (active.length) {
                w.document.write("<h2>Active</h2>");
                active.forEach((med) => {
                  w.document.write(
                    `<div class="card"><div class="title">${med.name} <span class="badge">${med.type}</span></div><div class="meta">${med.dosage} &mdash; ${med.frequency}${med.timeOfDay ? " (" + med.timeOfDay + ")" : ""}</div>${med.prescribedBy ? '<div class="meta">Prescribed by: ' + med.prescribedBy + "</div>" : ""}${med.pharmacy ? '<div class="meta">Pharmacy: ' + med.pharmacy + "</div>" : ""}${med.purpose ? '<div class="meta">Purpose: ' + med.purpose + "</div>" : ""}${med.refillDate ? '<div class="meta">Refill: ' + med.refillDate + "</div>" : ""}</div>`,
                  );
                });
              }
              if (inactive.length) {
                w.document.write("<h2>Inactive</h2>");
                inactive.forEach((med) => {
                  w.document.write(
                    `<div class="card"><div class="title">${med.name} <span class="badge">${med.type}</span> <span class="badge">Inactive</span></div><div class="meta">${med.dosage} &mdash; ${med.frequency}</div></div>`,
                  );
                });
              }
              w.document.write("</body></html>");
              w.document.close();
              w.focus();
              const triggerPrint = () => {
                w.print();
              };
              w.onafterprint = () => w.close();
              if (w.document.readyState === "complete") {
                setTimeout(triggerPrint, 100);
              } else {
                w.onload = () => setTimeout(triggerPrint, 100);
              }
            }}
            data-testid="button-print-medications"
          >
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="gradient-primary h-11 text-white border-none gap-1"
                data-testid="button-add-medication"
              >
                <Plus className="w-4 h-4" /> Add Medication
              </Button>
            </DialogTrigger>
            <DialogContent className={MED_DIALOG_CLASS}>
              <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
                <DialogTitle className="font-heading text-2xl font-bold text-white">
                  New Medication
                </DialogTitle>
                <DialogDescription className="text-white/85 text-sm">
                  Fill in the basics — name and dosage are required. The rest
                  you can come back to.
                </DialogDescription>
              </DialogHeader>
              <MedicationForm
                physicians={physicians}
                isEdit={false}
                onSubmit={(data) => createMut.mutate(data)}
                onCancel={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Today's Schedule */}
      {active.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-lg font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Today's Medications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* One tile per row on a phone. Two columns made every tile
                ~165px wide, so the medication name - the only thing that
                identifies the tile - was the part that got truncated, and an
                odd number of medications left a half-width tile dangling. */}
            <div className="grid min-w-0 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((med) => {
                const todayLog = logs.find(
                  (l) => l.medicationId === med.id && l.date === today,
                );
                const taken = !!todayLog && !!todayLog.taken;
                const skipped = !!todayLog && !todayLog.taken;
                return (
                  <div
                    key={med.id}
                    className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm ${
                      taken
                        ? "bg-green-50 dark:bg-green-950/20"
                        : skipped
                          ? "bg-amber-50 dark:bg-amber-950/20"
                          : "bg-secondary/50"
                    }`}
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {timeIcon(med.timeOfDay)}
                    </span>
                    {/* Wraps rather than truncates: a long name is still the
                        name, and a clipped one tells you nothing. */}
                    <span className="min-w-0 flex-1 font-medium leading-snug">
                      {med.name}
                    </span>
                    {med.dosage && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {med.dosage}
                      </span>
                    )}
                    {taken && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-300"
                        data-testid={`schedule-taken-${med.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Taken
                      </span>
                    )}
                    {skipped && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
                        data-testid={`schedule-skipped-${med.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Skipped
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger
            value="active"
            className="min-h-11 font-body text-sm font-semibold"
          >
            Active ({active.length})
          </TabsTrigger>
          <TabsTrigger
            value="inactive"
            className="min-h-11 font-body text-sm font-semibold"
          >
            Inactive ({inactive.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="space-y-3 mt-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-lg bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : active.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Pill className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-base text-muted-foreground">
                  No active medications
                </p>
              </CardContent>
            </Card>
          ) : (
            active.map((med) => <MedCard key={med.id} med={med} />)
          )}
        </TabsContent>
        <TabsContent value="inactive" className="space-y-3 mt-3">
          {inactive.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-base text-muted-foreground">
                  No inactive medications
                </p>
              </CardContent>
            </Card>
          ) : (
            inactive.map((med) => <MedCard key={med.id} med={med} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Helpful Links — collapsed by default so the medication list stays the focus. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LinkListCard
          title="Drug Interaction Checkers"
          icon={ShieldAlert}
          iconClass="text-destructive"
          description="Check if your medications interact with each other"
          testIdPrefix="interaction"
          links={[
            {
              name: "Drugs.com Interaction Checker",
              url: "https://www.drugs.com/drug_interactions.html",
            },
            {
              name: "WebMD Interaction Checker",
              url: "https://www.webmd.com/interaction-checker/default.htm",
            },
            {
              name: "Medscape Drug Interaction Checker",
              url: "https://reference.medscape.com/drug-interactionchecker",
            },
            {
              name: "RxList Interaction Checker",
              url: "https://www.rxlist.com/drug-interaction-checker.htm",
            },
          ]}
        />
        <LinkListCard
          title="Prescription Discounts"
          icon={Tag}
          iconClass="text-green-600 dark:text-green-400"
          description="Save money on your prescriptions"
          testIdPrefix="discount"
          links={[
            { name: "GoodRx", url: "https://www.goodrx.com" },
            { name: "RxSaver by RetailMeNot", url: "https://www.rxsaver.com" },
            { name: "NeedyMeds", url: "https://www.needymeds.org" },
            { name: "RxAssist", url: "https://www.rxassist.org" },
            {
              name: "Medicare Extra Help",
              url: "https://www.ssa.gov/medicare/part-d-extra-help",
            },
          ]}
        />
      </div>
    </div>
  );
}
