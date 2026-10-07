// Shared by netlify/functions/comps-index-background.mjs (nightly index) and
// the /admin/comps/ API (live lookup of a subject home that isn't in the
// index), so both read a VOW record into the same compact comp shape.
// Field notes (checked against the live feed 2026-10-07): no YearBuilt or
// Latitude/Longitude; size is LivingAreaRange ("1500-2000", ~96% filled),
// age is ApproximateAge ("31-50", ~64%), PurchaseContractDate is the firm
// date on closed sales.
import areaBoundaries from '../data/area-boundaries.json' with { type: 'json' };
import outlyingBoundaries from '../data/outlying-area-boundaries.json' with { type: 'json' };

export const COMPS_SELECT = [
  'ListingKey', 'UnparsedAddress', 'City', 'PostalCode', 'MlsStatus', 'ArchitecturalStyle',
  'ListPrice', 'OriginalListPrice', 'ClosePrice', 'CloseDate', 'PurchaseContractDate',
  'SoldConditionalEntryTimestamp', 'SoldEntryTimestamp', 'ListingContractDate', 'OriginalEntryTimestamp', 'DaysOnMarket',
  'BedroomsAboveGrade', 'BedroomsBelowGrade', 'BedroomsTotal', 'BathroomsTotalInteger',
  'LivingAreaRange', 'BuildingAreaTotal', 'ApproximateAge',
  'LotWidth', 'LotDepth', 'LotSizeRangeAcres', 'LotSizeArea', 'LotSizeUnits',
  'Basement', 'GarageType', 'CoveredSpaces', 'ParkingTotal', 'Sewer', 'Water',
  'TaxAnnualAmount', 'ListOfficeName', 'PoolFeatures', 'DenFamilyroomYN', 'ModificationTimestamp',
  'PropertyType', 'PropertySubType', 'TransactionType', 'StandardStatus',
];

export const isSale = (l) => l.PropertyType !== 'Commercial' && l.TransactionType === 'For Sale';

function polygonsOf(fc, nameKey) {
  return fc.features.map((f) => ({ slug: f.properties.slug, name: f.properties[nameKey] || f.properties.name, rings: f.geometry.coordinates }));
}
const LONDON_AREAS = polygonsOf(areaBoundaries, 'name');
const TOWN_AREAS = polygonsOf(outlyingBoundaries, 'name');

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const areaFor = (polys, lat, lng) => polys.find((p) => p.rings[0] && pointInRing(lat, lng, p.rings[0])) || null;

/** Neighbourhood (London polygons) or nearby town for a point: { ar: slug, arn: name, inLondon }. */
export function placeOf(lat, lng) {
  const london = areaFor(LONDON_AREAS, lat, lng);
  const town = london ? null : areaFor(TOWN_AREAS, lat, lng);
  return { ar: london?.slug || town?.slug || null, arn: london?.name || town?.name || null };
}

export function statusOf(l, cutoffIso) {
  const mls = String(l.MlsStatus || '');
  // Terminated/expired rows can still read StandardStatus "Active"; a firm
  // sale that hasn't closed has no sale price yet, so it's no use as a comp.
  if (/terminated|expired|suspended/i.test(mls)) return null;
  if (/conditional/i.test(mls)) return 'C';
  if (l.StandardStatus === 'Active Under Contract' || l.StandardStatus === 'Pending') return null;
  if (l.StandardStatus === 'Active') return 'A';
  if (l.StandardStatus === 'Closed' && /sold/i.test(mls || 'Sold')) {
    const firm = l.PurchaseContractDate || l.CloseDate;
    return firm && firm >= cutoffIso ? 'S' : null;
  }
  return null;
}

// "1100-1500" -> [1100, 1500]; "< 700" -> [0, 700]; "5000 +" -> [5000, 7500]
function sqftRange(l) {
  const exact = Number(l.BuildingAreaTotal);
  if (exact > 200) return [Math.round(exact), Math.round(exact)];
  const s = String(l.LivingAreaRange || '').replace(/,/g, '');
  let m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/<\s*(\d+)/);
  if (m) return [Math.round(Number(m[1]) * 0.6), Number(m[1])];
  m = s.match(/(\d+)\s*\+/);
  if (m) return [Number(m[1]), Math.round(Number(m[1]) * 1.5)];
  return null;
}

// "0-5" -> [0,5]; "New" -> [0,0]; "100+" -> [100,150]
function ageRange(l) {
  const s = String(l.ApproximateAge || '');
  if (/new/i.test(s)) return [0, 0];
  let m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/(\d+)\s*\+/);
  if (m) return [Number(m[1]), Number(m[1]) + 50];
  return null;
}

// Lot area in square feet, from frontage x depth when we have it.
function lotSqft(l) {
  const w = Number(l.LotWidth), d = Number(l.LotDepth);
  const metres = /met/i.test(String(l.LotSizeUnits || ''));
  if (w > 0 && d > 0) return Math.round(w * d * (metres ? 10.764 : 1));
  const area = Number(l.LotSizeArea);
  if (area > 0) {
    const u = String(l.LotSizeUnits || '');
    if (/acre/i.test(u) || area < 200) return Math.round(area * 43560);
    if (/met/i.test(u)) return Math.round(area * 10.764);
    return Math.round(area);
  }
  const band = String(l.LotSizeRangeAcres || '');
  const m = band.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (m) return Math.round(((Number(m[1]) + Number(m[2])) / 2) * 43560);
  if (/</.test(band)) return Math.round(0.2 * 43560);
  const plus = band.match(/([\d.]+)\s*\+/);
  if (plus) return Math.round(Number(plus[1]) * 1.3 * 43560);
  return null;
}

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => String(x).trim()) : v ? [String(v).trim()] : []);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const day = (v) => (v ? String(v).slice(0, 10) : null);

function isRural(l, lot) {
  const sewer = arr(l.Sewer).join(' ');
  const water = String(l.Water || '');
  return /septic/i.test(sewer) || /well/i.test(water) || (lot != null && lot >= 0.75 * 43560);
}

export function slim(l, status) {
  const lot = lotSqft(l);
  return {
    k: l.ListingKey,
    a: l.UnparsedAddress,
    c: l.City || null,
    pc: l.PostalCode ? String(l.PostalCode).replace(/\s+/g, '').toUpperCase() : null,
    st: status,
    mls: l.MlsStatus || null,
    t: l.PropertyType ? String(l.PropertyType).trim() : null,
    s: l.PropertySubType ? String(l.PropertySubType).trim() : null,
    sty: arr(l.ArchitecturalStyle)[0] || null,
    lp: num(l.ListPrice),
    olp: num(l.OriginalListPrice),
    sp: status === 'S' ? num(l.ClosePrice) : null,
    // The date that matters for comps: firm date for sales, conditional
    // date for conditionals, list date for actives.
    d: status === 'S' ? day(l.PurchaseContractDate || l.CloseDate)
      : status === 'C' ? day(l.SoldConditionalEntryTimestamp || l.ModificationTimestamp)
      : day(l.ListingContractDate || l.OriginalEntryTimestamp),
    cd: status === 'S' ? day(l.CloseDate) : null,
    ld: day(l.ListingContractDate || l.OriginalEntryTimestamp),
    dom: num(l.DaysOnMarket),
    b: num(l.BedroomsAboveGrade) ?? num(l.BedroomsTotal),
    bb: num(l.BedroomsBelowGrade),
    ba: num(l.BathroomsTotalInteger),
    sq: sqftRange(l),
    sqTxt: l.LivingAreaRange || (Number(l.BuildingAreaTotal) > 200 ? String(Math.round(l.BuildingAreaTotal)) : null),
    age: ageRange(l),
    ageTxt: l.ApproximateAge || null,
    lot,
    lotTxt: Number(l.LotWidth) > 0 && Number(l.LotDepth) > 0 ? `${Number(l.LotWidth)} x ${Number(l.LotDepth)} ${/met/i.test(String(l.LotSizeUnits || '')) ? 'm' : 'ft'}` : l.LotSizeRangeAcres ? `${l.LotSizeRangeAcres} ac` : null,
    bsmt: arr(l.Basement),
    gar: l.GarageType || null,
    gs: num(l.CoveredSpaces),
    pool: arr(l.PoolFeatures).some((p) => p && p !== 'None'),
    rural: isRural(l, lot),
    tax: num(l.TaxAnnualAmount),
    off: l.ListOfficeName || null,
  };
}
