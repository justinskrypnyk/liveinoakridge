// Email-safe listing card (photo on the left, price + address + link on the
// right) for the GHL Recommended Listing emails Smile builds. The site pushes
// each card's finished HTML into a GHL custom field, so her template only
// needs {{contact.recommended_listing_1_card}} etc. -- and an unused slot is
// an empty field, which renders nothing instead of a broken image.
//
// Plain .mjs (not .ts) because it's shared by the Astro API routes and the
// scheduled Netlify functions (saved-search-alerts, home-watch-alerts).
//
// The photo comes from /api/email-thumb/<key>.jpg, which crops every listing
// photo to the same 3:2 shape -- MLS photos come in all proportions, and most
// email clients (Gmail, Outlook) ignore object-fit, so the crop has to happen
// server-side for the cards to line up.

const THUMB_W = 150;
const THUMB_H = 100; // 3:2

/**
 * Tags a site link so GA4 shows the visit as email traffic from this email
 * (Acquisition > Traffic acquisition, session medium "email", campaign = which email).
 * Links to other sites are left alone.
 */
export function withUtm(url, campaign) {
  if (!campaign || !/^https:\/\/(www\.)?liveinoakridge\.ca\b/.test(String(url))) return url;
  const u = new URL(url);
  u.searchParams.set('utm_source', 'ghl');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The feed puts the unit number after the street type ("925 Lawson Road 8"),
// which reads like a typo in an email.
const STREET_UNIT = /^(.+\b(?:Road|Rd|Street|St|Drive|Dr|Avenue|Ave|Crescent|Cres|Court|Crt|Ct|Boulevard|Blvd|Lane|Ln|Way|Place|Pl|Terrace|Terr|Trail|Circle|Cir|Gate|Parkway|Pkwy|Line|Square|Sq|Grove|Heights|Hts|Common|Commons|Private|Row|Walk|Path|Mews)\.?(?:\s+(?:E|W|N|S|East|West|North|South)\.?)?)\s+([A-Za-z]?\d+[A-Za-z]?)$/i;

// "455 Hyde Park Road 15, London North, ON N6H 3R9" -> ["455 Hyde Park Road, Unit 15", "London North"]
function addressLines(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  const street = (parts[0] || 'Address unavailable').replace(STREET_UNIT, '$1, Unit $2');
  return [street, parts[1] || ''];
}

// "3 bed · 2 bath"; either half is left out when the feed has no number for it.
function bedsBathsText(beds, baths) {
  const n = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return [n(beds) != null ? `${n(beds)} bed` : '', n(baths) != null ? `${n(baths)} bath` : ''].filter(Boolean).join(' &middot; ');
}

/**
 * @param {{ siteUrl: string, key: string, address: string, price: number | null, url: string, sold?: boolean, campaign?: string, label?: string, previousPrice?: number | null, beds?: number | string | null, baths?: number | string | null }} l
 *   key: the MLS® number (ListingKey), shown on the card and used for the photo.
 *   label: replaces the "For sale"/"Sold" line, e.g. "Open house · Sat 2-4 PM".
 *   previousPrice: shown crossed out after the price (price-drop alerts).
 * @returns {string}
 */
export function listingCardHtml({ siteUrl, key, address, price, url: rawUrl, sold = false, campaign, label, previousPrice, beds, baths }) {
  const url = withUtm(rawUrl, campaign);
  const fmt = (n) => `$${Math.round(Number(n)).toLocaleString('en-CA')}`;
  const wasText = previousPrice != null && Number(previousPrice) > Number(price)
    ? ` <span style="font-size:14px;font-weight:normal;color:#5a7185;text-decoration:line-through;">${fmt(previousPrice)}</span>`
    : '';
  const [street, area] = addressLines(address);
  const priceText = price != null && Number(price) > 0 ? fmt(price) : 'Price on request';
  const bedsBaths = bedsBathsText(beds, baths);
  const thumb = `${siteUrl}/api/email-thumb/${encodeURIComponent(key)}.jpg`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid #dbe4ea;border-radius:6px;border-collapse:separate;max-width:560px;">
<tr>
<td width="${THUMB_W}" valign="top" style="padding:10px;"><a href="${esc(url)}"><img src="${esc(thumb)}" width="${THUMB_W}" height="${THUMB_H}" alt="${esc(street)}" style="display:block;width:${THUMB_W}px;height:${THUMB_H}px;border:0;border-radius:4px;"></a></td>
<td valign="middle" style="padding:10px 12px 10px 6px;font-family:Helvetica,Arial,sans-serif;color:#16283a;">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#047857;font-weight:bold;">${esc(label || (sold ? 'Sold' : 'For sale'))}</div>
<div style="font-size:18px;font-weight:bold;margin-top:2px;">${priceText}${wasText}</div>
${bedsBaths ? `<div style="font-size:14px;font-weight:bold;color:#16283a;margin-top:2px;">${bedsBaths}</div>\n` : ''}<div style="font-size:14px;color:#5a7185;line-height:1.4;margin-top:2px;"><a href="${esc(url)}" style="color:#5a7185;text-decoration:none;">${esc(street)}${area ? `<br>${esc(area)}` : ''}</a></div>
<div style="font-size:12px;color:#5a7185;margin-top:4px;"><a href="${esc(url)}" style="color:#5a7185;text-decoration:none;">MLS&reg; ${esc(key)}</a></div>
<a href="${esc(url)}" style="display:inline-block;margin-top:8px;font-size:14px;font-weight:bold;color:#047857;text-decoration:none;">${sold ? 'See the details' : 'View this home'} &rarr;</a>
</td>
</tr>
</table>`;
}

/** The three card custom fields, always all 3 -- an empty value clears a slot (same rule as recommended_listing_1..3). */
export function listingCardFields(cards) {
  return [0, 1, 2].map((i) => ({ key: `recommended_listing_${i + 1}_card`, fieldValue: cards[i] ?? '' }));
}
