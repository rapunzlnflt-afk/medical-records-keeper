// The card a Free (or lapsed) person sees where a MedRecords Max feature
// would be. Records never disappear: a lapsed plan keeps them visible,
// printable and exportable, and only adding new ones stops.

import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/plan";

export function MaxTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block align-[0.08em] rounded-full bg-primary px-[0.48em] pt-[0.26em] pb-[0.22em] text-[0.72em] font-extrabold uppercase leading-none tracking-wider text-primary-foreground ${className}`}
    >
      Max
    </span>
  );
}

export function MaxLockCard({
  feature,
  pitch,
  hasRecords = false,
  testId,
}: {
  /** e.g. "Vitals" */
  feature: string;
  /** One short sentence on what the feature does. */
  pitch: string;
  /** True when this person already has records here (lapsed plan). */
  hasRecords?: boolean;
  testId?: string;
}) {
  const plan = usePlan();
  const lapsed = plan.status === "lapsed" || (plan.status === "active" && !plan.max);
  return (
    <Card className="border-primary/25 bg-primary/5" data-testid={testId ?? "card-max-lock"}>
      <CardContent className="p-4 sm:p-5">
        <p className="flex items-center gap-2 font-heading text-base font-semibold text-primary">
          <Sparkles className="h-4 w-4 flex-shrink-0" />
          <span>
            {feature} is part of MedRecords <MaxTag />
          </span>
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          {lapsed
            ? `Your MedRecords Max plan isn't active right now.${hasRecords ? " Everything you saved here stays here to view, print and export." : ""} Renew to add new entries.`
            : pitch}
        </p>
        <Button asChild size="sm" className="mt-3 gradient-primary text-white border-none" data-testid="button-see-max">
          <Link href="/max">{lapsed ? "Renew MedRecords Max" : "See MedRecords Max"}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
