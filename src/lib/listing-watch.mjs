// "Your competition this week" reports for Justin's own listings (Justin,
// 2026-10-12: "add them to something and then you send them homes that come
// up for sale, sell, or change status, so I don't always have to keep my eye
// on it"). One email per watched listing, to Justin only, written so he can
// forward it to the seller as-is.
//
// The feed can't tell which Chapman listings are Justin's own (AMPRE sends
// no ListAgentKey/ListAgentFullName and no Member resource, checked
// 2026-10-12), so he ticks them on /admin/my-listings/.
//
// Data: the nightly comps index (netlify/functions/comps-index-background.mjs)
// scored with the same src/lib/comps-score.ts as /admin/comps/. Each run saves
// the competing set per listing, and the next run reports what changed.
// Used by netlify/functions/listing-watch-report-background.mjs (weekly send)
// and /api/admin/listing-watch.json (preview).
import { rankComps, subjectFromRow, DEFAULT_WEIGHTS } from './comps-score.ts';

export const SITE_URL = 'https://www.liveinoakridge.ca';
export const MAX_KM = 2;
// One-of-a-kind homes (e.g. a $1.1M near-acreage) can have nothing similar
// within 2 km; widen to this before calling it no competition.
const WIDE_KM = 5;
export const MIN_SCORE = 65; // out of 100, same score /admin/comps/ shows
// Buyers shop by price, which the comps score barely weighs: a $5.5M home
// scored 60+ against a $1.275M listing in testing. Sold homes use the sale price.
export const PRICE_BAND = 0.2;
const MAX_ACTIVE_SHOWN = 15; // rows in the first report's table; counts and tracking use every close match
const BASELINE_SOLD_DAYS = 90;

const DAY = 86400000;
const money = (n) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-CA')}`);
const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const street = (a) => String(a || '').split(',')[0];
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function competitorsWithin(row, rows, maxKm) {
  const subject = subjectFromRow(row);
  const filters = {
    maxKm,
    soldMonths: 4,
    sameTypeOnly: true,
    minBeds: row.b != null ? row.b - 1 : null,
    maxBeds: row.b != null ? row.b + 1 : null,
  };
  const ranked = rankComps(subject, rows.filter((r) => r.k !== row.k), DEFAULT_WEIGHTS, filters);
  const lo = row.lp * (1 - PRICE_BAND);
  const hi = row.lp * (1 + PRICE_BAND);
  const good = (list) => list.filter((x) => {
    const p = x.row.st === 'S' ? x.row.sp : x.row.lp;
    return x.score >= MIN_SCORE && (!row.lp || (p && p >= lo && p <= hi));
  });
  return { A: good(ranked.A), C: good(ranked.C), S: good(ranked.S), km: maxKm };
}

/** The homes that compete with `row` (a comps-index row), best match first. */
export function competitorsFor(row, rows) {
  const near = competitorsWithin(row, rows, MAX_KM);
  return near.A.length + near.S.length >= 3 ? near : competitorsWithin(row, rows, WIDE_KM);
}

/** What gets saved after a send, so next week can say what changed. */
export function stateFrom(comps, at) {
  const out = {};
  for (const x of [...comps.A, ...comps.C]) out[x.row.k] = { st: x.row.st, lp: x.row.lp, a: x.row.a };
  return { at, comps: out };
}

/**
 * Everything one report needs. `prev` is last report's saved state (null the
 * first time), `offMarket` maps a listing key that left the index to a
 * short status line (looked up live by the caller).
 */
export function buildReport({ row, rows, prev, now, offMarket = {} }) {
  const comps = competitorsFor(row, rows);
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const since = prev?.at ? new Date(prev.at) : new Date(now.getTime() - 7 * DAY);
  const sinceDay = new Date(since.getTime() - DAY).toISOString().slice(0, 10);
  const prevComps = prev?.comps || {};
  const current = new Set([...comps.A, ...comps.C].map((x) => x.row.k));

  const newListings = prev ? comps.A.filter((x) => !prevComps[x.row.k] && x.row.ld && x.row.ld >= sinceDay) : [];
  const priceChanges = [];
  const wentConditional = [];
  const leftMarket = [];
  for (const [k, p] of Object.entries(prevComps)) {
    const r = byKey.get(k);
    if (!r) {
      leftMarket.push({ k, a: p.a, lp: p.lp, status: offMarket[k] || 'No longer listed' });
      continue;
    }
    if (r.st === 'C' && p.st === 'A') wentConditional.push(r);
    else if (r.st === 'A' && p.lp && r.lp && r.lp !== p.lp) priceChanges.push({ row: r, from: p.lp, to: r.lp });
  }
  // Sold: firm since the last report among the close matches, plus any home
  // from last week's set that sold even if it no longer scores as close.
  const soldKeys = new Set();
  const sold = [];
  const soldSince = prev ? sinceDay : new Date(now.getTime() - BASELINE_SOLD_DAYS * DAY).toISOString().slice(0, 10);
  for (const x of comps.S) if (x.row.d && x.row.d >= soldSince) { sold.push(x.row); soldKeys.add(x.row.k); }
  for (const k of Object.keys(prevComps)) {
    const r = byKey.get(k);
    if (r?.st === 'S' && !soldKeys.has(k)) sold.push(r);
  }
  sold.sort((a, b) => (b.d || '').localeCompare(a.d || ''));

  const prices = comps.A.map((x) => x.row.lp).filter(Boolean);
  const below = prices.filter((p) => p < row.lp).length;
  const recentSold = comps.S.filter((x) => x.row.d && x.row.d >= new Date(now.getTime() - BASELINE_SOLD_DAYS * DAY).toISOString().slice(0, 10)).map((x) => x.row);
  const snapshot = {
    activeCount: comps.A.length,
    conditionalCount: comps.C.length,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    median: median(prices),
    cheaperCount: below,
    soldCount90: recentSold.length,
    soldMedian90: median(recentSold.map((r) => r.sp)),
    saleToList90: median(recentSold.filter((r) => r.sp && r.lp).map((r) => r.sp / r.lp)),
  };
  const changed = newListings.length + priceChanges.length + wentConditional.length + leftMarket.length + (prev ? sold.length : 0);
  return { row, comps, firstReport: !prev, newListings, priceChanges, wentConditional, sold, leftMarket, snapshot, changed, current, state: stateFrom(comps, now.toISOString()) };
}

const TD = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;vertical-align:top';
const TH = 'padding:8px 10px;border-bottom:2px solid #d1d5db;font-size:12px;color:#6b7280;text-align:left;font-weight:600';

// Photo + address cell. Photos come from /api/email-thumb/<key>.jpg (same
// 3:2 crop the GHL listing cards use; a placeholder if there's no photo, so
// never a broken image). Sold homes link to the sold page, which asks the
// viewer to sign in first, as MLS rules require for sold details.
function homeCell(r) {
  const specs = [r.b != null ? `${r.b}${r.bb ? `+${r.bb}` : ''} bed` : null, r.ba != null ? `${r.ba} bath` : null, r.sqTxt ? `${r.sqTxt} sq ft` : null].filter(Boolean).join(' · ');
  const name = esc(street(r.a));
  const key = String(r.k || '');
  // Homes that came off the market have no page left to link to.
  const href = key && r.st !== 'gone' ? `${SITE_URL}/${r.st === 'S' ? 'sold-map' : 'search'}/${key.toLowerCase()}/` : '';
  const thumb = key ? `<img src="${SITE_URL}/api/email-thumb/${encodeURIComponent(key)}.jpg" width="90" height="60" alt="" style="display:block;width:90px;height:60px;border:0;border-radius:4px">` : '';
  const text = `${href ? `<a href="${href}" style="color:#0c2340;font-weight:600">${name}</a>` : `<strong>${name}</strong>`}<div style="color:#6b7280;font-size:12px">${esc([r.arn, specs].filter(Boolean).join(' · '))}</div>`;
  if (!thumb) return text;
  return `<table cellpadding="0" cellspacing="0" role="presentation"><tr><td width="90" valign="top" style="padding-right:10px">${href ? `<a href="${href}">${thumb}</a>` : thumb}</td><td valign="top">${text}</td></tr></table>`;
}

function table(head, rowsHtml) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 18px"><tr>${head.map((h) => `<th style="${TH}">${h}</th>`).join('')}</tr>${rowsHtml.join('')}</table>`;
}

const section = (title, body) => `<h3 style="font-size:16px;color:#0c2340;margin:22px 0 4px">${title}</h3>${body}`;

/** Forward-ready HTML email for one report. */
export function reportHtml(rep, { seller = '', now }) {
  const r = rep.row;
  const s = rep.snapshot;
  const parts = [];
  parts.push(`<p style="font-size:15px">Hi ${esc(seller || 'there')},</p>`);
  parts.push(rep.firstReport
    ? `<p style="font-size:15px">Here's a look at the homes competing with <strong>${esc(street(r.a))}</strong> right now. From here on you'll get a short update each week with anything new: homes that list, change price, sell, or come off the market nearby.</p>`
    : rep.changed
      ? `<p style="font-size:15px">Here's what changed this week among the homes competing with <strong>${esc(street(r.a))}</strong>.</p>`
      : `<p style="font-size:15px">A quiet week around <strong>${esc(street(r.a))}</strong>: no new competing listings, price changes or sales nearby since last week.</p>`);

  const where = s.activeCount === 1
    ? `1 similar home is for sale within ${rep.comps.km} km, at ${money(s.low)}${r.lp ? `, ${s.low < r.lp ? 'below' : s.low > r.lp ? 'above' : 'the same as'} ${esc(street(r.a))} at ${money(r.lp)}` : ''}.`
    : s.activeCount
    ? `${s.activeCount} similar home${s.activeCount === 1 ? ' is' : 's are'} for sale within ${rep.comps.km} km, priced ${money(s.low)} to ${money(s.high)} (middle price ${money(s.median)}). ${s.cheaperCount} of them ${s.cheaperCount === 1 ? 'is' : 'are'} priced below ${esc(street(r.a))} at ${money(r.lp)}.`
    : `No closely similar homes are for sale within ${rep.comps.km} km right now.`;
  const sold90 = s.soldCount90
    ? ` In the last 90 days, ${s.soldCount90} similar home${s.soldCount90 === 1 ? '' : 's'} sold, at a middle price of ${money(s.soldMedian90)}${s.saleToList90 ? ` (about ${Math.round(s.saleToList90 * 1000) / 10}% of asking)` : ''}.`
    : '';
  parts.push(`<div style="background:#f0fdf4;border-left:4px solid #047857;padding:12px 14px;margin:14px 0;font-size:14px;line-height:1.5"><strong>The big picture</strong><br>${where}${sold90}${s.conditionalCount ? ` ${s.conditionalCount} more ${s.conditionalCount === 1 ? 'is' : 'are'} conditionally sold.` : ''}</div>`);

  if (rep.newListings.length) parts.push(section('New on the market', table(['Home', 'Price', 'Listed'], rep.newListings.map((x) => `<tr><td style="${TD}">${homeCell(x.row)}</td><td style="${TD}">${money(x.row.lp)}</td><td style="${TD}">${shortDate(x.row.ld)}</td></tr>`))));
  if (rep.priceChanges.length) parts.push(section('Price changes', table(['Home', 'Was', 'Now'], rep.priceChanges.map((c) => `<tr><td style="${TD}">${homeCell(c.row)}</td><td style="${TD}">${money(c.from)}</td><td style="${TD};font-weight:600;color:${c.to < c.from ? '#b91c1c' : '#047857'}">${money(c.to)}</td></tr>`))));
  if (rep.wentConditional.length) parts.push(section('Conditionally sold', table(['Home', 'Last asking'], rep.wentConditional.map((x) => `<tr><td style="${TD}">${homeCell(x)}</td><td style="${TD}">${money(x.lp)}</td></tr>`))));
  if (rep.sold.length) parts.push(section(rep.firstReport ? (rep.sold.length > 10 ? `The 10 most recent of ${rep.sold.length} sales nearby in the last 90 days` : 'Sold nearby in the last 90 days') : 'Sold', table(['Home', 'Asking', 'Sold for', 'Sold'], rep.sold.slice(0, 10).map((x) => `<tr><td style="${TD}">${homeCell(x)}</td><td style="${TD}">${money(x.lp)}</td><td style="${TD};font-weight:600">${money(x.sp)}</td><td style="${TD}">${shortDate(x.d)}${x.dom != null ? `<div style="color:#6b7280;font-size:12px">${x.dom} days on market</div>` : ''}</td></tr>`))));
  if (rep.leftMarket.length) parts.push(section('Off the market', table(['Home', 'Last asking', 'Status'], rep.leftMarket.map((x) => `<tr><td style="${TD}">${homeCell({ k: x.k, a: x.a, st: 'gone' })}</td><td style="${TD}">${money(x.lp)}</td><td style="${TD}">${esc(x.status)}</td></tr>`))));
  if (rep.firstReport && rep.comps.A.length) parts.push(section(rep.comps.A.length > MAX_ACTIVE_SHOWN ? `The ${MAX_ACTIVE_SHOWN} closest matches for sale right now` : 'Competing for sale right now', table(['Home', 'Price', 'Listed'], rep.comps.A.slice(0, MAX_ACTIVE_SHOWN).map((x) => `<tr><td style="${TD}">${homeCell(x.row)}</td><td style="${TD}">${money(x.row.lp)}</td><td style="${TD}">${shortDate(x.row.ld)}</td></tr>`))));

  parts.push(`<p style="font-size:15px;margin-top:22px">Any questions about what this means for your home, just reply or call me.</p><p style="font-size:15px">Justin</p>`);
  parts.push(`<p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:22px">"Similar" means the same type of home, within one bedroom, within ${rep.comps.km} km and ${Math.round(PRICE_BAND * 100)}% of the price, scored on location, size, age, lot and features. Sold prices and dates are from MLS® records, prepared for my clients' use, and are believed accurate but not guaranteed. Justin Skrypnyk, Real Estate Broker, Sutton Group Chapman Realty Inc., Brokerage · 519.639.5176 · Report date ${shortDate(now.toISOString())}.</p>`);
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Helvetica,Arial,sans-serif;color:#111827;max-width:640px;line-height:1.45">${parts.join('')}</div></body></html>`;
}

export function reportSubject(rep, now) {
  const tally = [
    rep.newListings.length && `${rep.newListings.length} new`,
    rep.priceChanges.length && `${rep.priceChanges.length} price change${rep.priceChanges.length === 1 ? '' : 's'}`,
    rep.wentConditional.length && `${rep.wentConditional.length} conditional`,
    !rep.firstReport && rep.sold.length && `${rep.sold.length} sold`,
    rep.leftMarket.length && `${rep.leftMarket.length} off market`,
  ].filter(Boolean).join(', ');
  const label = rep.firstReport ? 'first look' : tally || 'quiet week';
  return `Your competition: ${street(rep.row.a)} (${label}), ${shortDate(now.toISOString())}`;
}

// ---- Running and sending (scheduled function + admin "Send now") ----

const TO = 'info@homeswithjustin.ca';
const FROM = 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>';

async function sendEmail(subject, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

// A home that dropped out of the index entirely: the index skips
// terminated/expired/suspended listings and firm sales that haven't closed,
// so ask the feed which one it was.
async function offMarketStatus(listingKey) {
  try {
    const url = new URL(`${process.env.DDF_API_BASE_URL}Property`);
    url.searchParams.set('$filter', `contains(ListingKey,'${listingKey}')`);
    url.searchParams.set('$select', 'ListingKey,StandardStatus,MlsStatus');
    url.searchParams.set('$top', '5');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.VOW_ACCESS_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return 'No longer listed';
    const l = ((await res.json()).value || []).find((x) => x.ListingKey === listingKey);
    if (!l) return 'No longer listed';
    const mls = String(l.MlsStatus || '');
    if (/terminated|expired|suspended|withdrawn|cancel/i.test(mls)) return `Came off the market (${mls.replace(/^./, (c) => c.toUpperCase())})`;
    if (/sold/i.test(mls) || /pending|under contract/i.test(String(l.StandardStatus))) return 'Sold firm (price shows once it closes)';
    return 'No longer listed';
  } catch {
    return 'No longer listed';
  }
}

function reminderHtml(rows, adminKey) {
  const link = `${SITE_URL}/admin/my-listings/?key=${encodeURIComponent(adminKey)}`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#111827;max-width:640px">
<p>New Chapman listings came out this week. If any are yours, tick them so you get a weekly competition report for them:</p>
<ul>${rows.map((r) => `<li><strong>${esc(String(r.a).split(',')[0])}</strong>, $${Math.round(r.lp).toLocaleString('en-CA')}</li>`).join('')}</ul>
<p><a href="${link}" style="color:#047857;font-weight:600">Open My Listings</a></p></div></body></html>`;
}

/**
 * Build and (unless dryRun) send this week's reports. `getStore` is passed in
 * so this runs both in the scheduled function and in the admin API route.
 */
export async function runListingWatch({ getStore, only = null, dryRun = false }) {
  const HEATMAP_KEY = process.env.HEATMAP_KEY;
  if (!process.env.RESEND_API_KEY && !dryRun) throw new Error('Missing RESEND_API_KEY');
  const store = getStore('listing-watch');
  const index = await getStore('comps-index').get('latest', { type: 'json' });
  if (!index?.rows?.length) {
    console.error('listing-watch: comps index missing');
    if (!dryRun) await sendEmail('⚠️ Competition reports did not run', '<p>The comps index was missing, so no listing reports went out this week.</p>').catch(() => {});
    throw new Error('comps index missing');
  }
  let list = ((await store.get('list', { type: 'json' }).catch(() => null)) || { listings: [] }).listings;
  if (only && !list.some((x) => x.k === only)) {
    // Previewing a listing before ticking it is fine; sending isn't.
    if (!dryRun) throw new Error('Tick and save this listing first');
    list = [{ k: only, a: '', seller: '' }];
  }
  const byKey = new Map(index.rows.map((r) => [r.k, r]));
  const now = new Date();
  const results = [];

  for (const item of list) {
    if (only && item.k !== only) continue;
    const row = byKey.get(item.k);
    if (!row || row.st === 'S') {
      const status = row ? 'has sold' : 'is no longer active';
      const msg = `<p>${esc(item.a || item.k)} ${status}, so no competition report went out for it. Untick it on <a href="${SITE_URL}/admin/my-listings/?key=${encodeURIComponent(HEATMAP_KEY || '')}">My Listings</a> to stop these notes.</p>`;
      results.push({ k: item.k, skipped: status });
      if (!dryRun) await sendEmail(`Competition report paused: ${String(item.a || item.k).split(',')[0]}`, msg);
      continue;
    }
    const prev = await store.get(`state/${item.k}`, { type: 'json' }).catch(() => null);
    const gone = Object.keys(prev?.comps || {}).filter((k) => !byKey.has(k));
    const offMarket = {};
    for (const k of gone) offMarket[k] = await offMarketStatus(k);
    const rep = buildReport({ row, rows: index.rows, prev, now, offMarket });
    const subject = reportSubject(rep, now);
    const html = reportHtml(rep, { seller: item.seller, now });
    results.push({ k: item.k, subject, changed: rep.changed, firstReport: rep.firstReport, ...(dryRun ? { html } : {}) });
    if (dryRun) continue;
    await sendEmail(subject, html);
    await store.setJSON(`state/${item.k}`, rep.state);
  }

  // Reminder: Chapman listings out in the last week that aren't ticked yet.
  if (!only) {
    const seen = new Set((await store.get('chapman-seen', { type: 'json' }).catch(() => null)) || []);
    const watched = new Set(list.map((x) => x.k));
    const weekAgo = new Date(now.getTime() - 8 * 86400000).toISOString().slice(0, 10);
    const fresh = index.rows.filter((r) => r.st === 'A' && /chapman/i.test(r.off || '') && !watched.has(r.k) && !seen.has(r.k) && r.ld && r.ld >= weekAgo);
    if (fresh.length) {
      results.push({ reminder: fresh.map((r) => r.a) });
      if (!dryRun) {
        await sendEmail(`New Chapman listings: any of these yours? (${fresh.length})`, reminderHtml(fresh, HEATMAP_KEY || ''));
        // Remember every current Chapman listing so the reminder never repeats one.
        const all = index.rows.filter((r) => /chapman/i.test(r.off || '') && r.st !== 'S').map((r) => r.k);
        await store.setJSON('chapman-seen', [...new Set([...seen, ...all])]);
      }
    }
  }

  return { ran: now.toISOString(), dryRun, results };
}

