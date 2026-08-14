import { format } from "date-fns";

export type HistoryCopyBlock = {
  date: string;
  lines: string[];
};

export type HistoryCopyDocument = {
  title: string;
  profileName: string;
  filterLabel: string;
  blocks: HistoryCopyBlock[];
};

export type ClipboardCopyResult = "clipboard" | "legacy" | "manual";

export function localDateParts(value: string): { year: number; month: number; day: number } | null {
  const isoMatch = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
  }

  const usMatch = value.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (usMatch) {
    return { year: Number(usMatch[3]), month: Number(usMatch[1]), day: Number(usMatch[2]) };
  }

  return null;
}

export function localDateKey(value: string): string {
  const parts = localDateParts(value);
  if (!parts) return value.trim();
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function localSortKey(date: string, time?: string | null): number {
  const parts = localDateParts(date);
  if (!parts) return Number.NEGATIVE_INFINITY;
  const timeMatch = (time || "").trim().match(/^(\d{1,2}):(\d{1,2})/);
  const hours = timeMatch ? Math.min(23, Math.max(0, Number(timeMatch[1]))) : 0;
  const minutes = timeMatch ? Math.min(59, Math.max(0, Number(timeMatch[2]))) : 0;
  return new Date(parts.year, parts.month - 1, parts.day, hours, minutes, 0, 0).getTime();
}

export function formatHistoryDate(value: string): string {
  const parts = localDateParts(value);
  if (!parts) return value || "Date unavailable";
  return format(new Date(parts.year, parts.month - 1, parts.day), "EEEE, MMMM d, yyyy");
}

export function localTodayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function formatHistoryText(document: HistoryCopyDocument): string {
  const header = `${document.profileName} — ${document.title}\nFilter: ${document.filterLabel}`;
  if (document.blocks.length === 0) return `${header}\n\nNo history entries are currently visible.`;

  const blocks = document.blocks.map((block) => [block.date, ...block.lines].join("\n")).join("\n\n");
  return `${header}\n\n${blocks}`;
}

export async function copyHistoryText(text: string): Promise<ClipboardCopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    }
  } catch {
    // Older Safari and non-secure contexts continue through the legacy path.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  textarea.remove();
  return copied ? "legacy" : "manual";
}
