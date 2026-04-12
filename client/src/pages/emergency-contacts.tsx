import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getEmergencyContacts, createEmergencyContact, updateEmergencyContact, deleteEmergencyContact } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Phone, Plus, Trash2, Edit2, Mail, Star, User } from "lucide-react";
import type { EmergencyContact } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";

function ContactForm({ initial, onSubmit, onCancel }: {
  initial?: Partial<EmergencyContact>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    relationship: initial?.relationship || "",
    phone: initial?.phone || "",
    altPhone: initial?.altPhone || "",
    email: initial?.email || "",
    isPrimary: initial?.isPrimary ?? 0,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-body">Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" data-testid="input-ec-name" />
        </div>
        <div>
          <Label className="text-xs font-body">Relationship</Label>
          <Input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="Spouse, Parent, Sibling..." data-testid="input-ec-relationship" />
        </div>
        <div>
          <Label className="text-xs font-body">Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(555) 123-4567" data-testid="input-ec-phone" />
        </div>
        <div>
          <Label className="text-xs font-body">Alternate Phone</Label>
          <Input value={form.altPhone || ""} onChange={(e) => setForm({ ...form, altPhone: formatPhone(e.target.value) })} placeholder="(555) 987-6543" data-testid="input-ec-alt-phone" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs font-body">Email</Label>
          <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@email.com" data-testid="input-ec-email" />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.isPrimary === 1} onCheckedChange={(c) => setForm({ ...form, isPrimary: c ? 1 : 0 })} data-testid="switch-ec-primary" />
          <Label className="text-xs font-body">Primary Contact</Label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.name || !form.phone || !form.relationship}
          className="gradient-primary text-white border-none" data-testid="button-ec-save">
          {initial?.id ? "Update" : "Add"} Contact
        </Button>
      </div>
    </div>
  );
}

export default function EmergencyContacts() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const { toast } = useToast();

  const { data: contacts = [], isLoading } = useQuery<EmergencyContact[]>({
    queryKey: ["emergency-contacts", pid],
    queryFn: () => getEmergencyContacts(pid),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => createEmergencyContact({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); setOpen(false); toast({ title: "Contact added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateEmergencyContact(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); setEditing(null); toast({ title: "Contact updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteEmergencyContact(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); toast({ title: "Contact removed" }); },
  });

  const sorted = [...contacts].sort((a, b) => (b.isPrimary || 0) - (a.isPrimary || 0));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Emergency Contacts</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">People to reach in case of emergency</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-contact">
              <Plus className="w-4 h-4" /> Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-heading">New Emergency Contact</DialogTitle></DialogHeader>
            <ContactForm onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1,2].map(i => <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />)
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Phone className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No emergency contacts added yet</p>
            </CardContent>
          </Card>
        ) : (
          sorted.map((contact) => (
            <Card key={contact.id} className={`hover-elevate ${contact.isPrimary ? "ring-2 ring-primary/30" : ""}`} data-testid={`contact-${contact.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-heading text-sm font-semibold">{contact.name}</h3>
                      {contact.isPrimary === 1 && (
                        <Badge className="gradient-primary text-white text-xs border-none">
                          <Star className="w-3 h-3 mr-1" />Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-primary font-medium">{contact.relationship}</p>
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Phone className="w-3 h-3 flex-shrink-0" />{contact.phone}
                      </p>
                      {contact.altPhone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="w-3 h-3 flex-shrink-0" />{contact.altPhone} (alt)
                        </p>
                      )}
                      {contact.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="w-3 h-3 flex-shrink-0" />{contact.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Dialog open={editing?.id === contact.id} onOpenChange={(o) => !o && setEditing(null)}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(contact)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader><DialogTitle className="font-heading">Edit Contact</DialogTitle></DialogHeader>
                        <ContactForm initial={contact} onSubmit={(data) => updateMut.mutate({ id: contact.id!, data })} onCancel={() => setEditing(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(contact.id!)}>
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
