import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BellRing, AlertTriangle, Loader2, ChevronDown, ChevronRight, RefreshCw, CheckCircle2 } from "lucide-react";
import {
  detectPhoneReminderState,
  enablePhoneReminders,
  disablePhoneReminders,
  getCurrentPhoneReminderState,
  syncRemindersToSupabase,
  collectPhoneReminderDiagnostics,
  requestRemindersSync,
  type PhoneReminderState,
  type PhoneReminderDiagnostics,
  type SyncStatusRecord,
} from "@/lib/reminder-sync";
import { getAppointments, getMedications, getPatients } from "@/lib/db";

function formatStatus(record: SyncStatusRecord | null | undefined): string {
  if (!record) return "never";
  const when = new Date(record.ts);
  const ago = Date.now() - when.getTime();
  const minutes = Math.round(ago / 60000);
  const rel = minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
  const stage = record.stage ? ` [${record.stage}]` : "";
  const tail = typeof record.count === "number" ? ` · ${record.count}` : "";
  return `${record.ok ? "ok" : "error"}${stage} · ${rel}${tail} — ${record.message}`;
}

function DiagnosticsDetails({ diagnostics }: { diagnostics: PhoneReminderDiagnostics }) {
  const rows: Array<[string, string]> = [
    ["Build commit", diagnostics.buildCommit],
    ["Build time", diagnostics.buildTime],
    ["Service worker script", diagnostics.serviceWorkerScriptUrl ?? "(none)"],
    ["Service worker state", diagnostics.serviceWorkerState ?? "(none)"],
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
    ["Device id", diagnostics.deviceId || "(none)"],
    ["Authed user id", diagnostics.authedUserId ?? "(none)"],
    ["Last device sync", formatStatus(diagnostics.lastDeviceSync)],
    ["Last reminder sync", formatStatus(diagnostics.lastReminderSync)],
    ["Platform", diagnostics.platform || "(unknown)"],
    ["iOS detected", String(diagnostics.isIOS)],
    ["Safari detected", String(diagnostics.isSafari)],
    ["User agent", diagnostics.userAgent],
  ];

  return (
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
  );
}

const EMPTY_DIAGNOSTICS: PhoneReminderDiagnostics = {
  notificationPermission: "unavailable",
  serviceWorkerSupported: false,
  pushManagerSupported: false,
  notificationApiSupported: false,
  isStandalone: false,
  displayMode: "unknown",
  origin: "",
  hostname: "",
  protocol: "",
  isSecureContext: false,
  supabaseConfigured: false,
  vapidConfigured: false,
  platform: "",
  isIOS: false,
  isSafari: false,
  userAgent: "",
  deviceId: "",
  authedUserId: null,
  lastDeviceSync: null,
  lastReminderSync: null,
  buildCommit: "unknown",
  buildTime: "unknown",
  serviceWorkerScriptUrl: null,
  serviceWorkerState: null,
};

export function PhoneRemindersCard() {
  const [state, setState] = useState<PhoneReminderState>(() => detectPhoneReminderState());
  const [diagnostics, setDiagnostics] = useState<PhoneReminderDiagnostics>(EMPTY_DIAGNOSTICS);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const queryClient = useQueryClient();

  const refreshDiagnostics = useCallback(async () => {
    const d = await collectPhoneReminderDiagnostics();
    setDiagnostics(d);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getCurrentPhoneReminderState();
      if (cancelled) return;
      setState(s);
      await refreshDiagnostics();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDiagnostics]);

  // Reflect background sync results from anywhere in the app. We only surface a
  // user-visible message when something *failed*; successful syncs are silent
  // — they're still recorded in diagnostics for support.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as SyncStatusRecord | undefined;
      if (detail && !detail.ok) {
        setSyncError(detail.message);
      } else if (detail && detail.ok) {
        setSyncError(null);
      }
      void refreshDiagnostics();
    };
    window.addEventListener("mrk-reminder-sync-status", handler);
    return () => window.removeEventListener("mrk-reminder-sync-status", handler);
  }, [refreshDiagnostics]);

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
    queryKey: ["all-patients-for-sync"],
    enabled: subscribed,
    queryFn: getPatients,
  });

  const runInitialSync = useCallback(
    async (apps: any[], meds: any[], pats: any[]) => {
      try {
        await syncRemindersToSupabase({
          appointments: apps,
          medications: meds,
          patients: pats,
        });
        setSyncError(null);
      } catch (err: any) {
        setSyncError(err?.message ?? String(err));
      } finally {
        await refreshDiagnostics();
      }
    },
    [refreshDiagnostics],
  );

  // React to upstream changes: any time the underlying queries refresh after
  // an appointment/medication mutation, push the new set up to Supabase.
  useEffect(() => {
    if (!subscribed) return;
    if (appointments.length === 0 && medications.length === 0 && patients.length === 0) return;
    requestRemindersSync();
  }, [subscribed, appointments, medications, patients]);

  const handleEnable = async () => {
    setBusy(true);
    setSyncError(null);
    try {
      const next = await enablePhoneReminders();
      setState(next);
      await refreshDiagnostics();
      if (next.status === "subscribed") {
        await queryClient.invalidateQueries({ queryKey: ["all-appointments-for-sync"] });
        await queryClient.invalidateQueries({ queryKey: ["all-medications-for-sync"] });
        await queryClient.invalidateQueries({ queryKey: ["all-patients-for-sync"] });

        const [pats, allApps, allMeds] = await Promise.all([
          getPatients(),
          (async () => {
            const ps = await getPatients();
            const out: any[] = [];
            for (const p of ps) {
              if (p.id == null) continue;
              out.push(...(await getAppointments(p.id)));
            }
            return out;
          })(),
          (async () => {
            const ps = await getPatients();
            const out: any[] = [];
            for (const p of ps) {
              if (p.id == null) continue;
              out.push(...(await getMedications(p.id)));
            }
            return out;
          })(),
        ]);
        await runInitialSync(allApps, allMeds, pats);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setSyncError(null);
    await disablePhoneReminders();
    setState(await getCurrentPhoneReminderState());
    await refreshDiagnostics();
    setBusy(false);
  };

  const handleRecheck = async () => {
    setBusy(true);
    setState(await getCurrentPhoneReminderState());
    await refreshDiagnostics();
    setBusy(false);
  };

  if (state.status === "unsupported") {
    // Even when unsupported we render a small card on iOS so the user can see
    // *why* (e.g., not yet added to Home Screen).
    if (!diagnostics.isIOS) return null;
  }

  const iosNeedsHomeScreen = diagnostics.isIOS && !diagnostics.isStandalone;
  const isErrorState =
    state.status === "error" ||
    state.status === "permission-denied" ||
    state.status === "unsupported" ||
    state.status === "not-configured" ||
    !!syncError;

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
              Push notifications aren't available in this browser.
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
            Phone reminders aren't configured for this build yet.
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
                    On iPhone, web push only works from a{" "}
                    <strong>Home Screen web app</strong>. Open the app from its
                    Home Screen icon (not Safari) and try Enable again.
                  </li>
                  <li>
                    If you don't see this app under{" "}
                    <em>Settings &rsaquo; Notifications</em>, remove the existing
                    Home Screen icon, open the site in Safari, tap Share &rsaquo;{" "}
                    <strong>Add to Home Screen</strong>, then launch from the new icon.
                  </li>
                </ul>
              ) : (
                <p className="text-foreground/80">
                  Open your browser's site settings for this page and reset
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
                  On iPhone, push notifications only work after you{" "}
                  <strong>Add to Home Screen</strong> (Safari Share menu) and
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
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Setting up this device…
          </div>
        )}

        {state.status === "subscribed" && (
          <>
            <div className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-foreground font-medium">
                  Phone reminders are on for this device.
                </p>
                <p className="text-muted-foreground">
                  You'll get a push notification for upcoming appointments and
                  medication refills, even when the app is closed. Add or change
                  reminders in Appointments and Medications and they'll sync
                  automatically.
                </p>
              </div>
            </div>
            {syncError && (
              <div className="flex items-start gap-2 text-[11px] text-destructive bg-destructive/5 rounded p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <p>
                  We couldn't save your latest reminders to the reminder service.
                  They're saved on this device, and we'll retry next time the app
                  is open. If this keeps happening, open the troubleshooting
                  details below.
                </p>
              </div>
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
            <div className="space-y-2">
              <p>
                We couldn't finish setting up phone reminders on this device.
              </p>
              <p className="text-foreground/80">
                {state.stage ? `Step: ${state.stage}. ` : ""}
                {state.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEnable}
                disabled={busy}
                data-testid="button-retry-phone-reminders"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
                Try again
              </Button>
            </div>
          </div>
        )}

        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="pt-1 border-t border-border/40"
        >
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground gap-1"
                data-testid="button-toggle-phone-reminders-diagnostics"
              >
                {advancedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {isErrorState ? "Troubleshooting details" : "Show technical details"}
              </Button>
            </CollapsibleTrigger>
            {advancedOpen && (
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
            )}
          </div>
          <CollapsibleContent>
            <DiagnosticsDetails diagnostics={diagnostics} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
