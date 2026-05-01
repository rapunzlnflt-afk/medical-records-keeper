import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getMedications, createMedication, updateMedication, deleteMedication, getMedicationLogs, createMedicationLog, getPhysicians } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Pill, Plus, Trash2, Edit2, Clock, AlertCircle, CheckCircle2, Sunrise, Sun, Sunset, Moon, Printer, ExternalLink, Tag, ShieldAlert } from "lucide-react";
import type { Medication, MedicationLog, Physician } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { useLocation } from "wouter";
import AlertSoundControl from "@/components/alert-sound-control";
const MED_TYPES = ["prescription", "otc", "supplement", "vitamin"];
const FREQUENCIES = ["daily", "twice-daily", "three-times-daily", "weekly", "bi-weekly", "monthly", "as-needed"];
const TIMES_OF_DAY = ["morning", "afternoon", "evening", "bedtime"];

const timeIcon = (t: string | null) => {
  if (t === "morning") return <Sunrise className="w-3 h-3" />;
  if (t === "afternoon") return <Sun className="w-3 h-3" />;
  if (t === "evening") return <Sunset className="w-3 h-3" />;
  if (t === "bedtime") return <Moon className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
};

function MedicationForm({ initial, onSubmit, onCancel, physicians }: {
  initial?: Partial<Medication>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  physicians: Physician[];
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-body">Medication Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lisinopril" data-testid="input-med-name" />
        </div>
        <div>
          <Label className="text-xs font-body">Type</Label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger data-testid="select-med-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MED_TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Dosage</Label>
          <Input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} placeholder="10mg" data-testid="input-med-dosage" />
        </div>
        <div>
          <Label className="text-xs font-body">Frequency</Label>
          <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
            <SelectTrigger data-testid="select-med-freq"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Time of Day</Label>
          <Select value={form.timeOfDay || "none"} onValueChange={(v) => setForm({ ...form, timeOfDay: v === "none" ? "" : v })}>
            <SelectTrigger data-testid="select-med-time"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not specified</SelectItem>
              {TIMES_OF_DAY.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Prescribed By</Label>
          <Select value={form.prescribedBy || "none"} onValueChange={(v) => {
            if (v === "__add_physician__") {
              navigate("/physicians");
              return;
            }
            setForm({ ...form, prescribedBy: v === "none" ? "" : v });
          }}>
            <SelectTrigger data-testid="select-med-prescribed"><SelectValue placeholder="Select physician" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not specified</SelectItem>
              {physicians.map((p) => <SelectItem key={p.id} value={p.name}>{p.name} — {p.specialty}</SelectItem>)}
              <SelectItem value="__add_physician__" className="text-primary font-semibold">+ Add Physician</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-body">Pharmacy</Label>
          <Input value={form.pharmacy || ""} onChange={(e) => setForm({ ...form, pharmacy: e.target.value })} placeholder="CVS Main St" data-testid="input-med-pharmacy" />
        </div>
        <div>
          <Label className="text-xs font-body">Purpose</Label>
          <Input value={form.purpose || ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Blood pressure" data-testid="input-med-purpose" />
        </div>
        <div>
          <Label className="text-xs font-body">Start Date</Label>
          <Input type="date" value={form.startDate || ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-med-start" />
        </div>
        <div>
          <Label className="text-xs font-body">End Date</Label>
          <Input type="date" value={form.endDate || ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} data-testid="input-med-end" />
        </div>
        <div>
          <Label className="text-xs font-body">Refill Date</Label>
          <Input type="date" value={form.refillDate || ""} onChange={(e) => setForm({ ...form, refillDate: e.target.value })} data-testid="input-med-refill" />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <Switch checked={form.active === 1} onCheckedChange={(c) => setForm({ ...form, active: c ? 1 : 0 })} data-testid="switch-med-active" />
          <Label className="text-xs font-body">Active</Label>
        </div>
      </div>
      <div>
        <Label className="text-xs font-body">Side Effects</Label>
        <Input value={form.sideEffects || ""} onChange={(e) => setForm({ ...form, sideEffects: e.target.value })} placeholder="Dizziness, cough..." data-testid="input-med-side" />
      </div>
      <div>
        <Label className="text-xs font-body">Notes</Label>
        <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-med-notes" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.name || !form.dosage}
          className="gradient-primary text-white border-none" data-testid="button-med-save">
          {initial?.id ? "Update" : "Add"} Medication
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
  const [logOpen, setLogOpen] = useState<number | null>(null);
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

  const createMut = useMutation({
    mutationFn: (data: any) => createMedication({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medications", pid] }); setOpen(false); toast({ title: "Medication added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateMedication(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medications", pid] }); setEditing(null); toast({ title: "Medication updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMedication(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medications", pid] }); toast({ title: "Medication deleted" }); },
  });
  const logMut = useMutation({
    mutationFn: (data: any) => createMedicationLog(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medication-logs"] }); toast({ title: "Dose logged" }); },
  });

  const active = medications.filter((m) => m.active === 1);
  const inactive = medications.filter((m) => m.active !== 1);
  const today = new Date().toISOString().split("T")[0];

  const logDose = (medId: number, taken: boolean) => {
    logMut.mutate({
      medicationId: medId,
      date: today,
      taken: taken ? 1 : 0,
      time: format(new Date(), "HH:mm"),
    });
  };

  function MedCard({ med }: { med: Medication }) {
    const medLogs = logs.filter((l) => l.medicationId === med.id);
    const todayLog = medLogs.find((l) => l.date === today);

    return (
      <Card className="hover-elevate" data-testid={`medication-${med.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-heading text-sm font-semibold">{med.name}</h3>
                <Badge variant="secondary" className="text-xs">{med.type}</Badge>
                {!med.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span>{med.dosage}</span>
                <span className="flex items-center gap-1">{timeIcon(med.timeOfDay)}{med.frequency}</span>
                {med.purpose && <span>{med.purpose}</span>}
              </div>
              {med.prescribedBy && <p className="text-xs text-muted-foreground mt-1">Rx: {med.prescribedBy}</p>}
              {med.pharmacy && <p className="text-xs text-muted-foreground">Pharmacy: {med.pharmacy}</p>}
              {med.refillDate && (
                <p className="text-xs mt-1">
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />Refill: {format(parseISO(med.refillDate), "MMM d, yyyy")}
                  </span>
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {med.active === 1 && (
                <div className="flex gap-1">
                  {todayLog ? (
                    <Badge className="status-completed text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Taken</Badge>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => logDose(med.id!, true)} className="text-xs h-7" data-testid={`button-take-${med.id}`}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Take
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => logDose(med.id!, false)} className="text-xs h-7 text-muted-foreground" data-testid={`button-skip-${med.id}`}>
                        Skip
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="flex gap-1 mt-1">
                <Dialog open={editing?.id === med.id} onOpenChange={(o) => !o && setEditing(null)}>
                  <DialogTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={() => setEditing(med)} data-testid={`button-edit-med-${med.id}`}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle className="font-heading">Edit Medication</DialogTitle></DialogHeader>
                    <MedicationForm physicians={physicians} initial={med} onSubmit={(data) => updateMut.mutate({ id: med.id!, data })} onCancel={() => setEditing(null)} />
                  </DialogContent>
                </Dialog>
                <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(med.id!)} data-testid={`button-delete-med-${med.id}`}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Medications</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Track prescriptions, supplements, and daily doses</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 print-button-area" onClick={() => {
            const w = window.open('', '_blank', 'width=800,height=600');
            if (!w) return;
            w.document.write(`<!DOCTYPE html><html><head><title>Medications</title><style>
              body { font-family: 'Karla', Arial, sans-serif; padding: 24px; color: #1e293b; }
              h1 { font-family: 'Montserrat', Arial, sans-serif; font-size: 20px; margin-bottom: 16px; }
              h2 { font-family: 'Montserrat', Arial, sans-serif; font-size: 16px; margin: 16px 0 8px; }
              .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
              .title { font-weight: 600; font-size: 14px; }
              .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
              .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: #dbeafe; color: #1e40af; margin-left: 6px; }
            </style></head><body><h1>Medications</h1>`);
            if (active.length) {
              w.document.write('<h2>Active</h2>');
              active.forEach((med) => {
                w.document.write(`<div class="card"><div class="title">${med.name} <span class="badge">${med.type}</span></div><div class="meta">${med.dosage} &mdash; ${med.frequency}${med.timeOfDay ? ' (' + med.timeOfDay + ')' : ''}</div>${med.prescribedBy ? '<div class="meta">Prescribed by: ' + med.prescribedBy + '</div>' : ''}${med.pharmacy ? '<div class="meta">Pharmacy: ' + med.pharmacy + '</div>' : ''}${med.purpose ? '<div class="meta">Purpose: ' + med.purpose + '</div>' : ''}${med.refillDate ? '<div class="meta">Refill: ' + med.refillDate + '</div>' : ''}</div>`);
              });
            }
            if (inactive.length) {
              w.document.write('<h2>Inactive</h2>');
              inactive.forEach((med) => {
                w.document.write(`<div class="card"><div class="title">${med.name} <span class="badge">${med.type}</span> <span class="badge">Inactive</span></div><div class="meta">${med.dosage} &mdash; ${med.frequency}</div></div>`);
              });
            }
            w.document.write('</body></html>');
            w.document.close();
            w.focus();
            w.print();
            w.close();
          }} data-testid="button-print-medications">
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-medication">
                <Plus className="w-4 h-4" /> Add Medication
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">New Medication</DialogTitle></DialogHeader>
            <MedicationForm physicians={physicians} onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
          </Dialog>
        </div>
      </div>
      <AlertSoundControl reminderType="medicationsSound" label="Medication alert sound" />

      {/* Today's Schedule */}
      {active.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Today's Medications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {active.map((med) => {
                const todayLog = logs.find((l) => l.medicationId === med.id && l.date === today);
                return (
                  <div key={med.id} className={`p-2 rounded-md text-center text-xs ${todayLog ? "bg-green-50 dark:bg-green-950/20" : "bg-secondary/50"}`}>
                    <div className="flex items-center justify-center gap-1 mb-1">
                      {timeIcon(med.timeOfDay)}
                      <span className="font-semibold truncate">{med.name}</span>
                    </div>
                    <span className="text-muted-foreground">{med.dosage}</span>
                    {todayLog && <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400 mx-auto mt-1" />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" className="font-body text-xs">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="inactive" className="font-body text-xs">Inactive ({inactive.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="space-y-3 mt-3">
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}</div>
          ) : active.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Pill className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No active medications</p>
            </CardContent></Card>
          ) : active.map((med) => <MedCard key={med.id} med={med} />)}
        </TabsContent>
        <TabsContent value="inactive" className="space-y-3 mt-3">
          {inactive.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No inactive medications</p>
            </CardContent></Card>
          ) : inactive.map((med) => <MedCard key={med.id} med={med} />)}
        </TabsContent>
      </Tabs>

      {/* Helpful Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Drug Interaction Checkers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-destructive" />
              Drug Interaction Checkers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">Check if your medications interact with each other</p>
            {[
              { name: "Drugs.com Interaction Checker", url: "https://www.drugs.com/drug_interactions.html" },
              { name: "WebMD Interaction Checker", url: "https://www.webmd.com/interaction-checker/default.htm" },
              { name: "Medscape Drug Interaction Checker", url: "https://reference.medscape.com/drug-interactionchecker" },
              { name: "RxList Interaction Checker", url: "https://www.rxlist.com/drug-interaction-checker.htm" },
            ].map((link) => (
              <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline font-body p-1.5 rounded-md hover:bg-primary/5 transition-colors"
                data-testid={`link-interaction-${link.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                {link.name}
              </a>
            ))}
          </CardContent>
        </Card>

        {/* Prescription Discounts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
              Prescription Discounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">Save money on your prescriptions</p>
            {[
              { name: "GoodRx", url: "https://www.goodrx.com" },
              { name: "RxSaver by RetailMeNot", url: "https://www.rxsaver.com" },
              { name: "NeedyMeds", url: "https://www.needymeds.org" },
              { name: "RxAssist", url: "https://www.rxassist.org" },
              { name: "Medicare Extra Help", url: "https://www.ssa.gov/medicare/part-d-extra-help" },
            ].map((link) => (
              <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline font-body p-1.5 rounded-md hover:bg-primary/5 transition-colors"
                data-testid={`link-discount-${link.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                {link.name}
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
