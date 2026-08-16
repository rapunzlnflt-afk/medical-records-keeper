import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { BellRing, AlertTriangle, Loader2, ChevronDown, ChevronRight, RefreshCw, CheckCircle2, Pencil } from "lucide-react";
import {
  detectPhoneReminderState,
  enablePhoneReminders,
  disablePhoneReminders,
  getCurrentPhoneReminderState,
  syncRemindersToSupabase,
  collectPhoneReminderDiagnostics,
  requestRemindersSync,
  getDailyMedsNudge,
  setDailyMedsNudge,
  formatLocalTimeLabel,
  DAILY_MEDS_NUDGE_DEFAULTS,
  type DailyMedsNudgeSettings,
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
  // null = follow the default (open only when something needs attention); once the
  // user taps the header we respect their choice for the rest of the session.
  const [manualCardOpen, setManualCardOpen] = useState<boolean | null>(null);
  // Daily "log today's meds?" nudge. Off by default; the rule lives in
  // Supabase per device so the server keeps sending while the app is closed.
  const [nudge, setNudge] = useState<DailyMedsNudgeSettings>(DAILY_MEDS_NUDGE_DEFAULTS);
  const [nudgeLoaded, setNudgeLoaded] = useState(false);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  // Last value known to be persisted, so the time field can be edited freely
  // (including transiently empty) and only committed when it's valid.
  const savedNudgeRef = useRef<DailyMedsNudgeSettings>(DAILY_MEDS_NUDGE_DEFAULTS);
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

  // Load the saved rule once this device is actually subscribed.
  useEffect(() => {
    if (!subscribed) {
      setNudgeLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const saved = await getDailyMedsNudge();
      if (cancelled) return;
      savedNudgeRef.current = saved;
      setNudge(saved);
      setNudgeLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [subscribed]);

  const saveNudge = useCallback(async (next: DailyMedsNudgeSettings) => {
    const previous = nudge;
    setNudge(next); // optimistic
    setNudgeBusy(true);
    setNudgeError(null);
    try {
      const saved = await setDailyMedsNudge(next);
      savedNudgeRef.current = saved;
      setNudge(saved);
    } catch (err: any) {
      setNudge(previous); // roll back so the control never lies about server state
      setNudgeError(err?.message ?? String(err));
    } finally {
      setNudgeBusy(false);
    }
  }, [nudge]);

  // Commit the time only once it's a complete, valid HH:MM. Native time inputs
  // report intermediate and empty values while the user is picking.
  const commitNudgeTime = useCallback(() => {
    const candidate = nudge.time;
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(candidate)) {
      setNudge({ ...nudge, time: savedNudgeRef.current.time }); // revert display
      return;
    }
    if (candidate === savedNudgeRef.current.time) return; // nothing changed
    void saveNudge({ ...nudge, time: candidate });
  }, [nudge, saveNudge]);

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

  const cardOpen = manualCardOpen ?? !subscribed;
  const setCardOpen = (open: boolean) => setManualCardOpen(open);

  /* One-line status summary shown in the collapsed header, so the card is readable
     without opening it. Tone drives the badge colour. */
  const summary: { label: string; line: string; tone: "on" | "off" | "warn" } =
    state.status === "subscribed"
      ? { label: "On", line: "Reminders will ring on this device.", tone: "on" }
      : state.status === "subscribing"
        ? { label: "Setting up", line: "Setting up this device…", tone: "off" }
        : state.status === "permission-denied"
          ? { label: "Blocked", line: "Notifications are blocked for this site.", tone: "warn" }
          : state.status === "unsupported"
            ? { label: "Unavailable", line: iosNeedsHomeScreen ? "Add to Home Screen to turn these on." : "Not available in this browser.", tone: "warn" }
            : state.status === "not-configured"
              ? { label: "Unavailable", line: "Not configured for this build yet.", tone: "warn" }
              : state.status === "error"
                ? { label: "Needs attention", line: "Setup didn't finish on this device.", tone: "warn" }
                : { label: "Off", line: "Get reminded on your phone, even when the app is closed.", tone: "off" };

  const badgeClass =
    summary.tone === "on"
      ? "bg-primary/10 text-primary border-primary/20"
      : summary.tone === "warn"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-500/20"
        : "bg-muted text-muted-foreground border-border";

  return (
    <Card data-testid="card-phone-reminders" className="overflow-hidden">
      <Collapsible open={cardOpen} onOpenChange={setCardOpen}>
        {/* Whole header is the tap target: icon tile, title, live status line, badge, chevron. */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-[60px] hover-elevate"
            data-testid="button-toggle-phone-reminders"
          >
            <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <BellRing className="w-4 h-4 text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-heading text-base font-semibold leading-tight">Phone Reminders</span>
                <Badge variant="outline" className={`text-[10px] font-semibold ${badgeClass}`}>
                  {summary.label}
                </Badge>
              </span>
              <span className="block text-xs text-muted-foreground mt-1 break-words" data-testid="text-phone-reminders-summary">
                {summary.line}
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform ${cardOpen ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            {state.status === "unsupported" && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
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
              <div className="flex items-start gap-2 text-xs rounded-md bg-destructive/5 p-3 text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-2 min-w-0">
                  <p className="font-medium">Notifications are blocked for this site.</p>
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
                <p className="text-sm text-muted-foreground">
                  We'll send a push for upcoming appointment reminders and medication
                  refills — even when this app is closed.
                </p>
                {iosNeedsHomeScreen && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
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
                  className="w-full h-11 gradient-primary text-white border-none"
                  data-testid="button-enable-phone-reminders"
                >
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BellRing className="w-4 h-4 mr-2" />}
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
                {/* "Turn off" lives in this block, right next to the on/off status,
                    instead of as a lone button at the bottom of the card. */}
                <div className="rounded-md bg-primary/5 p-3 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      On for this device
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisable}
                      disabled={busy}
                      // size="sm" applies min-h-8, so a bare h-7 gets floored at
                      // 2rem. min-h-7 has to come with it for the height to change.
                      className="min-h-7 h-7 px-2.5 flex-shrink-0 bg-background text-[11px] font-medium"
                      data-testid="button-disable-phone-reminders"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                      Turn off
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    Alerts you set in Appointments and Medications sync here automatically.
                  </p>
                </div>
                {syncError && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-md p-3">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <p>
                      We couldn't save your latest reminders to the reminder service.
                      They're saved on this device, and we'll retry next time the app
                      is open. If this keeps happening, open the troubleshooting
                      details below.
                    </p>
                  </div>
                )}
                <div
                  className="rounded-md border border-border/60 p-3 space-y-2"
                  data-testid="section-daily-meds-nudge"
                >
                  {/* The whole label is the tap target, giving a >=44px row. */}
                  <label
                    htmlFor="switch-daily-meds-nudge"
                    className="flex min-h-[44px] items-center justify-between gap-3 cursor-pointer"
                  >
                    <span className="min-w-0 text-sm font-medium text-foreground">
                      Daily reminder to log meds
                    </span>
                    <Switch
                      id="switch-daily-meds-nudge"
                      checked={nudge.enabled}
                      disabled={!nudgeLoaded || nudgeBusy}
                      onCheckedChange={(checked) => void saveNudge({ ...nudge, enabled: checked })}
                      className="flex-shrink-0"
                      data-testid="switch-daily-meds-nudge"
                    />
                  </label>

                  <p className="text-xs text-muted-foreground">
                    {nudge.enabled
                      ? `One reminder every day at ${formatLocalTimeLabel(savedNudgeRef.current.time)}, your time.`
                      : "One general reminder a day, at a time you pick."}{" "}
                    It doesn't name any medication.
                  </p>

                  {/* The time is editable, so the row says so and the field is styled
                      like a control rather than a read-only value. */}
                  {nudge.enabled && (
                    <div className="flex min-h-[44px] items-center gap-3">
                      <label
                        htmlFor="input-daily-meds-nudge-time"
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <span className="block text-xs font-medium text-foreground">Reminder time</span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Pencil className="w-3 h-3 flex-shrink-0" /> tap to change
                        </span>
                      </label>
                      <Input
                        id="input-daily-meds-nudge-time"
                        type="time"
                        value={nudge.time}
                        disabled={nudgeBusy}
                        onChange={(e) => setNudge({ ...nudge, time: e.target.value })}
                        onBlur={commitNudgeTime}
                        className="h-11 w-[7.5rem] flex-shrink-0 text-sm bg-background border-primary/40 font-medium"
                        data-testid="input-daily-meds-nudge-time"
                      />
                      {nudgeBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
                    </div>
                  )}

                  {nudgeError && (
                    <p className="text-xs text-destructive" data-testid="text-daily-meds-nudge-error">
                      We couldn't save this setting. It stays off until it saves.
                    </p>
                  )}
                </div>

              </>
            )}

            {state.status === "error" && (
              <div className="flex items-start gap-2 text-xs rounded-md bg-destructive/5 p-3 text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-2 min-w-0">
                  <p className="font-medium">
                    We couldn't finish setting up phone reminders on this device.
                  </p>
                  <p className="text-foreground/80 break-words">
                    {state.stage ? `Step: ${state.stage}. ` : ""}
                    {state.message}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnable}
                    disabled={busy}
                    className="h-10"
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
                    className="h-8 px-2 text-[11px] text-muted-foreground gap-1"
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
                    className="h-8 px-2 text-[11px] text-muted-foreground gap-1"
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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
