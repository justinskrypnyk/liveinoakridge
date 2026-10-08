// Comp scoring for /admin/comps/ -- how close a home is to the subject, out
// of 100 (Justin, 2026-10-07: "100 being a perfect match"; closest home with
// the closest sale date wins). Each factor scores 0..1 and is weighted; the
// weights are adjustable on the page and always rescaled to total 100.
//
// Missing data: when the SUBJECT has no value for a factor (say, no age),
// that factor is dropped and the rest rescaled, so it can't drag every comp
// down. When a COMP is missing a value the subject has, it gets half credit
// and the breakdown says "unknown" -- Justin can check the photos.

export interface CompRow {
  k: string; a: string; c: string | null; pc: string | null;
  st: 'A' | 'C' | 'S'; mls: string | null;
  t: string | null; s: string | null; sty: string | null;
  lp: number | null; olp: number | null; sp: number | null;
  d: string | null; cd: string | null; ld: string | null; dom: number | null;
  b: number | null; bb: number | null; ba: number | null;
  sq: [number, number] | null; sqTxt: string | null;
  age: [number, number] | null; ageTxt: string | null;
  lot: number | null; lotTxt: string | null;
  bsmt: string[]; gar: string | null; gs: number | null; pool: boolean; rural: boolean;
  tax: number | null; off: string | null;
  lat?: number; lng?: number; gp?: 'exact' | 'street' | 'postal' | 'area'; ar?: string | null; arn?: string | null;
}

export interface Subject {
  address: string;
  lat: number | null; lng: number | null; ar: string | null; arn: string | null;
  subType: string | null; style: string | null;
  beds: number | null; bedsBelow: number | null; baths: number | null;
  sqft: number | null; age: number | null; lot: number | null;
  rural: boolean; basement: Basement | null; garage: Garage | null;
}

export type Basement = 'finished' | 'partial' | 'unfinished' | 'none';
export type Garage = 'attached' | 'detached' | 'none';

export const FACTORS = [
  { id: 'location', label: 'Location', weight: 22 },
  { id: 'recency', label: 'Sale date', weight: 10 },
  { id: 'type', label: 'Property type', weight: 12 },
  { id: 'style', label: 'Style', weight: 10 },
  { id: 'size', label: 'Square footage', weight: 12 },
  { id: 'beds', label: 'Bedrooms', weight: 8 },
  { id: 'baths', label: 'Bathrooms', weight: 6 },
  { id: 'age', label: 'Age', weight: 6 },
  { id: 'lot', label: 'Lot size', weight: 5 },
  { id: 'setting', label: 'Rural / city', weight: 3 },
  { id: 'basement', label: 'Basement', weight: 3 },
  { id: 'garage', label: 'Garage', weight: 3 },
] as const;
export type FactorId = (typeof FACTORS)[number]['id'];
export type Weights = Record<FactorId, number>;
export const DEFAULT_WEIGHTS = Object.fromEntries(FACTORS.map((f) => [f.id, f.weight])) as Weights;

export interface Filters {
  maxKm: number;          // hard cut-off
  soldMonths: number;     // sold comps: firm date within this many months
  sameTypeOnly: boolean;  // only the subject's type family (detached, semi, town, apt...)
  minBeds: number | null;
  maxBeds: number | null;
}

export interface Part { id: FactorId; pts: number; max: number; note: string }
export interface Scored { row: CompRow; score: number; km: number | null; parts: Part[] }

// ---- type / style families ----------------------------------------------

const TYPE_FAMILY: Record<string, string> = {
  'Detached': 'house', 'Detached Condo': 'house', 'Vacant Land Condo': 'house', 'Link': 'house', 'Rural Residential': 'house',
  'Modular Home': 'house',
  'Semi-Detached': 'semi', 'Semi-Detached Condo': 'semi',
  'Att/Row/Townhouse': 'town', 'Condo Townhouse': 'town', 'Common Element Condo': 'town',
  'Condo Apartment': 'apt', 'Co-op Apartment': 'apt', 'Co-Ownership Apartment': 'apt', 'Leasehold Condo': 'apt',
  'Duplex': 'multi', 'Triplex': 'multi', 'Fourplex': 'multi', 'Multiplex': 'multi',
  'Farm': 'farm', 'Vacant Land': 'land', 'MobileTrailer': 'mobile',
};
export const typeFamily = (s: string | null) => (s ? TYPE_FAMILY[s.trim()] ?? 'other' : null);

function styleGroup(s: string | null): string | null {
  if (!s) return null;
  if (/apartment|apt|loft/i.test(s)) return 'apt';
  if (/bungal|1 storey/i.test(s)) return 'bungalow';
  if (/1 1\/2/.test(s)) return 'storey1.5';
  if (/3-storey|3 storey/i.test(s)) return 'storey3';
  if (/2/.test(s)) return 'storey2';
  if (/split|multi-level/i.test(s)) return 'split';
  return 'other';
}
const NEAR_STYLES = new Set(['bungalow|storey1.5', 'storey1.5|storey2', 'split|bungalow', 'split|storey2', 'storey2|storey3']);

export function basementOf(b: string[]): Basement | null {
  if (!b.length) return null;
  const s = b.join(' ');
  if (/none|crawl|slab/i.test(s) && !/finish/i.test(s)) return 'none';
  if (/partially finished|partial/i.test(s)) return 'partial';
  if (/unfinished/i.test(s)) return 'unfinished';
  if (/finish/i.test(s)) return 'finished';
  return 'unfinished';
}
export function garageOf(g: string | null): Garage | null {
  if (!g) return null;
  if (/detach/i.test(g)) return 'detached';
  if (/attach|built-in|underground/i.test(g)) return 'attached';
  return 'none'; // None, Carport, Surface, Visitor, Other
}

// ---- helpers --------------------------------------------------------------

export function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
const daysSince = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000;
const fmtSqft = (n: number) => `${Math.round(n).toLocaleString('en-CA')} sf`;

// ---- scoring ---------------------------------------------------------------

type Fn = (s: Subject, r: CompRow, ctx: { km: number | null; maxKm: number }) => [number, string] | null;
const UNKNOWN: [number, string] = [0.5, 'unknown'];

const FN: Record<FactorId, Fn> = {
  location(s, r, { km: d, maxKm }) {
    if (s.lat == null) return null;
    if (d == null) return [0, 'no location'];
    const near = 0.3; // within ~3 blocks counts as next door
    const dist = d <= near ? 1 : clamp01(1 - (d - near) / Math.max(0.5, maxKm - near));
    const same = s.ar && r.ar === s.ar;
    const approx = r.gp === 'street' ? ' (street-level)' : r.gp && r.gp !== 'exact' ? ' (approx.)' : '';
    return [0.75 * dist + (same ? 0.25 : 0), `${d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`}${approx}${same ? ', same area' : r.arn ? `, ${r.arn}` : ''}`];
  },
  recency(_s, r) {
    if (r.st === 'A') return [1, 'on the market now'];
    if (!r.d) return UNKNOWN;
    const days = daysSince(r.d);
    const label = r.st === 'S' ? 'firm' : 'conditional';
    return [days <= 45 ? 1 : clamp01(1 - (days - 45) / 320), `${label} ${Math.round(days)} days ago`];
  },
  type(s, r) {
    if (!s.subType) return null;
    if (!r.s) return UNKNOWN;
    if (r.s === s.subType) return [1, r.s];
    return typeFamily(r.s) === typeFamily(s.subType) ? [0.6, r.s] : [0, r.s];
  },
  style(s, r) {
    if (!s.style) return null;
    if (!r.sty) return UNKNOWN;
    if (r.sty === s.style) return [1, r.sty];
    const a = styleGroup(s.style)!, b = styleGroup(r.sty)!;
    if (a === b) return [0.75, r.sty];
    return NEAR_STYLES.has(`${a}|${b}`) || NEAR_STYLES.has(`${b}|${a}`) ? [0.4, r.sty] : [0.1, r.sty];
  },
  size(s, r) {
    if (!s.sqft) return null;
    if (!r.sq) return UNKNOWN;
    const txt = r.sqTxt ? `${r.sqTxt} sf` : fmtSqft(mid(r.sq));
    if (s.sqft >= r.sq[0] && s.sqft <= r.sq[1]) return [1, txt];
    const nearest = s.sqft < r.sq[0] ? r.sq[0] : r.sq[1];
    return [clamp01(1 - Math.abs(nearest - s.sqft) / s.sqft / 0.35), txt];
  },
  beds(s, r) {
    if (s.beds == null) return null;
    if (r.b == null) return UNKNOWN;
    const below = s.bedsBelow != null && r.bb != null ? Math.abs(s.bedsBelow - r.bb) : 0;
    return [clamp01(1 - 0.4 * Math.abs(s.beds - r.b) - 0.15 * below), `${r.b}${r.bb ? ` + ${r.bb}` : ''} bed`];
  },
  baths(s, r) {
    if (s.baths == null) return null;
    if (r.ba == null) return UNKNOWN;
    return [clamp01(1 - 0.35 * Math.abs(s.baths - r.ba)), `${r.ba} bath`];
  },
  age(s, r) {
    if (s.age == null) return null;
    if (!r.age) return UNKNOWN;
    const txt = `${r.ageTxt} yrs`;
    if (s.age >= r.age[0] && s.age <= r.age[1]) return [1, txt];
    const nearest = s.age < r.age[0] ? r.age[0] : r.age[1];
    return [clamp01(1 - Math.abs(nearest - s.age) / 30), txt];
  },
  lot(s, r) {
    if (!s.lot) return null;
    if (!r.lot) return UNKNOWN;
    const ratio = Math.min(s.lot, r.lot) / Math.max(s.lot, r.lot);
    return [clamp01((ratio - 0.25) / 0.65), r.lotTxt || `${Math.round(r.lot).toLocaleString('en-CA')} sf lot`];
  },
  setting(s, r) {
    return r.rural === s.rural ? [1, r.rural ? 'rural' : 'city'] : [0, r.rural ? 'rural' : 'city'];
  },
  basement(s, r) {
    if (!s.basement) return null;
    const b = basementOf(r.bsmt);
    if (!b) return UNKNOWN;
    if (b === s.basement) return [1, b];
    const pair = new Set([b, s.basement]);
    if (pair.has('finished') && pair.has('partial')) return [0.6, b];
    if (pair.has('partial') && pair.has('unfinished')) return [0.6, b];
    if (pair.has('none')) return [0, b];
    return [0.3, b];
  },
  garage(s, r) {
    if (!s.garage) return null;
    const g = garageOf(r.gar);
    if (!g) return UNKNOWN;
    if (g === s.garage) return [1, g === 'none' ? 'no garage' : `${g} garage`];
    return g !== 'none' && s.garage !== 'none' ? [0.6, `${g} garage`] : [0, g === 'none' ? 'no garage' : `${g} garage`];
  },
};

export function passesFilters(s: Subject, r: CompRow, f: Filters, d: number | null): boolean {
  if (d != null && d > f.maxKm) return false;
  if (d == null && s.lat != null) return false;
  if (f.sameTypeOnly && s.subType && typeFamily(r.s) !== typeFamily(s.subType)) return false;
  if (f.minBeds != null && r.b != null && r.b < f.minBeds) return false;
  if (f.maxBeds != null && r.b != null && r.b > f.maxBeds) return false;
  if (r.st === 'S' && r.d && daysSince(r.d) > f.soldMonths * 30.5) return false;
  return true;
}

export function scoreRow(s: Subject, r: CompRow, w: Weights, maxKm: number, d: number | null): Scored {
  const raw: { id: FactorId; v: number; note: string; w: number }[] = [];
  for (const { id } of FACTORS) {
    if (!w[id]) continue;
    const res = FN[id](s, r, { km: d, maxKm });
    if (res) raw.push({ id, v: res[0], note: res[1], w: w[id] });
  }
  const total = raw.reduce((t, p) => t + p.w, 0) || 1;
  const parts = raw.map((p) => ({ id: p.id, pts: (p.v * p.w * 100) / total, max: (p.w * 100) / total, note: p.note }));
  return { row: r, score: Math.round(parts.reduce((t, p) => t + p.pts, 0)), km: d, parts };
}

export function rankComps(s: Subject, rows: CompRow[], w: Weights, f: Filters) {
  const out: Record<'S' | 'C' | 'A', Scored[]> = { S: [], C: [], A: [] };
  for (const r of rows) {
    const d = s.lat != null && r.lat != null && r.lng != null ? km(s.lat, s.lng!, r.lat, r.lng) : null;
    if (!passesFilters(s, r, f, d)) continue;
    out[r.st].push(scoreRow(s, r, w, f.maxKm, d));
  }
  // Best score first; ties go to the closer home, then the more recent date.
  for (const k of ['S', 'C', 'A'] as const) {
    out[k].sort((x, y) => y.score - x.score || (x.km ?? 99) - (y.km ?? 99) || (y.row.d || '').localeCompare(x.row.d || ''));
  }
  return out;
}

/** A comp row read as the subject's starting specs (all editable on the page). */
export function subjectFromRow(r: CompRow, address?: string): Subject {
  return {
    address: address || r.a,
    lat: r.lat ?? null, lng: r.lng ?? null, ar: r.ar ?? null, arn: r.arn ?? null,
    subType: r.s, style: r.sty,
    beds: r.b, bedsBelow: r.bb, baths: r.ba,
    sqft: r.sq ? Math.round(mid(r.sq)) : null,
    age: r.age ? Math.round(mid(r.age)) : null,
    lot: r.lot, rural: r.rural,
    basement: basementOf(r.bsmt),
    garage: garageOf(r.gar),
  };
}
