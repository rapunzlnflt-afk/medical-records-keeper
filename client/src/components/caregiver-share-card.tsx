// "Share doses with a caregiver" (MedRecords Max). The owner's side of
// caregiver sharing: name shown to caregivers, which medications are shared,
// what to do about a missed dose, the link, and who has joined.
// A port of Pawfolio's sitter sharing card; keep the wording in step.

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Users, Copy, Share2, Bell, BellOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useMax } from "@/lib/plan";
import { MaxLockCard } from "@/components/max-lock";
import { isDoseSchedulingAvailable, type MissedRule } from "@/lib/dose-schedule";
import {
  createGroup,
  getActiveGroup,
  getOwnerLabel,
  linkFor,
  listShareableSchedules,
  removeMember,
  setMissedRule,
  setOwnerLabel,
  setShared,
  stopSharing,
  updateGroupLabel,
  type ShareableSchedule,
} from "@/lib/caregiver-share";

const KEY_GROUP = ["caregiver-group"];
const KEY_SCHEDULES = ["caregiver-schedules"];

const MISSED_OPTIONS: { value: "" | MissedRule; label: string }[] = [
  { value: "", label: "No instruction" },
  { value: "asap", label: "Give it when remembered" },
  { value: "skip", label: "Skip it, give next as usual" },
  { value: "double", label: "Double the next dose" },
  { value: "note", label: "Follow the doctor's note" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "not opened yet";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return "active now";
  if (min < 60) return `active ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `active ${h} hr ago`;
  const d = Math.round(h / 24);
  return `active ${d} day${d === 1 ? "" : "s"} ago`;
}

function SharedMedRow({ item }: { item: ShareableSchedule }) {
  const { toast } = useToast();
  const s = item.schedule;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(s.missed_note || "");
  const rule = (s.missed_rule || "") as "" | MissedRule;

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY_SCHEDULES });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid={`caregiver-med-${s.source_id}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm break-words">{s.label}</p>
          <p className="text-xs text-muted-foreground break-words">
            {item.personName ? `for ${item.personName}` : item.medName}
          </p>
        </div>
        <Switch
          checked={!!s.shared}
          disabled={busy}
          onCheckedChange={(on) => run(() => setShared(item, on))}
          aria-label={`Share ${s.label}`}
          data-testid={`switch-share-${s.source_id}`}
        />
      </div>
      {s.shared && (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted-foreground" htmlFor={`missed-${s.id}`}>
            If a dose is missed
          </label>
          <select
            id={`missed-${s.id}`}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            value={rule}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value as "" | MissedRule;
              if (v !== "note") run(() => setMissedRule(s.id, v || null, null));
              else run(() => setMissedRule(s.id, "note", note));
            }}
            data-testid={`select-missed-${s.source_id}`}
          >
            {MISSED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {rule === "note" && (
            <Input
              value={note}
              maxLength={300}
              placeholder="The doctor's instructions for a missed dose"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => run(() => setMissedRule(s.id, "note", note))}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {rule === "double"
              ? "Only choose this if the doctor or pharmacist told you to."
              : "Shown to your caregiver when a dose is late or missed."}
          </p>
        </div>
      )}
    </div>
  );
}

/** `bare` drops the card frame so it can sit in a grouped list (Medications' "More tools"). */
export function CaregiverShareCard({ bare = false }: { bare?: boolean } = {}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(getOwnerLabel());
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = open && isDoseSchedulingAvailable();
  const { data: groupState } = useQuery({ queryKey: KEY_GROUP, queryFn: getActiveGroup, enabled });
  const { data: schedules = [] } = useQuery({
    queryKey: KEY_SCHEDULES,
    queryFn: listShareableSchedules,
    enabled,
    // Recheck every time the card opens, so reminders turned on elsewhere show up.
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (!isDoseSchedulingAvailable()) return null;

  const group = groupState?.group ?? null;
  const members = groupState?.members ?? [];
  const url = freshUrl || (group ? linkFor(group) : null);
  const sharedCount = schedules.filter((s) => s.schedule.shared).length;
  const max = useMax();

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      queryClient.invalidateQueries({ queryKey: KEY_GROUP });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async (link: string) => {
    const text = `${name ? name + " shared" : "Here are"} medication doses with you. Open this on your phone to see when each dose is due and mark it given:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Medication doses", text, url: link });
        return;
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Paste it into a text or email to your caregiver." });
    } catch {
      toast({ title: "Couldn't copy the link", description: link });
    }
  };

  return (
    <Frame bare={bare}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`w-full text-left px-4 py-3 flex items-center gap-3 min-h-[56px] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${bare ? "focus-visible:ring-inset" : "rounded-lg"}`}
            data-testid="button-toggle-caregiver-share"
          >
            <Users className="w-5 h-5 flex-shrink-0 text-primary" />
            <span className="flex-1 min-w-0">
              <span className={bare ? "block text-sm font-semibold leading-tight" : "block font-heading text-base font-semibold leading-tight"}>
                Share doses with a caregiver
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5 break-words">
                They tap Given or Skip on their phone, and you see who gave each dose.
              </span>
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0 text-muted-foreground">
              <Badge variant="secondary" className="text-[10px] font-medium">
                Max
              </Badge>
              <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-4">
            {!max ? (
              <MaxLockCard
                feature="Caregiver sharing"
                pitch="Send a caregiver a link. They see only the medications you choose, get a reminder when each dose is due, and you see who gave it."
                testId="card-max-lock-caregiver"
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Caregivers see only the medications you switch on below: the reminder name, who it's
                  for, and dose times. Nothing else in your records is shared.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium" htmlFor="caregiver-owner-name">
                    Your first name
                  </label>
                  <Input
                    id="caregiver-owner-name"
                    value={name}
                    maxLength={40}
                    placeholder="Shown to caregivers, e.g. Carol"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      setOwnerLabel(name);
                      if (group) updateGroupLabel(group.id).catch(() => {});
                    }}
                    data-testid="input-caregiver-owner-name"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Medications to share</p>
                  {schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Turn on Dose reminders for a medication first. Sharing uses the same dose times.
                    </p>
                  ) : (
                    schedules.map((item) => <SharedMedRow key={item.schedule.id} item={item} />)
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Caregiver link</p>
                  {!group ? (
                    <Button
                      className="w-full sm:w-auto"
                      disabled={busy || sharedCount === 0 || !name.trim()}
                      onClick={() =>
                        act(async () => {
                          setOwnerLabel(name);
                          const r = await createGroup();
                          setFreshUrl(r.url);
                          await sendLink(r.url);
                        })
                      }
                      data-testid="button-caregiver-make-link"
                    >
                      <Share2 className="w-4 h-4 mr-2" /> Make a link and send it
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {url && (
                        <Button variant="outline" disabled={busy} onClick={() => sendLink(url)} data-testid="button-caregiver-send">
                          <Copy className="w-4 h-4 mr-2" /> Send the link again
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            if (!window.confirm("Make a new link? The old link and everyone on it stop working.")) return;
                            const r = await createGroup();
                            setFreshUrl(r.url);
                            await sendLink(r.url);
                          })
                        }
                        data-testid="button-caregiver-new-link"
                      >
                        New link
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            if (!window.confirm("Stop sharing? Caregivers lose access right away.")) return;
                            await stopSharing(group.id);
                            setFreshUrl(null);
                          })
                        }
                        data-testid="button-caregiver-stop"
                      >
                        Stop sharing
                      </Button>
                    </div>
                  )}
                  {!group && (sharedCount === 0 || !name.trim()) && (
                    <p className="text-xs text-muted-foreground">
                      Add your first name and switch on at least one medication to make a link.
                    </p>
                  )}
                  {group && !url && (
                    <p className="text-xs text-muted-foreground">
                      This link was made on another phone. Make a new link to send it from here.
                    </p>
                  )}
                </div>

                {group && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Caregivers</p>
                    {members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No one has opened the link yet.</p>
                    ) : (
                      members.map((m) => (
                        <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`caregiver-member-${m.id}`}>
                          {m.reminders ? (
                            <Bell className="w-4 h-4 text-primary flex-shrink-0" aria-label="Reminders on" />
                          ) : (
                            <BellOff className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-label="Reminders off" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium break-words">{m.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {m.reminders ? "Reminders on" : "Reminders off"} · {timeAgo(m.last_seen_at)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                if (!window.confirm(`Remove ${m.label}? Their phone stops showing your doses.`)) return;
                                await removeMember(m.id);
                              })
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Frame>
  );
}

function Frame({ bare, children }: { bare: boolean; children: ReactNode }) {
  if (bare) return <div data-testid="card-caregiver-share">{children}</div>;
  return (
    <Card className="h-fit" data-testid="card-caregiver-share">
      {children}
    </Card>
  );
}
