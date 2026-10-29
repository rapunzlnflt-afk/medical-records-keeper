// MedRecords Care entitlement.
//
// Care is a new tier above Max. Until its price and store product exist,
// Care ships dark: nobody sees it unless this device has the preview switch
// on. Open the app once with ?carepreview=1 to turn it on, ?carepreview=0 to
// turn it off. When Care launches, hasCare() gains a real license check and
// the preview switch goes away.

import { useSyncExternalStore } from "react";

const PREVIEW_KEY = "mrCarePreview";
const listeners = new Set<() => void>();

function readPreview(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("carepreview");
    if (q === "1") localStorage.setItem(PREVIEW_KEY, "1");
    if (q === "0") localStorage.removeItem(PREVIEW_KEY);
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

let snapshot = typeof window !== "undefined" ? readPreview() : false;

export function hasCare(): boolean {
  return snapshot;
}

export function useCare(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

const NAME_KEY = "mrCareLoggedBy";
/** The first name this device logs care entries under. */
export function getLoggerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}
export function setLoggerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* ignore */
  }
}
