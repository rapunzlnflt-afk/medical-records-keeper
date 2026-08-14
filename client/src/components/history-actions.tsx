import { useState } from "react";
import { ClipboardCopy, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { copyHistoryText, formatHistoryText, formatHistoryDate, localTodayKey, type HistoryCopyDocument } from "@/lib/history-actions";

type HistoryActionsProps = {
  document: HistoryCopyDocument;
};

export function HistoryActions({ document }: HistoryActionsProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const text = formatHistoryText(document);

  const handleCopy = async () => {
    const result = await copyHistoryText(text);
    setStatus(result === "manual" ? "manual" : "copied");
  };

  return (
    <>
      <div className="no-print flex flex-wrap gap-2" data-testid="history-actions">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11 gap-2 px-4"
          onClick={handleCopy}
          data-testid="button-copy-for-doctor"
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          Copy for doctor
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11 gap-2 px-4"
          onClick={() => window.print()}
          data-testid="button-print-history"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print
        </Button>
      </div>
      {status === "copied" && (
        <p className="no-print text-sm font-medium text-green-700 dark:text-green-300" data-testid="text-copy-confirmation">
          Copied to clipboard.
        </p>
      )}
      {status === "manual" && (
        <div className="no-print space-y-2" data-testid="copy-fallback">
          <p className="text-sm font-medium text-foreground">Clipboard access is unavailable. Select and copy this text manually.</p>
          <Textarea readOnly value={text} className="min-h-36 text-sm" aria-label="History text to copy manually" data-testid="textarea-copy-fallback" />
        </div>
      )}
    </>
  );
}

export function HistoryPrintHeading({ document }: HistoryActionsProps) {
  return (
    <div className="print-history-heading" data-testid="print-history-heading">
      <h1>{document.title}</h1>
      <p>{document.profileName}</p>
      <p>Filter: {document.filterLabel}</p>
      <p>Printed {formatHistoryDate(localTodayKey())}</p>
    </div>
  );
}
