// Shared by the heatmap viewer (src/pages/admin/heatmap.astro) and the
// Monday traffic email (weekly-traffic-digest-background.mjs).

// "Local" = London and the towns around it. Anything else counts as out of
// town -- often people planning a move to London.
export const LONDON_AREA = new Set([
  'London', 'St. Thomas', 'Saint Thomas', 'Strathroy', 'Komoka', 'Kilworth', 'Lambeth', 'Ilderton', 'Dorchester',
  'Thorndale', 'Delaware', 'Arva', 'Mount Brydges', 'Belmont', 'Lucan', 'Ingersoll', 'Aylmer',
]);
export const isLocal = (place) => LONDON_AREA.has(String(place).split(',')[0].trim());

// Towns that are mostly giant cloud data centres (Amazon, Google, Microsoft,
// Meta). A "visitor" from one of these is almost always an automated bot,
// e.g. the Boardman, OR homepage form press on 2026-09-28.
export const DATA_CENTRE_PLACES = new Set([
  'Boardman, OR', 'Ashburn, VA', 'Council Bluffs, IA', 'The Dalles, OR', 'Prineville, OR', 'Quincy, WA',
  'Forest City, NC', 'Moncks Corner, SC', 'Altoona, IA', 'Papillion, NE', 'Beauharnois, QC',
]);
export const isDataCentre = (place) => DATA_CENTRE_PLACES.has(String(place));

export const FORM_NAMES = {
  contact: 'Contact form', 'home-value-lead': 'Home value estimate', 'school-listings': 'Listings by school',
  'save-listing': 'Save a listing', 'market-map-notify': 'Market map alerts', newsletter: 'Newsletter',
};
const FIELD_NAMES = {
  'first-name': 'First name', 'last-name': 'Last name', name: 'Name', email: 'Email', phone: 'Phone', message: 'Message',
  address: 'Address', school: 'School',
};
export const prettyField = (f) => FIELD_NAMES[f] || String(f).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Share of views that scrolled at least `fraction` of the page, from a page summary's depth histogram (100px bands). */
export function reachShare(page, fraction) {
  const views = Object.values(page.depth || {}).reduce((s, n) => s + n, 0);
  const height = page.heightN ? page.heightSum / page.heightN : 0;
  if (!views || !height) return null;
  const band = Math.floor((height * fraction) / 100);
  let reached = 0;
  for (const [b, n] of Object.entries(page.depth)) if (Number(b) >= band) reached += n;
  return reached / views;
}
