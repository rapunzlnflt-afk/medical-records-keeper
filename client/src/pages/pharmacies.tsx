import React, { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Plus,
  Trash2,
  Edit2,
  Phone,
  MapPin,
  Clock,
  Globe,
  Star,
  Printer,
  FileText,
} from "lucide-react";
import type { Pharmacy } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";

const pharmLabelClass = "text-base font-body font-semibold text-foreground";
const pharmControlClass = "h-12 text-base";

const PHARM_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

function PharmFieldSection({
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
          <h3 className="font-heading text-base font-semibold leading-tight">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </header>
      <div className="px-4 sm:px-5 pb-5 pt-2 space-y-4">{children}</div>
    </section>
  );
}

function PharmacyForm({ initial, onSubmit, onCancel, isEdit }: {
  initial?: Partial<Pharmacy>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isEdit: boolean;
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

  const canSubmit = Boolean(form.name);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <PharmFieldSection
          icon={Building2}
          title="Pharmacy Details"
          description="The pharmacy's name and how often you use it."
        >
          <div className="space-y-2">
            <Label htmlFor="pharm-name" className={pharmLabelClass}>Pharmacy Name</Label>
            <Input
              id="pharm-name"
              className={pharmControlClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="CVS Pharmacy"
              data-testid="input-pharm-name"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
            <div className="min-w-0">
              <p className={pharmLabelClass}>Preferred Pharmacy</p>
              <p className="text-xs text-muted-foreground mt-0.5">Mark this as the one you use most often.</p>
            </div>
            <Switch
              checked={form.isPrimary === 1}
              onCheckedChange={(c) => setForm({ ...form, isPrimary: c ? 1 : 0 })}
              data-testid="switch-pharm-primary"
            />
          </div>
        </PharmFieldSection>

        <PharmFieldSection
          icon={Phone}
          title="Contact & Hours"
          description="How and when to reach this pharmacy."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pharm-phone" className={pharmLabelClass}>Phone</Label>
              <Input
                id="pharm-phone"
                className={pharmControlClass}
                inputMode="tel"
                value={form.phone || ""}
                onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="(817) 555-0123"
                data-testid="input-pharm-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pharm-hours" className={pharmLabelClass}>Hours</Label>
              <Input
                id="pharm-hours"
                className={pharmControlClass}
                value={form.hours || ""}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
                placeholder="Mon-Fri 8am-9pm"
                data-testid="input-pharm-hours"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pharm-website" className={pharmLabelClass}>Website</Label>
            <Input
              id="pharm-website"
              className={pharmControlClass}
              autoCapitalize="none"
              autoCorrect="off"
              value={form.website || ""}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://www.cvs.com"
              data-testid="input-pharm-website"
            />
          </div>
        </PharmFieldSection>

        <PharmFieldSection
          icon={MapPin}
          title="Address"
          description="The physical location of this pharmacy."
        >
          <div className="space-y-2">
            <Label htmlFor="pharm-address" className={pharmLabelClass}>Street Address</Label>
            <Input
              id="pharm-address"
              className={pharmControlClass}
              value={form.address || ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Main St"
              data-testid="input-pharm-address"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pharm-city" className={pharmLabelClass}>City</Label>
            <Input
              id="pharm-city"
              className={pharmControlClass}
              value={form.city || ""}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Fort Worth"
              data-testid="input-pharm-city"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pharm-state" className={pharmLabelClass}>State</Label>
              <Input
                id="pharm-state"
                className={pharmControlClass}
                value={form.state || ""}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="TX"
                data-testid="input-pharm-state"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pharm-zip" className={pharmLabelClass}>ZIP</Label>
              <Input
                id="pharm-zip"
                className={pharmControlClass}
                inputMode="numeric"
                value={form.zip || ""}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                placeholder="76109"
                data-testid="input-pharm-zip"
              />
            </div>
          </div>
        </PharmFieldSection>

        <PharmFieldSection
          icon={FileText}
          title="Notes"
          description="Drive-through, parking, anything worth remembering."
        >
          <div className="space-y-2">
            <Label htmlFor="pharm-notes" className={pharmLabelClass}>Notes</Label>
            <Textarea
              id="pharm-notes"
              className="text-base min-h-[110px]"
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={4}
              placeholder="Drive-through available, free parking..."
              data-testid="input-pharm-notes"
            />
          </div>
        </PharmFieldSection>
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
          data-testid="button-pharm-save"
        >
          {isEdit ? "Update Pharmacy" : "Add Pharmacy"}
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
    <div className="p-4 md:p-6 space-y-6 max-w-6xl w-full min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Preferred Pharmacies</h1>
          <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">Manage your pharmacy locations</p>
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
              if (w) { w.document.write(html); w.document.close(); w.print(); w.close(); }
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
          <DialogContent className={PHARM_DIALOG_CLASS}>
            <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
              <DialogTitle className="font-heading text-2xl font-bold text-white">
                New Pharmacy
              </DialogTitle>
              <DialogDescription className="text-white/85 text-sm">
                Save a pharmacy you use. Only the name is required — phone, address, and notes are optional.
              </DialogDescription>
            </DialogHeader>
            <PharmacyForm
              isEdit={false}
              onSubmit={(data) => createMut.mutate(data)}
              onCancel={() => setOpen(false)}
            />
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
              <p className="text-base text-muted-foreground">No pharmacies added yet</p>
            </CardContent>
          </Card>
        ) : (
          sorted.map((pharm) => (
            <Card key={pharm.id} className="hover-elevate" data-testid={`pharmacy-${pharm.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <h3 className="font-heading text-base font-semibold break-words min-w-0">{pharm.name}</h3>
                      {pharm.isPrimary === 1 && (
                        <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 flex-shrink-0">
                          <Star className="w-3 h-3 mr-1" />Preferred
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-foreground/75 flex-wrap min-w-0">
                      {pharm.phone && (
                        <a href={`tel:${pharm.phone}`} className="flex items-center gap-1 hover:text-primary min-w-0 truncate">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" />{pharm.phone}
                        </a>
                      )}
                      {pharm.hours && <span className="flex items-center gap-1 min-w-0 truncate"><Clock className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{pharm.hours}</span></span>}
                    </div>
                    {(pharm.address || pharm.city) && (
                      <p className="text-sm text-foreground/75 mt-1 flex items-start gap-1 min-w-0">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="break-words min-w-0">{[pharm.address, pharm.city, pharm.state, pharm.zip].filter(Boolean).join(", ")}</span>
                      </p>
                    )}
                    {pharm.website && (
                      <a href={pharm.website.startsWith("http") ? pharm.website : `https://${pharm.website}`} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline flex items-center gap-1 mt-1 min-w-0 truncate">
                        <Globe className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{pharm.website}</span>
                      </a>
                    )}
                    {pharm.notes && <p className="text-sm text-foreground/70 mt-1 break-words">{pharm.notes}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Dialog open={editing?.id === pharm.id} onOpenChange={(o) => !o && setEditing(null)}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(pharm)} data-testid={`button-edit-pharm-${pharm.id}`}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className={PHARM_DIALOG_CLASS}>
                        <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
                          <DialogTitle className="font-heading text-2xl font-bold text-white">
                            Edit Pharmacy
                          </DialogTitle>
                          <DialogDescription className="text-white/85 text-sm">
                            Update this pharmacy's details. Changes save when you press Update.
                          </DialogDescription>
                        </DialogHeader>
                        <PharmacyForm
                          initial={pharm}
                          isEdit={true}
                          onSubmit={(data) => updateMut.mutate({ id: pharm.id!, data })}
                          onCancel={() => setEditing(null)}
                        />
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
