// MedRecords Max: what it adds, how to get it, and where a key goes.

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MaxTag } from "@/components/max-lock";
import { useCare, CARE_ON_SALE, CARE_BUY_URL } from "@/lib/care-plan";
import { activateKey, hasCareLicense, BUY_URL, ORDERS_URL, PENDING_KEY, removeKey, revalidate, usePlan } from "@/lib/plan";

const FREE = [
  "Medications, dose reminders and dose history",
  "Appointments, doctors, pharmacies and emergency contacts",
  "Insurance cards, notes and printing",
  "Up to 6 family members",
  "Backup and export",
];

const MAX = [
  "Share doses with a caregiver",
  "Medical Records: lab results, scans and documents",
  "Vitals",
  "Timeline",
  "Visit notes for past appointments",
];

const CARE = [
  "Daily care log: meals and snacks, PT and OT, bathing, changing clothes and cleaning",
  "Mood from 1 to 10 and awareness, each with notes",
  "Mark anything the patient declined",
  "Caregivers log from their own phone and see each other's entries",
  "Conditions shared with caregivers",
];

function niceDate(iso?: string | null) {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return null;
  }
}

export default function MaxPage() {
  const plan = usePlan();
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const submit = async (k = key) => {
    setBusy(true);
    setError(null);
    const r = await activateKey(k);
    setBusy(false);
    if (r.ok) {
      setKey("");
      toast({ title: hasCareLicense() ? "MedRecords Care is on" : "MedRecords Max is on", description: "Thanks for supporting MedRecords." });
    } else setError(r.message || "That key wasn't recognized.");
  };

  // A key handed over from the receipt link (?key=...) is tried once, automatically.
  useEffect(() => {
    let k: string | null = null;
    try {
      k = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    if (k && !autoTried.current && !plan.max) {
      autoTried.current = true;
      setKey(k);
      submit(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Care is visible (preview on or a Care key). Before launch nobody else sees Care wording.
  const careOn = useCare();
  const keyOk = plan.max && !!plan.key && plan.status === "active";
  const lapsed = !!plan.key && (plan.status !== "active" || (!plan.max && !plan.grandfathered));
  // Paste a key: anyone without a key yet, plus grandfathered people once Care
  // is visible (they keep Max for free but can buy Care).
  // The Care card: everyone once Care is on sale, preview devices before that.
  const showCare = CARE_ON_SALE || careOn;
  // A paid Max subscriber switches plans in Lemon Squeezy instead of buying again.
  const maxSubscriber = keyOk && !plan.care;
  const showKeyBox = !plan.care && (!plan.max || (plan.grandfathered && careOn && !keyOk) || lapsed);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl w-full min-w-0 overflow-x-hidden" data-testid="page-max">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary -ml-1 px-1 py-1.5"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="min-w-0">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          MedRecords <MaxTag />
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1.5">
          MedRecords Free never runs out. Max adds caregiver sharing and deeper records. No ads on either plan, and your
          records stay on your phone.
        </p>
      </div>

      {plan.max ? (
        <Card className="border-primary/25 bg-primary/5" data-testid="card-max-status">
          <CardContent className="p-4 sm:p-5 space-y-2">
            <p className="font-heading text-lg font-semibold flex items-center gap-2">
              <Check className="w-5 h-5 text-primary" /> {plan.care ? "You have MedRecords Care" : "You have MedRecords Max"}
            </p>
            {plan.care && (
              <p className="text-sm text-muted-foreground" data-testid="text-care-included">
                Care includes everything in Max, plus the shared care log.
              </p>
            )}
            {plan.grandfathered && !plan.key ? (
              <p className="text-sm text-muted-foreground">
                You were using MedRecords before Max existed, so it's yours for good. Thank you for being here early.
              </p>
            ) : (
              <>
                {plan.grandfathered && (
                  <p className="text-sm text-muted-foreground">Max stays yours for good, even without a key.</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {plan.plan ? `${plan.plan} plan. ` : ""}
                  {niceDate(plan.expiresAt) ? `Paid through ${niceDate(plan.expiresAt)}. ` : ""}
                  Manage or cancel any time from My Orders at Lemon Squeezy.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <a href={ORDERS_URL} target="_blank" rel="noopener noreferrer">
                      My Orders <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="button-remove-key"
                    onClick={async () => {
                      await removeKey();
                      toast({ title: "Key removed from this device", description: "Your records are still here." });
                    }}
                  >
                    Remove key from this device
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    data-testid="button-check-plan"
                    onClick={async () => {
                      setBusy(true);
                      await revalidate(true);
                      setBusy(false);
                      toast({ title: "Plan checked", description: hasCareLicense() ? "You have MedRecords Care." : "You have MedRecords Max." });
                    }}
                  >
                    {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Check my plan
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-testid="card-plan-free">
          <CardContent className="p-4 sm:p-5">
            <p className="font-heading text-lg font-semibold">MedRecords Free</p>
            <p className="mt-1">
              <span className="font-heading text-2xl font-bold">$0</span>{" "}
              <span className="text-sm text-muted-foreground">forever</span>
            </p>
            <p className="text-sm text-muted-foreground">No card and no ads, ever.</p>
            <ul className="mt-3 space-y-1.5">
              {FREE.map((f) => (
                <li key={f} className="flex gap-2 text-sm">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-primary/40" data-testid="card-plan-max">
          <CardContent className="p-4 sm:p-5">
            <p className="font-heading text-lg font-semibold">
              MedRecords <MaxTag />
            </p>
            <p className="mt-1">
              <span className="font-heading text-2xl font-bold">$4.99</span>{" "}
              <span className="text-sm text-muted-foreground">a month</span>
            </p>
            <p className="text-sm text-muted-foreground">or $29.99 a year. Cancel any time.</p>
            <ul className="mt-3 space-y-1.5">
              <li className="flex gap-2 text-sm font-medium">
                <span className="w-4 text-center flex-shrink-0 text-primary">+</span>
                <span>Everything in Free</span>
              </li>
              {MAX.map((f) => (
                <li key={f} className="flex gap-2 text-sm">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {!plan.max && (
              <Button asChild className="mt-4 w-full gradient-primary text-white border-none" data-testid="button-buy-max">
                <a href={BUY_URL} target="_blank" rel="noopener noreferrer">
                  {lapsed ? "Renew MedRecords Max" : "Get MedRecords Max"}
                </a>
              </Button>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              One key works on up to 3 devices. Yearly plans can be refunded within 30 days. If you stop paying, your
              records stay visible, printable and exportable.
            </p>
          </CardContent>
        </Card>
      </div>

      {showCare && (
        <Card className="border-primary/40" data-testid="card-plan-care">
          <CardContent className="p-4 sm:p-5">
            <p className="font-heading text-lg font-semibold">MedRecords Care</p>
            <p className="mt-1">
              <span className="font-heading text-2xl font-bold">$7.99</span>{" "}
              <span className="text-sm text-muted-foreground">a month</span>
            </p>
            <p className="text-sm text-muted-foreground">or $49.99 a year. Cancel any time. Caregivers join free.</p>
            <ul className="mt-3 space-y-1.5">
              <li className="flex gap-2 text-sm font-medium">
                <span className="w-4 text-center flex-shrink-0 text-primary">+</span>
                <span>Everything in Max</span>
              </li>
              {CARE.map((f) => (
                <li key={f} className="flex gap-2 text-sm">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {plan.care ? (
              <p className="mt-4 text-sm font-medium text-primary flex items-center gap-1.5" data-testid="text-care-current">
                <Check className="w-4 h-4" /> This is your plan
              </p>
            ) : maxSubscriber ? (
              <div className="mt-4 space-y-2" data-testid="care-upgrade-steps">
                <p className="text-sm font-medium">Switch your Max plan to Care</p>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
                  <li>Open My Orders and sign in with the email you used to buy Max.</li>
                  <li>Open your MedRecords Max subscription, tap the three dots, then Update.</li>
                  <li>Pick Care Monthly or Care Yearly and tap Save. You only pay the difference.</li>
                  <li>Come back here and tap Check my plan. Your key stays the same.</li>
                </ol>
                <Button asChild className="w-full gradient-primary text-white border-none" data-testid="button-upgrade-care">
                  <a href={ORDERS_URL} target="_blank" rel="noopener noreferrer">
                    Open My Orders <ExternalLink className="w-3.5 h-3.5 ml-1" />
                  </a>
                </Button>
              </div>
            ) : (
              <Button asChild className="mt-4 w-full gradient-primary text-white border-none" data-testid="button-buy-care">
                <a href={CARE_BUY_URL} target="_blank" rel="noopener noreferrer">
                  Get MedRecords Care
                </a>
              </Button>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              One key works on up to 3 devices. Yearly plans can be refunded within 30 days. If you stop paying, your
              records stay visible, printable and exportable.
            </p>
          </CardContent>
        </Card>
      )}

      {showKeyBox && (
        <Card data-testid="card-enter-key">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <p className="font-heading text-base font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Already have a key?
            </p>
            <p className="text-sm text-muted-foreground">
              {lapsed
                ? "Your plan isn't active right now. After you renew, tap Check again."
                : plan.grandfathered
                  ? "Bought MedRecords Care? Paste the license key from your receipt email."
                  : "Paste the license key from your receipt email."}
            </p>
            {lapsed ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await revalidate(true);
                  setBusy(false);
                }}
                data-testid="button-recheck"
              >
                {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Check again
              </Button>
            ) : (
              <form
                className="flex flex-col sm:flex-row gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                  aria-label="License key"
                  data-testid="input-license-key"
                />
                <Button type="submit" disabled={busy || !key.trim()} data-testid="button-activate-key">
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Activate
                </Button>
              </form>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="text-key-error">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
