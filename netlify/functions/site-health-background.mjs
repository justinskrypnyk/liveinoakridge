// Daily "is everything still working?" check (Justin, 2026-09-27).
//
// Several past failures on this site ran silently for days:
//   - vow-sold-sync stopped for 9 days (2026-08)
//   - GA4 recorded almost nothing for two weeks after the Partytown change (2026-08-15..30)
//   - the Netlify -> GHL form webhook was disabled (2026-07-30)
// This runs every morning after the overnight jobs and emails Justin ONLY
// when something fails. The webhook check stays in its own function
// (ghl-webhook-health-background.mjs, live since July) -- not repeated here.
//
// Replaces the never-pushed analytics-health-background.mjs, which needed a
// Google service account: this reuses the GOOGLE_OAUTH_CREDENTIALS refresh
// token the Monday traffic email already uses, and compares GA4 against the
// site's own heatmap page-view count instead of against Search Console.
//
// Each run's results also go to the `site-health` blob ('latest').
//
// Manual run: POST {"dryRun": true} returns the results without emailing.

import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';

const SITE = 'https://www.liveinoakridge.ca';
const SITE_ID = '55088671-90b8-4e17-a8f6-afe1e06fcfda';
const GA4_PROPERTY_ID = '542463311';
const ALERT_TO = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';
const HOUR = 3600000;
const TZ = 'America/Toronto';

const results = [];
function record(name, ok, detail, level = 'fail') {
  results.push({ name, ok, detail, level: ok ? 'ok' : level });
}
async function check(name, fn, level = 'fail') {
  try {
    const res = await fn();
    record(name, res.ok, res.detail, res.level || level);
  } catch (err) {
    record(name, false, `Check itself errored: ${err.message}`, level);
  }
}
const hoursAgo = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / HOUR : Infinity);
const ageText = (h) => (h === Infinity ? 'never' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`);
const torontoDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'LiveInOakridge-SiteHealth/1.0', ...(opts.headers || {}) } });
}

async function googleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_OAUTH_CREDENTIALS);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Google login refresh failed (HTTP ${res.status}) -- the Monday traffic email will fail too`);
  return (await res.json()).access_token;
}

async function sendEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Live In Oakridge Alerts <reports@mail.liveinoakridge.ca>', to: [ALERT_TO], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

export default async (req) => {
  let dryRun = false;
  try {
    dryRun = (await req?.json?.())?.dryRun === true;
  } catch {
    // scheduled runs carry no JSON body
  }
  results.length = 0;
  const env = process.env;

  // ---- 1. Key pages load ----
  let sampleListing = null;
  try {
    const snap = await getStore('area-newest-listings').get('latest', { type: 'json' });
    sampleListing = Object.values(snap?.areas || {}).flat()[0]?.key || null;
  } catch {
    // covered by the snapshot freshness check below
  }
  const pages = [
    ['Home page', '/'], ['Home search', '/search/'], ['Schools page', '/best-high-schools-london-ontario/'],
    ['Home value estimate', '/home-value-estimate/'], ['Market map', '/market-map/'], ['Sold map', '/sold-map/'], ['Blog', '/blog/'],
  ];
  if (sampleListing) pages.push(['A listing page', `/search/${sampleListing}/`]);
  await Promise.all(pages.map(([name, path]) => check(`Page loads: ${name}`, async () => {
    const t0 = Date.now();
    const res = await fetchWithTimeout(`${SITE}${path}`);
    const body = await res.text();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) return { ok: false, detail: `${path} returned HTTP ${res.status}` };
    if (!/<title>/i.test(body) || body.length < 2000) return { ok: false, detail: `${path} loaded but looks empty (${body.length} bytes)` };
    return { ok: true, detail: `${path} OK in ${secs}s` };
  })));
  if (sampleListing) {
    await check('Listing photo cards (emails)', async () => {
      const res = await fetchWithTimeout(`${SITE}/api/email-thumb/${sampleListing}.jpg`);
      const type = res.headers.get('content-type') || '';
      const size = Number(res.headers.get('content-length')) || (await res.arrayBuffer()).byteLength;
      if (!res.ok || !type.includes('image')) return { ok: false, detail: `HTTP ${res.status} (${type})` };
      if (size < 3000) return { ok: false, detail: 'Only the grey placeholder came back, so listing photos may not be loading', level: 'warn' };
      return { ok: true, detail: `OK (${Math.round(size / 1024)} KB)` };
    }, 'warn');
  }

  // ---- 2. Outside services still accept our keys ----
  const ddfCheck = (name, token) => check(name, async () => {
    const res = await fetchWithTimeout(`${env.DDF_API_BASE_URL}Property?$top=1&$select=ListingKey`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    return res.ok ? { ok: true, detail: 'OK' } : { ok: false, detail: `HTTP ${res.status} -- the access token may have expired` };
  });
  await Promise.all([
    ddfCheck('Listing feed (DDF) access', env.DDF_ACCESS_TOKEN),
    ddfCheck('Sold data feed (VOW) access', env.VOW_ACCESS_TOKEN),
    check('GHL access', async () => {
      const res = await fetchWithTimeout(`https://services.leadconnectorhq.com/locations/${env.GHL_LOCATION_ID}`, {
        headers: { Authorization: `Bearer ${env.GHL_API_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
      });
      return res.ok ? { ok: true, detail: 'OK' } : { ok: false, detail: `HTTP ${res.status} -- leads, alerts and school emails can't reach GHL` };
    }),
  ]);

  // ---- 3. Data is fresh ----
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await check('Sold listings updating (vow-sold-sync)', async () => {
    const { data, error } = await supabase.from('vow_sold_listings').select('updated_at').order('updated_at', { ascending: false }).limit(1);
    if (error) return { ok: false, detail: `Database error: ${error.message}` };
    const h = hoursAgo(data?.[0]?.updated_at);
    return { ok: h < 36, detail: `Last update ${ageText(h)}` };
  });
  await check('New sales still coming in', async () => {
    const since = torontoDate(-10);
    const { count, error } = await supabase.from('vow_sold_listings').select('listing_key', { count: 'exact', head: true }).gte('close_date', since).eq('is_lease', false);
    if (error) return { ok: false, detail: `Database error: ${error.message}` };
    return { ok: (count || 0) >= 5, detail: `${count || 0} London-area sales with a closing date in the last 10 days` };
  });
  const blobFresh = (name, store, key, field, maxHours, level = 'fail') => check(name, async () => {
    const doc = await getStore(store).get(key, { type: 'json' });
    const h = hoursAgo(doc?.[field]);
    return { ok: h < maxHours, detail: `Last updated ${ageText(h)}` };
  }, level);
  await Promise.all([
    blobFresh('Newest-listings snapshot (school welcome emails)', 'area-newest-listings', 'latest', 'builtAt', 36),
    blobFresh('Price history (price-drop alerts)', 'listing-price-history', 'latest', 'updatedAt', 36),
  ]);
  await check('"Your lead is back" alerts running', async () => {
    // lead-back-alerts runs every 20 minutes and clears finished visits.
    const { blobs } = await getStore('lead-activity').list();
    const oldest = blobs.map((b) => Number(b.key.split('/')[1]?.split('-')[0])).filter(Boolean).sort((a, b) => a - b)[0];
    if (oldest && Date.now() - oldest > 3 * HOUR) return { ok: false, detail: `${blobs.length} returning-lead page views waiting since ${ageText(hoursAgo(new Date(oldest).toISOString()))} -- the alert job has stopped` };
    return { ok: true, detail: `${blobs.length} page views waiting (normal)` };
  });
  let heatmapYesterday = null;
  await check('Heatmap rollup running', async () => {
    const { blobs } = await getStore('heatmap-raw').list();
    const oldest = blobs.map((b) => b.key).sort()[0];
    const oldestMs = oldest ? Number(oldest.split('/')[1]?.split('-')[0]) : null;
    if (oldestMs && Date.now() - oldestMs > 3 * HOUR) return { ok: false, detail: `${blobs.length} visits waiting since ${ageText(hoursAgo(new Date(oldestMs).toISOString()))} -- the hourly rollup has stopped` };
    return { ok: true, detail: `${blobs.length} visits waiting (normal)` };
  });
  try {
    const yday = torontoDate(-1);
    const [y, m, d] = yday.split('-').map(Number);
    const local = new Date(Date.UTC(y, m - 1, d));
    const monday = new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const siteDoc = await getStore('heatmap-weeks').get(`${monday}/site`, { type: 'json' });
    // No daily counts yet (the rollup only started recording them 2026-09-29)
    // means "nothing to compare", not "zero views".
    const daily = siteDoc?.site?.daily;
    heatmapYesterday = daily ? daily[yday] ?? 0 : null;
  } catch {
    heatmapYesterday = null;
  }

  // ---- 4. Tracking still works: GA4 vs the heatmap's own count ----
  await check('Google Analytics recording visits', async () => {
    const token = await googleAccessToken();
    const yday = torontoDate(-1);
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: yday, endDate: yday }], metrics: [{ name: 'screenPageViews' }] }),
    });
    if (!res.ok) return { ok: false, detail: `GA4 report failed: HTTP ${res.status}` };
    const gaViews = Number((await res.json()).rows?.[0]?.metricValues?.[0]?.value || 0);
    if (heatmapYesterday == null) return { ok: true, detail: `${gaViews} GA4 page views yesterday (no heatmap count to compare yet)` };
    const detail = `Yesterday: ${gaViews} page views in Google Analytics vs ${heatmapYesterday} in the site's own heatmap`;
    // Different tools count a bit differently (ad blockers, Do Not Track), so
    // only a big gap on a normal-traffic day counts as broken.
    if (heatmapYesterday >= 20 && gaViews < heatmapYesterday * 0.25) return { ok: false, detail: `${detail}. Google Analytics tracking looks broken` };
    if (gaViews >= 20 && heatmapYesterday < gaViews * 0.1) return { ok: false, detail: `${detail}. The heatmap tracker looks broken`, level: 'warn' };
    return { ok: true, detail };
  });

  // ---- 5. Leads still arriving ----
  await check('Website forms receiving leads', async () => {
    if (!env.NETLIFY_API_TOKEN) return { ok: true, detail: 'Skipped (no Netlify API token)' };
    const res = await fetchWithTimeout(`https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?per_page=1`, { headers: { Authorization: `Bearer ${env.NETLIFY_API_TOKEN}` } });
    if (!res.ok) return { ok: false, detail: `Netlify API HTTP ${res.status}` };
    const last = (await res.json())?.[0]?.created_at;
    const h = hoursAgo(last);
    return { ok: h < 14 * 24, detail: `Last form submission ${ageText(h)}` };
  }, 'warn');

  // ---- Report ----
  const failures = results.filter((r) => r.level === 'fail');
  const warnings = results.filter((r) => r.level === 'warn');
  const summary = { checkedAt: new Date().toISOString(), failures: failures.length, warnings: warnings.length, results };
  try {
    await getStore('site-health').setJSON('latest', summary);
  } catch (err) {
    console.error('site-health: could not save results', err);
  }

  if (!dryRun && (failures.length || warnings.length)) {
    const row = (r) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${r.level === 'fail' ? '🔴' : '🟡'} ${r.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${r.detail}</td></tr>`;
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#16283a;max-width:680px;">
      <p>This morning's website check found ${failures.length ? `<b>${failures.length} problem${failures.length === 1 ? '' : 's'}</b>` : 'no problems'}${warnings.length ? ` and ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to keep an eye on` : ''}.</p>
      <table style="border-collapse:collapse;">${[...failures, ...warnings].map(row).join('')}</table>
      <p style="margin-top:18px;">🔴 = something is broken now. 🟡 = worth a look, may be fine.</p>
      <p style="color:#5a7185;font-size:12px;">${results.length - failures.length - warnings.length} other checks passed. This email only comes when something needs attention. Forward it to Claude to have it looked at.</p>
    </div>`;
    const subject = failures.length ? `🔴 Website check: ${failures.map((f) => f.name).slice(0, 2).join(', ')}${failures.length > 2 ? '…' : ''}` : `🟡 Website check: ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to look at`;
    try {
      await sendEmail(subject, html);
    } catch (err) {
      console.error('site-health: alert email failed', err);
    }
  }

  console.log(`site-health: ${results.length} checks, ${failures.length} failed, ${warnings.length} warnings`);
  return new Response(JSON.stringify(summary, null, 1), { headers: { 'Content-Type': 'application/json' } });
};

export const config = {
  schedule: '30 13 * * *', // daily, 13:30 UTC (9:30 AM Toronto in summer) -- after the overnight syncs and 11-12 UTC alert jobs
};
