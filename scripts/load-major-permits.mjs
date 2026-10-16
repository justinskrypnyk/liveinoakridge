// Loads the City of London's "Principal Permits Issued" table (every permit
// $1M+, except single/semi-detached houses) from a quarterly Building Services
// Report into src/data/major-permits.json, tagged with neighbourhood.
//
// Run it once per quarter when the City posts a new report (the monthly
// neighbourhood-activity email flags when one appears):
//   1. Download the report PDF. The newer ones sit on pub-london.escribemeetings.com
//      behind a Cloudflare browser check, so open the link in a real browser.
//   2. pdftotext -layout report.pdf report.txt
//   3. node scripts/load-major-permits.mjs report.txt "2026 Q2"
//
// Each report is cumulative from Jan 1 ("Jan 1 to June 30, 2026"), so a newer
// report for the same year replaces that year's rows; the period label is kept.
// Addresses are matched on the City's own address map (no Google quota), then
// tagged with whichever of our 39 neighbourhood polygons contains them.
import fs from 'node:fs';
import areaBoundaries from '../src/data/area-boundaries.json' with { type: 'json' };

const [txtPath, period] = process.argv.slice(2);
if (!txtPath || !/^\d{4} Q[1-4]$/.test(period || '')) {
  console.error('usage: node scripts/load-major-permits.mjs report.txt "2026 Q2"');
  process.exit(1);
}
const year = period.slice(0, 4);
const OUT = new URL('../src/data/major-permits.json', import.meta.url);

// ---- 1. Parse the fixed-width table ---------------------------------------
// Split into pages at each "Principal Permits Issued from" title. Headers are
// centred differently from report to report, so column starts come from the
// data itself: the two widest all-blank vertical gaps on the page are the
// owner|location and location|work boundaries.
const VALUE_END = /\s(\d{1,3}(?:,\d{3}){2,})\s*$/;
const HEADER = /^(Owner|Project|Location|Proposed Work|No\.?|of|Units|Value|Construction|No\. of)(\s|$)/;
const allLines = fs.readFileSync(txtPath, 'utf8').split('\n');
const pages = [];
let page = null;
for (const line of allLines) {
  if (/Principal Permits Issued from/.test(line)) {
    page = [];
    pages.push(page);
    continue;
  }
  if (!page) continue;
  if (/Includes all permits \$1,000,000/.test(line) || /City of London - Building Division/.test(line)) {
    page = null;
    continue;
  }
  // Number-only lines are page numbers -- or a wrapped scrap of a description
  // ("SB-12 A-" / "1"), so skip them rather than ending the page.
  if (!line.trim() || /^\s*\d{1,3}\s*$/.test(line)) continue;
  const words = line.trim().split(/\s{2,}/);
  if (!VALUE_END.test(line) && words.every((w) => HEADER.test(w))) continue;
  page.push(line);
}

function columnsFor(lines) {
  // Only the left part of the line matters (owner + location + start of work).
  const width = Math.max(...lines.map((l) => l.length));
  const limit = Math.floor(width * 0.6);
  const blank = [];
  for (let x = 0; x < limit; x++) blank[x] = lines.every((l) => x >= l.length || l[x] === ' ');
  const runs = [];
  for (let x = 0; x < limit; x++) {
    if (!blank[x]) continue;
    let end = x;
    while (end + 1 < limit && blank[end + 1]) end++;
    // A gap touching the left margin is indentation, not a column boundary.
    if (x > 0) runs.push({ start: x, end, len: end - x + 1 });
    x = end;
  }
  const two = runs.sort((a, b) => b.len - a.len).slice(0, 2).sort((a, b) => a.start - b.start);
  if (two.length < 2) return null;
  return { loc: two[0].end + 1, work: two[1].end + 1 };
}

const rows = [];
let cur = null;
const flush = () => {
  if (cur) rows.push(cur);
  cur = null;
};
for (const lines of pages) {
  flush();
  const cols = columnsFor(lines);
  if (!cols) continue;
  for (const line of lines) {

  const owner = line.slice(0, cols.loc).trim();
  const loc = line.slice(cols.loc, cols.work).trim();
  let work = line.slice(cols.work).trimEnd();
  const m = line.match(VALUE_END);
  if (m) {
    flush();
    const value = Number(m[1].replace(/,/g, ''));
    // Units column: a bare number right before the value (often blank).
    const tail = line.slice(cols.work, line.length - m[0].length + 1);
    const um = tail.match(/\s(\d{1,4})\s*$/);
    const units = um ? Number(um[1]) : 0;
    work = (um ? tail.slice(0, tail.length - um[0].length) : tail).trim();
    cur = { owner: [owner], loc: [loc], work: [work], units, value, raw: line };
  } else if (cur) {
    if (owner) cur.owner.push(owner);
    if (loc) cur.loc.push(loc);
    if (work.trim()) cur.work.push(work.trim());
  }
  }
}
flush();

const clean = (s) => s.replace(/\s+/g, ' ').trim();
// The report's own "Total Permits N Units N Value" line parses like a row.
const realRows = rows.filter((r) => !/^Total\b/i.test(clean(r.owner.join(' '))));
for (const r of realRows) {
  // A long owner name can shift a page's gap detection so the street number
  // lands in the owner column. Re-split from the raw first line: owner, then
  // a 2+ space gap, then "<number> <street ...>" up to the next gap.
  if (/^\d/.test(clean(r.loc.join(' ')))) continue;
  const m = r.raw.match(/^\s*(.+?)\s{2,}(\d+[A-Z]?\s+[A-Za-z].*?)\s{2,}/) || r.raw.match(/^\s*(.*?\D)\s(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Za-z]+){0,3}?)\s{2,}/);
  if (m) {
    r.owner = [m[1]];
    r.loc = [m[2]];
  }
}
const permits = realRows.map((r) => {
  const work = clean(r.work.join(' '));
  const kind = work.match(/^(?:\(statcan\)\s*)?(Erect|Alter|Add(?: \([^)]*\))?|Install(?: Site Services)?|Demolish|Change of Use)\b/i)?.[1] ?? 'Other';
  return {
    owner: clean([...new Set(r.owner)].join(' ')),
    address: clean(r.loc.join(' ')),
    work: work.replace(/^\(statcan\)\s*/, ''),
    kind: /^add/i.test(kind) ? 'Addition' : /^install site/i.test(kind) ? 'Site services' : kind[0].toUpperCase() + kind.slice(1).toLowerCase(),
    units: r.units,
    value: r.value,
  };
});
console.log(`parsed ${permits.length} permits, $${(permits.reduce((s, p) => s + p.value, 0) / 1e6).toFixed(1)}M`);

// ---- 2. Locate each address on the City's address map -------------------
const polys = areaBoundaries.features.map((f) => ({ slug: f.properties.slug, name: f.properties.name, ring: f.geometry.coordinates[0] }));
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const STREET_TYPE = /^(St|Rd|Ave|Dr|Blvd|Cres|Crt|Ct|Pl|Way|Lane|Ln|Line|Gate|Sq|Terr|Trail|Pkwy|Hwy|Cir|Gdns|Grv|Hts|Pk|Row|Walk|Road|Street|Avenue|Drive|Place|Court|Cross)$/i;
// "1030 Darnley Blvd A" / "230 Base Line Rd W" -> street name only: drop a
// trailing block letter and direction, then ONE street type from the end (so
// "Base Line" keeps its "Line").
function streetName(rest) {
  const t = rest.replace(/[^A-Za-z' /]/g, ' ').trim().split(/\s+/);
  const trailing = [];
  while (t.length > 1 && /^(N|S|E|W|NE|NW|SE|SW|E\/S|W\/S|N\/S|S\/S|[A-Z]{1,2})$/.test(t[t.length - 1])) trailing.unshift(t.pop());
  if (t.length > 1 && STREET_TYPE.test(t[t.length - 1])) t.pop();
  // A trailing N/S/E/W may be a direction ("Commissioners Rd E") or a block
  // letter ("Darnley Blvd E"); locate() only uses it to pick between matches.
  const dir = trailing.find((x) => /^(N|S|E|W)$/.test(x)) || null;
  return { name: t.join(' ').toUpperCase(), dir };
}

async function locate(address) {
  const m = address.match(/^(\d+)[A-Z]?\s+(.+)$/);
  if (!m) return null;
  const num = m[1];
  const { name, dir } = streetName(m[2]);
  if (!name) return null;
  const where = `IntegerMunicipalNumber = ${num} AND UPPER(StreetName) = '${name.replace(/'/g, "''")}'`;
  const url = `https://maps.london.ca/server/rest/services/Addresses/MapServer/0/query?` +
    new URLSearchParams({ where, outFields: 'StreetName,StreetType,StreetDirection', returnGeometry: 'true', outSR: '4326', f: 'json' });
  const d = await (await fetch(url)).json();
  const found = d.features || [];
  const dirs = new Set(found.map((f) => (f.attributes.StreetDirection || '').trim().charAt(0).toUpperCase()));
  // Same number on e.g. Commissioners Rd E and W: the direction decides, and
  // with no direction to go on we'd rather leave it unplaced than guess.
  let f = found[0];
  if (dirs.size > 1) f = dir ? found.find((x) => (x.attributes.StreetDirection || '').trim().toUpperCase().startsWith(dir)) : null;
  return f ? { lat: f.geometry.y, lng: f.geometry.x } : null;
}

let located = 0;
for (const p of permits) {
  const pt = await locate(p.address).catch(() => null);
  if (!pt) continue;
  located++;
  p.lat = +pt.lat.toFixed(6);
  p.lng = +pt.lng.toFixed(6);
  const area = polys.find((a) => pointInRing(pt.lat, pt.lng, a.ring));
  if (area) {
    p.area = area.slug;
    p.areaName = area.name;
  }
}
console.log(`located ${located}/${permits.length}; in a neighbourhood: ${permits.filter((p) => p.area).length}`);
const missed = permits.filter((p) => p.lat == null).map((p) => p.address);
if (missed.length) console.log('not found on the address map:', missed.join(' | '));

// ---- 3. Save, replacing this year's rows ---------------------------------
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { years: {} };
// Keep the quarter each permit first appeared in, so the email can say "new
// this quarter" (same address + value + work = same permit).
const sig = (p) => `${p.address}|${p.value}|${p.work}`;
const before = new Map((existing.years[year]?.permits || []).map((p) => [sig(p), p.firstReported]));
for (const p of permits) p.firstReported = before.get(sig(p)) || period;
existing.years[year] = { period, loadedAt: new Date().toISOString().slice(0, 10), permits };
fs.writeFileSync(OUT, JSON.stringify(existing, null, 1) + '\n');
console.log(`wrote ${year} (${period}) to src/data/major-permits.json`);
