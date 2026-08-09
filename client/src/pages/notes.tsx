import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Edit2, FileText, Flag, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  createNote,
  createNoteUpdate,
  deleteNote,
  deleteNoteUpdate,
  getNotes,
  getNoteUpdates,
  getPhysicians,
  NOTE_CATEGORIES,
  noteCategory,
  noteIsFlaggedForDoctor,
  updateNote,
  updateNoteUpdate,
} from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import type { Note, NoteUpdate, Physician } from "@shared/schema";

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDateMarker(date: string): string {
  return format(parseISO(date), "EEEE, MMMM d, yyyy");
}

type NoteDraft = Pick<Note, "date" | "text" | "category" | "flaggedForDoctor" | "flaggedPhysicianId">;
type NoteUpdateDraft = Pick<NoteUpdate, "date" | "text">;

export function noteCategoryPillClass(category: string): string {
  switch (category) {
    case "Symptom":
    case "Injury":
    case "Illness":
      return "border-rose-500/25 bg-rose-500/10 text-rose-800 dark:border-rose-300/35 dark:bg-rose-300/15 dark:text-rose-100";
    case "Medication reaction":
      return "border-amber-600/25 bg-amber-500/10 text-amber-800 dark:border-amber-300/35 dark:bg-amber-300/15 dark:text-amber-100";
    case "Behavior / mood":
    case "Sleep":
      return "border-violet-500/25 bg-violet-500/10 text-violet-800 dark:border-violet-300/35 dark:bg-violet-300/15 dark:text-violet-100";
    case "Appetite / diet":
    case "Digestion":
      return "border-emerald-600/25 bg-emerald-500/10 text-emerald-800 dark:border-emerald-300/35 dark:bg-emerald-300/15 dark:text-emerald-100";
    case "Skin":
      return "border-sky-600/25 bg-sky-500/10 text-sky-800 dark:border-sky-300/35 dark:bg-sky-300/15 dark:text-sky-100";
    default:
      return "border-primary/25 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/20 dark:text-primary";
  }
}

function NoteEditor({
  initial,
  onSave,
  onCancel,
  saveLabel,
  physicians,
}: {
  initial: NoteDraft;
  onSave: (draft: NoteDraft) => void;
  onCancel: () => void;
  saveLabel: string;
  physicians: Physician[];
}) {
  const [draft, setDraft] = useState(initial);
  const canSave = Boolean(draft.date && draft.text.trim());

  return (
    <Card className="border-primary/30 bg-card shadow-sm" data-testid="note-editor">
      <CardContent className="p-4 sm:p-5">
        <div className="space-y-4 min-w-0">
          <div className="space-y-2 min-w-0">
            <Label htmlFor="note-date" className="text-base font-semibold">Date</Label>
            <Input
              id="note-date"
              type="date"
              value={draft.date}
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
              className="h-12 w-full max-w-full text-base"
              data-testid="input-note-date"
            />
          </div>
          <div className="space-y-2 min-w-0">
            <Label htmlFor="note-category" className="text-base font-semibold">Category</Label>
            <select
              id="note-category"
              value={noteCategory(draft)}
              onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
              className="flex h-12 w-full max-w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="select-note-category"
            >
              {NOTE_CATEGORIES.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2 min-w-0">
            <Label htmlFor="note-text" className="text-base font-semibold">Note</Label>
            <Textarea
              id="note-text"
              value={draft.text}
              onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
              placeholder="Describe a symptom or health event..."
              rows={6}
              className="min-h-36 w-full max-w-full resize-y text-base break-words"
              data-testid="input-note-text"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-base font-medium text-foreground">
            <input
              type="checkbox"
              checked={noteIsFlaggedForDoctor(draft)}
              onChange={(event) => setDraft((current) => ({
                ...current,
                flaggedForDoctor: event.target.checked,
                flaggedPhysicianId: event.target.checked ? current.flaggedPhysicianId ?? null : null,
              }))}
              className="h-5 w-5 shrink-0 accent-primary"
              data-testid="checkbox-note-flag"
            />
            <span>Mention at my next appointment</span>
          </label>
          {noteIsFlaggedForDoctor(draft) && physicians.length > 0 && (
            <div className="space-y-2 min-w-0">
              <Label htmlFor="note-flag-physician" className="text-base font-semibold">Bring up with</Label>
              <select
                id="note-flag-physician"
                value={draft.flaggedPhysicianId ?? ""}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  flaggedPhysicianId: event.target.value ? Number(event.target.value) : null,
                }))}
                className="flex h-12 w-full max-w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-note-flag-physician"
              >
                <option value="">Any doctor</option>
                {physicians.map((physician) => (
                  <option key={physician.id} value={physician.id}>{physician.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="h-12 w-full text-base sm:w-auto sm:min-w-28"
              data-testid="button-cancel-note"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => onSave({
                ...draft,
                text: draft.text.trim(),
                flaggedPhysicianId: noteIsFlaggedForDoctor(draft) && physicians.some((physician) => physician.id === draft.flaggedPhysicianId)
                  ? draft.flaggedPhysicianId
                  : null,
              })}
              disabled={!canSave}
              className="gradient-primary h-12 w-full border-none text-base font-semibold text-white sm:w-auto sm:min-w-36"
              data-testid="button-save-note"
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NoteUpdateEditor({
  initial,
  onSave,
  onCancel,
  saveLabel,
}: {
  initial: NoteUpdateDraft;
  onSave: (draft: NoteUpdateDraft) => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const [draft, setDraft] = useState(initial);
  const canSave = Boolean(draft.date && draft.text.trim());

  return (
    <div className="min-w-0 border-l-2 border-primary/30 pl-3 sm:pl-4" data-testid="note-update-editor">
      <div className="space-y-4 rounded-md bg-muted/45 p-3 sm:p-4">
        <div className="space-y-2 min-w-0">
          <Label htmlFor="update-date" className="text-sm font-semibold">Update date</Label>
          <Input
            id="update-date"
            type="date"
            value={draft.date}
            onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
            className="h-12 w-full max-w-full text-base"
            data-testid="input-update-date"
          />
        </div>
        <div className="space-y-2 min-w-0">
          <Label htmlFor="update-text" className="text-sm font-semibold">Update</Label>
          <Textarea
            id="update-text"
            value={draft.text}
            onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
            placeholder="What happened next?"
            rows={4}
            className="min-h-28 w-full max-w-full resize-y text-base break-words"
            data-testid="input-update-text"
          />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="h-12 w-full text-base sm:w-auto sm:min-w-28"
            data-testid="button-cancel-update"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave({ ...draft, text: draft.text.trim() })}
            disabled={!canSave}
            className="gradient-primary h-12 w-full border-none text-base font-semibold text-white sm:w-auto sm:min-w-36"
            data-testid="button-save-update"
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Notes() {
  const { activePatientId } = usePatient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingUpdateNoteId, setAddingUpdateNoteId] = useState<number | null>(null);
  const [editingUpdateId, setEditingUpdateId] = useState<number | null>(null);

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["notes", activePatientId],
    queryFn: () => getNotes(activePatientId),
  });
  const { data: physicians = [] } = useQuery<Physician[]>({
    queryKey: ["physicians", activePatientId],
    queryFn: () => getPhysicians(activePatientId),
  });
  const noteIds = notes.flatMap((note) => note.id === undefined ? [] : [note.id]);
  const { data: noteUpdates = [] } = useQuery<NoteUpdate[]>({
    queryKey: ["note-updates", activePatientId, noteIds],
    queryFn: () => getNoteUpdates(noteIds),
    enabled: noteIds.length > 0,
  });

  const invalidateTimeline = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notes", activePatientId] }),
    queryClient.invalidateQueries({ queryKey: ["note-updates", activePatientId] }),
  ]);
  const createMutation = useMutation({
    mutationFn: (draft: NoteDraft) => createNote({
      patientId: activePatientId,
      ...draft,
      createdAt: new Date().toISOString(),
    }),
    onSuccess: () => {
      void invalidateTimeline();
      setAdding(false);
      toast({ title: "Note added" });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: NoteDraft }) => updateNote(id, draft),
    onSuccess: () => {
      void invalidateTimeline();
      setEditingId(null);
      toast({ title: "Note updated" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      void invalidateTimeline();
      toast({ title: "Note removed" });
    },
  });
  const createUpdateMutation = useMutation({
    mutationFn: ({ noteId, draft }: { noteId: number; draft: NoteUpdateDraft }) => createNoteUpdate({
      noteId,
      ...draft,
      createdAt: new Date().toISOString(),
    }),
    onSuccess: () => {
      void invalidateTimeline();
      setAddingUpdateNoteId(null);
      toast({ title: "Update added" });
    },
  });
  const updateUpdateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: NoteUpdateDraft }) => updateNoteUpdate(id, draft),
    onSuccess: () => {
      void invalidateTimeline();
      setEditingUpdateId(null);
      toast({ title: "Update saved" });
    },
  });
  const deleteUpdateMutation = useMutation({
    mutationFn: deleteNoteUpdate,
    onSuccess: () => {
      void invalidateTimeline();
      toast({ title: "Update removed" });
    },
  });
  const updatesByNote = noteUpdates.reduce<Record<number, NoteUpdate[]>>((all, update) => {
    (all[update.noteId] ||= []).push(update);
    return all;
  }, {});

  const groups = notes.reduce<Array<{ date: string; entries: Note[] }>>((all, note) => {
    const group = all.find((item) => item.date === note.date);
    if (group) {
      group.entries.push(note);
    } else {
      all.push({ date: note.date, entries: [note] });
    }
    return all;
  }, []);

  return (
    <div className="w-full max-w-4xl min-w-0 overflow-x-hidden p-4 md:p-6">
      <div className="space-y-6 min-w-0">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 px-1 py-1.5 text-sm font-semibold text-muted-foreground hover:text-primary"
          data-testid="link-back-to-dashboard"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Notes</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">Track symptoms and health events for this profile.</p>
          </div>
          {!adding && (
            <Button
              onClick={() => { setAdding(true); setEditingId(null); }}
              className="gradient-primary h-11 shrink-0 gap-1 border-none px-4 text-base text-white"
              data-testid="button-add-note"
            >
              <Plus className="h-4 w-4" /> Add Note
            </Button>
          )}
        </div>

        {adding && (
          <NoteEditor
            key="new-note"
            initial={{ date: localToday(), text: "", category: "Observation", flaggedForDoctor: false, flaggedPhysicianId: null }}
            onSave={(draft) => createMutation.mutate(draft)}
            onCancel={() => setAdding(false)}
            saveLabel="Save Note"
            physicians={physicians}
          />
        )}

        {isLoading ? (
          <div className="space-y-4" data-testid="notes-loading">
            {[1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : notes.length === 0 && !adding ? (
          <Card data-testid="notes-empty-state">
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-base text-muted-foreground">Record a symptom or health event as it happens.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-7" data-testid="notes-timeline">
            {groups.map((group) => (
              <section key={group.date} className="min-w-0" data-testid={`notes-date-group-${group.date}`}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-foreground sm:text-lg">{formatDateMarker(group.date)}</h2>
                  <div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
                </div>
                <div className="ml-1 border-l-2 border-primary/20 pl-4 sm:pl-5">
                  <div className="space-y-3">
                    {group.entries.map((note) => {
                      const updates = updatesByNote[note.id!] || [];
                      return editingId === note.id ? (
                        <NoteEditor
                          key={note.id}
                          initial={{
                            date: note.date,
                            text: note.text,
                            category: noteCategory(note),
                            flaggedForDoctor: noteIsFlaggedForDoctor(note),
                            flaggedPhysicianId: physicians.some((physician) => physician.id === note.flaggedPhysicianId)
                              ? note.flaggedPhysicianId
                              : null,
                          }}
                          onSave={(draft) => updateMutation.mutate({ id: note.id!, draft })}
                          onCancel={() => setEditingId(null)}
                          saveLabel="Save Changes"
                          physicians={physicians}
                        />
                      ) : (
                        <Card key={note.id} className="min-w-0 overflow-hidden" data-testid={`note-${note.id}`}>
                          <CardContent className="p-4 sm:p-5">
                            <div className="flex flex-col gap-3 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-tight ${noteCategoryPillClass(noteCategory(note))}`}
                                  data-testid={`note-category-${note.id}`}
                                >
                                  {noteCategory(note)}
                                </span>
                                {noteIsFlaggedForDoctor(note) && (
                                  <span
                                    className="inline-flex min-h-7 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                                    data-testid={`note-doctor-flag-${note.id}`}
                                  >
                                    <Flag className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                    Next appointment
                                  </span>
                                )}
                                {noteIsFlaggedForDoctor(note) && typeof note.flaggedPhysicianId === "number" && physicians.find((physician) => physician.id === note.flaggedPhysicianId) && (
                                  <span
                                    className="inline-flex min-h-7 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                                    data-testid={`note-flag-physician-${note.id}`}
                                  >
                                    For {physicians.find((physician) => physician.id === note.flaggedPhysicianId)!.name}
                                  </span>
                                )}
                              </div>
                              <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground" data-testid={`note-text-${note.id}`}>
                                {note.text}
                              </p>
                              {updates.length > 0 && (
                                <div className="min-w-0 space-y-3 border-t border-border/70 pt-3" data-testid={`note-updates-${note.id}`}>
                                  {updates.map((update) => (
                                    editingUpdateId === update.id ? (
                                      <NoteUpdateEditor
                                        key={update.id}
                                        initial={{ date: update.date, text: update.text }}
                                        onSave={(draft) => updateUpdateMutation.mutate({ id: update.id!, draft })}
                                        onCancel={() => setEditingUpdateId(null)}
                                        saveLabel="Save Update"
                                      />
                                    ) : (
                                      <div
                                        key={update.id}
                                        className="min-w-0 border-l-2 border-primary/30 pl-3 sm:pl-4"
                                        data-testid={`note-update-${update.id}`}
                                      >
                                        <div className="flex min-w-0 flex-col gap-2 rounded-md bg-muted/45 p-3 sm:p-4">
                                          <p className="text-sm font-medium text-muted-foreground" data-testid={`note-update-date-${update.id}`}>
                                            {formatDateMarker(update.date)}
                                          </p>
                                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground" data-testid={`note-update-text-${update.id}`}>
                                            {update.text}
                                          </p>
                                          <div className="flex items-center justify-end gap-2">
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              onClick={() => { setEditingUpdateId(update.id!); setAddingUpdateNoteId(null); setEditingId(null); }}
                                              className="h-11 w-11 shrink-0"
                                              aria-label={`Edit update for ${formatDateMarker(update.date)}`}
                                              data-testid={`button-edit-update-${update.id}`}
                                            >
                                              <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <AlertDialog>
                                              <AlertDialogTrigger asChild>
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-11 w-11 shrink-0"
                                                  aria-label={`Delete update for ${formatDateMarker(update.date)}`}
                                                  data-testid={`button-delete-update-${update.id}`}
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </AlertDialogTrigger>
                                              <AlertDialogContent className="max-w-md">
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle className="font-heading flex items-center gap-2">
                                                    <Trash2 className="h-5 w-5 text-destructive" /> Delete update?
                                                  </AlertDialogTitle>
                                                  <AlertDialogDescription>
                                                    This update for <span className="font-medium text-foreground">{formatDateMarker(update.date)}</span> will be removed. This cannot be undone.
                                                  </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="gap-2 sm:gap-2">
                                                  <AlertDialogCancel
                                                    className="mt-0 h-11 text-base sm:h-10 sm:text-sm"
                                                    data-testid={`button-delete-update-cancel-${update.id}`}
                                                  >
                                                    Cancel
                                                  </AlertDialogCancel>
                                                  <AlertDialogAction
                                                    onClick={() => deleteUpdateMutation.mutate(update.id!)}
                                                    className="h-11 bg-destructive text-base font-semibold text-destructive-foreground hover:bg-destructive/90 sm:h-10 sm:text-sm"
                                                    data-testid={`button-delete-update-confirm-${update.id}`}
                                                  >
                                                    Delete update
                                                  </AlertDialogAction>
                                                </AlertDialogFooter>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  ))}
                                </div>
                              )}

                              {addingUpdateNoteId === note.id && (
                                <NoteUpdateEditor
                                  key={`new-update-${note.id}`}
                                  initial={{ date: localToday(), text: "" }}
                                  onSave={(draft) => createUpdateMutation.mutate({ noteId: note.id!, draft })}
                                  onCancel={() => setAddingUpdateNoteId(null)}
                                  saveLabel="Save Update"
                                />
                              )}

                              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-3">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => { setAddingUpdateNoteId(note.id!); setEditingUpdateId(null); setAdding(false); setEditingId(null); }}
                                  className="h-11 min-w-11 gap-1.5 px-3 text-sm"
                                  data-testid={`button-add-update-${note.id}`}
                                >
                                  <Plus className="h-4 w-4" /> Add update
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => { setEditingId(note.id!); setAdding(false); setAddingUpdateNoteId(null); setEditingUpdateId(null); }}
                                  className="h-11 w-11"
                                  aria-label={`Edit note for ${formatDateMarker(note.date)}`}
                                  data-testid={`button-edit-note-${note.id}`}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-11 w-11"
                                      aria-label={`Delete note for ${formatDateMarker(note.date)}`}
                                      data-testid={`button-delete-note-${note.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="max-w-md">
                                    <AlertDialogHeader>
                                      <AlertDialogTitle className="font-heading flex items-center gap-2">
                                        <Trash2 className="h-5 w-5 text-destructive" /> Delete note?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This note for <span className="font-medium text-foreground">{formatDateMarker(note.date)}</span> will be removed{updates.length > 0 ? " along with its updates" : ""}. This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter className="gap-2 sm:gap-2">
                                      <AlertDialogCancel
                                        className="mt-0 h-11 text-base sm:h-10 sm:text-sm"
                                        data-testid={`button-delete-note-cancel-${note.id}`}
                                      >
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteMutation.mutate(note.id!)}
                                        className="h-11 bg-destructive text-base font-semibold text-destructive-foreground hover:bg-destructive/90 sm:h-10 sm:text-sm"
                                        data-testid={`button-delete-note-confirm-${note.id}`}
                                      >
                                        Delete note
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
