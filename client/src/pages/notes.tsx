import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Edit2, FileText, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { createNote, deleteNote, getNotes, updateNote } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import type { Note } from "@shared/schema";

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDateMarker(date: string): string {
  return format(parseISO(date), "EEEE, MMMM d, yyyy");
}

type NoteDraft = Pick<Note, "date" | "text">;

function NoteEditor({
  initial,
  onSave,
  onCancel,
  saveLabel,
}: {
  initial: NoteDraft;
  onSave: (draft: NoteDraft) => void;
  onCancel: () => void;
  saveLabel: string;
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
              onClick={() => onSave({ ...draft, text: draft.text.trim() })}
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

export default function Notes() {
  const { activePatientId } = usePatient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["notes", activePatientId],
    queryFn: () => getNotes(activePatientId),
  });

  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ["notes", activePatientId] });
  const createMutation = useMutation({
    mutationFn: (draft: NoteDraft) => createNote({
      patientId: activePatientId,
      ...draft,
      createdAt: new Date().toISOString(),
    }),
    onSuccess: () => {
      void invalidateNotes();
      setAdding(false);
      toast({ title: "Note added" });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: NoteDraft }) => updateNote(id, draft),
    onSuccess: () => {
      void invalidateNotes();
      setEditingId(null);
      toast({ title: "Note updated" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      void invalidateNotes();
      toast({ title: "Note removed" });
    },
  });

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
            initial={{ date: localToday(), text: "" }}
            onSave={(draft) => createMutation.mutate(draft)}
            onCancel={() => setAdding(false)}
            saveLabel="Save Note"
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
                    {group.entries.map((note) => (
                      editingId === note.id ? (
                        <NoteEditor
                          key={note.id}
                          initial={{ date: note.date, text: note.text }}
                          onSave={(draft) => updateMutation.mutate({ id: note.id!, draft })}
                          onCancel={() => setEditingId(null)}
                          saveLabel="Save Changes"
                        />
                      ) : (
                        <Card key={note.id} className="min-w-0 overflow-hidden" data-testid={`note-${note.id}`}>
                          <CardContent className="p-4 sm:p-5">
                            <div className="flex flex-col gap-3 min-w-0">
                              <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground" data-testid={`note-text-${note.id}`}>
                                {note.text}
                              </p>
                              <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => { setEditingId(note.id!); setAdding(false); }}
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
                                        This note for <span className="font-medium text-foreground">{formatDateMarker(note.date)}</span> will be removed. This cannot be undone.
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
                    ))}
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
