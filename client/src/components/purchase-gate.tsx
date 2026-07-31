import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeartPulse, WifiOff, Loader2 } from "lucide-react";
import {
  GATE_ENABLED,
  checkStatus,
  hasExistingRecords,
  messageForReason,
  readUnlockFlag,
  requestGrandfather,
  verifyCode,
  writeUnlockFlag,
} from "@/lib/license";

const GUMROAD_URL = "https://cleartrackapps.gumroad.com/l/MedRecords";
const ETSY_URL = "https://www.etsy.com/listing/4487743018";
const DEMO_URL = "https://cleartrackapps.com/medical-records-demo/";
const HELP_EMAIL = "cleartrackapps@gmail.com";

type Phase = "checking" | "unlocked" | "locked";

export function PurchaseGate({ children }: { children: ReactNode }) {
  // Read the flag synchronously so an already-unlocked browser renders the app
  // on the first paint, with no network call and nothing to wait for.
  const [phase, setPhase] = useState<Phase>(() => {
    if (!GATE_ENABLED) return "unlocked";
    return readUnlockFlag() ? "unlocked" : "checking";
  });

  useEffect(() => {
    if (!GATE_ENABLED) return;

    const flag = readUnlockFlag();
    if (flag) {
      // Only worth talking to the server if it never confirmed this device.
      // This can add the device server-side but can never lock anyone out.
      if (flag.pending) {
        requestGrandfather()
          .then((res) => {
            if (res.ok) writeUnlockFlag(res.source ?? flag.source);
          })
          .catch(() => {});
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const existing = await hasExistingRecords();
      if (existing) {
        // An existing user gets in either way; the call is only so the server
        // knows about the device too.
        let source = writeUnlockFlag("existing_data", true).source;
        try {
          const res = await requestGrandfather();
          if (res.ok) source = res.source ?? source;
          writeUnlockFlag(source, !res.ok);
        } catch {
          // Offline or blocked — the local flag already let them in.
        }
        if (!cancelled) setPhase("unlocked");
        return;
      }

      // No local flag and no data, but this device may already be activated
      // (a reinstall, or the same device after clearing site data).
      try {
        const res = await checkStatus();
        if (res.ok) {
          writeUnlockFlag(res.source ?? "code");
          if (!cancelled) setPhase("unlocked");
          return;
        }
      } catch {
        // Offline — fall through to the unlock screen, which says so.
      }
      if (!cancelled) setPhase("locked");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "unlocked") return <>{children}</>;
  if (phase === "checking") return <GateSpinner />;
  return <UnlockScreen onUnlocked={() => setPhase("unlocked")} />;
}

function GateSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await verifyCode(trimmed);
      if (res.ok) {
        writeUnlockFlag(res.source ?? "code");
        onUnlocked();
        return;
      }
      setError(messageForReason(res.reason));
    } catch {
      setError("Couldn't reach the server. Check your internet connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-8 px-6">
          <div className="text-center mb-6">
            <HeartPulse className="w-10 h-10 mx-auto text-primary mb-3" />
            <h1 className="font-heading text-xl font-bold gradient-text">Medical Records Keeper</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Enter your key or code to unlock this app on this device.
            </p>
          </div>

          {!online && (
            <div className="flex gap-3 rounded-md border border-border bg-muted/50 p-3 mb-5">
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                You're offline. The first unlock needs an internet connection. After that, the app
                works offline forever.
              </p>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Your key or code"
              aria-label="Your key or code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={submitting}
              data-testid="input-license-code"
            />
            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="text-license-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full gradient-primary text-white border-none"
              disabled={submitting || !code.trim()}
              data-testid="button-unlock"
            >
              {submitting ? "Checking…" : "Unlock"}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border space-y-3 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Where do I find it?</span> If you bought
              on Gumroad, your purchase email contains a licence key. If you bought on Etsy, your code
              is in the download that came with your order.
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <a className="text-primary hover:underline" href={GUMROAD_URL} target="_blank" rel="noreferrer">
                Buy on Gumroad
              </a>
              <a className="text-primary hover:underline" href={ETSY_URL} target="_blank" rel="noreferrer">
                Buy on Etsy
              </a>
              <a className="text-primary hover:underline" href={DEMO_URL} target="_blank" rel="noreferrer">
                Try the free demo
              </a>
              <a className="text-primary hover:underline" href={`mailto:${HELP_EMAIL}`}>
                Get help
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
