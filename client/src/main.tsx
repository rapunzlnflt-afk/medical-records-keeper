import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { decidePlan, keyFromUrl, PENDING_KEY, revalidate } from "./lib/plan";

// A receipt link can carry the license key (?key=...). It's taken out of the
// address bar straight away and handed to the MedRecords Max page.
const handedKey = keyFromUrl();
if (handedKey) {
  try {
    sessionStorage.setItem(PENDING_KEY, handedKey);
  } catch {
    /* ignore */
  }
  window.location.hash = "#/max";
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Settle Free vs Max (and grandfathering) before the first paint, so an
// existing user never sees a Max lock flash up. Never wait more than 1.5s.
const settle = Promise.race([decidePlan().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
settle.then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
  revalidate(false);
});
