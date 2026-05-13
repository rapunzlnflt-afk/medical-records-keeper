import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getVitals, createVital, deleteVital } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  HeartPulse,
  Plus,
  Trash2,
  Activity,
  Thermometer,
  Droplets,
  Wind,
  Calendar,
  FileText,
  Scale,
} from "lucide-react";
import type { Vital } from "@shared/schema";
import { format, parseISO } from "date-fns";

const vitalLabelClass = "text-base font-body font-semibold text-foreground";
const vitalControlClass = "h-12 text-base";

const VITAL_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

function VitalFieldSection({
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
          <h3 className="font-heading text-lg font-semibold leading-tight">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
      </header>
      <div className="px-4 sm:px-5 pb-5 pt-2 space-y-4">{children}</div>
    </section>
  );
}

function VitalForm({ onSubmit, onCancel }: {
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    weight: "",
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    heartRate: "",
    temperature: "",
    bloodSugar: "",
    oxygenSaturation: "",
    notes: "",
  });

  const canSubmit = Boolean(form.date);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <VitalFieldSection
          icon={Calendar}
          title="Reading Date"
          description="When the reading was taken."
        >
          <div className="space-y-2">
            <Label htmlFor="vital-date" className={vitalLabelClass}>Date</Label>
            <Input
              id="vital-date"
              type="date"
              className={vitalControlClass}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              data-testid="input-vital-date"
            />
          </div>
        </VitalFieldSection>

        <VitalFieldSection
          icon={Activity}
          title="Blood Pressure & Heart Rate"
          description="Leave any field blank if it wasn't measured."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vital-sys" className={vitalLabelClass}>BP Systolic</Label>
              <Input
                id="vital-sys"
                type="number"
                inputMode="numeric"
                className={vitalControlClass}
                value={form.bloodPressureSystolic}
                onChange={(e) => setForm({ ...form, bloodPressureSystolic: e.target.value })}
                placeholder="120"
                data-testid="input-vital-sys"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vital-dia" className={vitalLabelClass}>BP Diastolic</Label>
              <Input
                id="vital-dia"
                type="number"
                inputMode="numeric"
                className={vitalControlClass}
                value={form.bloodPressureDiastolic}
                onChange={(e) => setForm({ ...form, bloodPressureDiastolic: e.target.value })}
                placeholder="80"
                data-testid="input-vital-dia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vital-hr" className={vitalLabelClass}>Heart Rate (bpm)</Label>
              <Input
                id="vital-hr"
                type="number"
                inputMode="numeric"
                className={vitalControlClass}
                value={form.heartRate}
                onChange={(e) => setForm({ ...form, heartRate: e.target.value })}
                placeholder="72"
                data-testid="input-vital-hr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vital-o2" className={vitalLabelClass}>O₂ Saturation (%)</Label>
              <Input
                id="vital-o2"
                type="number"
                inputMode="numeric"
                className={vitalControlClass}
                value={form.oxygenSaturation}
                onChange={(e) => setForm({ ...form, oxygenSaturation: e.target.value })}
                placeholder="98"
                data-testid="input-vital-o2"
              />
            </div>
          </div>
        </VitalFieldSection>

        <VitalFieldSection
          icon={Scale}
          title="Weight, Temperature & Blood Sugar"
          description="Anything you measured today."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vital-weight" className={vitalLabelClass}>Weight (lbs)</Label>
              <Input
                id="vital-weight"
                type="number"
                inputMode="decimal"
                className={vitalControlClass}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                placeholder="150"
                data-testid="input-vital-weight"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vital-temp" className={vitalLabelClass}>Temperature (°F)</Label>
              <Input
                id="vital-temp"
                type="number"
                inputMode="decimal"
                step="0.1"
                className={vitalControlClass}
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                placeholder="98.6"
                data-testid="input-vital-temp"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="vital-sugar" className={vitalLabelClass}>Blood Sugar (mg/dL)</Label>
              <Input
                id="vital-sugar"
                type="number"
                inputMode="numeric"
                className={vitalControlClass}
                value={form.bloodSugar}
                onChange={(e) => setForm({ ...form, bloodSugar: e.target.value })}
                placeholder="100"
                data-testid="input-vital-sugar"
              />
            </div>
          </div>
        </VitalFieldSection>

        <VitalFieldSection
          icon={FileText}
          title="Notes"
          description="Anything worth remembering about this reading."
        >
          <div className="space-y-2">
            <Label htmlFor="vital-notes" className={vitalLabelClass}>Notes</Label>
            <Textarea
              id="vital-notes"
              className="text-base min-h-[110px]"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={4}
              placeholder="After a 20-minute walk, post-meal, etc."
              data-testid="input-vital-notes"
            />
          </div>
        </VitalFieldSection>
      </div>

      <div
        className="sticky bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
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
          data-testid="button-vital-save"
        >
          Log Vitals
        </Button>
      </div>
    </div>
  );
}

export default function Vitals() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: vitals = [], isLoading } = useQuery<Vital[]>({
    queryKey: ["vitals", pid],
    queryFn: () => getVitals(pid),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => createVital({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["vitals", pid] }); setOpen(false); toast({ title: "Vitals logged" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteVital(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["vitals", pid] }); toast({ title: "Entry deleted" }); },
  });

  const latest = vitals[0];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl w-full min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Vitals</h1>
          <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">Track your health metrics over time</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-vital">
              <Plus className="w-4 h-4" /> Log Vitals
            </Button>
          </DialogTrigger>
          <DialogContent className={VITAL_DIALOG_CLASS}>
            <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
              <DialogTitle className="font-heading text-2xl font-bold text-white">
                Log Vitals
              </DialogTitle>
              <DialogDescription className="text-white/85 text-sm">
                Record today's reading. Pick a date and fill in whatever you measured — every field is optional except the date.
              </DialogDescription>
            </DialogHeader>
            <VitalForm onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Latest Reading Cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0">
          {latest.bloodPressureSystolic && latest.bloodPressureDiastolic && (
            <Card className="gradient-primary text-white border-none">
              <CardContent className="p-3 text-center">
                <Activity className="w-5 h-5 mx-auto mb-1 text-white/80" />
                <p className="text-sm text-white/90 font-semibold">Blood Pressure</p>
                <p className="text-2xl font-heading font-bold tabular-nums mt-1">{latest.bloodPressureSystolic}/{latest.bloodPressureDiastolic}</p>
                <p className="text-xs text-white/80 mt-0.5">mmHg</p>
              </CardContent>
            </Card>
          )}
          {latest.heartRate && (
            <Card>
              <CardContent className="p-3 text-center">
                <HeartPulse className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-sm text-muted-foreground font-semibold">Heart Rate</p>
                <p className="text-2xl font-heading font-bold tabular-nums mt-1">{latest.heartRate}</p>
                <p className="text-xs text-muted-foreground mt-0.5">bpm</p>
              </CardContent>
            </Card>
          )}
          {latest.temperature && (
            <Card>
              <CardContent className="p-3 text-center">
                <Thermometer className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-sm text-muted-foreground font-semibold">Temperature</p>
                <p className="text-2xl font-heading font-bold tabular-nums mt-1">{latest.temperature}°F</p>
              </CardContent>
            </Card>
          )}
          {latest.oxygenSaturation && (
            <Card>
              <CardContent className="p-3 text-center">
                <Wind className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-sm text-muted-foreground font-semibold">O₂ Sat</p>
                <p className="text-2xl font-heading font-bold tabular-nums mt-1">{latest.oxygenSaturation}%</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-lg font-semibold">History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : vitals.length === 0 ? (
            <div className="py-12 text-center">
              <HeartPulse className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-base text-muted-foreground">No vitals logged yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm font-heading font-semibold">Date</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">Weight</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">BP</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">HR</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">Temp</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">Sugar</TableHead>
                    <TableHead className="text-sm font-heading font-semibold">O2</TableHead>
                    <TableHead className="text-sm font-heading w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vitals.map((v) => (
                    <TableRow key={v.id} data-testid={`vital-${v.id}`}>
                      <TableCell className="text-sm font-medium">{format(parseISO(v.date), "MMM d, yy")}</TableCell>
                      <TableCell className="text-sm">{v.weight || "—"}</TableCell>
                      <TableCell className="text-sm">{v.bloodPressureSystolic && v.bloodPressureDiastolic ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}` : "—"}</TableCell>
                      <TableCell className="text-sm">{v.heartRate || "—"}</TableCell>
                      <TableCell className="text-sm">{v.temperature ? `${v.temperature}°` : "—"}</TableCell>
                      <TableCell className="text-sm">{v.bloodSugar || "—"}</TableCell>
                      <TableCell className="text-sm">{v.oxygenSaturation ? `${v.oxygenSaturation}%` : "—"}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(v.id!)}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
