// Every contact the site creates in GHL belongs to Justin (added 2026-09-29,
// ahead of a second agent joining the sub-account). Without an owner, a
// website lead lands unassigned and could be picked up by anyone or a
// round-robin rule.
//
// Only claims a contact nobody owns yet: brand-new contacts, and existing
// ones GHL reports as unassigned. A contact already assigned -- e.g. one
// Justin handed to the other agent -- is left alone, so an alert email or a
// repeat form fill never takes it back.
//
// Plain .mjs so the Astro API routes and the scheduled Netlify functions can
// share it (same as listing-card.mjs).

export const GHL_OWNER_USER_ID = 'OeFLCES8V4ETmMtgkm5k'; // Justin Skrypnyk

/** `upserted` is the parsed JSON from POST /contacts/upsert. */
export async function assignOwnerIfUnowned(upserted, headers) {
  const contact = upserted?.contact;
  if (!contact?.id) return;
  const unowned = upserted.new || ('assignedTo' in contact && !contact.assignedTo);
  if (!unowned) return;
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ assignedTo: GHL_OWNER_USER_ID }),
    });
    if (!res.ok) console.error('GHL assign owner failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('GHL assign owner failed:', err);
  }
}
