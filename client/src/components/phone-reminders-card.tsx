import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BellRing, AlertTriangle, Loader2 } from "lucide-react";
import {
  detectPhoneReminderState,
  enablePhoneReminders,
  disablePhoneReminders,
  getCurrentPhoneReminderState,
  syncRemindersToSupabase,
  type PhoneReminderState,
} from "@/lib/reminder-sync";
import { getAppointments, getMedications, getPatients } from "@/lib/db";

export function PhoneRemindersCard() {
  const [state, setState] = useState<PhoneReminderState>(() => detectPhoneReminderState());
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentPhoneReminderState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => { cancelled = true; };
  }, []);

  const subscribed = state.status === "subscribed";

  // Pull *all* upcoming reminders across patients so we sync regardless of
  // which patient is active in the UI.
  const { data: appointments = [] } = useQuery({
    queryKey: ["all-appointments-for-sync"],
    enabled: subscribed,
    queryFn: async () => {
      const patients = await getPatients();
      const out: any[] = [];
      for (const p of patients) {
        if (p.id == null) continue;
        out.push(...(await getAppointments(p.id)));
      }
      return out;
    },
  });
  const { data: medications = [] } = useQuery({
    queryKey: ["all-medications-for-sync"],
    enabled: subscribed,
    queryFn: async () => {
      const patients = await getPatients();
      const out: any[] = [];
      for (const p of patients) {
        if (p.id == null) continue;
        out.push(...(await getMedications(p.id)));
      }
      return out;
    },
  });
  const { data: patients = [] } = useQuery({
    queryKey: ["all-patients"],
    enabled: subscribed,
    queryFn: getPatients,
  });

  useEffect(() => {
    if (!subscribed) return;
    if (!appointments.length && !medications.length) return;
    let cancelled = false;
    setSyncMessage("Syncing…");
    syncRemindersToSupabase({ appointments, medications, patients })
      .then((res) => {
        if (cancelled) return;
        if ("synced" in res) setSyncMessage(`Synced ${res.synced} reminder${res.synced === 1 ? "" : "s"}`);
        else setSyncMessage(null);
      })
      .catch((err) => {
        if (!cancelled) setSyncMessage(`Sync failed: ${err.message ?? err}`);
      });
    return () => { cancelled = true; };
  }, [subscribed, appointments, medications, patients]);

  const handleEnable = async () => {
    setBusy(true);
    setSyncMessage(null);
    const next = await enablePhoneReminders();
    setState(next);
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true);
    setSyncMessage(null);
    await disablePhoneReminders();
    setState(await getCurrentPhoneReminderState());
    setBusy(false);
  };

  if (state.status === "unsupported") return null;

  return (
    <Card data-testid="card-phone-reminders">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
          <BellRing className="w-4 h-4 text-primary" />
          Phone Reminders
          {subscribed && (
            <Badge variant="secondary" className="text-[10px] font-medium">
              On
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "not-configured" && (
          <p className="text-xs text-muted-foreground">
            Phone reminders are not configured for this build. See{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">REMINDERS_SETUP.md</code>{" "}
            to add Supabase + VAPID keys.
          </p>
        )}

        {state.status === "permission-denied" && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              Notifications are blocked for this site. Enable them in your browser settings,
              then reload this page.
            </p>
          </div>
        )}

        {state.status === "permission-default" && (
          <>
            <p className="text-xs text-muted-foreground">
              Get reminded on your phone — even when this app is closed. We'll send a push
              for upcoming appointment reminders and medication refills.
            </p>
            <Button
              onClick={handleEnable}
              disabled={busy}
              size="sm"
              data-testid="button-enable-phone-reminders"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
              Enable phone reminders
            </Button>
          </>
        )}

        {state.status === "subscribing" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Subscribing this device…
          </div>
        )}

        {state.status === "subscribed" && (
          <>
            <p className="text-xs text-muted-foreground">
              This device will receive a push notification when a reminder is due.
              Add or change reminders inside Appointments / Medications and they'll
              sync automatically.
            </p>
            {syncMessage && (
              <p className="text-[11px] text-muted-foreground" data-testid="text-phone-reminders-sync">
                {syncMessage}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisable}
              disabled={busy}
              data-testid="button-disable-phone-reminders"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
              Turn off on this device
            </Button>
          </>
        )}

        {state.status === "error" && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{state.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
