// Finds active listings similar to a given one -- powers the "homes like
// the one you saved" recommendation email. Plain rule-based matching only
// (property type, price band, bedroom count, then ranked by distance) --
// no AI involved, same principle as every other automated report in this
// project. Searches the public National Pool feed (all brokerages), not
// just Chapman's own listings, since a lead comparing homes cares about the
// market, not who's representing the seller.
import { searchMarketListings, type RawListing } from '@/lib/ddf';

const PRICE_BAND_PCT = 0.15; // +/-15% of the saved listing's price
const BEDROOM_TOLERANCE = 1; // saved bedrooms -1, no upper bound

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}

export interface FindSimilarInput {
  listingKey: string;
  city: string | null;
  listPrice: number | null;
  propertySubType: string | null;
  propertyType: string | null;
  bedroomsTotal: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** Up to `limit` active listings similar to the given one, nearest-first when coordinates are available. Excludes the listing itself. */
export async function findSimilarActiveListings(saved: FindSimilarInput, limit = 3): Promise<RawListing[]> {
  if (!saved.city) return [];

  const propertyType = saved.propertySubType || saved.propertyType;
  const result = await searchMarketListings({
    query: saved.city,
    minPrice: saved.listPrice ? Math.round(saved.listPrice * (1 - PRICE_BAND_PCT)) : undefined,
    maxPrice: saved.listPrice ? Math.round(saved.listPrice * (1 + PRICE_BAND_PCT)) : undefined,
    propertyTypes: propertyType ? [propertyType] : undefined,
    minBeds: saved.bedroomsTotal ? Math.max(0, saved.bedroomsTotal - BEDROOM_TOLERANCE) : undefined,
  });

  const candidates = result.listings.filter((l) => String(l.ListingKey) !== saved.listingKey);

  if (saved.latitude == null || saved.longitude == null) return candidates.slice(0, limit);

  return candidates
    .map((l) => {
      const lat = Number(l.Latitude), lng = Number(l.Longitude);
      const distanceKm = Number.isFinite(lat) && Number.isFinite(lng)
        ? haversineKm(saved.latitude!, saved.longitude!, lat, lng)
        : Infinity;
      return { listing: l, distanceKm };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map((x) => x.listing);
}
