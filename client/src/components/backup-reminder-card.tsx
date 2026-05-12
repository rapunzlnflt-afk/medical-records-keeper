import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    body = "Save a backup now so you don't lose your medical records if you uninstall the app or clear browser data.";
  } else if (daysSince >= 7) {
    urgency = "amber";
    title = lastExport
      ? `Time for a backup — ${daysSince} days since last export`
      : "Save a backup of your records";
    body = "Tap Save Backup to download a file you can re-import later or move to another device.";
  } else {
    urgency = "info";
    title = "Save a backup of your records";
    body = `It's been ${daysSince} days. Tap Save Backup to keep your records safe.`;
  }
  return { show: true, urgency, title, body, daysSince, hasEverExported: !!lastExport };
}

const URGENCY_STYLES: Record<Urgency, { border: string; bg: string; iconBg: string; iconText: string; button: string }> = {
  info:  { border: "border-l-4 border-l-primary",        bg: "bg-primary/5",           iconBg: "bg-primary/15",       iconText: "text-primary",         button: "" },
  amber: { border: "border-l-4 border-l-amber-500",      bg: "bg-amber-50 dark:bg-amber-950/20", iconBg: "bg-amber-500/15",     iconText: "text-amber-600 dark:text-amber-400", button: "bg-amber-600 hover:bg-amber-700 text-white" },
  red:   { border: "border-l-4 border-l-destructive",    bg: "bg-destructive/5",       iconBg: "bg-destructive/15",   iconText: "text-destructive",     button: "bg-destructive hover:bg-destructive/90 text-white" },
};

export function BackupReminderCard({ hasData }: { hasData: boolean }) {
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
        shareTitle: "Medical Records Backup",
        shareText: "My Medical Records Keeper backup file.",
      });
      if (outcome.kind === "shared" || outcome.kind === "downloaded") {
        localStorage.setItem(LAST_EXPORT_KEY, todayISO());
        localStorage.removeItem(SNOOZED_KEY);
        setState(computeState(hasData));
      }
      if (outcome.kind === "shared") {
        toast({
          title: "Backup ready",
          description: isIosLike()
            ? "Choose Save to Files (or Mail it to yourself) to keep it safe."
            : "Choose where to save your backup file.",
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
  }, [hasData, toast]);

  const handleSnooze = useCallback(() => {
    localStorage.setItem(SNOOZED_KEY, todayISO());
    setState((s) => ({ ...s, show: false }));
  }, []);

  if (!state.show) return null;

  const styles = URGENCY_STYLES[state.urgency];
  const Icon = state.urgency === "red" ? ShieldAlert : state.urgency === "amber" ? Save : Info;

  return (
    <Card className={`${styles.border} ${styles.bg}`} data-testid="card-backup-reminder">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`w-10 h-10 rounded-lg ${styles.iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-5 h-5 ${styles.iconText}`} />
          </div>
          <div className="flex-1 min-w-0 basis-full sm:basis-auto">
            <p className="font-heading text-sm font-bold">{state.title}</p>
            <p className="font-body text-xs text-muted-foreground mt-0.5 leading-relaxed">{state.body}</p>
          </div>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={saving}
            className={styles.button || ""}
            data-testid="button-backup-export"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saving ? "Saving..." : "Save Backup"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSnooze}
            title="Remind me later"
            className="h-8 w-8 flex-shrink-0"
            data-testid="button-backup-snooze"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FirstVisitNoticeCard({ hasData }: { hasData: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_WELCOME_KEY);
    setShow(!seen && hasData);
  }, [hasData]);

  if (!show) return null;

  return (
    <Card className="border-l-4 border-l-primary bg-primary/5" data-testid="card-first-visit-notice">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Save className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-heading text-sm font-bold">Your records live on this device</p>
            <p className="font-body text-xs text-muted-foreground mt-1 leading-relaxed">
              Medical Records Keeper saves your records locally on your phone or browser — nothing is sent to a server.
              If you uninstall the app or clear your browser data, your records will be lost.
              {" "}<strong>Tap Save Backup every week or two</strong> to download a file you can re-import later or move to another device.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                localStorage.setItem(SEEN_WELCOME_KEY, todayISO());
                setShow(false);
              }}
              data-testid="button-first-visit-dismiss"
            >
              Got it
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper exported for sidebar Save handler so it can record the export timestamp too.
export function recordBackupExport() {
  localStorage.setItem(LAST_EXPORT_KEY, todayISO());
  localStorage.removeItem(SNOOZED_KEY);
}
