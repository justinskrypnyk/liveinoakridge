// Shared "push a recommendation into GHL" helper -- used by the save-listing
// similarity flow, the home-address watch alerts, the saved-search alerts,
// and the periodic market-update mailout. All four boil down to the same
// shape: upsert the contact, tag it so the matching GHL workflow fires the
// actual email (built once by Justin, see the GHL setup email), and hand
// over the content both as a note (always works, visible immediately on the
// contact) and as custom fields (best-effort merge-field population for the
// email itself).
//
// The custom field `key` values below assume GHL auto-generates
// `contact.<slugified_field_name>` from the field name Justin was told to
// use exactly (e.g. "Recommended Listing 1" -> contact.recommended_listing_1).
// If his account produced a different key, this simply fails to populate
// the merge field silently (try/catch) -- the note still has everything, so
// nothing is lost either way.
const GHL_API_TOKEN = import.meta.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = import.meta.env.GHL_LOCATION_ID;

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${GHL_API_TOKEN}`,
  Version: '2021-07-28',
};

export type RecommendationTag =
  | 'nosy-neighbour-alert'
  | 'similar-homes-match'
  | 'search-area-alert'
  | 'market-update'
  | 'vow-signup';

export interface RecommendedListingLine {
  address: string;
  price: number | null;
  url: string;
}

export interface PushRecommendationInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  tag: RecommendationTag;
  /** One-line context shown at the top of the note, e.g. "Homes near 123 Oak St" */
  intro: string;
  /** Up to 3 recommended listings -- omit/empty for the market-update tag, which uses `summary` instead. */
  listings?: RecommendedListingLine[];
  /** Plain-text market update paragraph -- only used for the market-update tag. */
  summary?: string;
}

function formatListingLine(l: RecommendedListingLine): string {
  const price = l.price != null ? `$${Math.round(l.price).toLocaleString('en-CA')}` : 'Price n/a';
  return `${l.address} — ${price} — ${l.url}`;
}

/** Fire-and-log: never throws -- a failed GHL push shouldn't break the caller's main flow (a save, a scheduled match, etc). */
export async function pushRecommendationToGhl(input: PushRecommendationInput): Promise<void> {
  if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
    console.error('GHL env vars missing, skipping recommendation push for', input.email);
    return;
  }

  const lines = (input.listings ?? []).slice(0, 3).map(formatListingLine);

  const customFields = input.tag === 'market-update'
    ? (input.summary ? [{ key: 'contact.market_update_summary', field_value: input.summary }] : [])
    : lines.map((value, i) => ({ key: `contact.recommended_listing_${i + 1}`, field_value: value }));

  let contactId: string | null = null;
  try {
    const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        firstName: input.firstName || undefined,
        lastName: input.lastName || undefined,
        email: input.email,
        phone: input.phone || undefined,
        locationId: GHL_LOCATION_ID,
        tags: [input.tag],
        customFields,
        source: 'Website — Automated Recommendation',
      }),
    });
    if (!res.ok) {
      console.error('GHL recommendation upsert failed:', res.status, await res.text().catch(() => ''));
      return;
    }
    const upserted = await res.json();
    contactId = upserted?.contact?.id ?? null;
  } catch (err) {
    console.error('GHL recommendation upsert failed:', err);
    return;
  }

  const noteBody = [input.intro, ...lines, input.summary].filter(Boolean).join('\n');
  if (!contactId || !noteBody) return;

  try {
    const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ body: noteBody }),
    });
    if (!noteRes.ok) console.error('GHL recommendation note failed:', noteRes.status, await noteRes.text().catch(() => ''));
  } catch (err) {
    console.error('GHL recommendation note failed:', err);
  }
}
