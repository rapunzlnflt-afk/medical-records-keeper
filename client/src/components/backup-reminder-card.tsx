import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { NoticeStrip, NOTICE_ACTION_CLASS } from "@/components/notice-strip";
import { useToast } from "@/hooks/use-toast";
import { exportAllData } from "@/lib/db";
import { saveJsonBackup, isIosLike } from "@/lib/save-backup";
import { Save, X, ShieldAlert, Info } from "lucide-react";

const LAST_EXPORT_KEY = "mrkLastExport";
const FIRST_SEEN_KEY = "mrkFirstSeen";
const SEEN_WELCOME_KEY = "mrkSeenWelcome";
const SNOOZED_KEY = "mrkBackupSnoozed";

const todayISO = () => new Date().toISOString().slice(0, 10);

type Urgency = "info" | "amber" | "red";

interface BannerState {
  show: boolean;
  urgency: Urgency;
  title: string;
  body: string;
  daysSince: number;
  hasEverExported: boolean;
}

function computeState(hasData: boolean): BannerState {
  if (!hasData) {
    return { show: false, urgency: "info", title: "", body: "", daysSince: 0, hasEverExported: false };
  }

  let firstSeen = localStorage.getItem(FIRST_SEEN_KEY);
  if (!firstSeen) {
    firstSeen = todayISO();
    localStorage.setItem(FIRST_SEEN_KEY, firstSeen);
  }

  const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
  const baseline = lastExport || firstSeen;
  const daysSince = Math.floor((Date.now() - new Date(baseline).getTime()) / 86400000);

  const snoozed = localStorage.getItem(SNOOZED_KEY);
  if (snoozed === todayISO()) {
    return { show: false, urgency: "info", title: "", body: "", daysSince, hasEverExported: !!lastExport };
  }
  if (daysSince < 3) {
    return { show: false, urgency: "info", title: "", body: "", daysSince, hasEverExported: !!lastExport };
  }

  let urgency: Urgency;
  let title: string;
  let body: string;
  if (daysSince >= 30) {
    urgency = "red";
    title = lastExport
      ? `It's been ${daysSince} days since your last backup`
      : "You haven't backed up your records yet";
    body = "Clearing browser data or uninstalling would erase your records.";
  } else if (daysSince >= 7) {
    urgency = "amber";
    title = lastExport
      ? `Time for a backup — ${daysSince} days since last export`
      : "Save a backup of your records";
    body = "Download a file you can re-import or move to another device.";
  } else {
    urgency = "info";
    title = "Save a backup of your records";
    body = `It's been ${daysSince} days since your last backup.`;
  }
  return { show: true, urgency, title, body, daysSince, hasEverExported: !!lastExport };
}

const URGENCY_BUTTON: Record<Urgency, string> = {
  info: "",
  amber: "bg-amber-600 hover:bg-amber-700 text-white",
  red: "bg-destructive hover:bg-destructive/90 text-white",
};

/**
 * Whether this notice wants the dashboard's single notice slot. Lets the
 * dashboard show one prompt at a time instead of stacking them.
 */
export function backupNoticeVisible(hasData: boolean): boolean {
  try {
    return computeState(hasData).show;
  } catch {
    return false;
  }
}

/** Same, for the first-visit notice below. */
export function firstVisitNoticeVisible(hasData: boolean): boolean {
  try {
    return hasData && !localStorage.getItem(SEEN_WELCOME_KEY);
  } catch {
    return false;
  }
}

export function BackupReminderCard({ hasData, onResolved }: { hasData: boolean; onResolved?: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<BannerState>(() => computeState(hasData));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setState(computeState(hasData));
  }, [hasData]);

  const handleExport = useCallback(async () => {
    setSaving(true);
    try {
      const data = await exportAllData();
      const filename = `medical-records-backup-${todayISO()}.json`;
      const outcome = await saveJsonBackup({
        filename,
        json: JSON.stringify(data, null, 2),
        // File only, no title or text: extras make iOS put message contacts
        // ahead of "Save to Files" in the share sheet.
        filesOnly: true,
      });
      if (outcome.kind === "shared" || outcome.kind === "downloaded") {
        localStorage.setItem(LAST_EXPORT_KEY, todayISO());
        localStorage.removeItem(SNOOZED_KEY);
        setState(computeState(hasData));
        onResolved?.();
      }
      if (outcome.kind === "shared") {
        // Fires after the share sheet completes, so keep it past tense.
        toast({
          title: "Backup saved",
          description: isIosLike()
            ? "Your backup went to the app you picked."
            : "Your backup went to the destination you chose.",
        });
      } else if (outcome.kind === "downloaded") {
        toast({ title: "Backup saved", description: `Downloaded ${filename}.` });
      } else if (outcome.kind === "cancelled") {
        toast({ title: "Save cancelled", description: "Your data is unchanged." });
      } else {
        toast({ title: "Error", description: "Could not save backup. Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not save backup. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [hasData, toast, onResolved]);

  const handleSnooze = useCallback(() => {
    localStorage.setItem(SNOOZED_KEY, todayISO());
    setState((s) => ({ ...s, show: false }));
    onResolved?.();
  }, [onResolved]);

  if (!state.show) return null;

  const Icon = state.urgency === "red" ? ShieldAlert : state.urgency === "amber" ? Save : Info;

  return (
    <NoticeStrip
      tone={state.urgency}
      icon={Icon}
      title={state.title}
      body={state.body}
      testId="card-backup-reminder"
      onDismiss={handleSnooze}
      dismissTitle="Remind me later"
      action={
        <Button
          size="sm"
          onClick={handleExport}
          disabled={saving}
          className={`${NOTICE_ACTION_CLASS} ${URGENCY_BUTTON[state.urgency]}`}
          data-testid="button-backup-export"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving..." : "Save Backup"}
        </Button>
      }
    />
  );
}

export function FirstVisitNoticeCard({ hasData, onResolved }: { hasData: boolean; onResolved?: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_WELCOME_KEY);
    setShow(!seen && hasData);
  }, [hasData]);

  if (!show) return null;

  return (
    <NoticeStrip
      icon={Save}
      title="Your records live on this device"
      body="Nothing is sent to a server, so back up every week or two."
      testId="card-first-visit-notice"
      action={
        <Button
          size="sm"
          className={NOTICE_ACTION_CLASS}
          onClick={() => {
            localStorage.setItem(SEEN_WELCOME_KEY, todayISO());
            setShow(false);
            onResolved?.();
          }}
          data-testid="button-first-visit-dismiss"
        >
          Got it
        </Button>
      }
    />
  );
}

// Helper exported for sidebar Save handler so it can record the export timestamp too.
export function recordBackupExport() {
  localStorage.setItem(LAST_EXPORT_KEY, todayISO());
  localStorage.removeItem(SNOOZED_KEY);
}
