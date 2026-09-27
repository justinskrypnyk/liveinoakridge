// Scheduled job, Friday mornings -- "open houses this weekend" alerts
// (Justin, 2026-09-27).
//
// The AMPRE feed has an OpenHouse resource (ListingKey, OpenHouseDate,
// start/end times in UTC, In Person / Virtual). Checked 2026-09-27: it only
// holds upcoming open houses (~5,700 Ontario-wide, 244 on active London
// listings), and most weekend ones are posted during the week -- hence a
// Friday send rather than earlier.
//
// Who gets one, one GHL push per person, best 3 homes:
//   1. anyone who saved a home that has an open house this weekend, first;
//   2. anyone whose saved search matches a home with an open house.
// Tag `open-house-alert` fires Smile's GHL workflow, which emails the photo
// cards in recommended_listing_1..3_card, each labelled with its times.
//
// Manual test: POST {"dryRun": true} returns who would get what, sends nothing.

import { createClient } from '@supabase/supabase-js';
import { listingCardHtml, listingCardFields, withUtm } from '../../src/lib/listing-card.mjs';
import { fetchActiveLondonPool, loadAreaRings, makeGeocoder, matchesCriteria, pushListingAlert } from '../../src/lib/alert-helpers.mjs';

const SITE_URL = 'https://www.liveinoakridge.ca';
const TAG = 'open-house-alert';
const TZ = 'America/Toronto';

const fmt = (n) => `$${Math.round(Number(n)).toLocaleString('en-CA')}`;

// Toronto calendar date (YYYY-MM-DD) `days` after today.
function torontoDate(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// "Sat 2-4 PM", "Sun 1:30-3 PM", "Sat 11 AM-1 PM"
function timeRange(startIso, endIso) {
  const part = (iso) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: p.weekday, time: p.minute === '00' ? p.hour : `${p.hour}:${p.minute}`, ampm: p.dayPeriod.toUpperCase() };
  };
  const s = part(startIso);
  if (!endIso) return `${s.day} ${s.time} ${s.ampm}`;
  const e = part(endIso);
  return s.ampm === e.ampm ? `${s.day} ${s.time}–${e.time} ${e.ampm}` : `${s.day} ${s.time} ${s.ampm}–${e.time} ${e.ampm}`;
}

async function fetchOpenHouses() {
  const headers = { Authorization: `Bearer ${process.env.DDF_ACCESS_TOKEN}`, Accept: 'application/json' };
  let url = `${process.env.DDF_API_BASE_URL}OpenHouse?$top=500`;
  const all = [];
  for (let page = 0; url && page < 60; page++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`OpenHouse fetch -> HTTP ${res.status}`);
    const data = await res.json();
    all.push(...(data.value || []));
    url = data['@odata.nextLink'];
  }
  return all;
}

export default async (req) => {
  let dryRun = false;
  try {
    dryRun = (await req?.json?.())?.dryRun === true;
  } catch {
    // scheduled runs carry no JSON body
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DDF_ACCESS_TOKEN, DDF_API_BASE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('open-house-alerts: missing required env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  // This weekend = the next Saturday and Sunday (the job runs Friday).
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date());
  const toSat = { Sat: 0, Sun: 6, Mon: 5, Tue: 4, Wed: 3, Thu: 2, Fri: 1 }[dow];
  const weekend = new Set([torontoDate(toSat), torontoDate(toSat + 1)]);

  const [pool, openHouses] = await Promise.all([fetchActiveLondonPool(), fetchOpenHouses()]);
  const poolByKey = new Map(pool.map((l) => [l.ListingKey, l]));

  // ListingKey -> { listing, times: [{start,end}] } for this weekend's in-person open houses.
  const homes = new Map();
  for (const oh of openHouses) {
    if (oh.OpenHouseStatus !== 'Active' || !weekend.has(oh.OpenHouseDate) || !oh.OpenHouseStartTime) continue;
    if (oh.OpenHouseFormat && oh.OpenHouseFormat !== 'In Person') continue;
    const listing = poolByKey.get(oh.ListingKey);
    if (!listing) continue;
    if (!homes.has(oh.ListingKey)) homes.set(oh.ListingKey, { listing, times: [] });
    homes.get(oh.ListingKey).times.push({ start: oh.OpenHouseStartTime, end: oh.OpenHouseEndTime });
  }
  for (const h of homes.values()) h.times.sort((a, b) => a.start.localeCompare(b.start));
  if (homes.size === 0) return new Response('open-house-alerts: no London open houses this weekend');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const people = new Map(); // email -> { person, items: Map(key -> { home, saved }) }
  const addFor = (row, home, saved) => {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) return;
    if (!people.has(email)) people.set(email, { person: row, items: new Map() });
    const items = people.get(email).items;
    const existing = items.get(home.listing.ListingKey);
    if (!existing || (saved && !existing.saved)) items.set(home.listing.ListingKey, { home, saved });
  };

  const { data: savedRows, error: savedErr } = await supabase
    .from('saved_listings')
    .select('email, first_name, last_name, phone, listing_key')
    .in('listing_key', [...homes.keys()]);
  if (savedErr) console.error('open-house-alerts: saved_listings query failed:', savedErr.message);
  for (const row of savedRows || []) addFor(row, homes.get(row.listing_key), true);

  const { data: searches, error: searchErr } = await supabase.from('saved_searches').select('*');
  if (searchErr) console.error('open-house-alerts: saved_searches query failed:', searchErr.message);
  const areaRings = loadAreaRings();
  const geocode = makeGeocoder();
  for (const sub of searches || []) {
    for (const home of homes.values()) {
      if (await matchesCriteria(sub, home.listing, areaRings, geocode)) addFor(sub, home, false);
    }
  }

  let sent = 0;
  const preview = [];
  for (const { person, items } of people.values()) {
    const top = [...items.values()]
      .sort((a, b) => (b.saved - a.saved) || a.home.times[0].start.localeCompare(b.home.times[0].start))
      .slice(0, 3);
    const url = (key) => `${SITE_URL}/search/${key}/`;
    const when = (home) => home.times.map((t) => timeRange(t.start, t.end)).join(', ');
    const line = (home) => `${home.listing.UnparsedAddress} — ${fmt(home.listing.ListPrice)} — open house ${when(home)} — ${withUtm(url(home.listing.ListingKey), TAG)}`;
    if (dryRun) {
      preview.push({ email: person.email, homes: top.map(({ home, saved }) => `${home.listing.UnparsedAddress}: ${when(home)}${saved ? ' (saved)' : ''}`) });
      continue;
    }
    const ok = await pushListingAlert({
      email: person.email,
      firstName: person.first_name,
      lastName: person.last_name,
      phone: person.phone,
      tag: TAG,
      intro: 'Open houses this weekend:',
      lines: top.map(({ home }) => line(home)),
      customFields: [
        ...[0, 1, 2].map((i) => ({ key: `recommended_listing_${i + 1}`, fieldValue: top[i] ? line(top[i].home) : '' })),
        ...listingCardFields(top.map(({ home }) => listingCardHtml({
          siteUrl: SITE_URL,
          key: home.listing.ListingKey,
          address: home.listing.UnparsedAddress,
          price: Number(home.listing.ListPrice) || null,
          url: url(home.listing.ListingKey),
          campaign: TAG,
          label: `Open house · ${when(home)}`,
        }))),
      ],
    });
    if (ok) sent++;
  }

  if (dryRun) return new Response(JSON.stringify({ weekend: [...weekend], homes: homes.size, people: preview }, null, 1), { headers: { 'Content-Type': 'application/json' } });
  const summary = `open-house-alerts: ${homes.size} London homes open this weekend, ${people.size} people matched, ${sent} alerts sent`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 12 * * 5', // Fridays, 12:00 UTC (8 AM Toronto in summer, 7 AM in winter)
};
