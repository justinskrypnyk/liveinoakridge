// Scheduled job -- "a home you're watching just dropped its price" alerts
// (Justin, 2026-09-27).
//
// The AMPRE feed keeps no price history: OriginalListPrice,
// PreviousListPrice and PriceChangeTimestamp exist but were empty on every
// one of ~500 active London listings checked 2026-09-27. So this job keeps
// its own: each run records every active London listing's price in the
// `listing-price-history` blob and compares it with the last run. A listing
// whose price went down by at least MIN_DROP is a price drop.
//
// Who hears about a drop, one GHL push per person per run, best 3 homes:
//   1. anyone who saved that exact home (saved_listings), first;
//   2. anyone whose saved search (saved_searches) the home still matches at
//      its new price.
// Tag `price-drop-alert` fires Smile's GHL workflow, which emails the photo
// cards in recommended_listing_1..3_card (see src/lib/listing-card.mjs).
//
// The first run only records prices (nothing to compare with yet), so the
// first alerts go out the day after deploy.
//
// Manual test: POST {"dryRun": true, "simulate": 20} pretends 20 listings
// were $15,000 higher yesterday and returns who would get what -- it
// neither reads nor writes the price history and sends nothing.

import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { listingCardHtml, listingCardFields, withUtm } from '../../src/lib/listing-card.mjs';
import { fetchActiveLondonPool, loadAreaRings, makeGeocoder, matchesCriteria, pushListingAlert } from '../../src/lib/alert-helpers.mjs';

const SITE_URL = 'https://www.liveinoakridge.ca';
const TAG = 'price-drop-alert';
const MIN_DROP = 1000; // ignore rounding-level edits
const HISTORY_KEEP_DAYS = 30; // a listing missing from one run keeps its last price this long
const LOG_KEEP_DAYS = 60;
// If a big share of the market "drops" in one day, that's a feed problem,
// not news -- record nothing and email nobody.
const MAX_DROP_SHARE = 0.1;

const fmt = (n) => `$${Math.round(Number(n)).toLocaleString('en-CA')}`;

export default async (req) => {
  let dryRun = false;
  let simulate = 0;
  try {
    const body = await req?.json?.();
    dryRun = body?.dryRun === true;
    simulate = Number(body?.simulate) || 0;
  } catch {
    // scheduled runs carry no JSON body
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DDF_ACCESS_TOKEN, DDF_API_BASE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('price-drop-alerts: missing required env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  const pool = await fetchActiveLondonPool();
  if (pool.length < 500) {
    // A partial feed response would make hundreds of listings look delisted.
    console.error(`price-drop-alerts: only ${pool.length} active listings came back, skipping this run`);
    return new Response('Pool too small', { status: 500 });
  }

  let store = null;
  let prev = null;
  if (dryRun) {
    prev = { prices: Object.fromEntries(pool.slice(0, simulate).map((l) => [l.ListingKey, { price: (Number(l.ListPrice) || 0) + 15000 }])) };
  } else {
    store = getStore('listing-price-history');
    prev = (await store.get('latest', { type: 'json' }).catch(() => null)) || null;
  }
  const now = new Date();
  const nowIso = now.toISOString();

  const drops = [];
  const next = {};
  for (const l of pool) {
    const price = Number(l.ListPrice) || 0;
    if (price <= 0) continue;
    const before = prev?.prices?.[l.ListingKey]?.price;
    if (before && before - price >= MIN_DROP) drops.push({ listing: l, from: before, to: price });
    next[l.ListingKey] = { price, seen: nowIso };
  }
  // Keep recently seen listings that dropped out of this one response.
  const keepAfter = now.getTime() - HISTORY_KEEP_DAYS * 86400000;
  for (const [key, v] of Object.entries(prev?.prices || {})) {
    if (!next[key] && new Date(v.seen).getTime() > keepAfter) next[key] = v;
  }

  if (!prev && !dryRun) {
    await store.setJSON('latest', { updatedAt: nowIso, prices: next });
    return new Response(`price-drop-alerts: first run, recorded ${Object.keys(next).length} prices`);
  }
  if (drops.length > pool.length * MAX_DROP_SHARE) {
    console.error(`price-drop-alerts: ${drops.length} drops out of ${pool.length} looks like a feed glitch; not recording or sending`);
    return new Response('Too many drops, skipped', { status: 500 });
  }
  if (!dryRun) await store.setJSON('latest', { updatedAt: nowIso, prices: next });

  // A running log of drops, for reporting later (e.g. the newsletter).
  if (drops.length && !dryRun) {
    const log = (await store.get('log', { type: 'json' }).catch(() => null)) || [];
    const logAfter = now.getTime() - LOG_KEEP_DAYS * 86400000;
    const kept = log.filter((d) => new Date(d.at).getTime() > logAfter);
    kept.push(...drops.map((d) => ({ key: d.listing.ListingKey, address: d.listing.UnparsedAddress, from: d.from, to: d.to, at: nowIso })));
    await store.setJSON('log', kept);
  }
  if (drops.length === 0) return new Response('price-drop-alerts: no price drops today');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const dropByKey = new Map(drops.map((d) => [d.listing.ListingKey, d]));

  // email -> { person, items: [{ drop, saved }] }
  const people = new Map();
  const addFor = (row, drop, saved) => {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) return;
    if (!people.has(email)) people.set(email, { person: row, items: new Map() });
    const items = people.get(email).items;
    const existing = items.get(drop.listing.ListingKey);
    if (!existing || (saved && !existing.saved)) items.set(drop.listing.ListingKey, { drop, saved });
  };

  const { data: savedRows, error: savedErr } = await supabase
    .from('saved_listings')
    .select('email, first_name, last_name, phone, listing_key')
    .in('listing_key', [...dropByKey.keys()]);
  if (savedErr) console.error('price-drop-alerts: saved_listings query failed:', savedErr.message);
  for (const row of savedRows || []) addFor(row, dropByKey.get(row.listing_key), true);

  const { data: searches, error: searchErr } = await supabase.from('saved_searches').select('*');
  if (searchErr) console.error('price-drop-alerts: saved_searches query failed:', searchErr.message);
  const areaRings = loadAreaRings();
  const geocode = makeGeocoder();
  for (const sub of searches || []) {
    for (const drop of drops) {
      if (await matchesCriteria(sub, drop.listing, areaRings, geocode)) addFor(sub, drop, false);
    }
  }

  let sent = 0;
  const preview = [];
  for (const { person, items } of people.values()) {
    const top = [...items.values()]
      .sort((a, b) => (b.saved - a.saved) || ((b.drop.from - b.drop.to) - (a.drop.from - a.drop.to)))
      .slice(0, 3);
    const url = (key) => `${SITE_URL}/search/${key}/`;
    if (dryRun) {
      preview.push({ email: person.email, homes: top.map(({ drop, saved }) => `${drop.listing.UnparsedAddress}: ${fmt(drop.from)} -> ${fmt(drop.to)}${saved ? ' (saved)' : ''}`) });
      continue;
    }
    const ok = await pushListingAlert({
      email: person.email,
      firstName: person.first_name,
      lastName: person.last_name,
      phone: person.phone,
      tag: TAG,
      intro: 'Price drops on homes you are watching:',
      lines: top.map(({ drop }) =>
        `${drop.listing.UnparsedAddress} — now ${fmt(drop.to)} (was ${fmt(drop.from)}) — ${withUtm(url(drop.listing.ListingKey), TAG)}`),
      customFields: [
        ...[0, 1, 2].map((i) => {
          const d = top[i]?.drop;
          return { key: `recommended_listing_${i + 1}`, fieldValue: d ? `${d.listing.UnparsedAddress} — now ${fmt(d.to)} (was ${fmt(d.from)}) — ${withUtm(url(d.listing.ListingKey), TAG)}` : '' };
        }),
        ...listingCardFields(top.map(({ drop, saved }) => listingCardHtml({
          siteUrl: SITE_URL,
          key: drop.listing.ListingKey,
          address: drop.listing.UnparsedAddress,
          price: drop.to,
          previousPrice: drop.from,
          url: url(drop.listing.ListingKey),
          campaign: TAG,
          label: saved ? 'Price drop · a home you saved' : 'Price drop',
        }))),
      ],
    });
    if (ok) sent++;
  }

  if (dryRun) return new Response(JSON.stringify({ drops: drops.length, people: preview }, null, 1), { headers: { 'Content-Type': 'application/json' } });
  const summary = `price-drop-alerts: ${drops.length} price drops, ${people.size} people matched, ${sent} alerts sent`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '45 11 * * *', // daily, 11:45am UTC -- after saved-search-alerts and home-watch-alerts (11:30)
};
