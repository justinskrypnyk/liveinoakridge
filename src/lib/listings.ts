// Shared helpers for reading raw DDF/RESO-shaped listing records.
// Used by both /properties/ (grid) and /properties/[listingKey]/ (detail page).
import { findAreaForPoint } from './area-boundaries';
import { AREAS } from '@/data/areas';

export const AREA_SLUGS: Record<string, string> = {
  'Oakridge': 'oakridge', 'West London': 'west-london', 'Whitehills': 'whitehills',
  'Byron': 'byron', 'Westmount': 'westmount', 'Riverbend': 'riverbend', 'Lambeth': 'lambeth',
};

export function fmtPrice(price: unknown): string {
  const n = Number(price);
  if (!n) return 'Price TBD';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

export function field(listing: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = listing[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

export function buildAddress(l: Record<string, unknown>): string {
  const unparsed = field(l, 'UnparsedAddress');
  if (unparsed) return unparsed;
  const parts = [
    field(l, 'UnitNumber') ? `${field(l, 'UnitNumber')}-` : '',
    field(l, 'StreetNumber'),
    field(l, 'StreetName'),
    field(l, 'StreetSuffix'),
  ].filter(Boolean);
  return parts.join(' ') || 'Address not available';
}

// Street-level only — buildAddress() above returns UnparsedAddress verbatim
// when present, which for AMPRE usually already includes city/region/postal
// (e.g. "590 Oakridge Drive, London North, ON N6H 3G2"). Fine for on-page
// display, but doubles up when fed into listingPhotoAlt(), which appends
// its own city/neighbourhood tail — this gives that function a clean
// street-only address to start from instead.
export function buildStreetAddress(l: Record<string, unknown>): string {
  const parts = [
    field(l, 'UnitNumber') ? `${field(l, 'UnitNumber')}-` : '',
    field(l, 'StreetNumber'),
    field(l, 'StreetName'),
    field(l, 'StreetSuffix'),
  ].filter(Boolean);
  return parts.join(' ') || buildAddress(l);
}

export function realtorUrl(l: Record<string, unknown>): string {
  const id = field(l, 'ListingId', 'ListingKey');
  if (!id) return 'https://www.realtor.ca';
  return `https://www.realtor.ca/real-estate/${id}`;
}

export function listingSlug(l: Record<string, unknown>): string {
  return field(l, 'ListingKey', 'ListingId').toLowerCase();
}

export function photos(l: Record<string, unknown>): string[] {
  const arr = l._photoUrls;
  return Array.isArray(arr) ? (arr as string[]) : [];
}

/** Resolves a geocoded point to one of the site's 7 mapped neighbourhood names (see src/lib/area-boundaries.ts), or null if it falls outside all of them (e.g. a non-London Ontario listing on /search/). */
export function neighbourhoodForPoint(geo: { lat: number; lng: number } | null | undefined): string | null {
  if (!geo) return null;
  const slug = findAreaForPoint(geo.lat, geo.lng);
  if (!slug) return null;
  return AREAS.find((a) => a.slug === slug)?.name ?? null;
}

export interface ListingAltContext {
  /** Street-level address, e.g. buildAddress()'s output. */
  address: string;
  city?: string;
  /** Resolved neighbourhood name (see neighbourhoodForPoint), or null/undefined if unknown or outside the 7 mapped areas. */
  neighbourhood?: string | null;
  beds?: string | number;
  propertyType?: string;
}

// Generates descriptive, accessible alt text for a DDF-sourced listing photo
// automatically from data every listing already carries — no manual entry
// per listing or per photo. Called at the same point each page/endpoint
// already builds its listing-card/detail data, not as a separate pass.
//
// Per-photo variation is driven by PHOTO ORDER, not photo content: MLS
// listings near-universally lead with the exterior/curb-appeal shot, so
// index 0 gets "exterior" and every later photo gets a generic "interior
// view" — safer than guessing "kitchen" vs "primary bedroom" from an
// unlabeled photo, which the feed doesn't reliably identify (RESO Media's
// ShortDescription/caption field exists in principle but isn't consistently
// populated board-to-board — worth revisiting if that changes).
export function listingPhotoAlt(ctx: ListingAltContext, photoIndex: number = 0): string {
  const bedsPart = ctx.beds ? `${ctx.beds} bedroom ` : '';
  const typePart = ctx.propertyType || 'home';
  const subject = `${bedsPart}${typePart}`.trim() + (photoIndex === 0 ? ' exterior' : ' interior view');

  // Neighbourhood only applies within the 7 areas this site maps in
  // London — /search/ covers all of Ontario via National Pool, so a listing
  // outside those boundaries falls back to its own city rather than being
  // mislabeled into a London neighbourhood it isn't actually in.
  const place = ctx.neighbourhood
    ? `${ctx.neighbourhood}, London, Ontario`
    : ctx.city
      ? `${ctx.city}, Ontario`
      : 'Ontario';

  return `${subject}, ${ctx.address}, ${place}`;
}
