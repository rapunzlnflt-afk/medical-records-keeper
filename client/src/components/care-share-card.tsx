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
import { isCareShared, setCareShared } from "@/lib/care-share";
import { conditionLabels, conditionsShared } from "@/lib/care";

// Same key as the dose-sharing card, so both stay in step.
const KEY_GROUP = ["caregiver-group"];

export function CareShareCard({ patient }: { patient: Patient }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(getOwnerLabel());
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const pid = patient.id!;
  const who = firstName(patient.name) || "this person";

  const { data: shared = false } = useQuery({ queryKey: ["care-shared", pid], queryFn: () => isCareShared(pid) });
  const { data: groupState } = useQuery({ queryKey: KEY_GROUP, queryFn: getActiveGroup, enabled: shared });

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

  return (
    <Card data-testid="card-care-share">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 flex-shrink-0 text-primary" />
          <p className="min-w-0 flex-1 font-heading text-base font-semibold leading-tight">Share with caregivers</p>
          <Switch
            checked={shared}
            disabled={busy}
            aria-label={`Share ${who}'s care log`}
            onCheckedChange={(on) =>
              act(async () => {
                await setCareShared(patient, on);
                queryClient.invalidateQueries({ queryKey: ["care-shared", pid] });
                if (on) queryClient.invalidateQueries({ queryKey: KEY_GROUP });
              })
            }
            data-testid="switch-care-share"
          />
        </div>
        <p className="-mt-1 text-sm text-muted-foreground break-words">
          Caregivers log care for {who} from their phone. Everyone on the link sees each other's entries, and they
          appear here with their name.
        </p>

        {shared && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm text-muted-foreground break-words">
              Caregivers see {who}'s first name
              {conditionsShared(patient) && conds.length ? ` and conditions (${conds.join(", ")})` : ""}, plus the last two days
              of entries. Entries you log on this phone stay private.
            </p>
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
