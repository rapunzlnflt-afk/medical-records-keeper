// MedRecords Care entitlement.
//
// Care is a tier above Max: a Lemon Squeezy key on a Care price option
// (see CARE_VARIANT_IDS in plan.ts) unlocks it, together with everything in Max.
// Grandfathered phones also get Care for good (see computeCare in plan.ts).
//
// Care launched on 2026-10-30. The old owner preview switch (5 taps on the Max
// page title) was removed; any leftover preview flag is cleared on load.

import { useSyncExternalStore } from "react";
import { getPlan, hasCareLicense, subscribePlan, CARE_VARIANT_IDS } from "./plan";

/** Care is on sale: everyone sees the Care card on the Max page. */
export const CARE_ON_SALE = true;

/** Care Monthly price option, preselected; the checkout also lists Care Yearly. */
export const CARE_BUY_URL =
  "https://cleartrackapps.lemonsqueezy.com/checkout/buy/aed5235d-4f96-402a-b722-29dbd1dc6c53";

// Clear the retired preview flag so it can't unlock anything.
try {
  if (typeof window !== "undefined") localStorage.removeItem("mrCarePreview");
} catch {
  /* ignore */
}

export function hasCare(): boolean {
  return hasCareLicense();
}

/** Care key or grandfathered phone. Re-renders when the plan changes. */
export function useCare(): boolean {
  return useSyncExternalStore(subscribePlan, () => hasCareLicense());
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
