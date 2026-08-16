import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NoticeTone = "info" | "amber" | "red";

/**
 * Compact one-row notice used for the dashboard's dismissible prompts.
 *
 * These used to be full cards, so three of them stacking pushed real content
 * below the fold. This keeps them to a single slim strip. Only the urgent tones
 * get a tinted fill and an accent edge; informational notices stay plain so the
 * top of the dashboard doesn't fill up with colour.
 */
const TONES: Record<NoticeTone, { wrap: string; chip: string; icon: string }> = {
  info: {
    wrap: "border-border bg-card",
    chip: "bg-primary/10",
    icon: "text-primary",
  },
  amber: {
    wrap: "border-amber-500/30 border-l-2 border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
    chip: "bg-amber-500/15",
    icon: "text-amber-700 dark:text-amber-500",
  },
  red: {
    wrap: "border-destructive/30 border-l-2 border-l-destructive bg-destructive/5",
    chip: "bg-destructive/15",
    icon: "text-destructive",
  },
};

export function NoticeStrip({
  tone = "info",
  icon: Icon,
  title,
  body,
  action,
  onDismiss,
  dismissTitle = "Dismiss",
  testId,
}: {
  tone?: NoticeTone;
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
  dismissTitle?: string;
  testId?: string;
}) {
  const t = TONES[tone];
  return (
    <div className={`rounded-lg border px-3 py-2.5 min-w-0 ${t.wrap}`} data-testid={testId}>
      {/* Text row first. The action sits on its own line underneath rather than
          competing with the title for width, which at phone width squeezed the
          title down to one word per line. */}
      <div className="flex items-start gap-3 min-w-0">
        <span className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${t.chip}`}>
          <Icon className={`w-4 h-4 ${t.icon}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold leading-snug">{title}</p>
          {body ? (
            <p className="font-body text-xs text-muted-foreground leading-snug mt-0.5">{body}</p>
          ) : null}
        </div>
        {onDismiss ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            title={dismissTitle}
            aria-label={dismissTitle}
            className="min-h-7 h-7 w-7 flex-shrink-0 text-muted-foreground"
            data-testid={testId ? `${testId}-dismiss` : undefined}
          >
            <X className="w-4 h-4" />
          </Button>
        ) : null}
      </div>
      {action ? <div className="mt-2 pl-11 flex min-w-0">{action}</div> : null}
    </div>
  );
}

/** Shared sizing for the single action button inside a notice strip. */
export const NOTICE_ACTION_CLASS = "min-h-8 h-8 px-3 text-xs flex-shrink-0";
