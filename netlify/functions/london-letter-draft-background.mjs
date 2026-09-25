// Monthly "London Letter" draft for Smile (Justin's VA), who builds and sends
// the actual newsletter to Justin's CRM contacts from GHL. This function does
// NOT send the newsletter itself -- it emails Smile (cc Justin) a ready-to-
// paste HTML file plus the choices only a person should make: Justin's note,
// which local events to keep, and a final check of the listings.
//
// Sections and where each comes from (layout agreed with Justin 2026-09-24/25):
//   - London in a minute: vow_sold_listings for the completed month vs. the
//     same month a year earlier, plus months of inventory from
//     citywide_snapshots. Turned into plain-English sentences by fixed rules
//     below -- no AI touches the numbers or the wording around them.
//   - West London corner: Oakridge vs. the city, same sources, plus one
//     west-end news item.
//   - New Chapman listings: Sutton Group Chapman Realty listings ONLY (Justin's
//     rule, 2026-09-24), newest first, London addresses, from the AMPRE feed.
//   - From the blog: newest non-market-update post in src/data/blog.ts.
//   - Around London + the west-end item: Smile picks these by hand each
//     month (Justin chose not to add an AI news search, 2026-09-25), so the
//     draft carries clearly marked placeholders there.
//
// Manual runs: POST {"test": true} sends to Justin only, subject marked
// [TEST]. {"dryRun": true} builds everything and returns the HTML without
// sending any email.

import { createClient } from '@supabase/supabase-js';
import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const JUSTIN_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';
const SMILE_EMAIL = 'smile@homeswithjustin.ca';

const SITE = 'https://www.liveinoakridge.ca'; // bare domain 301s to www
const MIN_PLAUSIBLE_SALE_PRICE = 30000; // same floor as monthly-digest-background.mjs
const LISTING_COUNT = 4;
const OAKRIDGE_MIN_SALES = 5; // below this, one month's median is too noisy to headline

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// "$550,000" -- rounded to the nearest $5K so the email never implies more
// precision than a median of a few hundred sales has.
function fmtRoundPrice(n) {
  return `$${(Math.round(n / 5000) * 5000).toLocaleString('en-CA')}`;
}

function monthRange(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

// ---------------------------------------------------------------------------
// Market numbers
// ---------------------------------------------------------------------------

// Paginated explicitly -- Supabase's default .select() silently caps at
// 1,000 rows (the 2026-08 truncation bug, see heat-map-snapshot-background).
async function soldRows(supabase, from, to, areaSlug) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabase
      .from('vow_sold_listings')
      .select('close_price, list_price')
      .eq('is_lease', false)
      .gte('close_price', MIN_PLAUSIBLE_SALE_PRICE)
      .gte('close_date', from)
      .lte('close_date', to);
    // Citywide excludes outlying towns but keeps NULL area_slug rows (real
    // London sales that just failed polygon matching) -- same .or() as
    // monthly-digest's rolling count, for the same reason.
    q = areaSlug ? q.eq('area_slug', areaSlug) : q.or('area_slug.is.null,area_slug.not.like.outlying-%');
    const { data, error } = await q.range(offset, offset + 999);
    if (error) throw new Error(`vow_sold_listings query failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function summarize(rows) {
  const prices = rows.map((r) => Number(r.close_price)).filter((n) => n > 0);
  const withList = rows.filter((r) => Number(r.list_price) > 0);
  return {
    count: prices.length,
    median: median(prices),
    saleToList: withList.length ? withList.reduce((s, r) => s + r.close_price / r.list_price, 0) / withList.length : null,
  };
}

async function getMarket(supabase, year, monthIndex) {
  const [from, to] = monthRange(year, monthIndex);
  const [lyFrom, lyTo] = monthRange(year - 1, monthIndex);
  const [city, cityLastYear, oak, oakLastYear] = await Promise.all([
    soldRows(supabase, from, to).then(summarize),
    soldRows(supabase, lyFrom, lyTo).then(summarize),
    soldRows(supabase, from, to, 'oakridge').then(summarize),
    soldRows(supabase, lyFrom, lyTo, 'oakridge').then(summarize),
  ]);

  // Months of inventory: newest capture on or before today. On the 1st that
  // is the 'month-end' row monthly-digest-background writes at 13:00 UTC,
  // two hours before this runs.
  const today = new Date().toISOString().slice(0, 10);
  const { data: cityMoi } = await supabase
    .from('citywide_snapshots')
    .select('months_of_inventory, capture_date')
    .lte('capture_date', today)
    .not('months_of_inventory', 'is', null)
    .order('capture_date', { ascending: false })
    .limit(1);
  const { data: oakMoi } = await supabase
    .from('market_map_snapshots')
    .select('months_of_inventory, capture_date')
    .eq('area_slug', 'oakridge')
    .lte('capture_date', today)
    .not('months_of_inventory', 'is', null)
    .order('capture_date', { ascending: false })
    .limit(1);

  return {
    city: { ...city, lastYear: cityLastYear, moi: cityMoi?.[0]?.months_of_inventory ?? null },
    oak: { ...oak, lastYear: oakLastYear, moi: oakMoi?.[0]?.months_of_inventory ?? null },
  };
}

function yoy(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

function moiWords(moi) {
  const n = moi.toFixed(1);
  if (moi < 3) return { tier: "seller's market", sentence: `<b>It's a seller's market.</b> There are only about ${n} months' worth of homes for sale, so well-priced homes are moving quickly.` };
  if (moi <= 6) return { tier: 'balanced market', sentence: `<b>It's a balanced market.</b> There are about ${n} months' worth of homes for sale, so buyers can take their time and sellers need to price it right.` };
  return { tier: "buyer's market", sentence: `<b>Buyers have the upper hand.</b> There are about ${n} months' worth of homes for sale, so buyers have plenty of choice and room to negotiate.` };
}

// Fixed rules, no AI: each sentence's wording is picked by thresholds on the
// real number, so the copy can never say something the data doesn't.
function marketSentences(m, monthName) {
  const out = [];
  const c = m.city;
  const change = yoy(c.median, c.lastYear.median);
  if (c.median != null) {
    if (change == null) {
      out.push(`<b>What homes sold for.</b> The typical London home sold for about ${fmtRoundPrice(c.median)} in ${monthName}.`);
    } else if (Math.abs(change) < 0.03) {
      out.push(`<b>Prices held steady.</b> The typical London home sold for about ${fmtRoundPrice(c.median)} in ${monthName}, close to where it was a year ago.`);
    } else if (change < 0) {
      out.push(`<b>Prices eased a little.</b> The typical London home sold for about ${fmtRoundPrice(c.median)} in ${monthName}, down from about ${fmtRoundPrice(c.lastYear.median)} a year ago.`);
    } else {
      out.push(`<b>Prices rose.</b> The typical London home sold for about ${fmtRoundPrice(c.median)} in ${monthName}, up from about ${fmtRoundPrice(c.lastYear.median)} a year ago.`);
    }
  }
  if (c.moi != null) out.push(moiWords(c.moi).sentence);
  if (c.saleToList != null) {
    const pct = Math.round(c.saleToList * 100);
    if (c.saleToList >= 1) out.push(`<b>Some homes are selling over asking.</b> On average, homes sold for about ${pct}% of their list price.`);
    else if (c.saleToList >= 0.97) out.push(`<b>Offers are landing close to asking.</b> Homes sold for about ${pct}% of their list price, on average.`);
    else out.push(`<b>Buyers have room to negotiate.</b> Homes sold for about ${pct}% of their list price, on average.`);
  }
  return out;
}

function oakridgeCorner(m, monthName) {
  const o = m.oak;
  if (o.count < OAKRIDGE_MIN_SALES || o.median == null) {
    return {
      heading: `Oakridge in ${monthName}`,
      body: `Only ${o.count} Oakridge home${o.count === 1 ? '' : 's'} sold in ${monthName}, which is too few for a reliable typical price.${o.moi != null ? ` There are about ${o.moi.toFixed(1)} months' worth of homes for sale in the neighbourhood, a ${moiWords(o.moi).tier}.` : ''}`,
    };
  }
  const oakChange = yoy(o.median, o.lastYear.median);
  const cityChange = yoy(m.city.median, m.city.lastYear.median);
  const price = fmtRoundPrice(o.median);
  let heading;
  let first;
  if (oakChange != null && Math.abs(oakChange) < 0.03) {
    heading = cityChange != null && cityChange <= -0.03 ? 'Oakridge is holding its ground' : 'Oakridge is holding steady';
    first = `${cityChange != null && cityChange <= -0.03 ? 'While prices dipped citywide, the' : 'The'} typical Oakridge home sold for about ${price}, close to what it did last ${monthName}.`;
  } else if (oakChange != null && oakChange > 0) {
    heading = 'Oakridge prices are climbing';
    first = `The typical Oakridge home sold for about ${price}, up from about ${fmtRoundPrice(o.lastYear.median)} last ${monthName}.`;
  } else if (oakChange != null) {
    heading = 'Oakridge prices softened';
    first = `The typical Oakridge home sold for about ${price}, down from about ${fmtRoundPrice(o.lastYear.median)} last ${monthName}.`;
  } else {
    heading = `Oakridge in ${monthName}`;
    first = `The typical Oakridge home sold for about ${price}.`;
  }
  let second = '';
  if (o.moi != null) {
    if (o.moi < 2) second = ` With less than two months' worth of homes for sale, Oakridge is still one of the tightest neighbourhoods in the city.`;
    else second = ` There are about ${o.moi.toFixed(1)} months' worth of homes for sale here, a ${moiWords(o.moi).tier}.`;
  }
  return { heading, body: first + second };
}

// ---------------------------------------------------------------------------
// Chapman listings (AMPRE feed)
// ---------------------------------------------------------------------------

// This AMPRE deployment only decodes %20 for spaces in $filter values (see
// src/lib/ddf.ts) -- URLSearchParams' '+' breaks it, so encode by hand.
async function odataGet(resource, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${DDF_API_BASE_URL}${resource}?${qs}`, {
    headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

const STREET_ABBR = { Road: 'Rd', Drive: 'Dr', Street: 'St', Avenue: 'Ave', Boulevard: 'Blvd', Crescent: 'Cres', Court: 'Crt', Place: 'Pl', Lane: 'Lane', Way: 'Way', Terrace: 'Terr', Circle: 'Circ', Gate: 'Gate', Trail: 'Trail' };
const QUADRANT = { 'London North': 'North London', 'London South': 'South London', 'London East': 'East London', 'London West': 'West London' };

// "455 Hyde Park Road 15, London North, ON N6H 3R9" -> "#15, 455 Hyde Park Rd"
function shortAddress(unparsed) {
  const street = String(unparsed || '').split(',')[0].trim();
  const words = street.split(/\s+/);
  const typeIdx = words.findIndex((w, i) => i > 0 && STREET_ABBR[w]);
  if (typeIdx === -1) return street;
  const unit = /^\d+[A-Z]?$/.test(words[typeIdx + 1] || '') ? words[typeIdx + 1] : null;
  const base = [...words.slice(0, typeIdx), STREET_ABBR[words[typeIdx]], ...words.slice(typeIdx + (unit ? 2 : 1))].join(' ');
  return unit ? `#${unit}, ${base}` : base;
}

async function areaNamesByKey() {
  try {
    const snap = await getStore('area-newest-listings').get('latest', { type: 'json' });
    const names = { oakridge: 'Oakridge', 'west-london': 'West London', whitehills: 'Whitehills', byron: 'Byron', westmount: 'Westmount', riverbend: 'Riverbend', lambeth: 'Lambeth' };
    const out = {};
    for (const [slug, list] of Object.entries(snap?.areas || {})) for (const l of list) out[l.key] = names[slug] || null;
    return out;
  } catch {
    return {}; // blobs unavailable (local run) -- fall back to the address quadrant
  }
}

async function getChapmanListings() {
  const data = await odataGet('Property', {
    $filter: "contains(ListOfficeName,'CHAPMAN')",
    $select: 'ListingKey,UnparsedAddress,ListPrice,BedroomsTotal,BathroomsTotalInteger,PropertyType,StandardStatus,TransactionType,OriginalEntryTimestamp,ListOfficeName',
    $top: '500',
  });
  const listings = (data.value || [])
    .filter((l) => /SUTTON GROUP CHAPMAN/i.test(l.ListOfficeName || ''))
    .filter((l) => l.StandardStatus === 'Active' && l.TransactionType !== 'For Lease' && l.PropertyType !== 'Commercial')
    .filter((l) => /,\s*London\b/.test(l.UnparsedAddress || ''))
    .sort((a, b) => String(b.OriginalEntryTimestamp).localeCompare(String(a.OriginalEntryTimestamp)))
    .slice(0, LISTING_COUNT);

  const areaByKey = await areaNamesByKey();
  return Promise.all(listings.map(async (l) => {
    let photo = null;
    try {
      const media = (await odataGet('Media', {
        $filter: `contains(ResourceRecordKey,'${l.ListingKey}')`,
        $select: 'MediaURL,Order,ImageSizeDescription',
        $orderby: 'Order',
        $top: '10',
      })).value || [];
      const firstOrder = Math.min(...media.map((m) => m.Order));
      const first = media.filter((m) => m.Order === firstOrder);
      photo = (first.find((m) => m.ImageSizeDescription === 'Large') || first[0])?.MediaURL || null;
    } catch (err) {
      console.error(`london-letter: photo lookup failed for ${l.ListingKey}:`, err.message);
    }
    const quadrant = (String(l.UnparsedAddress).split(',')[1] || '').trim();
    return {
      key: l.ListingKey,
      address: shortAddress(l.UnparsedAddress),
      area: areaByKey[l.ListingKey] || QUADRANT[quadrant] || 'London',
      price: l.ListPrice,
      beds: l.BedroomsTotal,
      baths: l.BathroomsTotalInteger,
      listedAt: String(l.OriginalEntryTimestamp || '').slice(0, 10),
      photo,
    };
  }));
}

// ---------------------------------------------------------------------------
// Blog pick
// ---------------------------------------------------------------------------

// src/data/blog.ts is TypeScript, so it's parsed with a regex rather than
// imported. netlify.toml force-includes the file in this function's bundle.
function stringField(chunk, name) {
  const m = new RegExp(`\\b${name}:\\s*(['"\`])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1`).exec(chunk);
  return m ? m[2].replace(/\\(['"`])/g, '$1') : null;
}

function getNewestBlogPost() {
  const src = readFileSync(new URL('../../src/data/blog.ts', import.meta.url), 'utf8');
  // Each post object starts at a line holding only "{" inside BLOG_POSTS;
  // only the fields before `content:` are read, so post bodies never match.
  const body = src.slice(src.indexOf('export const BLOG_POSTS'));
  const posts = body.split(/\n\s{2}\{\s*\n/).slice(1).map((chunk) => {
    const head = chunk.split(/\n\s+content:/)[0];
    const slug = stringField(head, 'slug');
    const date = /\bdate:\s*'(\d{4}-\d{2}-\d{2})'/.exec(head)?.[1];
    if (!slug || !date) return null;
    const href = stringField(head, 'href');
    return {
      slug,
      date,
      title: stringField(head, 'title'),
      description: stringField(head, 'description'),
      url: href ? `${SITE}${href}` : `${SITE}/blog/${slug}/`,
    };
  }).filter((p) => p && p.title && p.description);
  const candidates = posts
    .filter((p) => !p.slug.includes('market-update'))
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] || null;
}

// ---------------------------------------------------------------------------
// Newsletter HTML (email-client safe: tables + inline styles)
// ---------------------------------------------------------------------------

const PLACEHOLDER_STYLE = 'background:#fff4d6;color:#7a4b00;padding:2px 4px;';

function listingCell(l) {
  const img = l.photo
    ? `<img src="${esc(l.photo)}" width="260" alt="${esc(l.address)}" style="display:block;width:100%;height:auto;border-radius:4px;">`
    : `<div style="height:160px;background:#dbe4ea;border-radius:4px;"></div>`;
  return `<td class="col" width="50%" valign="top" style="padding:0 8px 16px;">
        <a href="${SITE}/properties/${esc(l.key)}/" style="text-decoration:none;color:#16283a;">
          ${img}
          <div style="font-weight:bold;font-size:15px;margin-top:8px;">$${Number(l.price).toLocaleString('en-CA')}</div>
          <div style="font-size:13px;color:#5a7185;line-height:1.4;">${esc(l.beds)} bed &middot; ${esc(l.baths)} bath &middot; ${esc(l.area)}<br>${esc(l.address)}</div>
        </a></td>`;
}

function buildNewsletter({ sendMonthName, sendYear, monthName, market, listings, blog }) {
  const sentences = marketSentences(market, monthName);
  const corner = oakridgeCorner(market, monthName);
  const bullet = (s, last) => `<tr><td width="22" valign="top" style="padding:5px 0 ${last ? 0 : 10}px;"><div style="width:10px;height:10px;border-radius:5px;background:#10b981;"></div></td><td style="padding:0 0 ${last ? 0 : 10}px;">${s}</td></tr>`;
  const rows = [];
  for (let i = 0; i < listings.length; i += 2) rows.push(`<tr>${listings.slice(i, i + 2).map(listingCell).join('')}</tr>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The London Letter, ${esc(sendMonthName)} ${sendYear}</title>
<style>
  @media only screen and (max-width:620px){
    .wrap{ width:100% !important; }
    .pad{ padding-left:20px !important; padding-right:20px !important; }
    .col{ display:block !important; width:100% !important; padding:0 0 18px 0 !important; }
    .h1{ font-size:27px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#e8eef1;">
<div style="display:none;max-height:0;overflow:hidden;">What London homes sold for in ${esc(monthName)}, new Chapman listings, and what's on in ${esc(sendMonthName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8eef1;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#16283a;">

  <tr><td class="pad" style="background:#0c2340;padding:28px 32px 24px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8fd9bd;">Justin Skrypnyk &middot; Chapman Team</div>
    <div class="h1" style="font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.1;color:#ffffff;margin-top:6px;">The London Letter</div>
    <div style="font-size:13px;color:#b8c7d6;margin-top:6px;">${esc(sendMonthName)} ${sendYear} &middot; Real estate and life in London, Ontario</div>
  </td></tr>

  <!-- JUSTIN'S NOTE: replace the highlighted paragraph -->
  <tr><td class="pad" style="padding:26px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="76" valign="top" style="padding-right:14px;"><img src="${SITE}/images/justin-skrypnyk-headshot-avatar.webp" width="64" height="64" alt="Justin Skrypnyk" style="display:block;width:64px;height:64px;border-radius:32px;"></td>
      <td valign="top" style="font-size:15px;line-height:1.6;">
        <p style="margin:0 0 10px;">Hi {{contact.first_name}},</p>
        <p style="margin:0 0 10px;"><span style="${PLACEHOLDER_STYLE}">[JUSTIN'S NOTE: 2 or 3 sentences from Justin about ${esc(monthName)}. Replace this whole highlighted line.]</span></p>
        <p style="margin:0 0 10px;">Here's a quick look at ${esc(monthName)}, our newest Chapman listings, and what's on around the city this month.</p>
        <p style="margin:0;font-family:Georgia,serif;font-style:italic;font-size:18px;color:#0c2340;">Justin</p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td class="pad" style="padding:26px 32px;border-top:1px solid #dbe4ea;">
    <div style="font-family:Georgia,serif;font-size:21px;color:#0c2340;margin:0 0 12px;">London in a minute</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:15px;line-height:1.5;">
      ${sentences.map((s, i) => bullet(s, i === sentences.length - 1)).join('\n      ')}
    </table>
    <p style="margin:12px 0 0;font-size:12px;color:#5a7185;">Based on MLS&reg; sales in the City of London, ${esc(monthName)} ${market.year}.</p>
  </td></tr>

  <tr><td class="pad" style="padding:26px 32px;border-top:1px solid #dbe4ea;background:#f6f8fa;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#047857;font-weight:bold;">West London corner</div>
    <div style="font-family:Georgia,serif;font-size:21px;color:#0c2340;margin:6px 0 12px;">${esc(corner.heading)}</div>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${esc(corner.body)}</p>
    <p style="margin:0;font-size:14px;line-height:1.55;"><span style="${PLACEHOLDER_STYLE}">[SMILE: add one west-end item here (event, park, road work or new business), with a link.]</span></p>
  </td></tr>

  <tr><td class="pad" align="center" style="padding:28px 32px;background:#f0f9f6;border-top:1px solid #dbe4ea;">
    <div style="font-family:Georgia,serif;font-size:21px;color:#0c2340;margin:0 0 8px;">Curious what your home is worth?</div>
    <p style="margin:0 auto;max-width:420px;font-size:15px;line-height:1.6;">Get an estimated range in about a minute. It's a starting point, not an appraisal, and I'm happy to follow up with a real number.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
      <td style="background:#047857;border-radius:4px;"><a href="${SITE}/home-value-estimate/" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;">See my home's range</a></td>
    </tr></table>
  </td></tr>
${listings.length ? `
  <tr><td class="pad" style="padding:26px 32px;border-top:1px solid #dbe4ea;">
    <div style="font-family:Georgia,serif;font-size:21px;color:#0c2340;margin:0 0 12px;">New Chapman listings this month</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${rows.join('\n      ')}
    </table>
    <a href="${SITE}/search/" style="display:inline-block;margin-top:6px;color:#047857;font-weight:bold;font-size:14px;text-decoration:none;">See all homes for sale &rarr;</a>
  </td></tr>
` : ''}
  <tr><td class="pad" style="padding:26px 32px;border-top:1px solid #dbe4ea;">
    <div style="font-family:Georgia,serif;font-size:21px;color:#0c2340;margin:0 0 6px;">Around London in ${esc(sendMonthName)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.55;">
      <tr><td style="padding:10px 0;border-top:1px solid #eef2f5;"><span style="${PLACEHOLDER_STYLE}">[SMILE: add 2 or 3 London events or news items for ${esc(sendMonthName)}, each with a link.]</span></td></tr>
    </table>
  </td></tr>
${blog ? `
  <tr><td class="pad" style="padding:26px 32px;border-top:1px solid #dbe4ea;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#047857;font-weight:bold;">From the blog</div>
    <div style="font-family:Georgia,serif;font-size:19px;color:#0c2340;margin:6px 0;">${esc(blog.title)}</div>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${esc(blog.description)}</p>
    <a href="${esc(blog.url)}" style="color:#047857;font-weight:bold;font-size:14px;text-decoration:none;">Read more &rarr;</a>
  </td></tr>
` : ''}
  <tr><td class="pad" align="center" style="padding:24px 32px;border-top:1px solid #dbe4ea;font-size:15px;line-height:1.6;">
    Know someone thinking about a move? I'd be glad to help them. Just reply to this email.
  </td></tr>

  <tr><td class="pad" style="background:#071829;color:#9fb2c2;font-size:12px;line-height:1.6;padding:22px 32px;">
    <b style="color:#ffffff;">Justin Skrypnyk, Real Estate Broker</b> &middot; Chapman Team<br>
    Sutton Group Chapman Realty Inc., Brokerage<br>
    <a href="${SITE}/" style="color:#8fd9bd;">liveinoakridge.ca</a><br>
    Listings shown are listed by Sutton Group Chapman Realty Inc., Brokerage. Not intended to solicit buyers or sellers currently under contract.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// The email to Smile
// ---------------------------------------------------------------------------

function subjectIdeas(market, monthName) {
  const change = yoy(market.city.median, market.city.lastYear.median);
  const oakChange = yoy(market.oak.median, market.oak.lastYear.median);
  const ideas = [`What London homes sold for in ${monthName}`];
  if (change != null && change <= -0.03 && oakChange != null && Math.abs(oakChange) < 0.03 && market.oak.count >= OAKRIDGE_MIN_SALES) ideas.push('London prices eased, Oakridge held steady');
  else if (change != null && Math.abs(change) < 0.03) ideas.push(`London prices held steady in ${monthName}`);
  else if (change != null && change >= 0.03) ideas.push(`London prices rose in ${monthName}`);
  ideas.push(`${monthName} in London, plus new Chapman listings`);
  return ideas;
}

function buildSmileEmail({ sendMonthName, sendYear, monthName, market, listings, blog, newsletterHtml, isTest }) {
  const statsLine = `London: ${market.city.count} sales, typical price ${market.city.median ? fmtRoundPrice(market.city.median) : 'n/a'} (a year ago ${market.city.lastYear.median ? fmtRoundPrice(market.city.lastYear.median) : 'n/a'}), ${market.city.moi != null ? `${market.city.moi.toFixed(1)} months of inventory` : 'months of inventory n/a'}. Oakridge: ${market.oak.count} sales, typical price ${market.oak.median ? fmtRoundPrice(market.oak.median) : 'n/a'} (a year ago ${market.oak.lastYear.median ? fmtRoundPrice(market.oak.lastYear.median) : 'n/a'}).`;
  const body = `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#16283a;max-width:680px;">
  ${isTest ? '<p style="background:#fde2e2;padding:8px;"><b>TEST RUN.</b> This went to Justin only.</p>' : ''}
  <p>Hi Smile,</p>
  <p>The ${esc(sendMonthName)} London Letter draft is ready. The file to paste into GHL is attached (<b>london-letter-${sendYear}-${String(MONTHS.indexOf(sendMonthName) + 1).padStart(2, '0')}.html</b>), and a preview is at the bottom of this email.</p>

  <h3 style="margin:22px 0 6px;">Your steps</h3>
  <ol>
    <li>In GHL, go to Marketing &gt; Emails &gt; Templates &gt; New and pick the code editor (HTML) option. Open the attached file in TextEdit, copy everything, and paste it in.</li>
    <li><b>Justin's note:</b> replace the highlighted yellow line near the top with Justin's 2 or 3 sentences for this month.</li>
    <li><b>Local news:</b> fill in the two yellow spots. Add 1 west-end item in the West London corner (Oakridge, Byron, Westmount, Hyde Park and nearby) and 2 or 3 London items under "Around London", each with a link. Good places to look: london.ca/newsroom, londontourism.ca/events and CBC London. Only use things happening this month, and double-check the dates.</li>
    <li><b>Listings:</b> click each listing and confirm it's still for sale. If one has sold, swap in another current Sutton Group Chapman Realty listing (never another brokerage's).</li>
    <li>Pick a subject line (ideas below), send a test to yourself and Justin, and check it on your phone: photos show, links work, and the unsubscribe line and business address appear at the bottom.</li>
    <li>Send to the newsletter list once Justin approves the test.</li>
  </ol>

  <h3 style="margin:22px 0 6px;">Subject line ideas</h3>
  <ul>${subjectIdeas(market, monthName).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>


  <h3 style="margin:22px 0 6px;">What's in the draft</h3>
  <ul>
    <li><b>Numbers:</b> ${esc(statsLine)}</li>
    <li><b>Listings:</b> ${listings.length ? listings.map((l) => `${esc(l.address)} (${esc(l.area)}, $${Number(l.price).toLocaleString('en-CA')}, listed ${esc(l.listedAt)})`).join('; ') : 'No active Chapman listings were found, so the listings section was left out.'}</li>
    <li><b>Blog:</b> ${blog ? `${esc(blog.title)} (${esc(blog.url)})` : 'No blog post found, so the section was left out.'}</li>
  </ul>
  <p style="font-size:13px;color:#5a7185;">The market sentences are written by fixed rules from the MLS&reg; numbers above, not by AI.</p>

  <hr style="margin:28px 0;border:0;border-top:2px solid #dbe4ea;">
  <p style="font-size:13px;color:#5a7185;">Preview:</p>
</div>`;
  const preview = newsletterHtml.slice(newsletterHtml.indexOf('<body'), newsletterHtml.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  return `${body}${preview}`;
}

async function sendEmail({ to, cc, subject, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
      to,
      cc,
      subject,
      html,
      attachments,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

async function sendFailureAlert(message) {
  if (!RESEND_API_KEY) return;
  try {
    await sendEmail({
      to: [JUSTIN_EMAIL], // internal ops alert -- Justin only, not Smile
      subject: '⚠️ London Letter draft FAILED',
      html: `<p>${esc(message)}</p><p>Check Netlify function logs for london-letter-draft-background.</p>`,
    });
  } catch (err) {
    console.error('london-letter: failure alert itself failed to send:', err.message);
  }
}

export default async (req) => {
  let isTest = false;
  let dryRun = false;
  try {
    const body = await req?.json?.();
    isTest = body?.test === true;
    dryRun = body?.dryRun === true;
  } catch {
    // scheduled runs carry no JSON body
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || (!dryRun && !RESEND_API_KEY)) {
    console.error('london-letter: missing required env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  // Runs on the 1st: report on the month that just ended, name the issue
  // after the month it goes out in.
  const now = new Date();
  const sendYear = now.getUTCFullYear();
  const sendMonthIndex = now.getUTCMonth();
  const reportDate = new Date(Date.UTC(sendYear, sendMonthIndex - 1, 1));
  const reportYear = reportDate.getUTCFullYear();
  const reportMonthIndex = reportDate.getUTCMonth();
  const monthName = MONTHS[reportMonthIndex];
  const sendMonthName = MONTHS[sendMonthIndex];

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [market, listings] = await Promise.all([
      getMarket(supabase, reportYear, reportMonthIndex).then((m) => ({ ...m, year: reportYear })),
      getChapmanListings().catch((err) => {
        console.error('london-letter: Chapman listings failed:', err.message);
        return [];
      }),
    ]);
    let blog = null;
    try {
      blog = getNewestBlogPost();
    } catch (err) {
      console.error('london-letter: blog lookup failed:', err.message);
    }
    if (market.city.count === 0) throw new Error(`No London sales found for ${monthName} ${reportYear} -- is the VOW sold sync running?`);

    const parts = { sendMonthName, sendYear, monthName, market, listings, blog };
    const newsletterHtml = buildNewsletter(parts);
    const smileHtml = buildSmileEmail({ ...parts, newsletterHtml, isTest });

    if (dryRun) {
      return new Response(JSON.stringify({ newsletterHtml, smileHtml, market, listings, blog }), { headers: { 'Content-Type': 'application/json' } });
    }

    const fileName = `london-letter-${sendYear}-${String(sendMonthIndex + 1).padStart(2, '0')}.html`;
    await sendEmail({
      to: isTest ? [JUSTIN_EMAIL] : [SMILE_EMAIL],
      cc: isTest ? undefined : [JUSTIN_EMAIL],
      subject: `${isTest ? '[TEST] ' : ''}London Letter draft for ${sendMonthName}: ready for GHL`,
      html: smileHtml,
      attachments: [{ filename: fileName, content: Buffer.from(newsletterHtml).toString('base64') }],
    });

    const summary = `london-letter sent${isTest ? ' (test)' : ''}: ${market.city.count} London sales, ${listings.length} listings, blog ${blog ? blog.slug : 'none'}`;
    console.log(summary);
    return new Response(summary);
  } catch (err) {
    console.error('london-letter: failed:', err.message);
    if (!dryRun) await sendFailureAlert(`The ${sendMonthName} London Letter draft failed: ${err.message}`);
    return new Response(`Failed: ${err.message}`, { status: 500 });
  }
};

export const config = {
  schedule: '0 15 1 * *', // 1st of month, 3pm UTC -- after heat-map-snapshot (9am) and monthly-digest (1pm), which writes the month-end citywide_snapshots row read here
};
