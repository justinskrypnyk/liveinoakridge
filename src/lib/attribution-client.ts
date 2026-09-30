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

// "Your lead is back" (2026-09-29). A browser counts as a known lead once
// it has sent a form here (it then carries a random browser_id, which
// ghl-lead.ts links to the GHL contact) or arrived from a GHL email link
// carrying ?lid={{contact.id}}. When a known lead comes back, each page
// they view is reported to /api/lead-back, and lead-back-alerts emails
// Justin a summary once the visit is over. Skipped for ?hm=off browsers
// (Justin, Smile, testing), Do Not Track and automated browsers.
const LEAD_ID_KEY = 'lead_lid';
const BROWSER_ID_KEY = 'lead_bt';

function captureLeadLink(): void {
  const url = new URL(window.location.href);
  const lid = url.searchParams.get('lid');
  if (!lid) return;
  if (/^[A-Za-z0-9]{15,40}$/.test(lid)) localStorage.setItem(LEAD_ID_KEY, lid);
  // Take it back out of the address bar, so it isn't copied into a shared
  // link or read by the analytics tags.
  url.searchParams.delete('lid');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

function watchKnownLead(): void {
  const lid = localStorage.getItem(LEAD_ID_KEY);
  const bt = localStorage.getItem(BROWSER_ID_KEY);
  if (!lid && !bt) return;
  // hm.js saves the ?hm=off opt-out, but may run after this does.
  if (/[?&]hm=off\b/.test(window.location.search)) localStorage.setItem('hm_off', '1');
  if (localStorage.getItem('hm_off') || navigator.doNotTrack === '1' || navigator.webdriver || !navigator.sendBeacon) return;
  const params = new URLSearchParams(window.location.search);
  const search: Record<string, string> = {};
  if (/^\/search\/?$/.test(window.location.pathname)) {
    for (const k of ['area', 'minPrice', 'maxPrice', 'types', 'minBeds', 'minBaths']) if (params.get(k)) search[k] = String(params.get(k)).slice(0, 60);
  }
  let sent = false;
  // Only once a real person has engaged (a scroll, tap or key, or 8 seconds
  // with the tab in view) -- email security scanners that open links
  // don't count as the lead coming back.
  const report = () => {
    if (sent || document.visibilityState !== 'visible') return;
    sent = true;
    navigator.sendBeacon('/api/lead-back', JSON.stringify({
      lid: lid || '', bt: bt || '', p: window.location.pathname, ti: document.title.slice(0, 120),
      q: Object.keys(search).length ? search : null,
    }));
  };
  ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, report, { once: true, passive: true }));
  setTimeout(report, 8000);
}

export function captureAttribution(): void {
  try {
    captureJourney();
  } catch {
    // storage blocked -- the journey is a nice-to-have
  }
  try {
    captureLeadLink();
    watchKnownLead();
  } catch {
    // storage blocked
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
  try {
    // Sending a form makes this a known lead's browser (see watchKnownLead).
    let bt = localStorage.getItem(BROWSER_ID_KEY);
    if (!bt) {
      bt = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
      localStorage.setItem(BROWSER_ID_KEY, bt);
    }
    out.browser_id = bt;
  } catch {
    // storage blocked
  }
  out.lead_page = window.location.pathname;
  return out;
}
