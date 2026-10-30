// MedRecords Care: "Share with caregivers" on the Care Log. Uses the same
// caregiver link as dose sharing; this card only switches the care log on or
// off for one person and makes or resends the link.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Share2, Users } from "lucide-react";
import type { Patient } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getSupabase } from "@/lib/supabase";
import { createGroup, firstName, getActiveGroup, getOwnerLabel, linkFor, setOwnerLabel } from "@/lib/caregiver-share";
import { getCareShare, setCareShared, setOwnerEntriesShared } from "@/lib/care-share";
import { conditionLabels, conditionsShared } from "@/lib/care";
import { usePatient } from "@/lib/patient-context";
import { PersonChip } from "@/components/person-chip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Same key as the dose-sharing card, so both stay in step.
const KEY_GROUP = ["caregiver-group"];

export function CareShareCard({ patient }: { patient: Patient }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(getOwnerLabel());
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pid = patient.id!;
  const who = firstName(patient.name) || "this person";

  const { data: share } = useQuery({ queryKey: ["care-shared", pid], queryFn: () => getCareShare(pid) });
  const shared = !!share?.shared;
  const ownerEntries = !!share?.ownerEntries;
  const { data: groupState } = useQuery({ queryKey: KEY_GROUP, queryFn: getActiveGroup, enabled: shared });
  // Caregivers see first names only, so two family members with the same
  // first name would look alike on their phone.
  const { patients: family } = usePatient();
  const sameFirst = family.filter(
    (p) => p.id !== pid && (firstName(p.name) || "").toLowerCase() === (firstName(patient.name) || "").toLowerCase(),
  );

  if (!getSupabase()) return null;

  const group = groupState?.group ?? null;
  const members = groupState?.members ?? [];
  const url = freshUrl || (group ? linkFor(group) : null);
  const conds = conditionLabels(patient);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async (link: string) => {
    const text = `${name ? name + " shared" : "Here is"} ${who}'s care log with you. Open this on your phone to log meals, therapy and how ${who} is doing:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Care for ${who}`, text, url: link });
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

  const turnOn = () =>
    act(async () => {
      await setCareShared(patient, true);
      queryClient.invalidateQueries({ queryKey: ["care-shared", pid] });
      queryClient.invalidateQueries({ queryKey: ["shared-people"] });
      queryClient.invalidateQueries({ queryKey: KEY_GROUP });
      toast({ title: `Sharing ${patient.name}'s care log` });
    });

  return (
    <Card data-testid="card-care-share">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <PersonChip patient={patient} testId="chip-share-person">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold flex-shrink-0 ${shared ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            data-testid="text-share-status"
          >
            {shared ? "Shared" : "Private"}
          </span>
        </PersonChip>
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 flex-shrink-0 text-primary" />
          <p className="min-w-0 flex-1 font-heading text-base font-semibold leading-tight">Share with caregivers</p>
          <Switch
            checked={shared}
            disabled={busy}
            aria-label={`Share ${who}'s care log`}
            onCheckedChange={(on) =>
              on
                ? setConfirmOpen(true)
                : act(async () => {
                    await setCareShared(patient, false);
                    queryClient.invalidateQueries({ queryKey: ["care-shared", pid] });
                    queryClient.invalidateQueries({ queryKey: ["shared-people"] });
                    toast({ title: `${patient.name}'s care log is private again` });
                  })
            }
            data-testid="switch-care-share"
          />
        </div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-confirm-care-share">
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">Share this person's care log?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-left">
                  <PersonChip patient={patient} />
                  <p className="break-words">
                    Caregivers on your link will see {who}'s first name
                    {conditionsShared(patient) && conds.length ? `, conditions (${conds.join(", ")})` : ""} and care entries, and
                    can log care for {who}.
                  </p>
                  {sameFirst.length > 0 && (
                    <p
                      className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-amber-900 dark:text-amber-200 break-words"
                      data-testid="text-same-first-name"
                    >
                      {sameFirst.map((p) => p.name).join(" and ")} also {sameFirst.length > 1 ? "have" : "has"} the first name {who}.
                      Caregivers see first names only, so consider changing one name in Profile (for example, a nickname) before
                      sharing.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-care-share">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={turnOn} data-testid="button-confirm-care-share">
                Share {who}'s care log
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="-mt-1 text-sm text-muted-foreground break-words">
          Caregivers log care for {who} from their phone. Everyone on the link sees each other's entries, and they
          appear here with their name.
        </p>

        {shared && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm text-muted-foreground break-words">
              Caregivers see {who}'s first name
              {conditionsShared(patient) && conds.length ? ` and conditions (${conds.join(", ")})` : ""}, plus the last two days
              of entries.
            </p>
            <div className="flex items-start gap-3 rounded-lg border p-3" data-testid="row-owner-entries">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">Caregivers see entries I log</p>
                <p className="mt-0.5 text-xs text-muted-foreground break-words" data-testid="text-owner-entries">
                  {ownerEntries
                    ? `Your entries for ${who} from the last two days show on their phones with your name. Only you can change them.`
                    : "Off: entries you log on this phone stay private."}
                </p>
              </div>
              <Switch
                checked={ownerEntries}
                disabled={busy}
                aria-label="Caregivers see entries I log"
                onCheckedChange={(on) =>
                  act(async () => {
                    await setOwnerEntriesShared(patient, on);
                    queryClient.invalidateQueries({ queryKey: ["care-shared", pid] });
                    toast({ title: on ? "Caregivers will see your entries" : "Your entries are private again" });
                  })
                }
                data-testid="switch-owner-entries"
              />
            </div>
            {!group ? (
              <>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium" htmlFor="care-owner-name">Your first name</label>
                  <Input
                    id="care-owner-name" value={name} maxLength={40} placeholder="Shown to caregivers, e.g. Carol"
                    onChange={(e) => setName(e.target.value)} onBlur={() => setOwnerLabel(name)}
                    data-testid="input-care-owner-name"
                  />
                </div>
                <Button
                  className="w-full sm:w-auto" disabled={busy || !name.trim()}
                  onClick={() =>
                    act(async () => {
                      setOwnerLabel(name);
                      const r = await createGroup();
                      setFreshUrl(r.url);
                      queryClient.invalidateQueries({ queryKey: KEY_GROUP });
                      await sendLink(r.url);
                    })
                  }
                  data-testid="button-care-make-link"
                >
                  <Share2 className="mr-2 h-4 w-4" /> Make a link and send it
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm break-words" data-testid="text-care-link-members">
                  {members.length
                    ? `On your caregiver link: ${members.map((m) => m.label).join(", ")}. They'll see the care log next time they open it.`
                    : "Nobody has opened your caregiver link yet."}
                </p>
                {url ? (
                  <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => sendLink(url)} data-testid="button-care-send-link">
                    <Copy className="mr-2 h-4 w-4" /> Send the caregiver link
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Your link was made on another device. To send a new one, go to Medications, then More tools, then
                    Share doses with a caregiver.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
