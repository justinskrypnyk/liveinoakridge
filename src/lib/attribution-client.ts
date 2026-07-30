// First-touch campaign attribution -- captures UTM params + Google's gclid
// from the landing URL once, persists them in localStorage (real estate
// decisions take months, so this deliberately never expires or gets
// overwritten by a later visit), and every lead-capture form's fetch()
// submit handler merges the stored values into its POST body so Justin can
// see which specific campaign/keyword actually produced a given lead,
// not just "Google Ads" in aggregate.
const STORAGE_KEY = 'attribution_v1';
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;

export function captureAttribution(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return; // first touch already recorded

    const params = new URLSearchParams(window.location.search);
    const attribution: Record<string, string> = {};
    for (const field of FIELDS) {
      const value = params.get(field);
      if (value) attribution[field] = value;
    }
    if (Object.keys(attribution).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    }
  } catch {
    // localStorage can throw in private-browsing/blocked-storage contexts --
    // attribution is a nice-to-have, never worth breaking the page over.
  }
}

export function getStoredAttribution(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
