// Save a JSON backup in the most user-visible way the current device offers.
//
// Why this exists: iOS Safari (and standalone PWAs installed to the home
// screen) ignore the `download` attribute on <a> elements. A blob-URL anchor
// click on iPhone navigates the current tab to raw JSON or does nothing
// obvious — no Save sheet appears, no file lands in the Files app. That's
// the bug the user hit: they tapped "Save My Data" expecting a file in
// iOS Files, but the browser had nowhere to put it.
//
// The fix is to feed the JSON to navigator.share({ files: [File] }) when
// the platform supports it. iOS shows the native share sheet, which
// includes "Save to Files", "Mail", "AirDrop", iCloud Drive, etc. — the
// same UX pawfolio uses. Desktop browsers and Android Chrome fall back to
// the existing anchor-download path, which already works for them.

export type SaveBackupOutcome =
  | { kind: "shared" }            // iOS / Android share sheet completed
  | { kind: "downloaded" }        // Desktop / Android anchor download fired
  | { kind: "cancelled" }         // User dismissed the share sheet
  | { kind: "failed"; error: unknown };

interface SaveBackupOptions {
  filename: string;       // e.g. "medical-records-backup-2026-05-12.json"
  json: string;           // already-stringified payload
  shareTitle?: string;    // shown on the share sheet
  shareText?: string;     // optional descriptive text
}

export async function saveJsonBackup(opts: SaveBackupOptions): Promise<SaveBackupOutcome> {
  const { filename, json, shareTitle = "Medical Records Backup", shareText } = opts;
  const blob = new Blob([json], { type: "application/json" });

  // Prefer the native share sheet when available — this is the iOS path.
  // Wrap the blob in a real File so iOS shows it as an attachment with a
  // proper name in Save to Files / Mail / AirDrop / Messages.
  const file = new File([blob], filename, { type: "application/json" });
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle,
        ...(shareText ? { text: shareText } : {}),
      });
      return { kind: "shared" };
    } catch (err) {
      // User cancelled — Safari throws AbortError. Treat as a normal cancel
      // so the caller can show a neutral message instead of an error toast.
      if (err instanceof DOMException && err.name === "AbortError") {
        return { kind: "cancelled" };
      }
      // Anything else: fall through to the anchor-download path below
      // rather than failing outright, so the user still gets a chance.
    }
  }

  // Anchor-download fallback. Works on desktop browsers and Android Chrome.
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Don't revoke immediately — some Safari versions invalidate the blob
    // before the download starts. One minute is plenty.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { kind: "downloaded" };
  } catch (err) {
    return { kind: "failed", error: err };
  }
}

// True when the current device is iOS or iPadOS. Used to tailor the
// post-save toast wording ("Choose Save to Files" vs "Downloaded").
export function isIosLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac; detect via touch points.
  const isIpadOS = /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOS;
}
