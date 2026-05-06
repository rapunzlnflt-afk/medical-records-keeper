import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BellRing, AlertTriangle, Loader2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import {
  detectPhoneReminderState,
  enablePhoneReminders,
  disablePhoneReminders,
  getCurrentPhoneReminderState,
  syncRemindersToSupabase,
  collectPhoneReminderDiagnostics,
  type PhoneReminderState,
  type PhoneReminderDiagnostics,
} from "@/lib/reminder-sync";
import { getAppointments, getMedications, getPatients } from "@/lib/db";

function DiagnosticsPanel({ diagnostics }: { diagnostics: PhoneReminderDiagnostics }) {
  const [open, setOpen] = useState(false);

  const rows: Array<[string, string]> = [
    ["Notification.permission", String(diagnostics.notificationPermission)],
    ["Service worker support", String(diagnostics.serviceWorkerSupported)],
    ["PushManager support", String(diagnostics.pushManagerSupported)],
    ["Notification API support", String(diagnostics.notificationApiSupported)],
    ["Display mode", diagnostics.displayMode],
    ["Standalone (Home Screen app)", String(diagnostics.isStandalone)],
    ["Origin", diagnostics.origin],
    ["Hostname", diagnostics.hostname],
    ["Protocol", diagnostics.protocol],
    ["Secure context", String(diagnostics.isSecureContext)],
    ["Supabase configured", String(diagnostics.supabaseConfigured)],
    ["VAPID public key configured", String(diagnostics.vapidConfigured)],
    ["Platform", diagnostics.platform || "(unknown)"],
    ["iOS detected", String(diagnostics.isIOS)],
    ["Safari detected", String(diagnostics.isSafari)],
    ["User agent", diagnostics.userAgent],
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground gap-1"
          data-testid="button-toggle-phone-reminders-diagnostics"
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Diagnostics
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="mt-2 rounded-md bg-muted/50 p-2 text-[10.5px] leading-relaxed font-mono space-y-0.5 break-all"
          data-testid="text-phone-reminders-diagnostics"
        >
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="text-muted-foreground flex-shrink-0">{label}:</span>
              <span className="text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PhoneRemindersCard() {
  const [state, setState] = useState<PhoneReminderState>(() => detectPhoneReminderState());
  const [diagnostics, setDiagnostics] = useState<PhoneReminderDiagnostics>(() =>
    collectPhoneReminderDiagnostics(),
  );
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentPhoneReminderState().then((s) => {
      if (!cancelled) {
        setState(s);
        setDiagnostics(collectPhoneReminderDiagnostics());
      }
    });
    return () => {
      cancelled = true;
    };
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
    return () => {
      cancelled = true;
    };
  }, [subscribed, appointments, medications, patients]);

  const handleEnable = async () => {
    setBusy(true);
    setSyncMessage(null);
    const next = await enablePhoneReminders();
    setState(next);
    setDiagnostics(collectPhoneReminderDiagnostics());
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true);
    setSyncMessage(null);
    await disablePhoneReminders();
    setState(await getCurrentPhoneReminderState());
    setDiagnostics(collectPhoneReminderDiagnostics());
    setBusy(false);
  };

  const handleRecheck = async () => {
    setBusy(true);
    setState(await getCurrentPhoneReminderState());
    setDiagnostics(collectPhoneReminderDiagnostics());
    setBusy(false);
  };

  if (state.status === "unsupported") {
    // Even when unsupported we render a small diagnostic card on iOS so the
    // user can see *why* (e.g., not yet added to Home Screen).
    if (!diagnostics.isIOS) return null;
  }

  const iosNeedsHomeScreen = diagnostics.isIOS && !diagnostics.isStandalone;

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
        {state.status === "unsupported" && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              Push notifications aren't available in this browser context.
              {iosNeedsHomeScreen && (
                <>
                  {" "}On iPhone, tap the Share button in Safari and choose
                  <strong> Add to Home Screen</strong>, then open the app from
                  the Home Screen icon and try again.
                </>
              )}
            </p>
          </div>
        )}

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
            <div className="space-y-2">
              <p>Notifications are blocked for this site.</p>
              {diagnostics.isIOS ? (
                <ul className="list-disc pl-4 space-y-1 text-foreground/80">
                  <li>
                    iOS only delivers web push from a <strong>Home Screen web app</strong>.
                    If you don't see Safari or this app under
                    <em> Settings &rsaquo; Notifications</em>, this site has never
                    been granted permission as an installed web app on this device.
                  </li>
                  <li>
                    Remove the existing Home Screen icon, open the site in Safari,
                    tap Share &rsaquo; <strong>Add to Home Screen</strong>, then
                    launch from the new icon and tap <em>Enable</em> again.
                  </li>
                  <li>
                    Preview URLs change between deployments — permission is tied
                    to the exact origin shown below, so a new origin starts
                    permission fresh.
                  </li>
                </ul>
              ) : (
                <p className="text-foreground/80">
                  Open your browser site settings for this origin and reset
                  notification permission to <em>Ask</em> or <em>Allow</em>, then
                  reload and try again.
                </p>
              )}
            </div>
          </div>
        )}

        {state.status === "permission-default" && (
          <>
            <p className="text-xs text-muted-foreground">
              Get reminded on your phone — even when this app is closed. We'll send a push
              for upcoming appointment reminders and medication refills.
            </p>
            {iosNeedsHomeScreen && (
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/50 rounded p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <p>
                  On iPhone, push notifications only work after you
                  <strong> Add to Home Screen</strong> (Safari Share menu) and
                  open the app from the Home Screen icon.
                </p>
              </div>
            )}
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

        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <DiagnosticsPanel diagnostics={diagnostics} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRecheck}
            disabled={busy}
            className="h-7 px-2 text-[11px] text-muted-foreground gap-1"
            data-testid="button-recheck-phone-reminders"
          >
            {busy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Re-check
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
