// Source: shared with londonontariohomes.ca (../city-wide-realtor) -- identical in
// both repos except THIS_SITE. Keep in sync.
//
// One admin for both of Justin's sites (2026-10-07): the heatmap and visitor
// sessions pages take ?site=oakridge|fch and read that site's Blobs. This
// site's own stores need nothing extra; the other site's are read through
// the Blobs API with NETLIFY_API_TOKEN (same token is set on both sites, and
// it belongs to the account that owns both).
import { getStore } from '@netlify/blobs';

export const ADMIN_SITES = [
  { id: 'oakridge', label: 'liveinoakridge.ca', origin: 'https://www.liveinoakridge.ca', siteID: '55088671-90b8-4e17-a8f6-afe1e06fcfda', searchPath: '/search' },
  { id: 'fch', label: 'londonontariohomes.ca', origin: 'https://www.londonontariohomes.ca', siteID: '70a479c3-a904-470d-8b99-85ce74b25366', searchPath: '/properties/' },
];

export const THIS_SITE = 'oakridge';

/** The site picked by ?site=, falling back to this one. */
export function pickAdminSite(param) {
  return ADMIN_SITES.find((s) => s.id === param) || ADMIN_SITES.find((s) => s.id === THIS_SITE);
}

/** A Blobs store on whichever site is being viewed. */
export function adminStore(name, site) {
  if (site.id === THIS_SITE) return getStore(name);
  const token = import.meta.env.NETLIFY_API_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (!token) throw new Error(`NETLIFY_API_TOKEN is not set, so ${site.label}'s stats can't be read from here`);
  return getStore({ name, siteID: site.siteID, token });
}

/** Absolute link to a page on the viewed site (relative when it's this one). */
export function siteHref(site, path) {
  return site.id === THIS_SITE ? path : `${site.origin}${path}`;
}
