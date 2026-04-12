import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Trash2, Edit2, Search, FlaskConical, Scan, Syringe, AlertTriangle, Heart, Shield, FolderOpen, ImageIcon, ExternalLink } from "lucide-react";
import type { MedicalRecord, Physician } from "@shared/schema";
import { format, parseISO } from "date-fns";

const CATEGORIES = [
  { value: "lab-results", label: "Lab Results", icon: FlaskConical },
  { value: "imaging", label: "Imaging", icon: Scan },
  { value: "vaccination", label: "Vaccination", icon: Syringe },
  { value: "allergy", label: "Allergy", icon: AlertTriangle },
  { value: "condition", label: "Condition", icon: Heart },
  { value: "insurance", label: "Insurance", icon: Shield },
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

  return (
    <div className="space-y-4">
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
              {physicians.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs font-body">Description</Label>
          <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Results summary, key findings..." data-testid="input-rec-description" />
        </div>
      </div>
      <div>
        <Label className="text-xs font-body">Photo / Image Link</Label>
        <Input value={form.imageUrl || ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://example.com/lab-results.jpg" data-testid="input-rec-image-url" />
        <p className="text-xs text-muted-foreground mt-1">Paste a link to a photo of the actual document or results</p>
        {form.imageUrl && (
          <div className="mt-2 rounded-md border overflow-hidden max-h-40">
            <img src={form.imageUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs font-body">Notes</Label>
        <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-rec-notes" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSubmit(form)} disabled={!form.title || !form.date}
          className="gradient-primary text-white border-none" data-testid="button-rec-save">
          {initial?.id ? "Update" : "Add"} Record
        </Button>
      </div>
    </div>
  );
}

export default function MedicalRecords() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalRecord | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: records = [], isLoading } = useQuery<MedicalRecord[]>({ queryKey: ["/api/medical-records"] });
  const { data: physicians = [] } = useQuery<Physician[]>({ queryKey: ["/api/physicians"] });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/medical-records", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/medical-records"] }); setOpen(false); toast({ title: "Record added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/medical-records/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/medical-records"] }); setEditing(null); toast({ title: "Record updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/medical-records/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/medical-records"] }); toast({ title: "Record deleted" }); },
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
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading">New Medical Record</DialogTitle></DialogHeader>
            <RecordForm physicians={physicians} onSubmit={(data) => createMut.mutate(data)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
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
                    <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                      <CatIcon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-heading text-sm font-semibold">{rec.title}</h3>
                        <Badge variant="secondary" className="text-xs">{catInfo.label}</Badge>
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
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                          <DialogHeader><DialogTitle className="font-heading">Edit Record</DialogTitle></DialogHeader>
                          <RecordForm physicians={physicians} initial={rec} onSubmit={(data) => updateMut.mutate({ id: rec.id, data })} onCancel={() => setEditing(null)} />
                        </DialogContent>
                      </Dialog>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(rec.id)}>
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
    </div>
  );
}
