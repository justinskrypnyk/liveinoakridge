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
//
// BUG FOUND + FIXED 2026-09-09: this was ALSO silently failing for TWO
// unrelated reasons the whole time:
//   1. Every customFields entry used `field_value` (snake_case), but GHL's
//      actual API property is `fieldValue` (camelCase, confirmed against
//      HighLevel's own docs).
//   2. The `key` itself was wrong too -- `contact.<slug>` is how GHL's
//      dashboard *displays* a field's key dressed up as the merge tag
//      you'd paste into an email ({{contact.<slug>}}), not the actual key
//      the upsert API wants. It wants the bare slug with no "contact."
//      prefix. Confirmed via a live round-trip test (push with the bare
//      key, GET the contact back, value was there; the "contact."-prefixed
//      form came back with an empty customFields array every time).
// Either bug alone would silently drop every field, so this has been
// completely broken since Gen 2 shipped 2026-07-23 -- meaning none of
// nosy-neighbour-alert/search-area-alert/market-update's merge fields have
// ever actually populated in a live GHL workflow email, however long those
// workflows have existed. Found while verifying the AskWidget chatbot's new
// custom-field push end-to-end against real GHL (see ghl-lead.ts) -- same
// bug, copy-pasted into every one of this pipeline's customFields builders.
// Fixed here and in ghl-lead.ts, home-watch-alerts-background.mjs,
// saved-search-alerts-background.mjs, and market-update-mailout-background.mjs.
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
  | 'vow-signup'
  | 'School Search Lead';

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

// GHL's contacts/upsert REPLACES a contact's whole tags array and overwrites
// its `source` (both confirmed against the live API 2026-09-23 with a
// throwaway contact) -- so a repeat upsert silently wiped every tag an
// earlier form/alert had set, and relabelled the lead's original source.
// Upsert WITHOUT tags (existing tags are then left alone), then add tags
// through this endpoint, which merges. Tags are added after the upsert on
// purpose: tag-triggered workflows must see the custom fields already set.
export async function addGhlTags(contactId: string, tags: string[]): Promise<void> {
  if (!contactId || tags.length === 0) return;
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) console.error('GHL add-tags failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('GHL add-tags failed:', err);
  }
}

async function removeGhlTags(contactId: string, tags: string[]): Promise<void> {
  try {
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ tags }),
    });
  } catch {
    // Removing a tag the contact doesn't have is a no-op; a failure here only
    // means the workflow may not re-fire, never a lost lead.
  }
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
    ? (input.summary ? [{ key: 'market_update_summary', fieldValue: input.summary }] : [])
    // Always all 3 -- an empty value clears the field (confirmed live), so a
    // 1-listing push doesn't email last time's leftover listings 2 and 3.
    : [0, 1, 2].map((i) => ({ key: `recommended_listing_${i + 1}`, fieldValue: lines[i] ?? '' }));

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
        // No tags/source here -- see addGhlTags. Every contact this pipeline
        // touches already came in through a site form, whose source should
        // survive.
        customFields,
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


  if (!contactId) return;

  const noteBody = [input.intro, ...lines, input.summary].filter(Boolean).join('\n');
  if (noteBody) {
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

  // Tags last, so the tag-triggered workflow sees the fields/note already set.
  // The recommendation tag is removed first so re-adding it always fires the
  // workflow's "tag added" trigger, even if an earlier push left it on.
  // Website Lead is re-asserted so every contact this pipeline touches stays
  // filterable; both merge, so nothing else on the contact is lost.
  await removeGhlTags(contactId, [input.tag]);
  await addGhlTags(contactId, ['Website Lead', input.tag]);
}
