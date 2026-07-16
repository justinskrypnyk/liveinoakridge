// Viewport-driven listing search backing /search/'s live map — called
// client-side on every pan/zoom. Backed by National Pool (see src/lib/ddf.ts
// searchNationalPoolByBounds), not AMPRE, since AMPRE can't filter by
// bounding box at all (rejects compound filters) and never has real
// coordinates. Returns a small JSON shape the client script renders into
// map pins + grid cards.
import type { APIRoute } from 'astro';
import { searchNationalPoolByBounds, getActiveListings } from '@/lib/ddf';
import { fmtPrice, field, buildAddress, listingSlug, ownListingKeySet } from '@/lib/listings';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const params = url.searchParams;
  const north = Number(params.get('north'));
  const south = Number(params.get('south'));
  const east = Number(params.get('east'));
  const west = Number(params.get('west'));

  if (![north, south, east, west].every((n) => Number.isFinite(n))) {
    return new Response(JSON.stringify({ error: 'Invalid bounds' }), { status: 400 });
  }

  const minPrice = Number(params.get('minPrice')) || undefined;
  const maxPrice = Number(params.get('maxPrice')) || undefined;
  const propertyType = params.get('type') || undefined;
  const minBeds = Number(params.get('minBeds')) || undefined;
  const minBaths = Number(params.get('minBaths')) || undefined;
  const minParking = Number(params.get('minParking')) || undefined;
  const daysOnMarket = Number(params.get('days')) || undefined;
  const keyword = params.get('keyword') || undefined;
  const sortBy = (params.get('sort') as 'newest' | 'price-asc' | 'price-desc' | 'beds-desc' | null) || undefined;

  const [{ listings, total, capped }, ownKeys] = await Promise.all([
    searchNationalPoolByBounds({
      north, south, east, west, minPrice, maxPrice, propertyType,
      minBeds, minBaths, minParking, daysOnMarket, keyword, sortBy,
    }),
    getActiveListings().then(ownListingKeySet),
  ]);

  const cards = listings.map((l) => {
    const L = l as Record<string, unknown>;
    const geo = L._geo as { lat: number; lng: number } | null;
    const mls = field(L, 'ListingKey', 'ListingId');
    return {
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      mls,
      price: fmtPrice(L.ListPrice),
      rawPrice: Number(L.ListPrice) || 0,
      address: buildAddress(L),
      city: field(L, 'City'),
      beds: field(L, 'BedroomsTotal'),
      baths: field(L, 'BathroomsTotalInteger', 'BathroomsTotal'),
      sqft: field(L, 'BuildingAreaTotal'),
      type: field(L, 'PropertySubType'),
      brokerage: field(L, 'ListOfficeName'),
      isOwn: ownKeys.has(mls.toLowerCase()),
      photoUrl: (L._photoUrl as string | null) ?? null,
      href: `/search/${listingSlug(L)}/`,
    };
  });

  return new Response(JSON.stringify({ listings: cards, total, capped }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
