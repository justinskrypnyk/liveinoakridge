// First-touch campaign attribution -- captures UTM params + Google's gclid
// from the landing URL once, persists them in localStorage (real estate
// decisions take months, so this deliberately never expires or gets
// overwritten by a later visit), and every lead-capture form's fetch()
// submit handler merges the stored values into its POST body so Justin can
// see which specific campaign/keyword actually produced a given lead,
// not just "Google Ads" in aggregate.
const STORAGE_KEY = 'attribution_v1';
// The visitor's journey, for every visitor rather than only tagged links
// (added 2026-09-27): where they first came from, the first page they saw,
// when, and how many separate visits before a form. Sent with every lead as
// first_referrer / first_page / first_seen / visits, plus lead_page (where
// the form was filled in), and shown on the GHL contact note (ghl-lead.ts).
const JOURNEY_KEY = 'journey_v1';
const SESSION_KEY = 'journey_session';

// "Where they came from", in words Justin and Smile can read at a glance.
function describeReferrer(ref: string, params: URLSearchParams): string {
  if (params.get('utm_medium') === 'email') return `Email${params.get('utm_campaign') ? ` (${params.get('utm_campaign')})` : ''}`;
  if (params.get('gclid') || params.get('utm_medium') === 'cpc') return 'Google Ads';
  if (params.get('fbclid')) return 'Facebook / Instagram';
  let host = '';
  try {
    host = ref ? new URL(ref).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  if (!host || host === window.location.hostname.replace(/^www\./, '')) return 'Direct (typed in, bookmark or app)';
  if (/(^|\.)google\./.test(host)) return 'Google search';
  if (/(^|\.)bing\.com$/.test(host)) return 'Bing search';
  if (/duckduckgo|yahoo|ecosia/.test(host)) return `Search engine (${host})`;
  if (/facebook|fb\.com|instagram/.test(host)) return 'Facebook / Instagram';
  if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot/.test(host)) return `AI assistant (${host})`;
  return `Another website (${host})`;
}

function captureJourney(): void {
  const now = new Date().toISOString().slice(0, 10);
  let journey = JSON.parse(localStorage.getItem(JOURNEY_KEY) || 'null');
  if (!journey) {
    journey = {
      first_referrer: describeReferrer(document.referrer, new URLSearchParams(window.location.search)),
      first_page: window.location.pathname,
      first_seen: now,
      visits: 0,
    };
  }
  // One visit per browser session (a new tab or window after closing counts again).
  if (!sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, '1');
    journey.visits = (Number(journey.visits) || 0) + 1;
  }
  recordSignals(journey, now);
  localStorage.setItem(JOURNEY_KEY, JSON.stringify(journey));
}

// Buying signals for hot-lead scoring (2026-09-29): which listings they've
// opened, how many filtered searches, which days they came, and whether
// they've used the seller tools. Sent with every lead as `signals` and
// scored in lead-score.ts. Only page addresses and dates -- never anything
// typed.
const LISTING_PATH = /^\/search\/([A-Za-z0-9]{5,20})\/?$/;
const SOLD_PATH = /^\/sold-map\/([A-Za-z0-9]{5,20})\/?$/;
const SEARCH_FILTERS = ['area', 'minPrice', 'maxPrice', 'types', 'minBeds', 'minBaths', 'q'];
function recordSignals(journey: any, today: string): void {
  const s = (journey.sig ||= { listings: [], solds: [], days: [], searches: 0, pages: 0, valueTool: 0, soldMap: 0 });
  const addOnce = (list: string[], value: string, cap: number) => {
    if (!list.includes(value)) list.push(value);
    if (list.length > cap) list.splice(0, list.length - cap);
  };
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  s.pages += 1;
  addOnce(s.days, today, 60);
  const listing = path.match(LISTING_PATH)?.[1];
  if (listing) addOnce(s.listings, listing.toUpperCase(), 100);
  const sold = path.match(SOLD_PATH)?.[1];
  if (sold) addOnce(s.solds, sold.toUpperCase(), 100);
  if (/^\/search\/?$/.test(path) && SEARCH_FILTERS.some((k) => params.get(k)) && (!params.get('page') || params.get('page') === '1')) s.searches += 1;
  if (/^\/home-value-estimate\/?$/.test(path)) s.valueTool = 1;
  if (/^\/(sold-map|market-map)\/?$/.test(path)) s.soldMap = 1;
}
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;

export function captureAttribution(): void {
  try {
    captureJourney();
  } catch {
    // storage blocked -- the journey is a nice-to-have
  }
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
  const out: Record<string, string> = {};
  try {
    Object.assign(out, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    const journey = JSON.parse(localStorage.getItem(JOURNEY_KEY) || 'null');
    if (journey) {
      for (const k of ['first_referrer', 'first_page', 'first_seen', 'visits']) if (journey[k] != null) out[k] = String(journey[k]);
      if (journey.sig) {
        const s = journey.sig;
        // Counts only, kept short -- l=listings opened, so=sold listings
        // opened, se=searches, d=days visited, p=pages, vt/sm=used the home
        // value tool / sold or market map.
        out.signals = `l=${s.listings.length};so=${s.solds.length};se=${s.searches};d=${s.days.length};p=${s.pages};vt=${s.valueTool};sm=${s.soldMap}`;
      }
    }
  } catch {
    // storage blocked
  }
  out.lead_page = window.location.pathname;
  return out;
}
