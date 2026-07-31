import React, { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getPhysicians, updatePatient } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Camera, Edit2, IdCard, Phone, Stethoscope, UserRound,
  X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Link } from "wouter";
import { differenceInYears, format, parseISO } from "date-fns";
import type { Patient, Physician } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";
import { formatPersonName } from "@/lib/format-name";
import { fileToStorableDataUrl, IMAGE_READ_ERROR, IMAGE_UPLOAD_ACCEPT } from "@/lib/image";

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];

const labelClass = "text-base font-body font-semibold text-foreground";
const controlClass = "h-12 text-base";

const PROFILE_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

const VIEWER_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-0 sm:right-0 sm:top-0 sm:w-screen sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0 " +
  "overflow-hidden flex flex-col bg-black text-white";

/** Empty strings from form inputs are stored as null so absent fields stay absent. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const years = differenceInYears(new Date(), parseISO(dob));
  return Number.isFinite(years) && years >= 0 && years < 150 ? years : null;
}

function formatDob(dob: string): string {
  const parsed = parseISO(dob);
  return Number.isNaN(parsed.getTime()) ? dob : format(parsed, "MMM d, yyyy");
}

function FieldSection({ icon: Icon, title, description, children }: {
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
          <h3 className="font-heading text-lg font-semibold leading-tight">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
      </header>
      <div className="px-4 sm:px-5 pb-5 pt-2 space-y-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-body font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-base font-body mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function FullScreenImage({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={VIEWER_DIALOG_CLASS}>
        <DialogHeader className="px-4 py-3 text-left shrink-0 border-b border-white/15">
          <DialogTitle className="font-heading text-base font-semibold text-white pr-8">{title}</DialogTitle>
          <DialogDescription className="text-white/70 text-xs">
            Show this at the check-in desk. Tap the image to zoom.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto overscroll-contain">
          <div className="min-w-full min-h-full flex items-center justify-center p-2">
            <img
              src={src}
              alt={title}
              onClick={() => setZoomed((z) => !z)}
              className={zoomed ? "max-w-none w-[220%] cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in"}
              data-testid="image-card-fullscreen"
            />
          </div>
        </div>
        <div
          className="shrink-0 border-t border-white/15 px-4 py-3 flex gap-2 justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        >
          <Button
            variant="outline"
            onClick={() => setZoomed((z) => !z)}
            className="h-12 flex-1 max-w-[200px] text-base bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white"
            data-testid="button-card-zoom"
          >
            {zoomed ? <ZoomOut className="w-5 h-5 mr-1.5" /> : <ZoomIn className="w-5 h-5 mr-1.5" />}
            {zoomed ? "Fit to screen" : "Zoom in"}
          </Button>
          <Button
            onClick={onClose}
            className="h-12 flex-1 max-w-[200px] text-base font-semibold gradient-primary text-white border-none"
            data-testid="button-card-close"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CardPhotoTile({ label, value, onChange, onView, testId }: {
  label: string;
  value: string | null | undefined;
  onChange: (dataUrl: string | null) => void;
  onView: () => void;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToStorableDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : IMAGE_READ_ERROR);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-body font-semibold">{label}</p>
      {value ? (
        <div className="relative">
          <button
            type="button"
            onClick={onView}
            className="block w-full aspect-[1.586] rounded-lg border overflow-hidden bg-muted/30"
            data-testid={`button-view-${testId}`}
          >
            <img src={value} alt={label} className="w-full h-full object-cover" />
          </button>
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            <Button
              type="button" size="icon" variant="secondary"
              className="w-8 h-8 rounded-full shadow"
              onClick={() => inputRef.current?.click()}
              aria-label={`Replace ${label}`}
              data-testid={`button-replace-${testId}`}
            >
              <Camera className="w-4 h-4" />
            </Button>
            <Button
              type="button" size="icon" variant="destructive"
              className="w-8 h-8 rounded-full shadow"
              onClick={() => onChange(null)}
              aria-label={`Remove ${label}`}
              data-testid={`button-remove-${testId}`}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full aspect-[1.586] min-h-[104px] rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1.5 px-2 text-center hover:bg-muted/30 transition-colors"
          data-testid={`button-add-${testId}`}
        >
          <Camera className="w-6 h-6 text-muted-foreground/60" />
          <span className="text-xs font-body text-muted-foreground leading-tight">
            {busy ? "Processing…" : "Take or choose a photo"}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        onChange={handleFile}
        className="hidden"
        data-testid={`input-${testId}`}
      />
      {error && <p className="text-xs text-destructive break-words">{error}</p>}
    </div>
  );
}

function ProfilePhoto({ patient, onChange }: { patient: Patient; onChange: (dataUrl: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = patient.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToStorableDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : IMAGE_READ_ERROR);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white font-heading text-xl font-bold shadow-sm"
        style={{ backgroundColor: patient.color || "#3b82f6" }}
        aria-label="Change profile photo"
        data-testid="button-profile-photo"
      >
        {patient.photoUrl ? (
          <img src={patient.photoUrl} alt={patient.name} className="w-full h-full object-cover" />
        ) : (
          <span>{initials || <UserRound className="w-8 h-8" />}</span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 flex items-center justify-center">
          <Camera className="w-3.5 h-3.5" />
        </span>
      </button>
      {patient.photoUrl && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-muted-foreground hover:text-destructive"
          data-testid="button-remove-profile-photo"
        >
          Remove photo
        </button>
      )}
      {busy && <p className="text-xs text-muted-foreground">Processing…</p>}
      {error && <p className="text-xs text-destructive max-w-[9rem] text-center break-words">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        onChange={handleFile}
        className="hidden"
        data-testid="input-profile-photo"
      />
    </div>
  );
}

function DialogShell({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
        <DialogTitle className="font-heading text-2xl font-bold text-white pr-8">{title}</DialogTitle>
        <DialogDescription className="text-white/85 text-sm">{description}</DialogDescription>
      </DialogHeader>
      {children}
    </>
  );
}

function FormFooter({ onCancel, onSave, saveLabel, disabled }: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="sticky bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      <Button variant="outline" onClick={onCancel} className="h-12 text-base w-full sm:w-auto sm:min-w-[140px]">
        Cancel
      </Button>
      <Button
        onClick={onSave}
        disabled={disabled}
        className="gradient-primary text-white border-none h-12 text-base font-semibold w-full sm:w-auto sm:min-w-[200px]"
        data-testid="button-profile-save"
      >
        {saveLabel}
      </Button>
    </div>
  );
}

function PersonalDetailsForm({ patient, physicians, onSubmit, onCancel }: {
  patient: Patient;
  physicians: Physician[];
  onSubmit: (data: Partial<Patient>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: patient.name || "",
    relationship: patient.relationship || "",
    dateOfBirth: patient.dateOfBirth || "",
    bloodType: patient.bloodType || "",
    height: patient.height || "",
    allergies: patient.allergies || "",
    conditions: patient.conditions || "",
    primaryPhysicianId: patient.primaryPhysicianId ?? null,
  });

  const age = ageFromDob(form.dateOfBirth);

  const handleSave = () => {
    onSubmit({
      name: formatPersonName(form.name.trim()),
      relationship: form.relationship.trim() ? formatPersonName(form.relationship.trim()) : null,
      dateOfBirth: blankToNull(form.dateOfBirth),
      bloodType: blankToNull(form.bloodType),
      height: blankToNull(form.height),
      allergies: blankToNull(form.allergies),
      conditions: blankToNull(form.conditions),
      primaryPhysicianId: form.primaryPhysicianId,
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <FieldSection icon={UserRound} title="Personal Details" description="Basic information about this family member.">
          <div className="space-y-2">
            <Label htmlFor="pf-name" className={labelClass}>Full Name</Label>
            <Input
              id="pf-name" className={controlClass} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Doe" data-testid="input-pf-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-relationship" className={labelClass}>Relationship</Label>
            <Input
              id="pf-relationship" className={controlClass} value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              placeholder="Self, Spouse, Child..." data-testid="input-pf-relationship"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-dob" className={labelClass}>Date of Birth</Label>
            <Input
              id="pf-dob" type="date" className={controlClass} value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              data-testid="input-pf-dob"
            />
            {age !== null && <p className="text-sm text-muted-foreground">Age {age}</p>}
          </div>
        </FieldSection>

        <FieldSection icon={Stethoscope} title="Health Details" description="Useful to have on hand at an appointment.">
          <div className="space-y-2">
            <Label className={labelClass}>Blood Type</Label>
            <Select
              value={form.bloodType || "none"}
              onValueChange={(v) => setForm({ ...form, bloodType: v === "none" ? "" : v })}
            >
              <SelectTrigger className={controlClass} data-testid="select-pf-blood-type">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {BLOOD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-height" className={labelClass}>Height</Label>
            <Input
              id="pf-height" className={controlClass} value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
              placeholder={`5'10" or 178 cm`} data-testid="input-pf-height"
            />
            <p className="text-xs text-muted-foreground">Weight is tracked over time on the Vitals page.</p>
          </div>
          <div className="space-y-2">
            <Label className={labelClass}>Primary Care Physician</Label>
            <Select
              value={form.primaryPhysicianId?.toString() || "none"}
              onValueChange={(v) => setForm({ ...form, primaryPhysicianId: v === "none" ? null : Number(v) })}
            >
              <SelectTrigger className={controlClass} data-testid="select-pf-physician">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {physicians.map((p) => (
                  <SelectItem key={p.id} value={p.id!.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {physicians.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No physicians yet — add them on the Physicians page to pick one here.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-allergies" className={labelClass}>Allergies</Label>
            <Textarea
              id="pf-allergies" rows={3} className="text-base" value={form.allergies}
              onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              placeholder="Penicillin, peanuts, latex..." data-testid="input-pf-allergies"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-conditions" className={labelClass}>Chronic Conditions / Notes</Label>
            <Textarea
              id="pf-conditions" rows={3} className="text-base" value={form.conditions}
              onChange={(e) => setForm({ ...form, conditions: e.target.value })}
              placeholder="Type 2 diabetes, asthma, pacemaker..." data-testid="input-pf-conditions"
            />
          </div>
        </FieldSection>
      </div>
      <FormFooter
        onCancel={onCancel}
        onSave={handleSave}
        saveLabel="Save Details"
        disabled={!form.name.trim()}
      />
    </div>
  );
}

function InsuranceForm({ patient, onSubmit, onCancel }: {
  patient: Patient;
  onSubmit: (data: Partial<Patient>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    insuranceCarrier: patient.insuranceCarrier || "",
    insurancePlanType: patient.insurancePlanType || "",
    insuranceMemberId: patient.insuranceMemberId || "",
    insuranceGroupNumber: patient.insuranceGroupNumber || "",
    insuranceRxBin: patient.insuranceRxBin || "",
    insuranceRxPcn: patient.insuranceRxPcn || "",
    insuranceRxGroup: patient.insuranceRxGroup || "",
    insurancePhone: patient.insurancePhone || "",
    insurancePolicyHolder: patient.insurancePolicyHolder || "",
    insuranceEffectiveDate: patient.insuranceEffectiveDate || "",
  });

  const handleSave = () => {
    onSubmit({
      insuranceCarrier: blankToNull(form.insuranceCarrier),
      insurancePlanType: blankToNull(form.insurancePlanType),
      insuranceMemberId: blankToNull(form.insuranceMemberId),
      insuranceGroupNumber: blankToNull(form.insuranceGroupNumber),
      insuranceRxBin: blankToNull(form.insuranceRxBin),
      insuranceRxPcn: blankToNull(form.insuranceRxPcn),
      insuranceRxGroup: blankToNull(form.insuranceRxGroup),
      insurancePhone: blankToNull(form.insurancePhone),
      insurancePolicyHolder: form.insurancePolicyHolder.trim()
        ? formatPersonName(form.insurancePolicyHolder.trim())
        : null,
      insuranceEffectiveDate: blankToNull(form.insuranceEffectiveDate),
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <FieldSection icon={IdCard} title="Plan" description="What's printed on the front of the card.">
          <div className="space-y-2">
            <Label htmlFor="ins-carrier" className={labelClass}>Carrier / Plan Name</Label>
            <Input
              id="ins-carrier" className={controlClass} value={form.insuranceCarrier}
              onChange={(e) => setForm({ ...form, insuranceCarrier: e.target.value })}
              placeholder="Blue Cross Blue Shield" data-testid="input-ins-carrier"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-plan-type" className={labelClass}>Plan Type</Label>
            <Input
              id="ins-plan-type" className={controlClass} value={form.insurancePlanType}
              onChange={(e) => setForm({ ...form, insurancePlanType: e.target.value })}
              placeholder="PPO, HMO, Medicare Advantage..." data-testid="input-ins-plan-type"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-member-id" className={labelClass}>Member ID</Label>
            <Input
              id="ins-member-id" className={controlClass} value={form.insuranceMemberId}
              onChange={(e) => setForm({ ...form, insuranceMemberId: e.target.value })}
              autoCapitalize="characters" autoCorrect="off"
              placeholder="XZY123456789" data-testid="input-ins-member-id"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-group" className={labelClass}>Group Number</Label>
            <Input
              id="ins-group" className={controlClass} value={form.insuranceGroupNumber}
              onChange={(e) => setForm({ ...form, insuranceGroupNumber: e.target.value })}
              autoCapitalize="characters" autoCorrect="off"
              placeholder="000123456" data-testid="input-ins-group"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-holder" className={labelClass}>Policy Holder</Label>
            <Input
              id="ins-holder" className={controlClass} value={form.insurancePolicyHolder}
              onChange={(e) => setForm({ ...form, insurancePolicyHolder: e.target.value })}
              placeholder="Jane Doe" data-testid="input-ins-holder"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-effective" className={labelClass}>Effective Date</Label>
            <Input
              id="ins-effective" type="date" className={controlClass} value={form.insuranceEffectiveDate}
              onChange={(e) => setForm({ ...form, insuranceEffectiveDate: e.target.value })}
              data-testid="input-ins-effective"
            />
          </div>
        </FieldSection>

        <FieldSection icon={Phone} title="Pharmacy & Contact" description="The small print used at the pharmacy counter.">
          <div className="space-y-2">
            <Label htmlFor="ins-rxbin" className={labelClass}>RxBIN</Label>
            <Input
              id="ins-rxbin" className={controlClass} value={form.insuranceRxBin}
              onChange={(e) => setForm({ ...form, insuranceRxBin: e.target.value })}
              autoCapitalize="characters" autoCorrect="off"
              placeholder="004336" data-testid="input-ins-rxbin"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-rxpcn" className={labelClass}>RxPCN</Label>
            <Input
              id="ins-rxpcn" className={controlClass} value={form.insuranceRxPcn}
              onChange={(e) => setForm({ ...form, insuranceRxPcn: e.target.value })}
              autoCapitalize="characters" autoCorrect="off"
              placeholder="ADV" data-testid="input-ins-rxpcn"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-rxgroup" className={labelClass}>RxGroup</Label>
            <Input
              id="ins-rxgroup" className={controlClass} value={form.insuranceRxGroup}
              onChange={(e) => setForm({ ...form, insuranceRxGroup: e.target.value })}
              autoCapitalize="characters" autoCorrect="off"
              placeholder="RX1234" data-testid="input-ins-rxgroup"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ins-phone" className={labelClass}>Member Services Phone</Label>
            <Input
              id="ins-phone" className={controlClass} inputMode="tel" value={form.insurancePhone}
              onChange={(e) => setForm({ ...form, insurancePhone: formatPhone(e.target.value) })}
              placeholder="(555) 123-4567" data-testid="input-ins-phone"
            />
          </div>
        </FieldSection>
      </div>
      <FormFooter onCancel={onCancel} onSave={handleSave} saveLabel="Save Insurance" />
    </div>
  );
}

export default function Profile() {
  const { activePatientId, activePatient, isLoading } = usePatient();
  const pid = activePatientId;
  const { toast } = useToast();
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState(false);
  const [viewing, setViewing] = useState<"front" | "back" | null>(null);

  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", pid],
    queryFn: () => getPhysicians(pid),
  });

  const updateMut = useMutation({
    mutationFn: (data: Partial<Patient>) => updatePatient(pid, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      setEditingPersonal(false);
      setEditingInsurance(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save. Please try again.", variant: "destructive" });
    },
  });

  const patient = activePatient;
  if (isLoading || !patient) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl w-full">
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  const age = ageFromDob(patient.dateOfBirth);
  const primaryDoc = physicians.find((p) => p.id === patient.primaryPhysicianId);
  const viewingSrc = viewing === "front" ? patient.insuranceCardFront : patient.insuranceCardBack;
  const hasInsuranceDetails = Boolean(
    patient.insuranceCarrier || patient.insuranceMemberId || patient.insuranceGroupNumber ||
    patient.insurancePlanType || patient.insuranceRxBin || patient.insuranceRxPcn ||
    patient.insuranceRxGroup || patient.insurancePhone || patient.insurancePolicyHolder ||
    patient.insuranceEffectiveDate,
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl w-full min-w-0 overflow-x-hidden">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary -ml-1 px-1 py-1.5" data-testid="link-back-to-dashboard">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">
          Personal details and insurance card for {patient.name}
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-4 min-w-0">
            <ProfilePhoto patient={patient} onChange={(photoUrl) => updateMut.mutate({ photoUrl })} />
            <div className="flex-1 min-w-0">
              <h2 className="font-heading text-xl font-bold break-words" data-testid="text-profile-name">{patient.name}</h2>
              {patient.relationship && <p className="text-sm text-primary font-semibold mt-0.5">{patient.relationship}</p>}
              {patient.dateOfBirth && (
                <p className="text-sm text-muted-foreground mt-1.5" data-testid="text-profile-dob">
                  Born {formatDob(patient.dateOfBirth)}
                  {age !== null && ` · Age ${age}`}
                </p>
              )}
              <Button
                size="sm" variant="outline" className="mt-3 gap-1.5"
                onClick={() => setEditingPersonal(true)}
                data-testid="button-edit-personal"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit details
              </Button>
            </div>
          </div>

          {(patient.bloodType || patient.height || primaryDoc) && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 min-w-0">
              <DetailRow label="Blood Type" value={patient.bloodType} />
              <DetailRow label="Height" value={patient.height} />
              <DetailRow label="Primary Care Physician" value={primaryDoc?.name} />
            </dl>
          )}
          {(patient.allergies || patient.conditions) && (
            <dl className="space-y-3 border-t pt-4 min-w-0">
              <DetailRow
                label="Allergies"
                value={patient.allergies && <span className="whitespace-pre-wrap">{patient.allergies}</span>}
              />
              <DetailRow
                label="Chronic Conditions / Notes"
                value={patient.conditions && <span className="whitespace-pre-wrap">{patient.conditions}</span>}
              />
            </dl>
          )}
          {!patient.bloodType && !patient.height && !primaryDoc && !patient.allergies && !patient.conditions && (
            <p className="text-sm text-muted-foreground border-t pt-4">
              Add blood type, height, allergies, and a primary care physician with <span className="font-semibold">Edit details</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
              <IdCard className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-lg font-semibold leading-tight">Insurance Card</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Photograph both sides so you can show them at check-in, even offline.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 min-w-0">
            <CardPhotoTile
              label="Front"
              value={patient.insuranceCardFront}
              onChange={(insuranceCardFront) => updateMut.mutate({ insuranceCardFront })}
              onView={() => setViewing("front")}
              testId="card-front"
            />
            <CardPhotoTile
              label="Back"
              value={patient.insuranceCardBack}
              onChange={(insuranceCardBack) => updateMut.mutate({ insuranceCardBack })}
              onView={() => setViewing("back")}
              testId="card-back"
            />
          </div>

          {hasInsuranceDetails ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 min-w-0">
              <DetailRow label="Carrier" value={patient.insuranceCarrier} />
              <DetailRow label="Plan Type" value={patient.insurancePlanType} />
              <DetailRow label="Member ID" value={patient.insuranceMemberId} />
              <DetailRow label="Group Number" value={patient.insuranceGroupNumber} />
              <DetailRow label="RxBIN" value={patient.insuranceRxBin} />
              <DetailRow label="RxPCN" value={patient.insuranceRxPcn} />
              <DetailRow label="RxGroup" value={patient.insuranceRxGroup} />
              <DetailRow label="Policy Holder" value={patient.insurancePolicyHolder} />
              <DetailRow
                label="Effective Date"
                value={patient.insuranceEffectiveDate && formatDob(patient.insuranceEffectiveDate)}
              />
              <DetailRow
                label="Member Services"
                value={patient.insurancePhone && (
                  <a
                    href={`tel:${patient.insurancePhone.replace(/[^\d+]/g, "")}`}
                    className="underline underline-offset-2 break-words"
                    data-testid="link-insurance-phone"
                  >
                    {patient.insurancePhone}
                  </a>
                )}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground border-t pt-4">
              No plan details saved yet. Add the member ID, group number, and member services
              phone so they're searchable even if the photo is hard to read.
            </p>
          )}

          <Button
            size="sm" variant="outline" className="gap-1.5"
            onClick={() => setEditingInsurance(true)}
            data-testid="button-edit-insurance"
          >
            <Edit2 className="w-3.5 h-3.5" /> {hasInsuranceDetails ? "Edit plan details" : "Add plan details"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={editingPersonal} onOpenChange={setEditingPersonal}>
        <DialogContent className={PROFILE_DIALOG_CLASS}>
          <DialogShell title="Edit Profile" description="These details stay on this device and are included in your backups.">
            <PersonalDetailsForm
              patient={patient}
              physicians={physicians}
              onSubmit={(data) => updateMut.mutate(data)}
              onCancel={() => setEditingPersonal(false)}
            />
          </DialogShell>
        </DialogContent>
      </Dialog>

      <Dialog open={editingInsurance} onOpenChange={setEditingInsurance}>
        <DialogContent className={PROFILE_DIALOG_CLASS}>
          <DialogShell title="Insurance Details" description="Type in what's printed on the card so you can search and read it easily.">
            <InsuranceForm
              patient={patient}
              onSubmit={(data) => updateMut.mutate(data)}
              onCancel={() => setEditingInsurance(false)}
            />
          </DialogShell>
        </DialogContent>
      </Dialog>

      {viewing && viewingSrc && (
        <FullScreenImage
          src={viewingSrc}
          title={`Insurance card — ${viewing === "front" ? "front" : "back"}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
