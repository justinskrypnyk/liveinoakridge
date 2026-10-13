// Address suggestions for /admin/comps/ (Justin, 2026-10-13): as he types,
// offer homes from the comps index and -- for homes that have never been
// listed -- his house number on a matching street, forgiving small typos
// ("1245 riverbnd rd" -> "1245 Riverbend Road, London"). Uses only the
// index's ~16k addresses, so no Google calls.
import type { CompRow } from './comps-score';

export type Suggestion = { label: string; note: string };

const SUFFIX: Record<string, string> = {
  rd: 'road', dr: 'drive', st: 'street', ave: 'avenue', av: 'avenue', cres: 'crescent', cr: 'crescent', cresc: 'crescent',
  blvd: 'boulevard', ct: 'court', crt: 'court', pl: 'place', ln: 'lane', cir: 'circle', crcl: 'circle', trl: 'trail', tr: 'trail',
  pkwy: 'parkway', hwy: 'highway', cl: 'close', gt: 'gate', gdns: 'gardens', hts: 'heights', sq: 'square', ter: 'terrace', terr: 'terrace',
};
const norm = (s: string) => s.toLowerCase().replace(/[#.,']/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter(Boolean).map((w) => SUFFIX[w] || w);
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b([NSEW])\b/gi, (c) => c.toUpperCase());

/** "1328 Commissioners Road W 2, London South, ON N6K 2Y6" -> parts */
function split(a: string) {
  const [first, cityPart = ''] = a.split(',');
  const m = first.trim().match(/^(?:lot\s+)?(?:\S+-)?(\d+[a-z]?)\s+(.+?)(?:\s+\S*\d\S*)?$/i);
  if (!m) return null;
  const city = /^London\b/i.test(cityPart.trim()) ? 'London' : cityPart.trim();
  return { num: m[1].toLowerCase(), street: title(m[2]), city };
}

// Optimal string alignment distance (Levenshtein + adjacent swaps), capped.
function dist(a: string, b: string, cap: number) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// How far typed word t is from street word w. The last typed word may be
// unfinished, so it's compared with the start of w.
function wordDist(t: string, w: string, last: boolean) {
  const cap = t.length <= 2 ? 0 : t.length <= 5 ? 1 : 2;
  if (w.startsWith(t) && (last || w === t)) return 0;
  const full = dist(t, w, cap);
  const pre = last ? Math.min(dist(t, w.slice(0, t.length), cap), dist(t, w.slice(0, t.length + 1), cap)) : full;
  const d = Math.min(full, pre);
  return d > cap ? null : d;
}

type Street = { name: string; city: string; w: string[]; london: boolean };
type Home = { num: string; key: string; label: string; note: string; d: string };
let built: { at: string; streets: Street[]; homes: Map<string, Home[]> } | null = null;

const STATUS: Record<string, string> = { S: 'sold', C: 'conditional', A: 'for sale' };
const month = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' }) : '');

function build(rows: CompRow[], at: string) {
  if (built?.at === at) return built;
  const streets = new Map<string, Street>();
  const homes = new Map<string, Home[]>(); // street key -> homes on it
  for (const r of rows) {
    const p = split(r.a);
    if (!p) continue;
    const key = `${words(p.street).join(' ')}|${p.city.toLowerCase()}`;
    if (!streets.has(key)) streets.set(key, { name: p.street, city: p.city, w: words(p.street), london: p.city === 'London' });
    const list = homes.get(key) || [];
    const label = `${r.a.split(',')[0].trim().replace(/^lot/i, 'Lot').replace(/\S+/g, (w) => (/\d/.test(w) ? w : title(w)))}, ${p.city}`;
    const prev = list.find((h) => h.label === label);
    const d = r.d || r.ld || '';
    const note = `${STATUS[r.st] || 'on MLS®'} ${month(d)}`.trim();
    if (!prev) list.push({ num: p.num, key, label, note, d });
    else if (d > prev.d) Object.assign(prev, { note, d });
    homes.set(key, list);
  }
  built = { at, streets: [...streets.values()], homes };
  return built;
}

export function suggest(q: string, rows: CompRow[], builtAt: string, limit = 8): Suggestion[] {
  const typed = norm(q.split(',')[0]);
  const m = typed.match(/^(?:lot\s+)?(?:(\S+)-)?(\d+[a-z]?)\s+(.+)$/);
  if (!m) return [];
  const [, unit, num] = m;
  // MLS writes units both ways: "12-515 Skyline Avenue" and "515 Skyline Avenue 12".
  const isUnit = (label: string) => !!unit && (label.toLowerCase().startsWith(`${unit}-`) || new RegExp(`\\s${unit},`, 'i').test(label));
  const t = words(m[3]).filter((w) => !/^(london|on|ontario)$/.test(w));
  if (!t.length || t[0].length < 2) return [];
  const { streets, homes } = build(rows, builtAt);

  const matches: { s: Street; d: number }[] = [];
  for (const s of streets) {
    if (t.length > s.w.length) continue;
    let total = 0;
    for (let i = 0; i < t.length; i++) {
      const d = wordDist(t[i], s.w[i], i === t.length - 1);
      if (d == null) { total = -1; break; }
      total += d;
    }
    if (total >= 0) matches.push({ s, d: total });
  }
  matches.sort((a, b) => a.d - b.d || Number(b.s.london) - Number(a.s.london) || a.s.name.length - b.s.name.length);

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (label: string, note: string) => { if (!seen.has(label.toLowerCase())) { seen.add(label.toLowerCase()); out.push({ label, note }); } };
  // This house number on the closest streets: an MLS home if there is one,
  // otherwise the corrected address of a never-listed home.
  for (const { s } of matches.slice(0, 6)) {
    const key = `${s.w.join(' ')}|${s.city.toLowerCase()}`;
    const onMls = (homes.get(key) || []).filter((h) => h.num === num);
    if (onMls.length) onMls.sort((a, b) => Number(isUnit(b.label)) - Number(isUnit(a.label)) || b.d.localeCompare(a.d)).forEach((h) => add(h.label, h.note));
    else add(`${num} ${s.name}, ${s.city}`, 'not on MLS® - fill in the details');
  }
  // Then other homes on the best street whose number starts the same way.
  if (out.length < limit && matches[0]) {
    const key = `${matches[0].s.w.join(' ')}|${matches[0].s.city.toLowerCase()}`;
    (homes.get(key) || []).filter((h) => h.num !== num && h.num.startsWith(num)).sort((a, b) => a.num.length - b.num.length || a.num.localeCompare(b.num))
      .forEach((h) => add(h.label, h.note));
  }
  return out.slice(0, limit);
}
