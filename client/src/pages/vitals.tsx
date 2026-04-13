import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getVitals, createVital, deleteVital } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { HeartPulse, Plus, Trash2, Activity, Thermometer, Droplets, Wind } from "lucide-react";
import type { Vital } from "@shared/schema";
import { format, parseISO } from "date-fns";

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

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-body">Date</Label>
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-vital-date" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-body">Weight (lbs)</Label>
          <Input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="150" data-testid="input-vital-weight" />
        </div>
        <div>
          <Label className="text-xs font-body">Heart Rate (bpm)</Label>
          <Input type="number" value={form.heartRate} onChange={(e) => setForm({ ...form, heartRate: e.target.value })} placeholder="72" data-testid="input-vital-hr" />
        </div>
        <div>
          <Label className="text-xs font-body">BP Systolic</Label>
          <Input type="number" value={form.bloodPressureSystolic} onChange={(e) => setForm({ ...form, bloodPressureSystolic: e.target.value })} placeholder="120" data-testid="input-vital-sys" />
        </div>
        <div>
          <Label className="text-xs font-body">BP Diastolic</Label>
          <Input type="number" value={form.bloodPressureDiastolic} onChange={(e) => setForm({ ...form, bloodPressureDiastolic: e.target.value })} placeholder="80" data-testid="input-vital-dia" />
        </div>
        <div>
          <Label className="text-xs font-body">Temperature (°F)</Label>
          <Input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} placeholder="98.6" data-testid="input-vital-temp" />
        </div>
        <div>
          <Label className="text-xs font-body">Blood Sugar (mg/dL)</Label>
          <Input type="number" value={form.bloodSugar} onChange={(e) => setForm({ ...form, bloodSugar: e.target.value })} placeholder="100" data-testid="input-vital-sugar" />
        </div>
        <div>
          <Label className="text-xs font-body">O2 Saturation (%)</Label>
          <Input type="number" value={form.oxygenSaturation} onChange={(e) => setForm({ ...form, oxygenSaturation: e.target.value })} placeholder="98" data-testid="input-vital-o2" />
        </div>
      </div>
      <div>
        <Label className="text-xs font-body">Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-vital-notes" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.date}
          className="gradient-primary text-white border-none" data-testid="button-vital-save">
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
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Vitals</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Track your health metrics over time</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-vital">
              <Plus className="w-4 h-4" /> Log Vitals
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-heading">Log Vitals</DialogTitle></DialogHeader>
            <VitalForm onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Latest Reading Cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {latest.bloodPressureSystolic && latest.bloodPressureDiastolic && (
            <Card className="gradient-primary text-white border-none">
              <CardContent className="p-3 text-center">
                <Activity className="w-5 h-5 mx-auto mb-1 text-white/80" />
                <p className="text-xs text-white/70">Blood Pressure</p>
                <p className="text-lg font-heading font-bold">{latest.bloodPressureSystolic}/{latest.bloodPressureDiastolic}</p>
                <p className="text-xs text-white/60">mmHg</p>
              </CardContent>
            </Card>
          )}
          {latest.heartRate && (
            <Card>
              <CardContent className="p-3 text-center">
                <HeartPulse className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-muted-foreground">Heart Rate</p>
                <p className="text-lg font-heading font-bold">{latest.heartRate}</p>
                <p className="text-xs text-muted-foreground">bpm</p>
              </CardContent>
            </Card>
          )}
          {latest.temperature && (
            <Card>
              <CardContent className="p-3 text-center">
                <Thermometer className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-muted-foreground">Temperature</p>
                <p className="text-lg font-heading font-bold">{latest.temperature}°F</p>
              </CardContent>
            </Card>
          )}
          {latest.oxygenSaturation && (
            <Card>
              <CardContent className="p-3 text-center">
                <Wind className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-muted-foreground">O2 Sat</p>
                <p className="text-lg font-heading font-bold">{latest.oxygenSaturation}%</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base font-semibold">History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : vitals.length === 0 ? (
            <div className="py-12 text-center">
              <HeartPulse className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No vitals logged yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-heading">Date</TableHead>
                    <TableHead className="text-xs font-heading">Weight</TableHead>
                    <TableHead className="text-xs font-heading">BP</TableHead>
                    <TableHead className="text-xs font-heading">HR</TableHead>
                    <TableHead className="text-xs font-heading">Temp</TableHead>
                    <TableHead className="text-xs font-heading">Sugar</TableHead>
                    <TableHead className="text-xs font-heading">O2</TableHead>
                    <TableHead className="text-xs font-heading w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vitals.map((v) => (
                    <TableRow key={v.id} data-testid={`vital-${v.id}`}>
                      <TableCell className="text-xs font-medium">{format(parseISO(v.date), "MMM d, yy")}</TableCell>
                      <TableCell className="text-xs">{v.weight || "—"}</TableCell>
                      <TableCell className="text-xs">{v.bloodPressureSystolic && v.bloodPressureDiastolic ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}` : "—"}</TableCell>
                      <TableCell className="text-xs">{v.heartRate || "—"}</TableCell>
                      <TableCell className="text-xs">{v.temperature ? `${v.temperature}°` : "—"}</TableCell>
                      <TableCell className="text-xs">{v.bloodSugar || "—"}</TableCell>
                      <TableCell className="text-xs">{v.oxygenSaturation ? `${v.oxygenSaturation}%` : "—"}</TableCell>
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
