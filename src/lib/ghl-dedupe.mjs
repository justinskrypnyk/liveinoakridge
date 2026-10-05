// Two sites, one GHL location (Justin, 2026-10-04): liveinoakridge.ca and
// londonontariohomes.ca both email listing alerts to contacts in the same
// GHL account, and a buyer can have saved searches on both. So nobody gets
// two listing emails the same morning, every listing alert stamps the
// contact's `last_listing_email_on` custom field with "<Toronto date>|<site>",
// and each site skips a contact the OTHER site already emailed today (its
// own repeats are left to its own schedule). londonontariohomes.ca writes
// and checks the same field with its own site name.
//
// The field has to exist in GHL (Smile: a single-line text field named
// "Last Listing Email On"); until it does, the lookups find nothing and
// alerts go out exactly as before. Any API error also lets the alert go out:
// a missed dedupe is a small annoyance, a missed alert is a lost lead.

export const SITE_NAME = 'liveinoakridge';
export const SITE_TAG = 'Site: liveinoakridge.ca';
const FIELD_KEY = 'last_listing_email_on';
const API = 'https://services.leadconnectorhq.com';

export const torontoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

/** The custom-field entry to include in an alert's upsert. */
export const lastListingEmailField = () => ({ key: FIELD_KEY, fieldValue: `${torontoToday()}|${SITE_NAME}` });

let fieldIdPromise = null;
async function fieldId(headers, locationId) {
  if (!fieldIdPromise) {
    fieldIdPromise = (async () => {
      const res = await fetch(`${API}/locations/${locationId}/customFields?model=contact`, { headers });
      if (!res.ok) return null;
      const fields = (await res.json())?.customFields || [];
      return fields.find((f) => f.fieldKey === `contact.${FIELD_KEY}`)?.id || null;
    })().catch(() => null);
  }
  return fieldIdPromise;
}

/** True when another site already sent this email address a listing alert today. */
export async function otherSiteEmailedToday(email, headers, locationId) {
  try {
    const id = await fieldId(headers, locationId);
    if (!id || !email) return false;
    const found = await fetch(`${API}/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(email)}`, { headers });
    if (!found.ok) return false;
    const contactId = (await found.json())?.contact?.id;
    if (!contactId) return false;
    const res = await fetch(`${API}/contacts/${contactId}`, { headers });
    if (!res.ok) return false;
    const value = String(((await res.json())?.contact?.customFields || []).find((f) => f.id === id)?.value || '');
    const [day, site] = value.split('|');
    return day === torontoToday() && Boolean(site) && site !== SITE_NAME;
  } catch {
    return false;
  }
}
