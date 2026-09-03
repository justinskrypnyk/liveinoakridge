// Scheduled job -- emails Justin a full-month review on the 1st of each
// month, using the month-end capture heat-map-snapshot-background.mjs
// already writes to market_map_snapshots that same morning (9am UTC vs this
// job's 1pm UTC, same day -- the gap guarantees the row already exists).
//
// Matches the 6 data points from Justin's own manually-made monthly graphic
// (Total Sales, New Listings, Med List Price, Med Sale Price, Med Days on
// Market, Med List-to-Sale Price %) for EVERY neighbourhood, not just one --
// his 7 served areas first (fixed order), then the rest alphabetically.
// MoM/YoY % change per metric comes straight from market_map_changes
// (heat-map-snapshot-background.mjs already computes it every capture) --
// this is a brand new pipeline, so those percentages will be blank for a
// while: MoM needs 2 captures of the same period_type (~a month), YoY needs
// ~11-12 months of history. Unlike Justin's example graphic (sourced from
// LSTAR's own long-running board stats), there's no way to backfill that
// history -- it fills in automatically as time passes, no rebuild needed.
//
// Also renders a choropleth map PNG (same visual language as Justin's own
// hand-made monthly graphic: colored by median sold price, his exact
// legend palette sampled from his template) using the real 39 London-area
// polygons from src/data/area-boundaries.json, plus 7 outlying-area boxes
// (Thorndale, Dorchester, Mount Brydges, Strathroy, Komoka/Kilworth,
// Delaware, St. Thomas) drawn as flat labeled boxes rather than projected
// shapes -- some are geographically far enough from London that including
// their real footprint would squish the main map; Justin confirmed simple
// boxes (matching his own template's layout) are fine, colored from real
// MLS data where available (see outlying-area-boundaries.json's mls_city
// field) or gray "no data" where the town isn't in this feed at all
// (confirmed empirically -- Thorndale/Dorchester/Mount Brydges genuinely
// don't exist in this AMPRE deployment's City field, not just a naming
// guess miss).
//
// Same AI-free compilation principle as weekly-digest-background.mjs: every
// color/number here is a fixed lookup against already-computed aggregates,
// not an AI interpreting the underlying sold data.
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';

const SERVED_AREA_ORDER = ['oakridge', 'byron', 'westmount', 'riverbend', 'lambeth', 'whitehills', 'west-london'];

function sortAreasServedFirst(areas) {
  return [...areas].sort((a, b) => {
    const aIdx = SERVED_AREA_ORDER.indexOf(a.area_slug);
    const bIdx = SERVED_AREA_ORDER.indexOf(b.area_slug);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.area_name.localeCompare(b.area_name);
  });
}

// The 6 metrics from Justin's graphic, mapped to this project's column
// names and a formatter for each. units_sold/median_sold_price/
// avg_sale_to_list_ratio use the "_month" columns (true calendar-month
// figures) -- the plain ones stay a 90-day rolling window for the heat
// map's own medians (see heat-map-snapshot-background.mjs). This digest
// always runs off a 'month-end' capture (see the guard below), so "_month"
// here always means the full completed month being reported on.
const REPORT_METRICS = [
  { key: 'units_sold_month', label: 'Total Sales', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  // Firm-sale count (first observed 'Active Under Contract'), NOT closing
  // date -- a much closer match to LSTAR's own "Sales Activity" than Total
  // Sales above. No history before 2026-09-03 (see migrations/004), so
  // this reads 0 for August 2026 and earlier -- expected, not a bug.
  { key: 'units_firmed_month', label: 'Homes Firmed Up', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'new_listings_count', label: 'New Listings', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'active_count', label: 'Active Listings', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'median_list_price', label: 'Med. List Price', fmt: fmtPrice },
  { key: 'median_sold_price_month', label: 'Med. Sale Price', fmt: fmtPrice },
  { key: 'avg_days_on_market', label: 'Med. Days on Market', fmt: (n) => (n == null ? 'n/a' : String(Math.round(n))) },
  { key: 'avg_sale_to_list_ratio_month', label: 'List-to-Sale %', fmt: (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`) },
  { key: 'price_per_sqft', label: 'Price/Sqft', fmt: (n) => (n == null ? 'n/a' : `$${Math.round(n)}`) },
  { key: 'median_bedrooms', label: 'Med. Bedrooms', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'median_bathrooms', label: 'Med. Bathrooms', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'pct_detached', label: '% Detached', fmt: (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`) },
  { key: 'delisted_count', label: 'Left Market', fmt: (n) => (n == null ? 'n/a' : String(n)) },
];

const METRIC_LABELS = Object.fromEntries(REPORT_METRICS.map((m) => [m.key, m.label]));

function fmtPrice(n) {
  if (n == null) return 'n/a';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n) {
  if (n == null) return 'n/a';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toCsv(rows) {
  const header = ['area_slug', 'area_name', 'capture_date', ...REPORT_METRICS.flatMap((m) => [m.key, `${m.key}_mom_pct`, `${m.key}_yoy_pct`])].join(',');
  const lines = rows.map((row) => {
    const cells = [row.area_slug, row.area_name, row.capture_date];
    for (const m of REPORT_METRICS) {
      cells.push(row[m.key] ?? '', row[`${m.key}_mom`] ?? '', row[`${m.key}_yoy`] ?? '');
    }
    return cells.map((v) => {
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',');
  });
  return [header, ...lines].join('\n');
}

// ---- Choropleth map rendering ----

// Sampled directly from Justin's own template legend (see conversation --
// pixel-sampled hex values, not guessed), $-thousands lower bound per band.
const PRICE_BANDS = [
  { max: 400000, color: '#d0d6c7' },
  { max: 500000, color: '#bdd09f' },
  { max: 600000, color: '#668d3c' },
  { max: 700000, color: '#b99c6b' },
  { max: 800000, color: '#8a6851' },
  { max: 900000, color: '#ff944e' },
  { max: 1000000, color: '#f16c2f' },
  { max: Infinity, color: '#b13b3c' },
];
const NO_DATA_COLOR = '#c9c9c9';

function priceBandColor(price) {
  if (price == null) return NO_DATA_COLOR;
  return PRICE_BANDS.find((b) => price < b.max).color;
}

function loadAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, name: f.properties.name, rings: f.geometry.coordinates }));
}

function loadOutlyingAreas() {
  const dataPath = fileURLToPath(new URL('../../src/data/outlying-area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, name: f.properties.name, mlsCity: f.properties.mls_city }));
}

function loadLogoBase64() {
  try {
    const logoPath = fileURLToPath(new URL('../../public/images/justinlogo.png', import.meta.url));
    return readFileSync(logoPath).toString('base64');
  } catch {
    return null;
  }
}

function loadRiverLines() {
  try {
    const dataPath = fileURLToPath(new URL('../../src/data/river-lines.json', import.meta.url));
    const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
    return raw.features.map((f) => f.geometry.coordinates);
  } catch {
    return [];
  }
}

// Area-weighted polygon centroid (standard shoelace-based formula) -- a
// plain vertex average can land outside the shape for concave/L-shaped
// neighbourhoods, this stays inside far more often.
function polygonCentroid(ring) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToRingEdge(pt, ring) {
  let minDist = Infinity;
  for (let i = 0; i < ring.length - 1; i++) minDist = Math.min(minDist, distToSegment(pt, ring[i], ring[i + 1]));
  return minDist;
}

// Approximates Mapbox's "polylabel" (pole of inaccessibility): the point
// inside the polygon that's furthest from every edge. A plain centroid can
// land in a narrow/pinched part of an odd-shaped neighbourhood (or outside
// it entirely for a concave one) -- this grid search finds a point that's
// actually deep inside the shape, so the label reliably sits within its own
// boundary regardless of how irregular the polygon is. Falls back to the
// centroid on the rare miss (grid too coarse for a very thin sliver).
function findLabelPoint(ring, gridSize = 30) {
  const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const minX = Math.min(...lngs), maxX = Math.max(...lngs);
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  let best = null, bestDist = -Infinity;
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const pt = [minX + ((maxX - minX) * i) / gridSize, minY + ((maxY - minY) * j) / gridSize];
      if (!pointInRing(pt, ring)) continue;
      const d = distToRingEdge(pt, ring);
      if (d > bestDist) { bestDist = d; best = pt; }
    }
  }
  return best || polygonCentroid(ring);
}

// Clips a river polyline to the actual footprint of the mapped neighbourhood
// polygons (plus a small buffer), not just their rectangular bounding box --
// a bbox clip left the river visibly floating past the real shapes into
// blank background wherever a corner of the box fell outside every polygon
// (confirmed near Crumlin, the east end of the Thames River trace). Keeps
// the longest contiguous inside-or-near-a-polygon run, with the two cut
// ends binary-searched onto the actual crossing point so the trim lands
// cleanly rather than jumping to whichever raw traced point was nearest.
function clipLineToPolygons(coords, polygons, bufferDeg) {
  const insideOrNear = (pt) => {
    for (const rings of polygons) {
      for (const ring of rings) {
        if (pointInRing(pt, ring)) return true;
      }
    }
    for (const rings of polygons) {
      for (const ring of rings) {
        if (distToRingEdge(pt, ring) < bufferDeg) return true;
      }
    }
    return false;
  };

  // a is assumed inside/near, b outside -- narrows onto the transition point.
  function findCrossing(a, b) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const pt = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
      if (insideOrNear(pt)) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  let runs = [];
  let current = [];
  for (let i = 0; i < coords.length; i++) {
    if (insideOrNear(coords[i])) {
      current.push(i);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  if (runs.length === 0) return [];
  const best = runs.reduce((a, b) => (b.length > a.length ? b : a));

  const result = best.map((i) => coords[i]);
  const firstIdx = best[0], lastIdx = best[best.length - 1];
  if (firstIdx > 0) result.unshift(findCrossing(coords[firstIdx], coords[firstIdx - 1]));
  if (lastIdx < coords.length - 1) result.push(findCrossing(coords[lastIdx], coords[lastIdx + 1]));
  return result;
}

// Catmull-Rom-to-cubic-Bezier conversion -- turns the hand-traced straight
// segments into a smooth flowing curve through the same points, so the
// river reads as a natural waterway rather than a jointed polyline.
function smoothLineToPathD(points) {
  if (points.length < 3) return `M${points.map((p) => p.join(',')).join('L')}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const cp2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${cp1[0]},${cp1[1]} ${cp2[0]},${cp2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Simple equirectangular-with-latitude-correction projection -- fine at
// London's latitude/scale, no need for anything fancier for a static map.
function buildProjector(allPoints, canvasWidth, canvasHeight, padding) {
  const avgLat = allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length;
  const latCorrection = Math.cos((avgLat * Math.PI) / 180);
  const xs = allPoints.map((p) => p[0] * latCorrection);
  const ys = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const usableW = canvasWidth - 2 * padding;
  const usableH = canvasHeight - 2 * padding;
  const scale = Math.min(usableW / (maxX - minX), usableH / (maxY - minY));
  const offsetX = padding + (usableW - (maxX - minX) * scale) / 2;
  const offsetY = padding + (usableH - (maxY - minY) * scale) / 2;
  return ([lng, lat]) => {
    const x = lng * latCorrection;
    return [offsetX + (x - minX) * scale, offsetY + (maxY - lat) * scale];
  };
}

function polygonToPathD(rings, project) {
  return rings.map((ring) => `M${ring.map((pt) => project(pt).join(',')).join('L')}Z`).join(' ');
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// Same slugify outlying-sold-sync-background.mjs uses to turn an mls_city
// name into the synthetic area_slug it tags synced rows with (e.g.
// "Middlesex Centre" -> "outlying-middlesex-centre"). Duplicated per this
// directory's self-contained-function convention, not imported.
function outlyingAreaSlug(mlsCity) {
  return `outlying-${mlsCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

// Reads the calendar-month sold prices outlying-sold-sync-background.mjs
// keeps synced into vow_sold_listings, instead of this function's old
// approach: a single live, undated $top=2000 fetch straight to AMPRE at
// email-send time. That was wrong two ways -- no CloseDate filter at all
// (so "this month" next to the number was never actually true), and this
// AMPRE deployment's feed empirically returns oldest-first with no
// $orderby available, so a bounded fetch for a town with years of history
// on this feed mostly never reached recent closings anyway. Fixed
// 2026-09-03, same pass as the units_sold/median_sold_price month
// mislabeling -- see outlying-sold-sync-background.mjs's header for the
// fuller story.
async function medianSoldPriceForCity(supabase, exactCityName, monthStart, monthEnd) {
  if (!exactCityName) return null;
  try {
    const { data, error } = await supabase
      .from('vow_sold_listings')
      .select('close_price')
      .eq('area_slug', outlyingAreaSlug(exactCityName))
      .eq('is_lease', false)
      .gte('close_date', monthStart)
      .lte('close_date', monthEnd);
    if (error) throw error;
    const prices = (data || []).map((l) => Number(l.close_price)).filter((n) => n > 0);
    return median(prices);
  } catch (err) {
    console.error(`medianSoldPriceForCity(${exactCityName}) failed:`, err.message);
    return null;
  }
}

// ---- Bundled fonts for the map image -----------------------------------
// Netlify's function runtime has no fonts installed at all, so sharp's
// SVG->raster step (librsvg/Pango/fontconfig) has nothing to substitute
// for "Georgia"/"Arial" and renders every <text> glyph as a tofu box --
// same bug, same fix, as monthly-blog-post-background.mjs's card image
// (see that file's ensureCardFonts() for the fuller explanation). Bundled
// here separately rather than imported, per this directory's
// self-contained-function convention. PT Sans/PT Serif, OFL-licensed via
// Google Fonts -- see assets/fonts/OFL-LICENSE.txt.
let mapFontsReady = false;
function ensureMapFonts() {
  if (mapFontsReady) return;
  const fontDir = path.join(os.tmpdir(), 'map-fonts');
  const cacheDir = path.join(os.tmpdir(), 'map-fontconfig-cache');
  mkdirSync(fontDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  const bundled = [
    ['PTSans-Regular.ttf', fileURLToPath(new URL('./assets/fonts/PTSans-Regular.ttf', import.meta.url))],
    ['PTSans-Bold.ttf', fileURLToPath(new URL('./assets/fonts/PTSans-Bold.ttf', import.meta.url))],
    ['PTSerif-Regular.ttf', fileURLToPath(new URL('./assets/fonts/PTSerif-Regular.ttf', import.meta.url))],
    ['PTSerif-Bold.ttf', fileURLToPath(new URL('./assets/fonts/PTSerif-Bold.ttf', import.meta.url))],
  ];
  for (const [name, src] of bundled) {
    const dest = path.join(fontDir, name);
    if (!existsSync(dest)) writeFileSync(dest, readFileSync(src));
  }
  const confPath = path.join(fontDir, 'fonts.conf');
  if (!existsSync(confPath)) {
    writeFileSync(confPath, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontDir}</dir>\n  <cachedir>${cacheDir}</cachedir>\n</fontconfig>\n`);
  }
  process.env.FONTCONFIG_PATH = fontDir;
  mapFontsReady = true;
}

export async function renderNeighbourhoodMapPng(snapshotRows, dateLabel) {
  ensureMapFonts();
  // Square format is the true lowest-common-denominator between Instagram's
  // documented 1080x1080 "Post" spec and Facebook's feed rendering -- both
  // show it natively with no cropping, unlike a portrait 4:5.
  const CANVAS_W = 1080;
  const CANVAS_H = 1080;
  const MAP_PADDING = 60;

  // Title lives as a scrim overlay on top of the map itself rather than its
  // own reserved row below/above it -- frees real vertical space for the
  // map to actually be bigger, while still reading as a deliberate title
  // treatment instead of text dropped on a canvas.
  const TITLE_SCRIM_H = 128;
  const TITLE_Y = 50;
  const SUBTITLE_Y = 80;
  const DIVIDER_Y = 98;

  // Hard floor for the map's topmost point -- some neighbourhoods (Fanshawe)
  // run tall enough that plain padding-based centering let their peak creep
  // up into the title scrim/divider. Shifting the whole projection down by a
  // fixed amount guarantees real separation regardless of that shape's
  // aspect ratio.
  const MAP_TOP = 148;
  const MAP_BOTTOM = 880; // map band occupies MAP_TOP..MAP_BOTTOM
  const LOGO_SIZE = 76;
  const LOGO_Y = MAP_BOTTOM + 24;
  const LEGEND_CAPTION_Y = LOGO_Y + LOGO_SIZE + 34;
  const LEGEND_Y = LEGEND_CAPTION_Y + 12;
  const LEGEND_H = 34;

  const priceByArea = new Map(snapshotRows.map((r) => [r.area_slug, r.median_sold_price_month]));
  // Whitehills stays fully wired for listings/geocoding elsewhere -- Justin
  // just doesn't want it drawn on this map (its traced shape overlaps
  // Medway's, and he'd rather not show that overlap here).
  const polygons = loadAreaBoundaries().filter((p) => p.slug !== 'whitehills');
  const logoBase64 = loadLogoBase64();
  const riverLines = loadRiverLines(); // both Thames branches, hand-traced by Justin via geojson.io

  // Project against the NEIGHBOURHOOD polygons only -- the raw river trace
  // runs well past the mapped area on both ends, and including it here was
  // forcing the whole map to zoom out to fit track that's getting clipped
  // away anyway. The river is clipped to these same polygons below, then run
  // through this identical projector so it still lines up correctly.
  const polygonPoints = polygons.flatMap((p) => p.rings.flatMap((ring) => ring));
  const rawProject = buildProjector(polygonPoints, CANVAS_W, MAP_BOTTOM - MAP_TOP, MAP_PADDING);
  const project = (pt) => {
    const [x, y] = rawProject(pt);
    return [x, y + MAP_TOP];
  };

  // No area-name text on the map itself -- with 39 neighbourhoods packed
  // this tight, several labels (Central London, London North, South London
  // among them) are simply wider than their own small polygon, so a
  // centered label unavoidably spills onto a neighbour even though its
  // anchor point sits correctly inside the shape. Per Justin, better to ship
  // clean colored shapes + legend + river and let him drop labels on
  // manually where he has full control over placement/wrapping.
  const areaPaths = polygons.map((p) => {
    const color = priceBandColor(priceByArea.get(p.slug));
    const d = polygonToPathD(p.rings, project);
    return { d, color };
  });

  const polygonSvg = areaPaths.map((a) =>
    `<path d="${a.d}" fill="${a.color}" stroke="#1c2b3a" stroke-width="2" stroke-opacity="0.75" />`
  ).join('\n');

  // Clipped to the real neighbourhood footprint (both branches ran past it
  // on either end), then run through Catmull-Rom smoothing so the
  // hand-traced straight segments read as a natural flowing waterway. A soft
  // blurred duplicate underneath plus a thin pale highlight on top give it a
  // little depth instead of a flat blue line.
  const CLIP_BUFFER_DEG = 0.003; // ~330m -- covers the gap between the hand-traced river and the real polygon edge without letting it run off into blank background
  const riverSvg = riverLines.map((coords) => {
    const clipped = clipLineToPolygons(coords, polygons.map((p) => p.rings), CLIP_BUFFER_DEG);
    if (clipped.length < 2) return '';
    const d = smoothLineToPathD(clipped.map((pt) => project(pt)));
    return `
      <path d="${d}" fill="none" stroke="#3f78a6" stroke-width="16" stroke-linecap="round" filter="url(#riverShadow)" opacity="0.35" />
      <path d="${d}" fill="none" stroke="#7ab6dd" stroke-width="11" stroke-linecap="round" />
      <path d="${d}" fill="none" stroke="#d7ecf9" stroke-width="3" stroke-linecap="round" opacity="0.6" />
    `;
  }).join('\n');

  // Legend -- exact colors/order sampled from Justin's own template, wrapped
  // in a rounded-rect clip so the overall bar reads as one soft pill instead
  // of a strip of hard-edged blocks.
  const legendLabels = ['$300', '$400k', '$500k', '$600k', '$700k', '$800', '$900', '$1M+'];
  const legendX = 60;
  const legendW = CANVAS_W - 120;
  const swatchW = legendW / PRICE_BANDS.length;
  const legendSwatches = PRICE_BANDS.map((b, i) => `
    <rect x="${legendX + i * swatchW}" y="${LEGEND_Y}" width="${swatchW + 0.5}" height="${LEGEND_H}" fill="${b.color}" />
    <text x="${legendX + i * swatchW + swatchW / 2}" y="${LEGEND_Y + LEGEND_H / 2 + 1}" font-family="PT Sans" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${legendLabels[i]}</text>
  `).join('\n');
  const legendSvg = `
    <text x="${CANVAS_W / 2}" y="${LEGEND_CAPTION_Y}" font-family="PT Sans" font-size="13" font-weight="bold" fill="#5b5346" text-anchor="middle" letter-spacing="2">MEDIAN SOLD PRICE</text>
    <g clip-path="url(#legendClip)">
      ${legendSwatches}
    </g>
    <rect x="${legendX}" y="${LEGEND_Y}" width="${legendW}" height="${LEGEND_H}" rx="8" fill="none" stroke="#1c2b3a" stroke-width="1.5" stroke-opacity="0.55" />
  `;

  const logoSvg = logoBase64
    ? `
      <circle cx="${CANVAS_W / 2}" cy="${LOGO_Y + LOGO_SIZE / 2}" r="${LOGO_SIZE / 2 + 5}" fill="#fdfbf7" filter="url(#cardShadow)" />
      <image href="data:image/png;base64,${logoBase64}" x="${(CANVAS_W - LOGO_SIZE) / 2}" y="${LOGO_Y}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" />
    `
    : '';

  const svg = `
    <svg width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f8f5ee" />
          <stop offset="100%" stop-color="#ece5d5" />
        </linearGradient>
        <radialGradient id="vignette" cx="50%" cy="42%" r="72%">
          <stop offset="60%" stop-color="#0c2340" stop-opacity="0" />
          <stop offset="100%" stop-color="#0c2340" stop-opacity="0.16" />
        </radialGradient>
        <linearGradient id="titleScrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0c2340" stop-opacity="0.82" />
          <stop offset="100%" stop-color="#0c2340" stop-opacity="0" />
        </linearGradient>
        <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
          <feOffset in="blur" dx="0" dy="2" result="offsetBlur" />
          <feComponentTransfer in="offsetBlur" result="shadow">
            <feFuncA type="linear" slope="0.35" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="riverShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" />
        </filter>
        <clipPath id="legendClip">
          <rect x="${legendX}" y="${LEGEND_Y}" width="${legendW}" height="${LEGEND_H}" rx="8" />
        </clipPath>
      </defs>

      <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#bgGradient)" />

      <g filter="url(#cardShadow)">
        ${polygonSvg}
      </g>
      ${riverSvg}

      <rect x="0" y="0" width="${CANVAS_W}" height="${MAP_BOTTOM}" fill="url(#vignette)" />

      <rect x="0" y="0" width="${CANVAS_W}" height="${TITLE_SCRIM_H}" fill="url(#titleScrim)" />
      <text x="${CANVAS_W / 2}" y="${TITLE_Y}" font-family="PT Serif" font-size="33" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">London Ontario — Median Sold Price</text>
      <text x="${CANVAS_W / 2}" y="${SUBTITLE_Y}" font-family="PT Sans" font-size="16" fill="#e7ecf2" text-anchor="middle" letter-spacing="1">BY NEIGHBOURHOOD  •  ${esc(dateLabel)}</text>
      <line x1="${CANVAS_W / 2 - 45}" y1="${DIVIDER_Y}" x2="${CANVAS_W / 2 + 45}" y2="${DIVIDER_Y}" stroke="#b99c6b" stroke-width="2" />

      <line x1="60" y1="${MAP_BOTTOM}" x2="${CANVAS_W - 60}" y2="${MAP_BOTTOM}" stroke="#1c2b3a" stroke-width="1" stroke-opacity="0.15" />
      ${logoSvg}
      ${legendSvg}
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Justin shades the outlying-town boxes on the map himself (manually, in
// Canva) rather than us drawing them -- he just needs the real numbers so he
// knows which color band each town falls in. Same city-lookup quirks as the
// map: safe single-word search term per exact city name, since this AMPRE
// deployment's contains() filter silently empties out on multi-word values
// ('Middlesex Centre', 'St. Thomas') but not hyphenated ones.
async function getOutlyingAreaPrices(supabase, monthStart, monthEnd) {
  const outlyingAreas = loadOutlyingAreas();
  const results = await Promise.all(
    outlyingAreas.map(async (a) => ({ name: a.name, price: await medianSoldPriceForCity(supabase, a.mlsCity, monthStart, monthEnd) }))
  );
  results.push({ name: 'St. Thomas', price: await medianSoldPriceForCity(supabase, 'St. Thomas', monthStart, monthEnd) });
  return results;
}

async function sendDigestEmail(subject, html, attachments) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Resend's sandbox sender (onboarding@resend.dev) 403s on ANY
      // recipient besides the account's own verified address -- confirmed
      // 2026-09-02 (a real production send, the first time this ever
      // actually ran against Resend since the smile@ CC was added). Fixed
      // for real 2026-09-02 by verifying mail.liveinoakridge.ca in Resend
      // (Justin already had the GoDaddy DNS records in place) -- a verified
      // domain's `from` address has no such restriction.
      from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
      to: [DIGEST_TO_EMAIL, 'smile@homeswithjustin.ca'],
      subject,
      html,
      attachments,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

// Best-effort failure alert, matching monthly-blog-post-background.mjs's
// sendNotifyEmail pattern -- this is the ONLY thing that would have told
// Justin the 2026-09-01 run failed silently (dead RESEND_API_KEY at 9am ET,
// fixed later that same afternoon). If RESEND_API_KEY itself is the failure,
// this alert will also fail to send -- a known gap, same one the blog post's
// notify path already accepts -- but it still catches every OTHER failure
// mode (Supabase query, map render, AMPRE lookup, etc.).
async function sendFailureAlert(message) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
        to: [DIGEST_TO_EMAIL], // internal ops alert -- Justin only, not Smile
        subject: '⚠️ Monthly digest FAILED to send',
        html: `<p>${esc(message)}</p><p>Check Netlify function logs for monthly-digest-background.</p>`,
      }),
    });
  } catch (err) {
    console.error('monthly-digest: failure alert itself failed to send:', err.message);
  }
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    console.error('monthly-digest: missing required env vars', {
      SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY: !!RESEND_API_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: latestMonthEnd } = await supabase
    .from('market_map_snapshots')
    .select('capture_date')
    .eq('period_type', 'month-end')
    .order('capture_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestMonthEnd) {
    console.log('monthly-digest: no month-end snapshot found yet, skipping');
    return new Response('No month-end snapshot found yet');
  }

  // Same run-date-vs-reported-month offset as monthly-blog-post-background.mjs
  // -- heat-map-snapshot-background.mjs stamps a 'month-end' row's capture_date
  // as the day it ran (the 1st), but the DATA in that row is the PREVIOUS
  // month's completed close. Queries below still key off the raw capture_date
  // (that's the correct DB value) -- only human-facing text uses monthLabel.
  const captureDateObj = new Date(`${latestMonthEnd.capture_date}T00:00:00Z`);
  const reportedMonthObj = new Date(Date.UTC(captureDateObj.getUTCFullYear(), captureDateObj.getUTCMonth() - 1, 1));
  const monthLabel = reportedMonthObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthShort = reportedMonthObj.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  const reportedYear = reportedMonthObj.getUTCFullYear();
  // Calendar-month bounds for the outlying-towns lookup below -- same
  // reportedMonthObj the rest of this file already uses for monthLabel.
  const reportedMonthStart = reportedMonthObj.toISOString().slice(0, 10);
  const reportedMonthEnd = new Date(Date.UTC(reportedMonthObj.getUTCFullYear(), reportedMonthObj.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);

  try {

  const [{ data: snapshotRows, error: snapError }, { data: changeRows, error: changeError }] = await Promise.all([
    supabase
      .from('market_map_snapshots')
      .select(['area_slug', 'area_name', 'capture_date', ...REPORT_METRICS.map((m) => m.key)].join(','))
      .eq('period_type', 'month-end')
      .eq('capture_date', latestMonthEnd.capture_date),
    supabase
      .from('market_map_changes')
      .select('area_slug, area_name, metric, current_value, mom_pct_change, yoy_pct_change, is_notable')
      .eq('period_type', 'month-end')
      .eq('capture_date', latestMonthEnd.capture_date)
      .in('metric', REPORT_METRICS.map((m) => m.key)),
  ]);

  if (snapError || !snapshotRows) {
    console.error('monthly-digest: snapshot query failed:', snapError?.message);
    return new Response('Query failed', { status: 500 });
  }

  const changesByAreaMetric = new Map();
  for (const c of changeRows || []) {
    if (!changesByAreaMetric.has(c.area_slug)) changesByAreaMetric.set(c.area_slug, {});
    changesByAreaMetric.get(c.area_slug)[c.metric] = { mom: c.mom_pct_change, yoy: c.yoy_pct_change };
  }

  const rows = snapshotRows.map((s) => {
    const changes = changesByAreaMetric.get(s.area_slug) || {};
    const row = { ...s };
    for (const m of REPORT_METRICS) {
      row[`${m.key}_mom`] = changes[m.key]?.mom ?? null;
      row[`${m.key}_yoy`] = changes[m.key]?.yoy ?? null;
    }
    return row;
  });

  const sortedRows = sortAreasServedFirst(rows);

  const totalSold = snapshotRows.reduce((sum, r) => sum + (r.units_sold_month || 0), 0);
  const totalNewListings = snapshotRows.reduce((sum, r) => sum + (r.new_listings_count || 0), 0);

  // "Notable" is already computed by heat-map-snapshot-background.mjs
  // (fixed 10%+ MoM swing, plain code -- no AI judgment involved). Split so
  // Justin's 7 served areas surface first, per his ask, with everything
  // else after. median_bedrooms excluded per Justin's ask (2026-09-02) --
  // it's a low-cardinality metric that swings 10%+ on small sample noise
  // alone, not a stat worth a "notable move" callout. Still shown in the
  // full per-neighbourhood table below, just never in this section.
  const notable = (changeRows || []).filter((c) => c.is_notable && c.metric !== 'median_bedrooms').sort((a, b) => Math.abs(b.mom_pct_change) - Math.abs(a.mom_pct_change));
  const notableServed = notable.filter((c) => SERVED_AREA_ORDER.includes(c.area_slug));
  const notableOther = notable.filter((c) => !SERVED_AREA_ORDER.includes(c.area_slug));

  function notableLineHtml(c) {
    const direction = c.mom_pct_change > 0 ? '▲' : '▼';
    const label = METRIC_LABELS[c.metric] || c.metric;
    return `<li>${direction} <strong>${esc(c.area_name)}</strong> — ${esc(label)}: ${fmtPct(c.mom_pct_change)} MoM (now ${c.current_value})</li>`;
  }

  const tableRows = sortedRows.map((r) => {
    const isServed = SERVED_AREA_ORDER.includes(r.area_slug);
    const nameCell = isServed ? `<strong>${esc(r.area_name)}</strong>` : esc(r.area_name);
    const metricCells = REPORT_METRICS.map((m) => {
      const val = m.fmt(r[m.key]);
      const mom = fmtPct(r[`${m.key}_mom`]);
      const yoy = fmtPct(r[`${m.key}_yoy`]);
      return `<td style="padding:4px 8px;white-space:nowrap;">${val}<br/><span style="font-size:10px;color:#888;">MoM ${mom} · YoY ${yoy}</span></td>`;
    }).join('');
    return `<tr>${`<td style="padding:4px 8px;">${nameCell}</td>`}${metricCells}</tr>`;
  }).join('');

  const headerCells = REPORT_METRICS.map((m) => `<td style="padding:4px 8px;">${esc(m.label)}</td>`).join('');

  const outlyingPrices = await getOutlyingAreaPrices(supabase, reportedMonthStart, reportedMonthEnd);
  const outlyingListHtml = outlyingPrices
    .map((a) => `<li><strong>${esc(a.name)}</strong>: ${fmtPrice(a.price)}</li>`)
    .join('');

  const html = `
    <h2>Full Month Review — ${esc(monthLabel)}</h2>
    <p>Total Sales: ${totalSold} · New Listings: ${totalNewListings} · ${snapshotRows.length} neighbourhoods</p>
    <p style="font-size:12px;color:#888;">MoM/YoY % change needs history this pipeline hasn't built up yet (brand new as of July 2026) -- these will read "n/a" for a while, then populate automatically once enough monthly captures exist. No rebuild needed when that happens.</p>

    <h3>🔔 Notable Moves — Your 7 Areas (10%+ month-over-month)</h3>
    ${notableServed.length > 0 ? `<ul>${notableServed.map(notableLineHtml).join('')}</ul>` : '<p style="color:#888;">None this period (or not enough history yet to compute a % change).</p>'}

    <h3>Other Notable Moves (10%+ month-over-month)</h3>
    ${notableOther.length > 0 ? `<ul>${notableOther.slice(0, 15).map(notableLineHtml).join('')}</ul>` : '<p style="color:#888;">None this period.</p>'}

    <p>Neighbourhood map attached as PNG (colored by median sold price, same legend as your own monthly graphic -- no boxes/labels, add those yourself).</p>

    <h3>Outlying Areas — Median Sold Price</h3>
    <p style="font-size:12px;color:#888;">For shading the boxes you add to the map yourself. Gray/"n/a" means this town genuinely isn't in the MLS feed's City field.</p>
    <ul>${outlyingListHtml}</ul>

    <table style="border-collapse:collapse;font-size:12px;">
      <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 8px;">Neighbourhood</td>${headerCells}</tr>
      ${tableRows}
    </table>
    <p>Bold = your 7 served areas. Full data also attached as CSV (filterable headers in Excel/Sheets).</p>
    <p style="font-size:12px;color:#888;">Auto-generated from live MLS data -- no AI involved in compiling these numbers.</p>
  `;

  const csv = toCsv(sortedRows);
  const mapPng = await renderNeighbourhoodMapPng(snapshotRows, monthLabel);

  const fileTag = `${monthShort}-${reportedYear}`;
  await sendDigestEmail(
    `Full Month Review — ${monthLabel}`,
    html,
    [
      { filename: `full-month-review-${fileTag}.csv`, content: Buffer.from(csv).toString('base64') },
      { filename: `neighbourhood-map-${fileTag}.png`, content: mapPng.toString('base64') },
    ]
  );

  const summary = `monthly-digest sent: ${sortedRows.length} areas, ${totalSold} sold, ${totalNewListings} new listings, map rendered`;
  console.log(summary);
  return new Response(summary);
  } catch (err) {
    console.error('monthly-digest: failed:', err.message);
    await sendFailureAlert(`Monthly digest for ${monthLabel} failed: ${esc(err.message)}`);
    return new Response(`Failed: ${err.message}`, { status: 500 });
  }
};

export const config = {
  schedule: '0 13 1 * *', // 1st of month, 1pm UTC -- after heat-map-snapshot's 9am UTC month-end capture same day
};
