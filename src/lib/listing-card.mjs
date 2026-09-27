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

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "455 Hyde Park Road 15, London North, ON N6H 3R9" -> ["455 Hyde Park Road 15", "London North"]
function addressLines(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  return [parts[0] || 'Address unavailable', parts[1] || ''];
}

/**
 * @param {{ siteUrl: string, key: string, address: string, price: number | null, url: string, sold?: boolean }} l
 * @returns {string}
 */
export function listingCardHtml({ siteUrl, key, address, price, url, sold = false }) {
  const [street, area] = addressLines(address);
  const priceText = price != null && Number(price) > 0 ? `$${Math.round(Number(price)).toLocaleString('en-CA')}` : 'Price on request';
  const thumb = `${siteUrl}/api/email-thumb/${encodeURIComponent(key)}.jpg`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid #dbe4ea;border-radius:6px;border-collapse:separate;max-width:560px;">
<tr>
<td width="${THUMB_W}" valign="top" style="padding:10px;"><a href="${esc(url)}"><img src="${esc(thumb)}" width="${THUMB_W}" height="${THUMB_H}" alt="${esc(street)}" style="display:block;width:${THUMB_W}px;height:${THUMB_H}px;border:0;border-radius:4px;"></a></td>
<td valign="middle" style="padding:10px 12px 10px 6px;font-family:Helvetica,Arial,sans-serif;color:#16283a;">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#047857;font-weight:bold;">${sold ? 'Sold' : 'For sale'}</div>
<div style="font-size:18px;font-weight:bold;margin-top:2px;">${priceText}</div>
<div style="font-size:14px;color:#5a7185;line-height:1.4;margin-top:2px;">${esc(street)}${area ? `<br>${esc(area)}` : ''}</div>
<a href="${esc(url)}" style="display:inline-block;margin-top:8px;font-size:14px;font-weight:bold;color:#047857;text-decoration:none;">${sold ? 'See the details' : 'View this home'} &rarr;</a>
</td>
</tr>
</table>`;
}

/** The three card custom fields, always all 3 -- an empty value clears a slot (same rule as recommended_listing_1..3). */
export function listingCardFields(cards) {
  return [0, 1, 2].map((i) => ({ key: `recommended_listing_${i + 1}_card`, fieldValue: cards[i] ?? '' }));
}
