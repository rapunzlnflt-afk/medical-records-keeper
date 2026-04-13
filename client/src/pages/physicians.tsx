import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getPhysicians, createPhysician, updatePhysician, deletePhysician } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Stethoscope, Plus, Trash2, Edit2, Phone, Mail, MapPin, FileText } from "lucide-react";
import type { Physician } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";

function PhysicianForm({ initial, onSubmit, onCancel }: {
  initial?: Partial<Physician>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
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

  return (
    <div className="flex flex-col max-h-[calc(85vh-5rem)] sm:max-h-none">
      <div className="overflow-y-auto flex-1 space-y-4 pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-body">Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr. Jane Smith" data-testid="input-doc-name" />
          </div>
          <div>
            <Label className="text-xs font-body">Specialty</Label>
            <Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Cardiology" data-testid="input-doc-specialty" />
          </div>
          <div>
            <Label className="text-xs font-body">Phone</Label>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(555) 123-4567" data-testid="input-doc-phone" />
          </div>
          <div>
            <Label className="text-xs font-body">Fax</Label>
            <Input value={form.fax || ""} onChange={(e) => setForm({ ...form, fax: e.target.value })} placeholder="(555) 123-4568" data-testid="input-doc-fax" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-body">Email</Label>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="doctor@clinic.com" data-testid="input-doc-email" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-body">Address</Label>
            <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Medical Center Dr" data-testid="input-doc-address" />
          </div>
          <div>
            <Label className="text-xs font-body">City</Label>
            <Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Fort Worth" data-testid="input-doc-city" />
          </div>
          <div>
            <Label className="text-xs font-body">State</Label>
            <Input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="TX" data-testid="input-doc-state" />
          </div>
          <div>
            <Label className="text-xs font-body">ZIP</Label>
            <Input value={form.zip || ""} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="76109" data-testid="input-doc-zip" />
          </div>
          <div>
            <Label className="text-xs font-body">NPI Number</Label>
            <Input value={form.npi || ""} onChange={(e) => setForm({ ...form, npi: e.target.value })} placeholder="1234567890" data-testid="input-doc-npi" />
          </div>
        </div>
        <div>
          <Label className="text-xs font-body">Notes</Label>
          <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-doc-notes" />
        </div>
      </div>
      <div className="flex gap-3 justify-end pt-4 pb-1 border-t mt-4 flex-shrink-0">
        <Button variant="outline" onClick={onCancel} className="h-10 px-5 text-sm">Cancel</Button>
        <Button onClick={() => onSubmit(form)} disabled={!form.name || !form.specialty}
          className="gradient-primary text-white border border-primary/30 h-10 px-5 text-sm" data-testid="button-doc-save">
          {initial?.id ? "Update" : "Add"} Physician
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
    mutationFn: (data: any) => createPhysician({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["physicians", pid] }); setOpen(false); toast({ title: "Physician added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updatePhysician(id, data),
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
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">New Physician</DialogTitle></DialogHeader>
            <PhysicianForm onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
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
                      <DialogContent className="max-w-lg">
                        <DialogHeader><DialogTitle className="font-heading">Edit Physician</DialogTitle></DialogHeader>
                        <PhysicianForm initial={doc} onSubmit={(data) => updateMut.mutate({ id: doc.id!, data })} onCancel={() => setEditing(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(doc.id!)} data-testid={`button-delete-doc-${doc.id}`}>
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
