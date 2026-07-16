// Neighbourhood boundary polygons, converted from Justin's own QGIS shapefiles
// (source: ~/Desktop/Real Estate/QGIS/*.shp, exported via ogr2ogr to WGS84
// GeoJSON). Used to tag live DDF listings with the area they actually fall
// inside, rather than guessing from MLS district names.
import boundaries from '@/data/area-boundaries.json';

type Ring = [number, number][]; // [lng, lat] pairs, GeoJSON order

const polygons: { slug: string; rings: Ring[] }[] = (boundaries as any).features.map(
  (f: any) => ({
    slug: f.properties.slug as string,
    rings: f.geometry.coordinates as Ring[],
  })
);

// Ray casting — point-in-polygon test for a single ring.
function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Returns the area slug whose boundary contains the given point, or null if none match. */
export function findAreaForPoint(lat: number, lng: number): string | null {
  for (const { slug, rings } of polygons) {
    // rings[0] is the outer boundary; this dataset has no holes to subtract.
    if (rings[0] && pointInRing(lat, lng, rings[0])) return slug;
  }
  return null;
}

export interface Bounds { north: number; south: number; east: number; west: number; }

/** Bounding box of a single area's polygon, or null if the slug isn't known. */
export function getAreaBounds(slug: string): Bounds | null {
  const match = polygons.find((p) => p.slug === slug);
  if (!match || !match.rings[0]) return null;
  let north = -90, south = 90, east = -180, west = 180;
  for (const [lng, lat] of match.rings[0]) {
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }
  return { north, south, east, west };
}

/** Union bounding box of every known area — the "All London" default view. */
export function getAllAreasBounds(): Bounds {
  let north = -90, south = 90, east = -180, west = 180;
  for (const { rings } of polygons) {
    if (!rings[0]) continue;
    for (const [lng, lat] of rings[0]) {
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lng < west) west = lng;
    }
  }
  return { north, south, east, west };
}
