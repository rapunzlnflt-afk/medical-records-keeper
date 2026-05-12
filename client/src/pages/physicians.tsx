import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getPhysicians, createPhysician, updatePhysician, deletePhysician } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { Stethoscope, Plus, Trash2, Edit2, Phone, Mail, MapPin, FileText, Contact, Building2, IdCard } from "lucide-react";
import type { Physician } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";
import { formatPersonName, formatStreetAddress, formatCity, formatState } from "@/lib/format-name";

function normalizePhysicianFields<T extends Partial<Physician>>(data: T): T {
  return {
    ...data,
    name: data.name ? formatPersonName(data.name) : data.name,
    specialty: data.specialty ? formatPersonName(data.specialty) : data.specialty,
    address: data.address ? formatStreetAddress(data.address) : data.address,
    city: data.city ? formatCity(data.city) : data.city,
    state: data.state ? formatState(data.state) : data.state,
  };
}

/* ---- Contact import helpers ---- */

function hasContactPicker(): boolean {
  return 'contacts' in navigator && 'ContactsManager' in window;
}

interface ContactData {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

async function pickContact(): Promise<ContactData | null> {
  try {
    const nav = navigator as any;
    const props = ['name', 'tel', 'email', 'address'];
    const contacts = await nav.contacts.select(props, { multiple: false });
    if (!contacts || contacts.length === 0) return null;
    const c = contacts[0];
    const name = c.name?.[0] || '';
    const phone = c.tel?.[0] || '';
    const email = c.email?.[0] || '';
    // Address is an object with properties
    const addr = c.address?.[0];
    return {
      name,
      phone,
      email,
      address: addr?.streetAddress || addr?.addressLine?.[0] || '',
      city: addr?.city || addr?.locality || '',
      state: addr?.region || '',
      zip: addr?.postalCode || '',
    };
  } catch {
    return null;
  }
}

function parseVCard(text: string): ContactData[] {
  const results: ContactData[] = [];
  const cards = text.split('BEGIN:VCARD');
  for (const card of cards) {
    if (!card.includes('END:VCARD')) continue;
    // Unfold continuation lines (RFC 2425)
    const unfolded = card.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    let name = '', phone = '', email = '', address = '', city = '', state = '', zip = '';
    for (const raw of lines) {
      const line = raw.trim();
      // FN (formatted name) — preferred
      if (/^FN[;:]/.test(line)) {
        name = line.replace(/^FN[^:]*:/, '').trim();
      }
      // N (structured name) — fallback if FN is empty
      if (/^N[;:]/.test(line) && !name) {
        const parts = line.replace(/^N[^:]*:/, '').split(';');
        const last = parts[0]?.trim() || '';
        const first = parts[1]?.trim() || '';
        name = [first, last].filter(Boolean).join(' ');
      }
      // TEL
      if (/^TEL[;:]/.test(line)) {
        const val = line.replace(/^TEL[^:]*:/, '').trim();
        if (!phone) phone = val;
      }
      // EMAIL
      if (/^EMAIL[;:]/.test(line)) {
        const val = line.replace(/^EMAIL[^:]*:/, '').trim();
        if (!email) email = val;
      }
      // ADR — structured: PO Box;Extended;Street;City;State;Zip;Country
      if (/^ADR[;:]/.test(line)) {
        const val = line.replace(/^ADR[^:]*:/, '');
        const parts = val.split(';');
        if (!address) address = parts[2]?.trim() || '';
        if (!city) city = parts[3]?.trim() || '';
        if (!state) state = parts[4]?.trim() || '';
        if (!zip) zip = parts[5]?.trim() || '';
      }
    }
    if (name) {
      results.push({ name, phone, email, address, city, state, zip });
    }
  }
  return results;
}

function ContactImportButton({ onImport }: { onImport: (data: ContactData) => void }) {
  const { toast } = useToast();
  if (!hasContactPicker()) return null;

  async function handleContactPicker() {
    const data = await pickContact();
    if (data) onImport(data);
    else toast({ title: 'No contact selected', variant: 'destructive' });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleContactPicker}
      className="gap-1 text-xs" data-testid="button-import-contact">
      <Contact className="w-3.5 h-3.5" /> Import from Contacts
    </Button>
  );
}

/* ---- Physician form ---- */

const physLabelClass = "text-base font-body font-semibold text-foreground";
const physControlClass = "h-12 text-base";

function PhysFieldSection({
  icon: Icon, title, description, children,
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

// Shared classes for the New/Edit Physician dialog so it behaves like a
// near-full-screen sheet on mobile and a roomy centered dialog on desktop —
// mirrors the appointment and medication modals.
const PHYS_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

function PhysicianForm({ initial, onSubmit, onCancel, isEdit }: {
  initial?: Partial<Physician>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isEdit: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    specialty: initial?.specialty || "",
    phone: initial?.phone || "",
    fax: initial?.fax || "",
    email: initial?.email || "",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    zip: initial?.zip || "",
    npi: initial?.npi || "",
    notes: initial?.notes || "",
  });

  function handleContactImport(data: ContactData) {
    setForm(prev => ({
      ...prev,
      name: data.name || prev.name,
      phone: data.phone ? formatPhone(data.phone) : prev.phone,
      email: data.email || prev.email,
      address: data.address || prev.address,
      city: data.city || prev.city,
      state: data.state || prev.state,
      zip: data.zip || prev.zip,
    }));
  }

  const canSubmit = Boolean(form.name && form.specialty);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <ContactImportButton onImport={handleContactImport} />

        <PhysFieldSection
          icon={Stethoscope}
          title="Physician Details"
          description="Who they are and what they specialize in."
        >
          <div className="space-y-2">
            <Label htmlFor="doc-name" className={physLabelClass}>Name</Label>
            <Input
              id="doc-name"
              className={physControlClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Dr. Jane Smith"
              data-testid="input-doc-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-specialty" className={physLabelClass}>Specialty</Label>
            <Input
              id="doc-specialty"
              className={physControlClass}
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              placeholder="Cardiology"
              data-testid="input-doc-specialty"
            />
          </div>
        </PhysFieldSection>

        <PhysFieldSection
          icon={Phone}
          title="Contact Information"
          description="How to reach this provider."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc-phone" className={physLabelClass}>Phone</Label>
              <Input
                id="doc-phone"
                className={physControlClass}
                inputMode="tel"
                value={form.phone || ""}
                onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="(555) 123-4567"
                data-testid="input-doc-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-fax" className={physLabelClass}>Fax</Label>
              <Input
                id="doc-fax"
                className={physControlClass}
                inputMode="tel"
                value={form.fax || ""}
                onChange={(e) => setForm({ ...form, fax: e.target.value })}
                placeholder="(555) 123-4568"
                data-testid="input-doc-fax"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-email" className={physLabelClass}>Email</Label>
            <Input
              id="doc-email"
              type="email"
              className={physControlClass}
              autoCapitalize="none"
              autoCorrect="off"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="doctor@clinic.com"
              data-testid="input-doc-email"
            />
          </div>
        </PhysFieldSection>

        <PhysFieldSection
          icon={Building2}
          title="Office Address"
          description="Used to auto-fill the location on new appointments."
        >
          <div className="space-y-2">
            <Label htmlFor="doc-address" className={physLabelClass}>Street Address</Label>
            <Input
              id="doc-address"
              className={physControlClass}
              value={form.address || ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Medical Center Dr"
              data-testid="input-doc-address"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-city" className={physLabelClass}>City</Label>
            <Input
              id="doc-city"
              className={physControlClass}
              value={form.city || ""}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Fort Worth"
              data-testid="input-doc-city"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc-state" className={physLabelClass}>State</Label>
              <Input
                id="doc-state"
                className={physControlClass}
                value={form.state || ""}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="TX"
                data-testid="input-doc-state"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-zip" className={physLabelClass}>ZIP</Label>
              <Input
                id="doc-zip"
                className={physControlClass}
                inputMode="numeric"
                value={form.zip || ""}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                placeholder="76109"
                data-testid="input-doc-zip"
              />
            </div>
          </div>
        </PhysFieldSection>

        <PhysFieldSection
          icon={IdCard}
          title="Additional Info"
          description="Optional — useful for paperwork and personal notes."
        >
          <div className="space-y-2">
            <Label htmlFor="doc-npi" className={physLabelClass}>NPI Number</Label>
            <Input
              id="doc-npi"
              className={physControlClass}
              inputMode="numeric"
              value={form.npi || ""}
              onChange={(e) => setForm({ ...form, npi: e.target.value })}
              placeholder="1234567890"
              data-testid="input-doc-npi"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-notes" className={physLabelClass}>Notes</Label>
            <Textarea
              id="doc-notes"
              className="text-base min-h-[110px]"
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={4}
              placeholder="Office hours, parking, billing notes..."
              data-testid="input-doc-notes"
            />
          </div>
        </PhysFieldSection>
      </div>

      {/* Sticky action bar */}
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
          data-testid="button-doc-save"
        >
          {isEdit ? "Update Physician" : "Add Physician"}
        </Button>
      </div>
    </div>
  );
}

export default function Physicians() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Physician | null>(null);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: physicians = [], isLoading } = useQuery<Physician[]>({
    queryKey: ["physicians", pid],
    queryFn: () => getPhysicians(pid),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => createPhysician({ ...normalizePhysicianFields(data), patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["physicians", pid] }); setOpen(false); toast({ title: "Physician added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updatePhysician(id, normalizePhysicianFields(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["physicians", pid] }); setEditing(null); toast({ title: "Physician updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deletePhysician(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["physicians", pid] }); toast({ title: "Physician removed" }); },
  });

  const filtered = physicians.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.specialty.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Physicians</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Your healthcare provider directory</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-physician">
              <Plus className="w-4 h-4" /> Add Physician
            </Button>
          </DialogTrigger>
          <DialogContent className={PHYS_DIALOG_CLASS}>
            <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
              <DialogTitle className="font-heading text-2xl font-bold text-white">
                New Physician
              </DialogTitle>
              <DialogDescription className="text-white/85 text-sm">
                Add a healthcare provider. Name and specialty are required — the rest is optional.
              </DialogDescription>
            </DialogHeader>
            <PhysicianForm
              isEdit={false}
              onSubmit={(data) => createMut.mutate(data)}
              onCancel={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Input placeholder="Search by name or specialty..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" data-testid="input-search-physicians" />

      <div className="grid gap-4 sm:grid-cols-2">
        {isLoading ? (
          [1,2,3,4].map(i => <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />)
        ) : filtered.length === 0 ? (
          <Card className="sm:col-span-2">
            <CardContent className="py-12 text-center">
              <Stethoscope className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">{search ? "No matching physicians" : "No physicians added yet"}</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((doc) => (
            <Card key={doc.id} className="hover-elevate" data-testid={`physician-${doc.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <Stethoscope className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading text-sm font-semibold">{doc.name}</h3>
                    <p className="text-xs text-primary font-medium">{doc.specialty}</p>
                    <div className="mt-2 space-y-1">
                      {doc.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="w-3 h-3 flex-shrink-0" />{doc.phone}
                        </p>
                      )}
                      {doc.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="w-3 h-3 flex-shrink-0" />{doc.email}
                        </p>
                      )}
                      {(doc.address || doc.city) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {[doc.address, doc.city, doc.state, doc.zip].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {doc.npi && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <FileText className="w-3 h-3 flex-shrink-0" />NPI: {doc.npi}
                        </p>
                      )}
                    </div>
                    {doc.notes && <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">{doc.notes}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Dialog open={editing?.id === doc.id} onOpenChange={(o) => !o && setEditing(null)}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(doc)} data-testid={`button-edit-doc-${doc.id}`}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className={PHYS_DIALOG_CLASS}>
                        <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-5 pb-5 sm:pb-6 text-left space-y-1.5 shrink-0">
                          <DialogTitle className="font-heading text-2xl font-bold text-white">
                            Edit Physician
                          </DialogTitle>
                          <DialogDescription className="text-white/85 text-sm">
                            Update this provider's details. Changes save when you press Update.
                          </DialogDescription>
                        </DialogHeader>
                        <PhysicianForm
                          initial={doc}
                          isEdit={true}
                          onSubmit={(data) => updateMut.mutate({ id: doc.id!, data })}
                          onCancel={() => setEditing(null)}
                        />
                      </DialogContent>
                    </Dialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid={`button-delete-doc-${doc.id}`}
                          aria-label={`Delete physician ${doc.name}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="max-w-md">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="font-heading flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-destructive" />
                            Delete physician?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            <span className="font-medium text-foreground">{doc.name}</span>
                            {doc.specialty ? ` (${doc.specialty})` : ""}
                            {" "}will be removed from your provider directory. This cannot be undone.
                            Existing appointments and medications referencing this physician will be kept but will no longer auto-link.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:gap-2">
                          <AlertDialogCancel
                            className="h-11 text-base sm:h-10 sm:text-sm mt-0"
                            data-testid={`button-delete-doc-cancel-${doc.id}`}
                          >
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMut.mutate(doc.id!)}
                            className="h-11 text-base sm:h-10 sm:text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
                            data-testid={`button-delete-doc-confirm-${doc.id}`}
                          >
                            Delete physician
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
