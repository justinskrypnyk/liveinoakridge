// Scheduled job -- "Nosy Neighbour" style alerts. Runs daily, an hour after
// vow-sold-sync-background.mjs refreshes vow_sold_listings, and checks every
// home_watch_subscriptions row (see api/vow/watch-address.json.ts -- signup
// requires an active VOW session, since this alert is built from real
// closed sale prices) for anything new within its radius since it was last
// notified. Same AI-free principle as every other automated email here:
// plain distance math against already-synced data, no interpretation.
//
// GHL push logic is a self-contained copy of src/lib/ghl-recommend.ts rather
// than a cross-import -- this repo keeps Netlify Functions and src/lib
// deliberately separate (different module systems/env conventions); see
// that file for the fuller reasoning on the custom-field/note split.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const SITE_URL = 'https://www.liveinoakridge.ca';

const FREQUENCY_MIN_HOURS = { daily: 20, weekly: 24 * 6.5, monthly: 24 * 27 };

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}

function isDue(sub) {
  if (!sub.last_notified_at) return true;
  const hoursSince = (Date.now() - new Date(sub.last_notified_at).getTime()) / (1000 * 60 * 60);
  return hoursSince >= (FREQUENCY_MIN_HOURS[sub.frequency] ?? FREQUENCY_MIN_HOURS.weekly);
}

async function pushToGhl({ email, firstName, lastName, phone, intro, lines }) {
  if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
    console.error('GHL env vars missing, skipping push for', email);
    return;
  }
  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${GHL_API_TOKEN}`,
    Version: '2021-07-28',
  };
  const customFields = lines.map((value, i) => ({ key: `contact.recommended_listing_${i + 1}`, field_value: value }));

  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email,
      phone: phone || undefined,
      locationId: GHL_LOCATION_ID,
      tags: ['nosy-neighbour-alert'],
      customFields,
      source: 'Website — Automated Recommendation',
    }),
  });
  if (!res.ok) {
    console.error('GHL upsert failed:', res.status, await res.text().catch(() => ''));
    return;
  }
  try {
    const upserted = await res.json();
    const contactId = upserted?.contact?.id;
    if (contactId) {
      const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ body: [intro, ...lines].join('\n') }),
      });
      if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));
    }
  } catch (err) {
    console.error('GHL note failed:', err);
  }
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('home-watch-alerts: missing Supabase env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: subs, error: subsError } = await supabase.from('home_watch_subscriptions').select('*');
  if (subsError) {
    console.error('home-watch-alerts: subscription query failed:', subsError.message);
    return new Response('Query failed', { status: 500 });
  }
  if (!subs || subs.length === 0) return new Response('No subscriptions');

  const dueSubs = subs.filter(isDue);
  if (dueSubs.length === 0) return new Response('Nothing due');

  // One shared candidate pool (last 40 days of closings) rather than a
  // per-subscription query -- cheap in-memory distance filtering scales
  // fine at this data size and avoids N round-trips to Supabase.
  const since = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: recentSold, error: soldError } = await supabase
    .from('vow_sold_listings')
    .select('listing_key, address, close_price, close_date, lat, lng')
    .gte('close_date', since)
    .eq('is_lease', false)
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (soldError) {
    console.error('home-watch-alerts: sold-listings query failed:', soldError.message);
    return new Response('Query failed', { status: 500 });
  }

  let sent = 0;
  for (const sub of dueSubs) {
    const sinceDate = sub.last_notified_at ? sub.last_notified_at.slice(0, 10) : null;
    const nearby = (recentSold || [])
      .filter((l) => !sinceDate || l.close_date > sinceDate)
      .map((l) => ({ listing: l, distanceKm: haversineKm(sub.latitude, sub.longitude, l.lat, l.lng) }))
      .filter((x) => x.distanceKm <= sub.radius_km)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 3)
      .map((x) => x.listing);

    if (nearby.length > 0) {
      await pushToGhl({
        email: sub.email,
        firstName: sub.first_name,
        lastName: sub.last_name,
        phone: sub.phone,
        intro: `Homes sold near ${sub.address_label}:`,
        lines: nearby.map((l) =>
          `${l.address} — $${Math.round(Number(l.close_price)).toLocaleString('en-CA')} — ${SITE_URL}/sold-map/${l.listing_key}/`
        ),
      });
      sent++;
    }

    await supabase.from('home_watch_subscriptions').update({ last_notified_at: new Date().toISOString() }).eq('id', sub.id);
  }

  const summary = `home-watch-alerts: checked ${dueSubs.length} due subscriptions, sent ${sent} alerts`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 11 * * *', // daily, 11am UTC -- an hour after vow-sold-sync-background's 10am refresh
};
