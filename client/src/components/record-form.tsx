import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FlaskConical, Scan, Syringe, AlertTriangle, Heart, Shield, FolderOpen, ImageIcon,
  Upload, X, Receipt,
} from "lucide-react";
import type { MedicalRecord, Physician } from "@shared/schema";
import { fileToStorableDataUrl, FILE_UPLOAD_ACCEPT, IMAGE_READ_ERROR } from "@/lib/image";

// Shared by the Medical Records page and the appointment card's "Attach record"
// dialog, so a record added from an appointment is the same record, same fields.
export const CATEGORIES = [
  { value: "lab-results", label: "Lab Results", icon: FlaskConical },
  { value: "imaging", label: "Imaging", icon: Scan },
  { value: "vaccination", label: "Vaccination", icon: Syringe },
  { value: "allergy", label: "Allergy", icon: AlertTriangle },
  { value: "condition", label: "Condition", icon: Heart },
  { value: "insurance", label: "Insurance", icon: Shield },
  { value: "receipt", label: "Receipts", icon: Receipt },
  { value: "other", label: "Other", icon: FolderOpen },
];

export function getCategoryInfo(cat: string) {
  return CATEGORIES.find((c) => c.value === cat) || CATEGORIES[CATEGORIES.length - 1];
}

export function RecordForm({ physicians, initial, onSubmit, onCancel }: {
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(
    isDataUrl ? (initial?.imageUrl ?? null) : null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const dataUrl = await fileToStorableDataUrl(file);
      setForm((prev) => ({ ...prev, imageUrl: dataUrl }));
      setUploadPreview(dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : IMAGE_READ_ERROR);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearPhoto = () => {
    setForm((prev) => ({ ...prev, imageUrl: "" }));
    setUploadPreview(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col max-h-[calc(85vh-5rem)] sm:max-h-none">
      <div className="overflow-y-auto flex-1 space-y-4 pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-sm font-body font-semibold">Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Blood panel results" data-testid="input-rec-title" />
          </div>
          <div>
            <Label className="text-sm font-body font-semibold">Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger data-testid="select-rec-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-body font-semibold">Date</Label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-rec-date" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-sm font-body font-semibold">Physician</Label>
            <Select value={form.physicianId?.toString() || "none"} onValueChange={(v) => setForm({ ...form, physicianId: v === "none" ? null : Number(v) })}>
              <SelectTrigger data-testid="select-rec-physician"><SelectValue placeholder="Select physician" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {physicians.map((p) => <SelectItem key={p.id} value={p.id!.toString()}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-sm font-body font-semibold">Description</Label>
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
                accept={FILE_UPLOAD_ACCEPT}
                onChange={handleFileUpload}
                className="hidden"
                data-testid="input-photo-file"
              />
              {uploadError && (
                <p className="text-xs text-destructive break-words" data-testid="text-photo-error">
                  {uploadError}
                </p>
              )}
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

