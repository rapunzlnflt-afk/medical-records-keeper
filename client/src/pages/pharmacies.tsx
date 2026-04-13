import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getPharmacies, createPharmacy, updatePharmacy, deletePharmacy } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Trash2, Edit2, Phone, MapPin, Clock, Globe, Star, Printer } from "lucide-react";
import type { Pharmacy } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";

function PharmacyForm({ initial, onSubmit, onCancel }: {
  initial?: Partial<Pharmacy>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    phone: initial?.phone || "",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    zip: initial?.zip || "",
    hours: initial?.hours || "",
    website: initial?.website || "",
    notes: initial?.notes || "",
    isPrimary: initial?.isPrimary ?? 0,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label className="text-xs font-body">Pharmacy Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CVS Pharmacy" data-testid="input-pharm-name" />
        </div>
        <div>
          <Label className="text-xs font-body">Phone</Label>
          <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(817) 555-0123" data-testid="input-pharm-phone" />
        </div>
        <div>
          <Label className="text-xs font-body">Website</Label>
          <Input value={form.website || ""} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://www.cvs.com" data-testid="input-pharm-website" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs font-body">Address</Label>
          <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St" data-testid="input-pharm-address" />
        </div>
        <div>
          <Label className="text-xs font-body">City</Label>
          <Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Fort Worth" data-testid="input-pharm-city" />
        </div>
        <div>
          <Label className="text-xs font-body">State</Label>
          <Input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="TX" data-testid="input-pharm-state" />
        </div>
        <div>
          <Label className="text-xs font-body">ZIP</Label>
          <Input value={form.zip || ""} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="76109" data-testid="input-pharm-zip" />
        </div>
        <div>
          <Label className="text-xs font-body">Hours</Label>
          <Input value={form.hours || ""} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="Mon-Fri 8am-9pm" data-testid="input-pharm-hours" />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <Switch checked={form.isPrimary === 1} onCheckedChange={(c) => setForm({ ...form, isPrimary: c ? 1 : 0 })} data-testid="switch-pharm-primary" />
          <Label className="text-xs font-body">Preferred Pharmacy</Label>
        </div>
      </div>
      <div>
        <Label className="text-xs font-body">Notes</Label>
        <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Drive-through available..." data-testid="input-pharm-notes" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.name}
          className="gradient-primary text-white border-none" data-testid="button-pharm-save">
          {initial?.id ? "Update" : "Add"} Pharmacy
        </Button>
      </div>
    </div>
  );
}

export default function Pharmacies() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pharmacy | null>(null);
  const { toast } = useToast();

  const { data: pharmacyList = [], isLoading } = useQuery<Pharmacy[]>({
    queryKey: ["pharmacies", pid],
    queryFn: () => getPharmacies(pid),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => createPharmacy({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["pharmacies", pid] }); setOpen(false); toast({ title: "Pharmacy added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updatePharmacy(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["pharmacies", pid] }); setEditing(null); toast({ title: "Pharmacy updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deletePharmacy(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["pharmacies", pid] }); toast({ title: "Pharmacy deleted" }); },
  });

  // Show preferred pharmacies first
  const sorted = [...pharmacyList].sort((a, b) => (b.isPrimary ?? 0) - (a.isPrimary ?? 0));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Preferred Pharmacies</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Manage your pharmacy locations</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline" className="gap-1"
            data-testid="button-print-pharmacies"
            onClick={() => {
              const list = sorted.map((p) => {
                const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
                return `<tr>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${p.name}${p.isPrimary ? ' ⭐' : ''}</td>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${p.phone || '—'}</td>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${addr || '—'}</td>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${p.hours || '—'}</td>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${p.website || '—'}</td>
                  <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${p.notes || '—'}</td>
                </tr>`;
              }).join("");
              const html = `<html><head><title>My Pharmacies</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:auto">
                <h1 style="font-size:20px;margin-bottom:4px">Preferred Pharmacies</h1>
                <p style="color:#6b7280;font-size:13px;margin-bottom:16px">Printed ${new Date().toLocaleDateString()}</p>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead><tr style="background:#f3f4f6">
                    <th style="padding:8px 12px;text-align:left">Name</th>
                    <th style="padding:8px 12px;text-align:left">Phone</th>
                    <th style="padding:8px 12px;text-align:left">Address</th>
                    <th style="padding:8px 12px;text-align:left">Hours</th>
                    <th style="padding:8px 12px;text-align:left">Website</th>
                    <th style="padding:8px 12px;text-align:left">Notes</th>
                  </tr></thead>
                  <tbody>${list}</tbody>
                </table>
              </body></html>`;
              const w = window.open("", "_blank");
              if (w) { w.document.write(html); w.document.close(); w.print(); }
            }}
          >
            <Printer className="w-4 h-4" /> Print
          </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-pharmacy">
              <Plus className="w-4 h-4" /> Add Pharmacy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">New Pharmacy</DialogTitle></DialogHeader>
            <PharmacyForm onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No pharmacies added yet</p>
            </CardContent>
          </Card>
        ) : (
          sorted.map((pharm) => (
            <Card key={pharm.id} className="hover-elevate" data-testid={`pharmacy-${pharm.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-heading text-sm font-semibold">{pharm.name}</h3>
                      {pharm.isPrimary === 1 && (
                        <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          <Star className="w-3 h-3 mr-1" />Preferred
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {pharm.phone && (
                        <a href={`tel:${pharm.phone}`} className="flex items-center gap-1 hover:text-primary">
                          <Phone className="w-3 h-3" />{pharm.phone}
                        </a>
                      )}
                      {pharm.hours && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{pharm.hours}</span>}
                    </div>
                    {(pharm.address || pharm.city) && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        {[pharm.address, pharm.city, pharm.state, pharm.zip].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {pharm.website && (
                      <a href={pharm.website.startsWith("http") ? pharm.website : `https://${pharm.website}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
                        <Globe className="w-3 h-3" />{pharm.website}
                      </a>
                    )}
                    {pharm.notes && <p className="text-xs text-muted-foreground mt-1">{pharm.notes}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Dialog open={editing?.id === pharm.id} onOpenChange={(o) => !o && setEditing(null)}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(pharm)} data-testid={`button-edit-pharm-${pharm.id}`}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader><DialogTitle className="font-heading">Edit Pharmacy</DialogTitle></DialogHeader>
                        <PharmacyForm initial={pharm} onSubmit={(data) => updateMut.mutate({ id: pharm.id!, data })} onCancel={() => setEditing(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(pharm.id!)} data-testid={`button-delete-pharm-${pharm.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
