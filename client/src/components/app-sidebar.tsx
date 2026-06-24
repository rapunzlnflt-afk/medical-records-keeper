import { useState, useRef, useEffect } from "react";
import {
  LayoutDashboard, CalendarDays, Pill, Stethoscope, FileText,
  HeartPulse, Phone, Building2, Sun, Moon, Download, Upload,
  Plus, X, Check, ChevronDown, Pencil, Trash2,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/lib/theme";
import { queryClient } from "@/lib/queryClient";
import { usePatient } from "@/lib/patient-context";
import { useToast } from "@/hooks/use-toast";
import { recordBackupExport } from "@/components/backup-reminder-card";
import { useMutation } from "@tanstack/react-query";
import {
  createPatient, updatePatient, deletePatient as deletePatientDb,
  exportAllData, importAllData, getPatients,
} from "@/lib/db";
import { saveJsonBackup, isIosLike } from "@/lib/save-backup";
import { formatPersonName } from "@/lib/format-name";
import type { Patient } from "@shared/schema";

function normalizePatientFields<T extends Partial<Patient>>(data: T): T {
  return {
    ...data,
    name: data.name ? formatPersonName(data.name) : data.name,
    relationship: data.relationship ? formatPersonName(data.relationship) : data.relationship,
  };
}

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Appointments", url: "/appointments", icon: CalendarDays },
  { title: "Medications", url: "/medications", icon: Pill },
  { title: "Physicians", url: "/physicians", icon: Stethoscope },
  { title: "Medical Records", url: "/records", icon: FileText },
  { title: "Vitals", url: "/vitals", icon: HeartPulse },
  { title: "Pharmacies", url: "/pharmacies", icon: Building2 },
  { title: "Emergency Contacts", url: "/emergency", icon: Phone },
];

const AVATAR_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444",
];

function PatientAvatar({ patient, size = "md" }: { patient: Patient; size?: "sm" | "md" }) {
  const s = size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  const initials = patient.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className={`${s} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
      style={{ backgroundColor: patient.color || "#3b82f6" }}
    >
      {initials}
    </div>
  );
}

function PatientSwitcher() {
  const { patients, activePatient, activePatientId, setActivePatientId } = usePatient();
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] = useState("");
  const [newColor, setNewColor] = useState(AVATAR_COLORS[0]);
  const { toast } = useToast();

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const existing = await getPatients();
      if (existing.length >= 6) throw new Error("Maximum of 6 family members allowed");
      return createPatient(normalizePatientFields(data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      setShowAdd(false);
      setNewName("");
      setNewRelationship("");
      toast({ title: "Family member added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updatePatient(id, normalizePatientFields(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      setEditingId(null);
      toast({ title: "Updated" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const existing = await getPatients();
      if (existing.length <= 1) throw new Error("Cannot delete the last family member");
      return deletePatientDb(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      toast({ title: "Family member removed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!activePatient) return null;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors"
        data-testid="button-patient-switcher"
      >
        <PatientAvatar patient={activePatient} />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-base font-heading font-semibold text-sidebar-foreground truncate">
            {activePatient.name}
          </p>
          {activePatient.relationship && (
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">{activePatient.relationship}</p>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="space-y-1 pl-1 pr-1">
          {patients.map((p) => {
            if (editingId === p.id) {
              return (
                <div key={p.id} className="p-2 rounded-lg bg-sidebar-accent/30 space-y-2">
                  <Input
                    defaultValue={p.name}
                    className="h-7 text-xs"
                    data-testid={`input-edit-patient-${p.id}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateMut.mutate({ id: p.id!, data: { name: (e.target as HTMLInputElement).value } });
                      }
                    }}
                    onBlur={(e) => {
                      if (e.target.value !== p.name) {
                        updateMut.mutate({ id: p.id!, data: { name: e.target.value } });
                      } else {
                        setEditingId(null);
                      }
                    }}
                    autoFocus
                  />
                </div>
              );
            }
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors group ${
                  p.id === activePatientId ? "bg-primary/10" : "hover:bg-sidebar-accent/30"
                }`}
              >
                <div
                  className="flex items-center gap-2 flex-1 min-w-0"
                  onClick={() => { setActivePatientId(p.id!); setExpanded(false); }}
                  data-testid={`button-select-patient-${p.id}`}
                >
                  <PatientAvatar patient={p} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    {p.relationship && <p className="text-xs text-muted-foreground mt-0.5">{p.relationship}</p>}
                  </div>
                </div>
                {p.id === activePatientId && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingId(p.id!); }}
                    className="p-1 rounded hover:bg-sidebar-accent"
                    data-testid={`button-edit-patient-${p.id}`}
                  >
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </button>
                  {patients.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteMut.mutate(p.id!); }}
                      className="p-1 rounded hover:bg-destructive/10"
                      data-testid={`button-delete-patient-${p.id}`}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {showAdd ? (
            <div className="p-2 rounded-lg bg-sidebar-accent/30 space-y-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={(e) => setNewName(formatPersonName(e.target.value))}
                placeholder="Name"
                className="h-7 text-xs"
                data-testid="input-new-patient-name"
                autoFocus
              />
              <Input
                value={newRelationship}
                onChange={(e) => setNewRelationship(e.target.value)}
                onBlur={(e) => setNewRelationship(formatPersonName(e.target.value))}
                placeholder="Relationship (e.g. Spouse, Child)"
                className="h-7 text-xs"
                data-testid="input-new-patient-relationship"
              />
              <div className="flex gap-1.5 items-center">
                <Label className="text-[10px] text-muted-foreground">Color:</Label>
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${newColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-1.5 justify-end">
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs px-2 gradient-primary text-white border-none"
                  onClick={() => createMut.mutate({ name: newName, relationship: newRelationship || null, dateOfBirth: null, color: newColor })}
                  disabled={!newName.trim()}
                  data-testid="button-save-new-patient"
                >
                  Add
                </Button>
              </div>
            </div>
          ) : patients.length < 6 ? (
            <button
              onClick={() => { setShowAdd(true); setNewColor(AVATAR_COLORS[patients.length % AVATAR_COLORS.length]); }}
              className="flex items-center gap-2 p-1.5 rounded-lg text-xs text-muted-foreground hover:bg-sidebar-accent/30 transition-colors w-full"
              data-testid="button-add-family-member"
            >
              <div className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5" />
              </div>
              Add Family Member
            </button>
          ) : (
            <p className="text-[10px] text-muted-foreground text-center py-1">Maximum 6 members</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSaveData = async () => {
    setSaving(true);
    try {
      const data = await exportAllData();
      const filename = `medical-records-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const outcome = await saveJsonBackup({
        filename,
        json: JSON.stringify(data, null, 2),
        shareTitle: "Medical Records Backup",
        shareText: "My Medical Records Keeper backup file.",
      });
      if (outcome.kind === "shared" || outcome.kind === "downloaded") {
        recordBackupExport();
      }
      if (outcome.kind === "shared") {
        toast({
          title: "Backup ready",
          description: isIosLike()
            ? "Choose Save to Files (or Mail it to yourself) to keep it safe."
            : "Choose where to save your backup file.",
        });
      } else if (outcome.kind === "downloaded") {
        toast({ title: "Data Saved", description: `Downloaded ${filename}.` });
      } else if (outcome.kind === "cancelled") {
        toast({ title: "Save cancelled", description: "Your data is unchanged." });
      } else {
        toast({ title: "Error", description: "Could not save data. Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not save data. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version) throw new Error("Invalid backup file");
      await importAllData(data);
      await queryClient.invalidateQueries();
      toast({ title: "Data Loaded", description: "Your records have been restored." });
    } catch {
      toast({ title: "Error", description: "Could not load data. Make sure you selected a valid backup file.", variant: "destructive" });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L12 6M12 18L12 22M6 12H2M22 12H18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <rect x="7" y="7" width="10" height="10" rx="2" stroke="white" strokeWidth="2" fill="none"/>
              <path d="M10 12H14M12 10V14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-base font-bold text-sidebar-foreground leading-tight truncate">
              Medical Records
            </h1>
            <p className="text-sm text-muted-foreground leading-tight">Keeper</p>
          </div>
        </div>
        <PatientSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-heading text-sm font-semibold uppercase tracking-wider">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={
                        isActive
                          ? "gradient-primary text-white font-semibold"
                          : ""
                      }
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => { if (isMobile) setOpenMobile(false); }}
                      >
                        <item.icon className="w-5 h-5" />
                        <span className="font-body text-base font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveData}
            disabled={saving}
            className="flex-1 gap-1 font-body text-[11px] font-semibold px-1 h-8"
            data-testid="button-save-data"
          >
            <Download className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{saving ? "Saving..." : "Save My Data"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex-1 gap-1 font-body text-[11px] font-semibold px-1 h-8"
            data-testid="button-load-data"
          >
            <Upload className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{loading ? "Loading..." : "Load My Data"}</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleLoadData}
            className="hidden"
            data-testid="input-load-file"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          className="w-full gap-1.5 font-body text-[11px] font-semibold h-8"
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
