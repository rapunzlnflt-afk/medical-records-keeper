// MedRecords Care entitlement.
//
// Care is a tier above Max: a Lemon Squeezy key on a Care price option
// (see CARE_VARIANT_IDS in plan.ts) unlocks it, together with everything in Max.
//
// Until launch the Care options are switched off in the store, so nobody can
// buy them. For testing, the preview switch still turns Care on for one
// device: open the app once with ?carepreview=1 (or ?carepreview=0 to turn it
// off). Remove the preview at launch.

import { useSyncExternalStore } from "react";
import { getPlan, hasCareLicense, subscribePlan, CARE_VARIANT_IDS } from "./plan";

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
  return snapshot || hasCareLicense();
}

/** Preview on, or a Care key. Re-renders when either changes. */
export function useCare(): boolean {
  const preview = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  const licensed = useSyncExternalStore(subscribePlan, () => hasCareLicense());
  return preview || licensed;
}

/** True when the saved key is on a Care price option (active or not). */
export function keyIsCare(): boolean {
  return CARE_VARIANT_IDS.includes(Number(getPlan().variantId));
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
