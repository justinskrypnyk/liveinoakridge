// "Your lead is back" alerts (Justin, 2026-09-29). Every 20 minutes, looks
// at the pages known leads have viewed on their return visits (written by
// src/pages/api/lead-back.ts to lead-activity/<contactId>/...). Once a
// visit has gone quiet for 20 minutes, it emails Justin who came back and
// what they looked at, and adds the same summary to the GHL contact as a
// note. At most one email per lead every 6 hours; later visits in that
// window still get their note. Contacts tagged "No site tracking" in GHL
// (people who asked us to stop, per the privacy policy) are skipped.

import { getStore } from '@netlify/blobs';

const GHL = 'https://services.leadconnectorhq.com';
const ALERT_TO = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';
const QUIET_MINUTES = 20;
const EMAIL_EVERY_HOURS = 6;
const MAX_CONTACTS_PER_RUN = 40;
const MAX_PAGES_PER_VISIT = 60;
const DROP_AFTER_DAYS = 7;
const TZ = 'America/Toronto';
const OPT_OUT_TAG = 'no site tracking';

const ghlHeaders = () => ({
  Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
  Version: '2021-07-28',
  Accept: 'application/json',
  'Content-Type': 'application/json',
});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (iso) => new Date(iso).toLocaleString('en-CA', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// "32 HUNTER WOODS Crescent, London South, ON N6J 2B1 | $659,900 | Justin..." -> address + price
function listingOf(v) {
  const [address = v.p, price = ''] = String(v.ti || '').split(' | ');
  return { address: address.replace(/,\s*ON\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, ''), price: price.startsWith('$') ? price : '', path: v.p };
}
function searchOf(q) {
  const k = (n) => `$${Math.round(Number(n) / 1000)}K`;
  const bits = [q.area ? titleCase(q.area) : 'All areas'];
  if (q.minBeds) bits.push(`${q.minBeds}+ bed`);
  if (q.minPrice && q.maxPrice) bits.push(`${k(q.minPrice)}–${k(q.maxPrice)}`);
  else if (q.maxPrice) bits.push(`under ${k(q.maxPrice)}`);
  else if (q.minPrice) bits.push(`${k(q.minPrice)}+`);
  if (q.types) bits.push(titleCase(q.types.replace(/,/g, ', ')));
  return bits.join(' · ');
}

function summarize(views) {
  const listings = [];
  const solds = [];
  const searches = [];
  const other = [];
  for (const v of views) {
    if (/^\/search\/[A-Za-z0-9]{5,20}\/?$/.test(v.p)) { if (!listings.some((l) => l.path === v.p)) listings.push(listingOf(v)); }
    else if (/^\/sold-map\/[A-Za-z0-9]{5,20}\/?$/.test(v.p)) { if (!solds.some((l) => l.path === v.p)) solds.push(listingOf(v)); }
    else if (v.q) { const s = searchOf(v.q); if (!searches.includes(s)) searches.push(s); }
    else { const t = String(v.ti || v.p).split(' | ')[0]; if (!other.includes(t)) other.push(t); }
  }
  return { listings, solds, searches, other };
}

async function sendEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Live In Oakridge Alerts <reports@mail.liveinoakridge.ca>', to: [ALERT_TO], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

export default async () => {
  if (!process.env.GHL_API_TOKEN) return new Response('lead-back-alerts: GHL_API_TOKEN missing', { status: 500 });
  const activity = getStore('lead-activity');
  const alerted = getStore('lead-alerted');

  const { blobs } = await activity.list();
  const byContact = new Map();
  for (const { key } of blobs) {
    const [contactId, stamp] = key.split('/');
    const ms = Number(String(stamp || '').split('-')[0]);
    if (!contactId || !ms) continue;
    if (!byContact.has(contactId)) byContact.set(contactId, []);
    byContact.get(contactId).push({ key, ms });
  }

  let emailed = 0;
  let noted = 0;
  let processed = 0;
  for (const [contactId, items] of byContact) {
    if (processed >= MAX_CONTACTS_PER_RUN) break;
    items.sort((a, b) => a.ms - b.ms);
    const newest = items.at(-1).ms;
    // Still browsing: wait until the visit has been quiet for a while.
    if (Date.now() - newest < QUIET_MINUTES * 60000) continue;
    processed++;
    const keys = items.map((i) => i.key);
    const drop = async () => { for (const k of keys) await activity.delete(k).catch(() => {}); };

    // Stale leftovers (e.g. the job was down) aren't worth an alert.
    if (Date.now() - newest > DROP_AFTER_DAYS * 86400000) { await drop(); continue; }

    const views = [];
    for (const { key } of items.slice(-MAX_PAGES_PER_VISIT)) {
      const v = await activity.get(key, { type: 'json' }).catch(() => null);
      if (v) views.push(v);
    }
    if (!views.length) { await drop(); continue; }

    // Who it is. An id GHL doesn't know (a mistyped or made-up email link) is dropped.
    const res = await fetch(`${GHL}/contacts/${contactId}`, { headers: ghlHeaders() });
    if (res.status === 400 || res.status === 404 || res.status === 422) { await drop(); continue; }
    if (!res.ok) { console.error(`lead-back-alerts: GHL contact lookup HTTP ${res.status}`); continue; } // try again next run
    const c = (await res.json())?.contact || {};
    // Asked us not to (privacy policy): Justin or Smile adds this tag in GHL.
    if ((c.tags || []).some((t) => String(t).toLowerCase() === OPT_OUT_TAG)) { await drop(); continue; }
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || c.email || 'A past lead';
    const place = views.map((v) => v.place).find(Boolean) || '';
    const via = views.some((v) => v.via === 'email') ? 'clicked a link in one of your emails' : 'came back on their own';
    const { listings, solds, searches, other } = summarize(views);
    const started = views[0].at;

    // Kept for the Monday traffic report's Email section (the activity
    // blobs themselves are deleted below once the visit is handled).
    try {
      const day = new Date(started).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      await getStore('lead-back-log').setJSON(`${day}/${contactId}-${new Date(started).getTime()}`, {
        name,
        via: views.some((v) => v.via === 'email') ? 'email' : 'returned',
        pages: views.length,
        listings: listings.slice(0, 3).map((l) => l.address),
        at: started,
      });
    } catch (err) {
      console.error('lead-back-alerts: weekly log failed', err);
    }

    // GHL note (every visit).
    const noteLines = [
      `Back on the website ${when(started)}${place ? ` (from ${place})` : ''}, ${via}. ${views.length} page${views.length === 1 ? '' : 's'}.`,
      listings.length && `Listings viewed: ${listings.map((l) => `${l.address}${l.price ? ` (${l.price})` : ''}`).join('; ')}`,
      searches.length && `Searched: ${searches.join('; ')}`,
      solds.length && `Sold homes looked at: ${solds.map((l) => l.address).join('; ')}`,
      other.length && `Also read: ${other.slice(0, 8).join('; ')}`,
    ].filter(Boolean);
    try {
      const n = await fetch(`${GHL}/contacts/${contactId}/notes`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ body: noteLines.join('\n') }) });
      if (n.ok) noted++;
      else console.error('lead-back-alerts: note failed', n.status);
    } catch (err) {
      console.error('lead-back-alerts: note failed', err);
    }

    // Email Justin, at most once per lead every few hours.
    const last = await alerted.get(contactId, { type: 'json' }).catch(() => null);
    if (!last || Date.now() - new Date(last.at).getTime() > EMAIL_EVERY_HOURS * 3600000) {
      const li = (s) => `<li style="margin:3px 0;">${s}</li>`;
      const section = (title, rows) => (rows.length ? `<p style="margin:14px 0 4px;"><b>${title}</b></p><ul style="margin:0;padding-left:20px;">${rows.join('')}</ul>` : '');
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#16283a;max-width:620px;">
        <p style="font-size:16px;margin:0 0 6px;"><b>${esc(name)}</b> was back on the website ${esc(when(started))}${place ? ` from ${esc(place)}` : ''}.</p>
        <p style="margin:0;color:#5a7185;">They ${esc(via)} and viewed ${views.length} page${views.length === 1 ? '' : 's'}.</p>
        ${section('Listings they looked at', listings.map((l) => li(`<a href="https://www.liveinoakridge.ca${esc(l.path)}" style="color:#047857;">${esc(l.address)}</a>${l.price ? ` · ${esc(l.price)}` : ''}`)))}
        ${section('What they searched for', searches.map((s) => li(esc(s))))}
        ${section('Sold homes they looked at', solds.map((l) => li(esc(l.address))))}
        ${section('Also read', other.slice(0, 8).map((t) => li(esc(t))))}
        <p style="margin:18px 0 4px;"><b>Contact</b></p>
        <p style="margin:0;">${esc(name)}${c.phone ? ` · <a href="tel:${esc(c.phone)}" style="color:#047857;">${esc(c.phone)}</a>` : ''}${c.email ? ` · ${esc(c.email)}` : ''}</p>
        <p style="color:#5a7185;font-size:12px;margin-top:18px;">The same summary is saved as a note on their GHL contact. You'll get at most one of these per person every ${EMAIL_EVERY_HOURS} hours.</p>
      </div>`;
      const subject = `🔔 ${name} is back on the site${listings.length ? `: ${listings.length} listing${listings.length === 1 ? '' : 's'} viewed` : ''}`;
      try {
        await sendEmail(subject, html);
        await alerted.setJSON(contactId, { at: new Date().toISOString() });
        emailed++;
      } catch (err) {
        console.error('lead-back-alerts: email failed', err);
      }
    }
    await drop();
  }

  const summary = `lead-back-alerts: ${byContact.size} leads with activity, ${processed} visits finished, ${emailed} emails, ${noted} notes`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '*/20 * * * *',
};
