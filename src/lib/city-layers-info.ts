// "What's at this spot" from the City of London open-data layers, for the
// /admin/comps/ map click and the subject home's summary line. Server-side
// (the City's server sends no CORS headers). City of London only.
import { CITY_QUERY_BASE, ZONING_COLOURS } from './city-layers';

export type CityFact = { key: string; label: string; text: string };
export type CityFacts = { inCity: boolean; facts: CityFact[] };

type Feature = { attributes: Record<string, any>; geometry?: { paths?: number[][][]; rings?: number[][][] } };

async function query(path: string, lat: number, lng: number, fields: string, opts: { within?: number; geometry?: boolean } = {}): Promise<Feature[]> {
  const q = new URLSearchParams({
    geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: fields, returnGeometry: String(!!opts.geometry), outSR: '4326', f: 'json',
  });
  if (opts.within) { q.set('distance', String(opts.within)); q.set('units', 'esriSRUnit_Meter'); }
  const res = await fetch(`${CITY_QUERY_BASE}/${path}/query?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(`${path}: ${d.error.message}`);
  return d.features || [];
}

// Metres from the point to the nearest line segment (local flat projection;
// plenty accurate over a few hundred metres).
function metresTo(lat: number, lng: number, f: Feature) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (const part of [...(f.geometry?.paths || []), ...(f.geometry?.rings || [])]) {
    for (let i = 0; i < part.length - 1; i++) {
      const ax = (part[i][0] - lng) * kx, ay = (part[i][1] - lat) * ky;
      const bx = (part[i + 1][0] - lng) * kx, by = (part[i + 1][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}
const nearest = (lat: number, lng: number, fs: Feature[]) => fs.reduce((m, f) => Math.min(m, metresTo(lat, lng, f)), Infinity);
const blank = (v: unknown) => v == null || String(v).trim() === '';

const cache = new Map<string, { at: number; v: CityFacts }>();

export async function cityFactsAt(lat: number, lng: number): Promise<CityFacts> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.v;

  // Each lookup on its own, so one slow/failed layer doesn't sink the rest.
  const safe = <T,>(p: Promise<T>) => p.catch((err) => { console.error('city layer lookup:', err instanceof Error ? err.message : err); return null; });
  const [zoning, parcel, district, heritage, vacant, parks, hydro, rail] = await Promise.all([
    safe(query('OpenData_Community/MapServer/16', lat, lng, 'GIS_FeatureKey,GeneralizedLandUse')),
    safe(query('OpenData_BaseMaps/MapServer/53', lat, lng, 'PARCELMAPPING.Parcels.Area')),
    safe(query('OpenData_Community/MapServer/6', lat, lng, 'GIS_FeatureKey')),
    safe(query('OpenData_Community/MapServer/7', lat, lng, 'Status,Address,DesignationPart,YearBuilt')),
    safe(query('OpenData_Community/MapServer/20', lat, lng, 'Category,GeneralLandUse,EstimatedTotalUnits,Acres')),
    safe(query('OpenData_Recreation/MapServer/3', lat, lng, 'GIS_FeatureKey', { within: 150, geometry: true })),
    safe(query('OpenData_BaseMaps/MapServer/44', lat, lng, 'OBJECTID', { within: 300, geometry: true })),
    safe(query('OpenData_BaseMaps/MapServer/27', lat, lng, 'OBJECTID', { within: 300, geometry: true })),
  ]);

  const facts: CityFact[] = [];
  const add = (key: string, label: string, text: string) => facts.push({ key, label, text });
  const z = zoning?.[0]?.attributes;
  if (z) add('zoning', 'Zoning', `${z.GIS_FeatureKey}${z.GeneralizedLandUse ? ` · ${ZONING_COLOURS[z.GeneralizedLandUse]?.label || z.GeneralizedLandUse}` : ''}`);
  const m2 = parcel?.[0]?.attributes?.['PARCELMAPPING.Parcels.Area'];
  if (m2 > 20) {
    const sqft = Math.round((m2 * 10.7639) / 10) * 10;
    add('lot', 'City lot', `~${sqft.toLocaleString('en-CA')} sq ft${sqft >= 43560 ? ` (${(sqft / 43560).toFixed(2)} acres)` : ''}`);
  }
  const d = district?.[0]?.attributes;
  if (d) add('heritage', 'Heritage district', String(d.GIS_FeatureKey));
  const h = heritage?.[0]?.attributes;
  if (h) add('heritage', 'Heritage property', `${h.Status}${blank(h.DesignationPart) ? '' : ` (Part ${String(h.DesignationPart).trim()})`}${blank(h.Address) ? '' : ` · ${h.Address}`}${blank(h.YearBuilt) ? '' : ` · built ${String(h.YearBuilt).trim()}`}`);
  const v = vacant?.[0]?.attributes;
  if (v) add('vacant', 'Vacant land', `${String(v.Category || '').replace(/^\d+\.\s*/, '')}${v.GeneralLandUse ? ` · ${v.GeneralLandUse}` : ''}${v.EstimatedTotalUnits >= 1 ? ` · ~${Math.round(v.EstimatedTotalUnits)} units planned` : ''}${v.Acres ? ` · ${Number(v.Acres).toFixed(1)} acres` : ''}`);
  if (parks?.length) {
    const named = parks.map((p) => ({ name: String(p.attributes.GIS_FeatureKey || 'Park'), m: metresTo(lat, lng, p) })).sort((a, b) => a.m - b.m);
    add('parks', 'Park', named.slice(0, 2).map((p) => `${p.name} (${p.m < 15 ? 'next to it' : `${Math.round(p.m)} m`})`).join(', '));
  }
  if (hydro?.length) add('hydro', 'Hydro transmission line', `${Math.round(nearest(lat, lng, hydro))} m away`);
  if (rail?.length) add('hydro', 'Railway', `${Math.round(nearest(lat, lng, rail))} m away`);

  // No zoning polygon = outside the City of London (towns aren't covered).
  const v2: CityFacts = { inCity: !!z, facts };
  if (zoning) cache.set(key, { at: Date.now(), v: v2 });
  return v2;
}
