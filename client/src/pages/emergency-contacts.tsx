import React, { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Phone, Plus, Trash2, Edit2, Mail, Star, User, Users, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { EmergencyContact } from "@shared/schema";
import { formatPhone } from "@/lib/format-phone";
import { formatPersonName } from "@/lib/format-name";

function normalizeEmergencyContactFields<T extends Partial<EmergencyContact>>(data: T): T {
  return {
    ...data,
    name: data.name ? formatPersonName(data.name) : data.name,
    relationship: data.relationship ? formatPersonName(data.relationship) : data.relationship,
  };
}

const ecLabelClass = "text-base font-body font-semibold text-foreground";
const ecControlClass = "h-12 text-base";

const EC_DIALOG_CLASS =
  "p-0 gap-0 max-w-none w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0 left-0 right-0 top-0 translate-x-0 translate-y-0 " +
  "sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border " +
  "overflow-hidden flex flex-col";

function EcFieldSection({
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

function ContactForm({ initial, onSubmit, onCancel, isEdit }: {
  initial?: Partial<EmergencyContact>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isEdit: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    relationship: initial?.relationship || "",
    phone: initial?.phone || "",
    altPhone: initial?.altPhone || "",
    email: initial?.email || "",
    isPrimary: initial?.isPrimary ?? 0,
  });

  const canSubmit = Boolean(form.name && form.phone && form.relationship);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-5 bg-muted/20">
        <EcFieldSection
          icon={Users}
          title="Who They Are"
          description="The person to call in an emergency."
        >
          <div className="space-y-2">
            <Label htmlFor="ec-name" className={ecLabelClass}>Name</Label>
            <Input
              id="ec-name"
              className={ecControlClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Doe"
              data-testid="input-ec-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-relationship" className={ecLabelClass}>Relationship</Label>
            <Input
              id="ec-relationship"
              className={ecControlClass}
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              placeholder="Spouse, Parent, Sibling..."
              data-testid="input-ec-relationship"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
            <div className="min-w-0">
              <p className={ecLabelClass}>Primary Contact</p>
              <p className="text-sm text-muted-foreground mt-1">The first person to reach in an emergency.</p>
            </div>
            <Switch
              checked={form.isPrimary === 1}
              onCheckedChange={(c) => setForm({ ...form, isPrimary: c ? 1 : 0 })}
              data-testid="switch-ec-primary"
            />
          </div>
        </EcFieldSection>

        <EcFieldSection
          icon={Phone}
          title="How to Reach Them"
          description="At least one phone number is required."
        >
          <div className="space-y-2">
            <Label htmlFor="ec-phone" className={ecLabelClass}>Phone</Label>
            <Input
              id="ec-phone"
              className={ecControlClass}
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
              placeholder="(555) 123-4567"
              data-testid="input-ec-phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-alt-phone" className={ecLabelClass}>Alternate Phone</Label>
            <Input
              id="ec-alt-phone"
              className={ecControlClass}
              inputMode="tel"
              value={form.altPhone || ""}
              onChange={(e) => setForm({ ...form, altPhone: formatPhone(e.target.value) })}
              placeholder="(555) 987-6543"
              data-testid="input-ec-alt-phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-email" className={ecLabelClass}>Email</Label>
            <Input
              id="ec-email"
              type="email"
              className={ecControlClass}
              autoCapitalize="none"
              autoCorrect="off"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="jane@email.com"
              data-testid="input-ec-email"
            />
          </div>
        </EcFieldSection>
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
          data-testid="button-ec-save"
        >
          {isEdit ? "Update Contact" : "Add Contact"}
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
    mutationFn: (data: any) => createEmergencyContact({ ...normalizeEmergencyContactFields(data), patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); setOpen(false); toast({ title: "Contact added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateEmergencyContact(id, normalizeEmergencyContactFields(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); setEditing(null); toast({ title: "Contact updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteEmergencyContact(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency-contacts", pid] }); toast({ title: "Contact removed" }); },
  });

  const sorted = [...contacts].sort((a, b) => (b.isPrimary || 0) - (a.isPrimary || 0));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl w-full min-w-0 overflow-x-hidden">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary -ml-1 px-1 py-1.5" data-testid="link-back-to-dashboard">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Emergency Contacts</h1>
          <p className="text-sm sm:text-base text-muted-foreground font-body mt-1.5">People to reach in case of emergency</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-contact">
              <Plus className="w-4 h-4" /> Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent className={EC_DIALOG_CLASS}>
            <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
              <DialogTitle className="font-heading text-2xl font-bold text-white">
                New Emergency Contact
              </DialogTitle>
              <DialogDescription className="text-white/85 text-sm">
                Add someone to call in an emergency. Name, relationship, and phone are required.
              </DialogDescription>
            </DialogHeader>
            <ContactForm
              isEdit={false}
              onSubmit={(data) => createMut.mutate(data)}
              onCancel={() => setOpen(false)}
            />
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
              <p className="text-base text-muted-foreground">No emergency contacts added yet</p>
            </CardContent>
          </Card>
        ) : (
          sorted.map((contact) => (
            <Card key={contact.id} className={`hover-elevate ${contact.isPrimary ? "ring-2 ring-primary/30" : ""}`} data-testid={`contact-${contact.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <h3 className="font-heading text-base sm:text-lg font-semibold break-words min-w-0">{contact.name}</h3>
                      {contact.isPrimary === 1 && (
                        <Badge className="gradient-primary text-white text-xs border-none flex-shrink-0 font-semibold">
                          <Star className="w-3 h-3 mr-1" />Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-primary font-semibold mt-0.5">{contact.relationship}</p>
                    <div className="mt-2 space-y-1 min-w-0">
                      <p className="text-sm text-foreground/75 flex items-center gap-1.5 min-w-0 truncate">
                        <Phone className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{contact.phone}</span>
                      </p>
                      {contact.altPhone && (
                        <p className="text-sm text-foreground/75 flex items-center gap-1.5 min-w-0 truncate">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{contact.altPhone} (alt)</span>
                        </p>
                      )}
                      {contact.email && (
                        <p className="text-sm text-foreground/75 flex items-center gap-1.5 min-w-0 truncate">
                          <Mail className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{contact.email}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Dialog open={editing?.id === contact.id} onOpenChange={(o) => !o && setEditing(null)}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(contact)} data-testid={`button-edit-ec-${contact.id}`}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className={EC_DIALOG_CLASS}>
                        <DialogHeader className="gradient-primary text-white px-5 sm:px-6 pt-3 pb-3 sm:pt-4 sm:pb-4 text-left space-y-1 shrink-0">
                          <DialogTitle className="font-heading text-2xl font-bold text-white">
                            Edit Emergency Contact
                          </DialogTitle>
                          <DialogDescription className="text-white/85 text-sm">
                            Update this contact's details. Changes save when you press Update.
                          </DialogDescription>
                        </DialogHeader>
                        <ContactForm
                          initial={contact}
                          isEdit={true}
                          onSubmit={(data) => updateMut.mutate({ id: contact.id!, data })}
                          onCancel={() => setEditing(null)}
                        />
                      </DialogContent>
                    </Dialog>
                    <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(contact.id!)} data-testid={`button-delete-ec-${contact.id}`}>
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
