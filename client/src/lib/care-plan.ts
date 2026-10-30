// MedRecords Care entitlement.
//
// Care is a tier above Max: a Lemon Squeezy key on a Care price option
// (see CARE_VARIANT_IDS in plan.ts) unlocks it, together with everything in Max.
//
// Care launched on 2026-10-30. The owner's test switch remains: tap the
// "MedRecords" title on the Max page 5 times to turn Care on or off for one
// device without a key (works inside an installed iPhone home-screen app).
// The old ?carepreview=1 link is gone; ?carepreview=0 still clears it.

import { useSyncExternalStore } from "react";
import { getPlan, hasCareLicense, subscribePlan, CARE_VARIANT_IDS } from "./plan";

const PREVIEW_KEY = "mrCarePreview";

/** Care is on sale: everyone sees the Care card on the Max page. */
export const CARE_ON_SALE = true;

/** Care Monthly price option, preselected; the checkout also lists Care Yearly. */
export const CARE_BUY_URL =
  "https://cleartrackapps.lemonsqueezy.com/checkout/buy/aed5235d-4f96-402a-b722-29dbd1dc6c53";
const listeners = new Set<() => void>();

function readPreview(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("carepreview");
    if (q === "0") localStorage.removeItem(PREVIEW_KEY);
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

let snapshot = typeof window !== "undefined" ? readPreview() : false;

/** Turn the preview on or off for this device (the hidden 5-tap switch). */
export function setCarePreview(on: boolean) {
  try {
    if (on) localStorage.setItem(PREVIEW_KEY, "1");
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    /* ignore */
  }
  snapshot = on;
  listeners.forEach((l) => l());
}

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
