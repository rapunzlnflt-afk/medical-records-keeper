import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getMedicalRecords, createMedicalRecord, updateMedicalRecord, deleteMedicalRecord, getPhysicians } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Trash2, Edit2, Search, FlaskConical, Scan, Syringe,
  AlertTriangle, Heart, Shield, FolderOpen, ImageIcon, ExternalLink,
  Upload, Link2, Info, HardDrive, X, TriangleAlert, Receipt,
} from "lucide-react";
import type { MedicalRecord, Physician } from "@shared/schema";
import { format, parseISO } from "date-fns";

const CATEGORIES = [
  { value: "lab-results", label: "Lab Results", icon: FlaskConical },
  { value: "imaging", label: "Imaging", icon: Scan },
  { value: "vaccination", label: "Vaccination", icon: Syringe },
  { value: "allergy", label: "Allergy", icon: AlertTriangle },
  { value: "condition", label: "Condition", icon: Heart },
  { value: "insurance", label: "Insurance", icon: Shield },
  { value: "receipt", label: "Receipts", icon: Receipt },
  { value: "other", label: "Other", icon: FolderOpen },
];

function getCategoryInfo(cat: string) {
  return CATEGORIES.find((c) => c.value === cat) || CATEGORIES[CATEGORIES.length - 1];
}

function RecordForm({ physicians, initial, onSubmit, onCancel }: {
  physicians: Physician[];
  initial?: Partial<MedicalRecord>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    category: initial?.category || "other",
    date: initial?.date || "",
    physicianId: initial?.physicianId || null,
    description: initial?.description || "",
    notes: initial?.notes || "",
    imageUrl: initial?.imageUrl || "",
  });

  // Photo mode: "upload" or "link"
  // If existing imageUrl is a data URL or external URL (not a server upload path), detect mode
  const isDataUrl = initial?.imageUrl?.startsWith("data:");
  const isExternalUrl = initial?.imageUrl && !initial.imageUrl.startsWith("data:") && initial.imageUrl.startsWith("http");
  const [photoMode, setPhotoMode] = useState<"upload" | "link">(
    isExternalUrl ? "link" : "upload"
  );
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(
    isDataUrl ? (initial?.imageUrl ?? null) : null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setForm((prev) => ({ ...prev, imageUrl: dataUrl }));
      setUploadPreview(dataUrl);
    } catch {
      // Show inline error silently
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearPhoto = () => {
    setForm((prev) => ({ ...prev, imageUrl: "" }));
    setUploadPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col max-h-[calc(85vh-5rem)] sm:max-h-none">
      <div className="overflow-y-auto flex-1 space-y-4 pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs font-body">Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Blood panel results" data-testid="input-rec-title" />
          </div>
          <div>
            <Label className="text-xs font-body">Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger data-testid="select-rec-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-body">Date</Label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-rec-date" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-body">Physician</Label>
            <Select value={form.physicianId?.toString() || "none"} onValueChange={(v) => setForm({ ...form, physicianId: v === "none" ? null : Number(v) })}>
              <SelectTrigger data-testid="select-rec-physician"><SelectValue placeholder="Select physician" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {physicians.map((p) => <SelectItem key={p.id} value={p.id!.toString()}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-body">Description</Label>
            <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Results summary, key findings..." data-testid="input-rec-description" />
          </div>
        </div>

        {/* Photo Section */}
        <div className="rounded-lg border p-4 space-y-3">
          <Label className="text-sm font-heading font-semibold flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-primary" />
            Attach Photo of Record
          </Label>

          {photoMode === "upload" ? (
            <div className="space-y-2">
              {uploadPreview ? (
                <div className="relative rounded-md border overflow-hidden">
                  <img src={uploadPreview} alt="Uploaded photo" className="w-full max-h-48 object-contain bg-muted/30" />
                  <Button
                    type="button" size="icon" variant="destructive"
                    className="absolute top-2 right-2 w-7 h-7 rounded-full"
                    onClick={clearPhoto}
                    data-testid="button-remove-photo"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-24 flex flex-col items-center justify-center gap-2 border-2 border-dashed hover:bg-muted/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-photo"
                >
                  <Upload className="w-6 h-6 text-muted-foreground/60" />
                  <span className="text-sm text-muted-foreground font-body">
                    {uploading ? "Processing..." : "Tap Here to Upload a Photo"}
                  </span>
                  <span className="text-xs text-muted-foreground/70">JPG, PNG, or PDF up to 10 MB</span>
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileUpload}
                className="hidden"
                data-testid="input-photo-file"
              />
              <button
                type="button"
                className="text-xs text-primary hover:underline font-body"
                onClick={() => setPhotoMode("link")}
              >
                Or paste a link instead
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={form.imageUrl || ""}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://drive.google.com/... or https://dropbox.com/..."
                data-testid="input-rec-image-url"
              />
              <p className="text-xs text-muted-foreground">Paste a link from Google Drive, Dropbox, or any cloud storage</p>
              {form.imageUrl && !form.imageUrl.startsWith("data:") && (
                <div className="rounded-md border overflow-hidden max-h-48">
                  <img
                    src={form.imageUrl} alt="Preview"
                    className="w-full h-full object-contain bg-muted/30"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <button
                type="button"
                className="text-xs text-primary hover:underline font-body"
                onClick={() => setPhotoMode("upload")}
              >
                Or upload a photo instead
              </button>
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs font-body">Notes</Label>
          <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-rec-notes" />
        </div>
      </div>
      <div className="flex gap-3 justify-end pt-4 pb-1 border-t mt-4 flex-shrink-0">
        <Button variant="outline" onClick={onCancel} className="h-10 px-5 text-sm">Cancel</Button>
        <Button onClick={() => onSubmit(form)} disabled={!form.title || !form.date}
          className="gradient-primary text-white border border-primary/30 h-10 px-5 text-sm" data-testid="button-rec-save">
          {initial?.id ? "Update" : "Add"} Record
        </Button>
      </div>
    </div>
  );
}

export default function MedicalRecords() {
  const { activePatientId } = usePatient();
  const pid = activePatientId;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalRecord | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: records = [], isLoading } = useQuery<MedicalRecord[]>({
    queryKey: ["medical-records", pid],
    queryFn: () => getMedicalRecords(pid),
  });
  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", pid],
    queryFn: () => getPhysicians(pid),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => createMedicalRecord({ ...data, patientId: pid }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medical-records", pid] }); setOpen(false); toast({ title: "Record added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateMedicalRecord(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medical-records", pid] }); setEditing(null); toast({ title: "Record updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMedicalRecord(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["medical-records", pid] }); toast({ title: "Record deleted" }); },
  });

  const filtered = records.filter((r) => {
    const matchesCat = catFilter === "all" || r.category === catFilter;
    const matchesSearch = !search || r.title.toLowerCase().includes(search.toLowerCase()) || (r.description || "").toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl font-bold">Medical Records</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Lab results, conditions, vaccinations, and more</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary text-white border-none gap-1" data-testid="button-add-record">
              <Plus className="w-4 h-4" /> Add Record
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-heading">New Medical Record</DialogTitle></DialogHeader>
            <RecordForm physicians={physicians} onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-heading text-sm font-semibold">How It Works</h3>
                <p className="text-xs text-muted-foreground mt-1 font-body leading-relaxed">
                  Upload photos directly or paste cloud storage links (Google Drive, Dropbox). Organize by category to track your records visually.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-2.5">
              <HardDrive className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-heading text-sm font-semibold">Device Storage</h3>
                <p className="text-xs text-muted-foreground mt-1 font-body leading-relaxed">
                  Uploaded photos stay on this device. Cloud links remain accessible from any device. Use Save My Data to back up everything.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <Input placeholder="Search records..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" data-testid="input-search-records" />
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-40" data-testid="select-filter-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">{search || catFilter !== "all" ? "No matching records" : "No medical records yet"}</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((rec) => {
            const catInfo = getCategoryInfo(rec.category);
            const CatIcon = catInfo.icon;
            const doc = physicians.find((p) => p.id === rec.physicianId);
            return (
              <Card key={rec.id} className="hover-elevate" data-testid={`record-${rec.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Thumbnail if there's a photo */}
                    {rec.imageUrl ? (
                      <a href={rec.imageUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <div className="w-14 h-14 rounded-lg border overflow-hidden bg-muted/30">
                          <img src={rec.imageUrl} alt={rec.title} className="w-full h-full object-cover" onError={(e) => {
                            const parent = (e.target as HTMLImageElement).parentElement;
                            if (parent) {
                              parent.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted-foreground/40"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg></div>';
                            }
                          }} />
                        </div>
                      </a>
                    ) : (
                      <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                        <CatIcon className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-heading text-sm font-semibold">{rec.title}</h3>
                        <Badge variant="secondary" className="text-xs">{catInfo.label}</Badge>
                        {rec.imageUrl && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <ImageIcon className="w-3 h-3" />Photo
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(parseISO(rec.date), "MMM d, yyyy")}
                        {doc ? ` · ${doc.name}` : ""}
                      </p>
                      {rec.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rec.description}</p>}
                      {rec.notes && <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-1">{rec.notes}</p>}
                      {rec.imageUrl && (
                        <a href={rec.imageUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-primary hover:underline" data-testid={`link-image-${rec.id}`}>
                          <ImageIcon className="w-3 h-3" /> View Photo
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Dialog open={editing?.id === rec.id} onOpenChange={(o) => !o && setEditing(null)}>
                        <DialogTrigger asChild>
                          <Button size="icon" variant="ghost" onClick={() => setEditing(rec)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader><DialogTitle className="font-heading">Edit Record</DialogTitle></DialogHeader>
                          <RecordForm physicians={physicians} initial={rec} onSubmit={(data) => updateMut.mutate({ id: rec.id!, data })} onCancel={() => setEditing(null)} />
                        </DialogContent>
                      </Dialog>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(rec.id!)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Cache Warning */}
      <Card className="border-red-300/40 bg-red-50/50 dark:bg-red-950/10 dark:border-red-800/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="w-4 h-4 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-heading text-sm font-semibold">Important: Back Up Your Data</h3>
              <p className="text-xs text-muted-foreground mt-1 font-body leading-relaxed">
                All your records, appointments, medications, and uploaded photos are stored on this device.
                If you clear your browser cache or data, everything will be erased.
              </p>
              <p className="text-xs text-muted-foreground mt-2 font-body leading-relaxed font-semibold">
                To protect your data:
              </p>
              <ol className="text-xs text-muted-foreground mt-1 font-body leading-relaxed list-decimal list-inside space-y-1">
                <li>Tap <span className="font-semibold">Save My Data</span> in the sidebar regularly to download a backup file.</li>
                <li>Keep the backup file in a safe place (email it to yourself, save to a USB drive, etc.).</li>
                <li>If your data is ever erased, open the app and tap <span className="font-semibold">Load My Data</span>, then select your backup file to restore everything.</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
