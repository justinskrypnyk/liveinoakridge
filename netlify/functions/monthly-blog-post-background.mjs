// CHANGED 2026-10-01 (Justin): the scheduled run no longer publishes. It
// emails Justin the month's numbers and a hero-image preview, and the post
// is written together with him to Nico Gorrono's GEO standard (interview
// first, outline approval, at least 50% different from earlier posts) --
// see the september-2026-london-ontario-housing-market post. The fixed
// template below repeats the same sentences every month. It still runs for
// POST {"publish": true} (and {"preview": ...}), but nothing calls that on a
// schedule. VOW: Justin confirmed (2026-10-01) that AI-assisted posts are
// fine as long as he's involved -- he gives his read, approves the outline
// and the final post.
//
// Original note: writes and publishes a monthly market-update blog post
// with NO human review step, per Justin's explicit choice (2026-08-25).
// That choice only holds up because this file guarantees one thing: no LLM
// call happens anywhere in this pipeline. Every sentence is picked from a
// fixed phrase bank keyed by direction + magnitude of a number this script
// computed itself -- same "plain JS math, template output" rule every other
// automated email on this site already follows (weekly-digest-background,
// monthly-digest-background), extended here to public, indexed content
// instead of an inbox. A template can't hallucinate a wrong price; a
// generative call could -- that's the actual justification for skipping
// review, not just a VOW Article 6.2(a) technicality (though it also
// satisfies that: VOW forbids an AI system from interpreting sold-price
// data, and nothing here interprets anything -- it selects).
//
// Runs after monthly-digest-background.mjs (1pm UTC) so it works from data
// Justin's own inbox already saw an hour earlier. Publishes by having this
// job commit directly to `main` via GitHub's Contents API -- the same
// git-push-triggers-Netlify-deploy pipeline every manual change already
// uses, just with a bot driving the commit instead of a person. Requires
// GITHUB_TOKEN (fine-grained PAT, contents:write, scoped to this repo only)
// -- Justin has to create that himself, it can't be generated on his behalf.
//
// Self-contained rather than importing monthly-digest-background.mjs's
// helpers -- same isolation convention as every function in this
// directory (see that file's own header comment for the fuller reasoning).
import { wrongLondonHour } from '../../src/lib/london-time.mjs';
import { createClient } from '@supabase/supabase-js';
import { CITYWIDE_METHOD_SINCE, fetchVowLondonListings, firmSales, previousMonthRange, SALE_FIELDS, torontoDate } from '../../src/lib/vow-listings.mjs';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// Citywide active stats come from the VOW feed -- DDF misses ~15% of
// London's listings (see src/lib/vow-listings.mjs).
const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Same backstop as every other function that touches vow_sold_listings --
// see weekly-digest-background.mjs's own copy of this constant for the
// full story (AMPRE leases occasionally sync with is_lease wrongly false).
const MIN_PLAUSIBLE_SALE_PRICE = 30000;

const GITHUB_OWNER = 'justinskrypnyk';
const GITHUB_REPO = 'liveinoakridge';
const BLOG_DATA_PATH = 'src/data/blog.ts';
const SITE_URL = 'https://www.liveinoakridge.ca';

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

// Subset of monthly-digest's REPORT_METRICS this post actually narrates --
// same column names/formatters, trimmed to what's readable as prose rather
// than a full 12-column table dump.
// units_sold/median_sold_price/avg_sale_to_list_ratio use the "_month"
// columns (true calendar-month figures), NOT the plain ones -- those stay
// a 90-day rolling window for the heat map's own medians (see
// heat-map-snapshot-background.mjs). This post always runs off a
// 'month-end' capture (see the guard below), so "_month" here always means
// the full completed month being reported on, never month-to-date.
const REPORT_METRICS = [
  { key: 'units_sold_month', label: 'homes sold', shortLabel: 'Homes Sold', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'median_sold_price_month', label: 'median sale price', shortLabel: 'Median Sale Price', fmt: fmtPrice },
  { key: 'avg_days_on_market', label: 'days on market', shortLabel: 'Days on Market', fmt: (n) => (n == null ? 'n/a' : String(Math.round(n))) },
  { key: 'avg_sale_to_list_ratio_month', label: 'sale-to-list ratio', shortLabel: 'Sale-to-List', fmt: (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`) },
  { key: 'new_listings_count', label: 'new listings', shortLabel: 'New Listings', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'months_of_inventory', label: 'months of inventory', shortLabel: 'Months of Inventory', fmt: (n) => (n == null ? 'n/a' : `${n.toFixed(1)} mo`) },
];
const METRIC_BY_KEY = Object.fromEntries(REPORT_METRICS.map((m) => [m.key, m]));

function fmtPrice(n) {
  if (n == null) return 'n/a';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n) {
  if (n == null) return 'n/a';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

// Standard real-estate read of months-of-inventory -- under 3 months is
// generally a seller's market, 3-6 balanced, 6+ a buyer's market. Same
// thresholds as src/lib/market-map-summary.ts's per-neighbourhood version
// on the public /market-map/ page.
function moiTierLabel(moi) {
  if (moi < 3) return "seller's market";
  if (moi <= 6) return 'balanced market';
  return "buyer's market";
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escJs(s) {
  // For splicing into a JS/TS template literal in blog.ts -- backticks and
  // ${ are the two things that would actually break the generated file.
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// ---- HTML -> Word doc (backup copy, attached to the success email so --
// Justin has the full post text saved off-site even if the site itself is
// down) -----------------------------------------------------------------
// Not a general HTML parser: this only ever runs against bodyHtml this same
// file just generated a few lines up, so it only needs to understand the
// fixed handful of tags that template actually emits (h2/p/table/ul/li,
// plus inline <strong>/<a>).
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·')
    .replace(/&reg;/g, '®');
}
function linkifyForDocx(html) {
  // Turn <a href="/x">text</a> into "text (https://www.liveinoakridge.ca/x)"
  // -- a Word doc has no live links worth preserving as hrefs here, but the
  // URL itself is real information that shouldn't just vanish.
  return html.replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => {
    const full = href.startsWith('/') ? `${SITE_URL}${href}` : href;
    return `${text} (${full})`;
  });
}
function inlineRunsFromHtml(html) {
  const linked = linkifyForDocx(html);
  const parts = linked.split(/(<strong>[\s\S]*?<\/strong>)/g).filter(Boolean);
  const runs = [];
  for (const part of parts) {
    const strongMatch = part.match(/^<strong>([\s\S]*?)<\/strong>$/);
    const raw = strongMatch ? strongMatch[1] : part;
    const text = decodeEntities(raw.replace(/<[^>]+>/g, ''));
    if (text) runs.push(new TextRun({ text, bold: !!strongMatch }));
  }
  return runs.length ? runs : [new TextRun('')];
}
function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}
function htmlBlocksToDocx(bodyHtml) {
  const nodes = [];
  const blockRe = /<(h2|p|table|ul)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = blockRe.exec(bodyHtml))) {
    const [, tag, attrs, inner] = m;
    if (tag === 'h2') {
      const text = stripTags(inner);
      if (text) nodes.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
    } else if (tag === 'p') {
      const runs = inlineRunsFromHtml(inner.trim());
      const isFootnote = /font-size:\s*12px/.test(attrs || '');
      nodes.push(new Paragraph({
        children: isFootnote ? runs.map((r) => new TextRun({ text: r.text, italics: true, size: 16, color: '888888' })) : runs,
        spacing: { after: 160 },
      }));
    } else if (tag === 'ul') {
      const liRe = /<li>([\s\S]*?)<\/li>/g;
      let lm;
      while ((lm = liRe.exec(inner))) {
        nodes.push(new Paragraph({ children: inlineRunsFromHtml(lm[1].trim()), bullet: { level: 0 }, spacing: { after: 80 } }));
      }
    } else if (tag === 'table') {
      const headMatch = inner.match(/<thead>([\s\S]*?)<\/thead>/);
      const bodyMatch = inner.match(/<tbody>([\s\S]*?)<\/tbody>/);
      const rows = [];
      if (headMatch) {
        const ths = [...headMatch[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map((x) => stripTags(x[1]));
        if (ths.length) {
          rows.push(new TableRow({
            children: ths.map((t) => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
              shading: { fill: 'EEEEEE' },
            })),
          }));
        }
      }
      if (bodyMatch) {
        const trRe = /<tr>([\s\S]*?)<\/tr>/g;
        let tm;
        while ((tm = trRe.exec(bodyMatch[1]))) {
          const tds = [...tm[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => stripTags(x[1]));
          if (tds.length) rows.push(new TableRow({ children: tds.map((t) => new TableCell({ children: [new Paragraph(t)] })) }));
        }
      }
      if (rows.length) {
        nodes.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        nodes.push(new Paragraph({ text: '', spacing: { after: 160 } }));
      }
    }
  }
  return nodes;
}
export async function renderPostDocx({ title, dateDisplay, description, bodyHtml, faqs, postUrl }) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: `${dateDisplay} · Justin Skrypnyk · Market Updates`, italics: true, color: '666666' })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: description, bold: true })], spacing: { after: 240 } }),
    ...htmlBlocksToDocx(bodyHtml),
  ];
  if (faqs?.length) {
    children.push(new Paragraph({ text: 'FAQs', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
    for (const f of faqs) {
      children.push(new Paragraph({ children: [new TextRun({ text: f.question, bold: true })], spacing: { after: 40 } }));
      children.push(new Paragraph({ text: f.answer, spacing: { after: 160 } }));
    }
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: `Live at: ${postUrl}`, italics: true, size: 18, color: '888888' })],
    spacing: { before: 240 },
  }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// ---- Deterministic phrase banks -------------------------------------
// Every sentence below is picked, never generated. `pick(seed, bank)`
// selects a variant using a seed derived from real data (the area name +
// metric key), not randomness -- so a re-run of the same month always
// reads identically, and different areas in the same post don't all read
// with the exact same sentence.
function seedIndex(seed, len) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % len;
}
function pick(seed, bank) {
  return bank[seedIndex(seed, bank.length)];
}

const UP_VERBS = ['climbed', 'rose', 'moved up', 'gained ground'];
const DOWN_VERBS = ['eased', 'pulled back', 'softened', 'came down'];
const FLAT_PHRASES = ['held essentially steady', 'stayed close to flat', 'barely moved'];

// ---- Buy/sell guidance: fixed sentences keyed on a citywide number this
// script computed itself (average sale-to-list ratio across the 7 served
// areas) -- same "template picks a variant, never writes one" rule as the
// phrase banks above, just applied to a section instead of a single word.
// This is what closes the gap with Justin's manually-written posts (which
// always included buy/sell guidance and a why-behind-the-numbers read) --
// see [[project-monthly-blog-post-automation]] for the fuller context on
// why this stays selection-only rather than an LLM writing real analysis.
function average(numbers) {
  const valid = numbers.filter((n) => n != null && Number.isFinite(n));
  return valid.length ? valid.reduce((sum, n) => sum + n, 0) / valid.length : null;
}
function sellerMarketTier(ratio) {
  if (ratio == null) return null;
  if (ratio >= 1.0) return 'hot';
  if (ratio >= 0.97) return 'balanced';
  return 'soft';
}
const SELL_GUIDANCE = {
  hot: 'Yes, decisively. Homes are averaging at or above asking price citywide, and accurately priced listings are drawing competitive offers rather than sitting.',
  balanced: 'For accurately priced homes, yes. The average sale-to-list ratio is holding close to full asking price -- well-priced homes are still finding motivated buyers; overpriced ones are the ones sitting.',
  soft: "Only if you price to today's market, not last season's. The average sale-to-list ratio has softened, giving buyers more room to negotiate on anything priced ahead of the market.",
};
const BUY_GUIDANCE = {
  hot: "Be ready to move decisively. With homes averaging at or above asking citywide, competitive offers are common on well-priced listings -- know your budget before you view, not after.",
  balanced: 'Yes, with realistic expectations. Well-priced homes are still moving at close to full asking, so steep discounts are rare -- but overpriced listings are lingering long enough to negotiate on.',
  soft: 'Yes -- this is a buyer-friendlier month than most. A softer citywide sale-to-list ratio means more room to negotiate, especially on listings that have been sitting.',
};

function directionPhrase(seed, pctChange) {
  if (pctChange == null) return null;
  if (Math.abs(pctChange) < 0.02) return pick(seed, FLAT_PHRASES);
  const bank = pctChange > 0 ? UP_VERBS : DOWN_VERBS;
  return pick(seed, bank);
}

function magnitudeWord(pctChange) {
  const abs = Math.abs(pctChange ?? 0);
  if (abs >= 0.15) return pctChange > 0 ? 'jumped' : 'dropped sharply';
  if (abs >= 0.08) return pctChange > 0 ? 'climbed' : 'fell';
  if (abs >= 0.02) return pctChange > 0 ? 'ticked up' : 'ticked down';
  return 'held steady';
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Card copy: mirrors the "topic + bold stat / HERE'S THE STORY. /
// green+red pill pair" structure of Justin's manually-designed monthly
// covers (see renderStatCardWebp) -- built from the same headline pick
// the post body already narrates, so the card never says something
// different from the post underneath it.
function buildCardCopy({ headline, totalSold, monthLabel, citywide }) {
  const monthWord = monthLabel.split(' ')[0];
  const upDown = (pct) => `${pct >= 0 ? 'UP' : 'DOWN'} ${Math.abs(pct * 100).toFixed(1)}%`;
  // Pills: the template's "SALES UP x% / PRICES DOWN y%" pair, citywide,
  // against last month under the same rules (getCitywideStats).
  const pillGreenText = citywide?.momUnitsSold != null ? `SALES ${upDown(citywide.momUnitsSold)}` : `${totalSold} HOMES SOLD`;
  const pillRedText = citywide?.momMedianSoldPrice != null
    ? `PRICES ${upDown(citywide.momMedianSoldPrice)}`
    : `MEDIAN ${citywide?.medianSoldPrice ? `$${Math.round(citywide.medianSoldPrice / 1000)}K` : 'N/A'}`;
  const captionLine = `The Full ${monthWord} Market Breakdown`;
  if (!headline) {
    return { line1: `${totalSold} HOMES`, line2: `SOLD IN ${monthWord.toUpperCase()}`, pillGreenText, pillRedText, captionLine };
  }
  const pct = headline.change.mom_pct_change;
  const word = { units_sold_month: 'SALES', median_sold_price_month: 'PRICES', avg_sale_to_list_ratio_month: 'SALE-TO-LIST', new_listings_count: 'NEW LISTINGS', avg_days_on_market: 'DAYS LISTED', months_of_inventory: 'INVENTORY' }[headline.metric.key]
    || headline.metric.shortLabel.toUpperCase();
  return {
    line1: `${headline.area.area_name.toUpperCase()} ${word}`,
    line2: `${pct >= 0 ? 'UP' : 'DOWN'} ${Math.round(Math.abs(pct * 100))}%`,
    pillGreenText,
    pillRedText,
    captionLine,
  };
}

// ---- GitHub Contents API ---------------------------------------------
async function githubGet(path, branch) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${branch}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const json = await res.json();
  return { content: Buffer.from(json.content, 'base64').toString('utf-8'), sha: json.sha };
}

async function githubPut(path, contentUtf8, sha, message, branch) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.isBuffer(contentUtf8) ? contentUtf8.toString('base64') : Buffer.from(contentUtf8, 'utf-8').toString('base64'),
      sha, // omit (undefined -> not sent) when creating a brand-new file
      branch,
    }),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// ---- Bundled fonts for the card image ---------------------------------
// Netlify's function runtime has no fonts installed at all -- confirmed
// empirically after the Sept 1 2026 auto-post's card rendered every
// <text> glyph as an empty tofu box (sharp's SVG->raster step goes
// through librsvg/Pango/fontconfig, which has nothing to substitute when
// no font matching "Georgia"/"Arial" -- or ANY font -- exists on disk).
// Fix: bundle real font files and point fontconfig at them directly via
// FONTCONFIG_PATH, written to /tmp (the one writable dir in the function
// sandbox) once per cold start. PT Sans/PT Serif, not Arial/Georgia --
// Apple's copies of the latter aren't ours to redistribute in a public
// repo; these are pulled from Google Fonts under the OFL (see
// assets/fonts/OFL-LICENSE.txt), same pairing used by
// monthly-digest-background.mjs's chart image for the same reason.
let cardFontsReady = false;
function ensureCardFonts() {
  if (cardFontsReady) return;
  const fontDir = path.join(os.tmpdir(), 'card-fonts');
  const cacheDir = path.join(os.tmpdir(), 'card-fontconfig-cache');
  mkdirSync(fontDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  // Literal `new URL('./exact/path', import.meta.url)` per file (not a
  // loop over a template string) -- Netlify's bundler only discovers
  // local file dependencies it can resolve statically.
  const bundled = [
    ['PTSans-Regular.ttf', fileURLToPath(new URL('./assets/fonts/PTSans-Regular.ttf', import.meta.url))],
    ['PTSans-Bold.ttf', fileURLToPath(new URL('./assets/fonts/PTSans-Bold.ttf', import.meta.url))],
    ['PTSerif-Regular.ttf', fileURLToPath(new URL('./assets/fonts/PTSerif-Regular.ttf', import.meta.url))],
    ['PTSerif-Bold.ttf', fileURLToPath(new URL('./assets/fonts/PTSerif-Bold.ttf', import.meta.url))],
    // Montserrat (OFL) -- the face Justin's own covers use. Static weights
    // cut from Google's variable font: sharp's bundled font engine ignores
    // variable-font weights and falls back to a generic sans.
    ['Montserrat-Regular.ttf', fileURLToPath(new URL('./assets/fonts/Montserrat-Regular.ttf', import.meta.url))],
    ['Montserrat-Bold.ttf', fileURLToPath(new URL('./assets/fonts/Montserrat-Bold.ttf', import.meta.url))],
    ['Montserrat-ExtraBold.ttf', fileURLToPath(new URL('./assets/fonts/Montserrat-ExtraBold.ttf', import.meta.url))],
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
  cardFontsReady = true;
}

// Rough width estimate for a pill badge -- sharp/librsvg gives no text-metrics
// API, so this is a per-character average for PT Sans Bold at the given
// size rather than an exact measurement. Good enough for a stat pill (not
// print), and errs slightly wide rather than clipping.
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.6;
}

// ---- Card image (branded stat card, matching Justin's manually-designed
// monthly covers -- see public/images/june-2026-london-ontario-market-
// update.png, the Aug 1 2026 post's template he asked this to match) ----
// Colors below are sampled directly from that PNG (same "don't guess,
// sample the real template" rule market-map's legend colors already
// follow), not eyeballed.
// Card text is drawn as vector shapes straight from the bundled Montserrat
// files (opentype.js), not left to the server's font system: librsvg on
// macOS ignores bundled fonts entirely, and a font miss on any machine would
// silently swap in a generic sans. This also gives exact text widths, so
// pills and the caption arrow are sized and placed precisely.
let cardFonts = null;
function loadCardFonts() {
  if (cardFonts) return cardFonts;
  const load = (url) => { const b = readFileSync(fileURLToPath(url)); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  cardFonts = {
    regular: load(new URL('./assets/fonts/Montserrat-Regular.ttf', import.meta.url)),
    bold: load(new URL('./assets/fonts/Montserrat-Bold.ttf', import.meta.url)),
    extraBold: load(new URL('./assets/fonts/Montserrat-ExtraBold.ttf', import.meta.url)),
  };
  return cardFonts;
}

function textWidth(font, text, size, spacing = 0) {
  return font.getAdvanceWidth(text, size, { letterSpacing: spacing / size, kerning: true });
}

// anchor: 'start' | 'middle' | 'end'; spacing in px.
function textShape(font, text, x, y, size, fill, { anchor = 'start', spacing = 0 } = {}) {
  const w = textWidth(font, text, size, spacing);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  // Path data built by hand: opentype.js 2.0's toPathData(decimals) writes
  // "NaN" for some coordinates (seen on the apostrophe and K), which makes
  // librsvg drop the rest of the line.
  const n = (v) => (Math.round(v * 100) / 100).toString();
  const d = font.getPath(text, left, y, size, { letterSpacing: spacing / size, kerning: true }).commands.map((c) => {
    if (c.type === 'M' || c.type === 'L') return `${c.type}${n(c.x)} ${n(c.y)}`;
    if (c.type === 'Q') return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
    if (c.type === 'C') return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    return 'Z';
  }).join('');
  return `<path d="${d}" fill="${fill}" />`;
}

export async function renderStatCardWebp({ monthLabel, locationLabel, line1, line2, pillGreenText, pillRedText, captionLine }) {
  const F = loadCardFonts();
  // Same proportions and layout as Justin's own covers (public/images/
  // may-2026-london-ontario-market-update.webp, 1584x720): photo left, gold
  // rule, a big two-line headline, "HERE'S THE STORY.", the pills right
  // under the gold line. Everything that matters sits in the middle band,
  // so the blog list's wide crop still shows the headline and pills.
  const W = 1584, H = 720;
  const PHOTO_W = 720;
  const RULE_X = 735;
  const TEXT_X = 768;
  const TEXT_MAX_W = W - TEXT_X - 60;

  const GOLD = '#ffc159';
  const GOLD_LINE = '#efad10';
  const BLUE = '#7cc4f2';
  const GREEN = '#128040';
  const RED = '#c31f1f';

  // Largest size (up to 104px) at which both headline lines fit.
  const headSize = Math.min(104, ...[line1, line2].map((t) => Math.floor((104 * (TEXT_MAX_W - 26)) / textWidth(F.extraBold, t, 104))));

  const pillFont = 27;
  const pillPadX = 30;
  const pillH = 58;
  const pillGap = 28;
  const pillY = 498;
  const greenW = textWidth(F.bold, pillGreenText, pillFont) + pillPadX * 2;
  const redW = textWidth(F.bold, pillRedText, pillFont) + pillPadX * 2;
  const pillTextY = pillY + pillH / 2 + pillFont * 0.36;

  const caption = captionLine.toUpperCase();
  const captionW = textWidth(F.regular, caption, 28, 0.5);

  const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0d0c34" />
          <stop offset="100%" stop-color="#201f81" />
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)" />
      <rect x="${RULE_X - 4}" y="0" width="8" height="${H}" fill="${GOLD_LINE}" />

      ${textShape(F.bold, `${locationLabel}  \u2022  ${monthLabel.toUpperCase()}`, TEXT_X + 26, 98, 28, BLUE, { spacing: 4 })}

      ${textShape(F.extraBold, line1, TEXT_X + 26, 335 - headSize * 1.08, headSize, '#ffffff')}
      ${textShape(F.extraBold, line2, TEXT_X + 26, 335, headSize, '#ffffff')}

      ${textShape(F.extraBold, 'HERE\u2019S THE STORY.', TEXT_X, 436, 60, GOLD)}
      <rect x="${TEXT_X}" y="462" width="${Math.min(TEXT_MAX_W, textWidth(F.extraBold, 'HERE\u2019S THE STORY.', 60))}" height="3" fill="${GOLD_LINE}" />

      <rect x="${TEXT_X}" y="${pillY}" width="${greenW}" height="${pillH}" rx="${pillH / 2}" fill="${GREEN}" />
      ${textShape(F.bold, pillGreenText, TEXT_X + greenW / 2, pillTextY, pillFont, '#ffffff', { anchor: 'middle' })}
      <rect x="${TEXT_X + greenW + pillGap}" y="${pillY}" width="${redW}" height="${pillH}" rx="${pillH / 2}" fill="${RED}" />
      ${textShape(F.bold, pillRedText, TEXT_X + greenW + pillGap + redW / 2, pillTextY, pillFont, '#ffffff', { anchor: 'middle' })}

      ${textShape(F.regular, caption, TEXT_X + 16, 640, 28, '#ffffff', { spacing: 0.5 })}
      <g transform="translate(${TEXT_X + 16 + captionW + 16}, 630)" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <line x1="0" y1="0" x2="38" y2="0" />
        <polyline points="28,-9 38,0 28,9" />
      </g>
    </svg>
  `;

  // Justin's own photo (the exact shot his manually-made covers use),
  // filling the left panel and fading into the background gradient
  // rather than a hard rectangular seam -- avoids needing a true
  // background-cutout (this photo's studio-gray backdrop is too close in
  // brightness to itself in places to key out reliably without visible
  // fringing). Failure here (missing file, decode error) shouldn't take
  // down the whole card -- falls back to the text-only layout with no
  // photo rather than throwing.
  const composites = [];
  try {
    const photoPath = fileURLToPath(new URL('../../public/images/justin-skrypnyk-realtor-billboard.webp', import.meta.url));
    const photo = await sharp(photoPath)
      .resize(PHOTO_W, H, { fit: 'cover', position: 'top' })
      .composite([{ input: Buffer.from(`<svg width="${PHOTO_W}" height="${H}"><rect width="${PHOTO_W}" height="${H}" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fff" stop-opacity="1"/><stop offset="60%" stop-color="#fff" stop-opacity="1"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>`), blend: 'dest-in' }])
      .png()
      .toBuffer();
    composites.push({ input: photo, left: 0, top: 0 });
  } catch (err) {
    console.error('monthly-blog-post: photo composite failed (card will render without it):', err.message);
  }

  return sharp(Buffer.from(svg)).composite(composites).webp({ quality: 88 }).toBuffer();
}

async function sendNotifyEmail(subject, html, attachments, toSmile = true) {
  if (!RESEND_API_KEY) return; // don't let a missing key take down the alert path itself
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Resend's sandbox sender (onboarding@resend.dev) 403s on ANY
        // recipient besides the account's own verified address -- confirmed
        // 2026-09-02 via monthly-digest-background's first real send since
        // the smile@ CC was added. Fixed for real 2026-09-02 by verifying
        // mail.liveinoakridge.ca in Resend. toSmile=false for the ops-only
        // failure alert below -- publish notifications go to both.
        from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
        to: toSmile ? [DIGEST_TO_EMAIL, 'smile@homeswithjustin.ca'] : [DIGEST_TO_EMAIL],
        subject,
        html,
        ...(attachments?.length ? { attachments } : {}),
      }),
    });
    // fetch() only rejects on a network-level failure -- a rejected/erroring
    // Resend call (bad key, unverified sender, etc.) resolves normally with
    // a non-2xx status, so this has to be checked explicitly or a failed
    // send disappears with no trace anywhere. Same check every other
    // function's sendNotifyEmail already has; this one was missing it.
    if (!res.ok) {
      console.error('monthly-blog-post: notify email itself failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('monthly-blog-post: notify email itself failed:', err.message);
  }
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function roundedAverage(numbers) {
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

function daysSince(timestamp) {
  const listed = new Date(timestamp).getTime();
  if (Number.isNaN(listed)) return null;
  return Math.max(0, Math.floor((Date.now() - listed) / (1000 * 60 * 60 * 24)));
}

function pctChange(previous, current) {
  if (previous == null || current == null || previous === 0) return null;
  return (current - previous) / previous;
}

// Citywide (all of London, no per-neighbourhood split, so no geocoding
// needed at all) median list price + days on market from a live DDF pull,
// plus median sold price for the reported month from vow_sold_listings.
// Added 2026-09-16 per Justin's ask -- the post's "How Did London
// Ontario's Housing Market Perform" section previously only narrated
// citywide SUMS (total sold, new listings), never a citywide median --
// same 3 headline numbers monthly-digest-background.mjs's own citywide
// section shows, computed the identical way (duplicated here rather than
// imported, per this directory's self-contained-function convention).
// Deliberately NOT sourced from market_map_snapshots -- see that file's
// getCitywideStats comment for why a synthetic citywide row doesn't belong
// in that shared, per-neighbourhood-only table.
//
// Also computes month-over-month % change and upserts this capture into
// citywide_snapshots (supabase/migrations/005) -- same table/row
// monthly-digest-background.mjs's own getCitywideStats writes for the same
// period_type='month-end'/capture_date (the 1st); harmless to write twice,
// the values are identical since both run the same query for the same
// reported month.
async function getCitywideStats(supabase, monthStart, monthEnd, periodType, captureDate, { persist = true } = {}) {
  // Sales and active listings both come from one VOW pull. Sales are counted
  // by firm date, like the MLS (see firmSales in src/lib/vow-listings.mjs),
  // and the City check keeps out other towns' "London Road" addresses.
  const listings = await fetchVowLondonListings({
    baseUrl: DDF_API_BASE_URL,
    token: VOW_ACCESS_TOKEN,
    select: ['OriginalEntryTimestamp', ...SALE_FIELDS],
  });
  const active = listings.filter((l) => l.StandardStatus === 'Active');
  const listPrices = active.map((l) => Number(l.ListPrice)).filter((n) => n > 0);
  const dom = active.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null);
  const soldPrices = firmSales(listings, monthStart, monthEnd).map((l) => Number(l.ClosePrice));
  // Last month's sales for the same day range, recomputed from the feed
  // under the same rules -- comparable even when last month's saved row isn't.
  const prevSoldPrices = firmSales(listings, ...previousMonthRange(monthStart, monthEnd)).map((l) => Number(l.ClosePrice));

  // Months of inventory: active listings / (sales in the last 90 days / 3),
  // the same basis as the per-neighbourhood column.
  const rolling90dSoldCount = firmSales(listings, torontoDate(90), torontoDate()).length;

  const current = {
    activeCount: active.length,
    medianListPrice: median(listPrices),
    avgDaysOnMarket: roundedAverage(dom),
    medianSoldPrice: soldPrices.length > 0 ? median(soldPrices) : null,
    unitsSold: soldPrices.length,
    monthsOfInventory: rolling90dSoldCount ? Math.round((active.length / (rolling90dSoldCount / 3)) * 10) / 10 : null,
  };

  const { data: prevRows, error: prevError } = await supabase
    .from('citywide_snapshots')
    .select('median_list_price, avg_days_on_market, median_sold_price, months_of_inventory')
    .eq('period_type', periodType)
    .lt('capture_date', captureDate)
    .gte('capture_date', CITYWIDE_METHOD_SINCE)
    .order('capture_date', { ascending: false })
    .limit(1);
  if (prevError) console.error('monthly-blog-post: citywide_snapshots history query failed:', prevError.message);
  const prev = prevRows?.[0] || null;

  const { error: upsertError } = !persist ? {} : await supabase
    .from('citywide_snapshots')
    .upsert({
      period_type: periodType,
      capture_date: captureDate,
      median_list_price: current.medianListPrice,
      avg_days_on_market: current.avgDaysOnMarket,
      median_sold_price: current.medianSoldPrice,
      units_sold: current.unitsSold,
      active_count: current.activeCount,
      months_of_inventory: current.monthsOfInventory,
    }, { onConflict: 'period_type,capture_date' });
  if (upsertError) console.error('monthly-blog-post: citywide_snapshots upsert failed:', upsertError.message);

  return {
    ...current,
    momMedianSoldPrice: prevSoldPrices.length > 0 ? pctChange(median(prevSoldPrices), current.medianSoldPrice) : null,
    momUnitsSold: prevSoldPrices.length > 0 ? pctChange(prevSoldPrices.length, current.unitsSold) : null,
    momMedianListPrice: prev ? pctChange(prev.median_list_price, current.medianListPrice) : null,
    momAvgDaysOnMarket: prev ? pctChange(prev.avg_days_on_market, current.avgDaysOnMarket) : null,
    momMonthsOfInventory: prev ? pctChange(prev.months_of_inventory, current.monthsOfInventory) : null,
  };
}

export default async (req) => {
  if (await wrongLondonHour(req, 7)) return new Response('Not 7 a.m. in London yet, skipping this run');
  // Real scheduled invocations (Netlify's own cron trigger) carry no usable
  // JSON body -- branch defaults to 'main'. A manual test POST can override
  // it, e.g. {"branch": "test/auto-blog-dry-run"}, so a first real run can
  // be pointed at a throwaway branch instead of production before this is
  // ever trusted unattended. isTest just labels the slug/email so a test
  // run can never be mistaken for the real monthly post even if the branch
  // gets merged by accident.
  let branch = 'main';
  // POST {"preview": {captureDate, snapshotRows, changeRows}}: build the post
  // from those rows (e.g. a heat-map-snapshot dry run) and return it -- no
  // database reads or writes, no GitHub commit, no email. For checking a
  // month's post before its numbers are live.
  let preview = null;
  let publish = false;
  try {
    const body = await req?.json?.();
    if (body?.branch && typeof body.branch === 'string') branch = body.branch;
    if (body?.preview?.snapshotRows) preview = body.preview;
    publish = body?.publish === true;
  } catch {
    // no body / not JSON -- fine, stay on 'main'
  }
  const isTest = branch !== 'main';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !GITHUB_TOKEN || !VOW_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    const msg = 'monthly-blog-post: missing required env vars';
    console.error(msg, {
      SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      RESEND_API_KEY: !!RESEND_API_KEY, GITHUB_TOKEN: !!GITHUB_TOKEN,
      VOW_ACCESS_TOKEN: !!VOW_ACCESS_TOKEN, DDF_API_BASE_URL: !!DDF_API_BASE_URL,
    });
    await sendNotifyEmail('⚠️ Monthly blog post FAILED to publish', `<p>${esc(msg)}</p><p>Check Netlify env vars, especially GITHUB_TOKEN.</p>`, undefined, false);
    return new Response(msg, { status: 500 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: latestMonthEnd } = preview
      ? { data: { capture_date: preview.captureDate } }
      : await supabase
        .from('market_map_snapshots')
        .select('capture_date')
        .eq('period_type', 'month-end')
        .order('capture_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!latestMonthEnd) {
      // Same "gate not met yet, quiet no-op" convention as
      // market-stats-snapshot-background.mjs on a non-trigger day -- not
      // an error, nothing to alert about.
      console.log('monthly-blog-post: no month-end snapshot yet, skipping');
      return new Response('No month-end snapshot yet');
    }
    const captureDate = latestMonthEnd.capture_date; // 'YYYY-MM-DD' -- the RUN date, always the 1st
    const publishDateObj = new Date(`${captureDate}T00:00:00Z`);
    // heat-map-snapshot-background.mjs stamps a 'month-end' row's capture_date
    // as the day it ran (the 1st), but the DATA in that row is the PREVIOUS
    // month's completed close (see that file's own header comment) -- so the
    // month this post reports on is one calendar month before the publish
    // date, not the publish month. Matches the manual precedent this
    // pipeline replaced: the post published Aug 1 2026 was titled "July
    // 2026", not "August 2026". Got this backwards on the first real run
    // (2026-09-01 published as "September 2026" while narrating August's
    // data) -- confirmed via Justin catching the mismatch same day.
    const reportedMonthObj = new Date(Date.UTC(publishDateObj.getUTCFullYear(), publishDateObj.getUTCMonth() - 1, 1));
    const monthLabel = reportedMonthObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const monthShort = reportedMonthObj.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
    const year = reportedMonthObj.getUTCFullYear();
    const slug = `${monthShort}-${year}-london-ontario-market-update-auto${isTest ? '-test' : ''}`;
    // Calendar-month bounds for the citywide stats lookup below -- same
    // reportedMonthObj this file already uses for monthLabel.
    const reportedMonthStart = reportedMonthObj.toISOString().slice(0, 10);
    const reportedMonthEnd = new Date(Date.UTC(reportedMonthObj.getUTCFullYear(), reportedMonthObj.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);

    // ---- Idempotency guard: check blog.ts BEFORE doing any real work ----
    const { content: blogTsContent, sha: blogTsSha } = preview
      ? { content: readFileSync(fileURLToPath(new URL('../../src/data/blog.ts', import.meta.url)), 'utf-8'), sha: null }
      : await githubGet(BLOG_DATA_PATH, branch);
    if (!preview && blogTsContent.includes(`slug: '${slug}'`)) {
      console.log(`monthly-blog-post: ${slug} already published, skipping`);
      return new Response(`Already published: ${slug}`);
    }

    // ---- Pull the same data monthly-digest-background.mjs already computed ----
    const [{ data: snapshotRows, error: snapError }, { data: changeRows, error: changeError }] = preview
      ? [{ data: preview.snapshotRows }, { data: (preview.changeRows || []).filter((c) => REPORT_METRICS.some((m) => m.key === c.metric)) }]
      : await Promise.all([
      supabase
        .from('market_map_snapshots')
        .select(['area_slug', 'area_name', 'capture_date', ...REPORT_METRICS.map((m) => m.key)].join(','))
        .eq('period_type', 'month-end')
        .eq('capture_date', captureDate),
      supabase
        .from('market_map_changes')
        .select('area_slug, area_name, metric, current_value, mom_previous_value, mom_pct_change, yoy_pct_change, is_notable')
        .eq('period_type', 'month-end')
        .eq('capture_date', captureDate)
        .in('metric', REPORT_METRICS.map((m) => m.key)),
    ]);
    if (snapError || changeError || !snapshotRows) {
      throw new Error(`Supabase query failed: ${snapError?.message || changeError?.message}`);
    }

    const changesByAreaMetric = new Map();
    for (const c of changeRows || []) {
      if (!changesByAreaMetric.has(c.area_slug)) changesByAreaMetric.set(c.area_slug, {});
      changesByAreaMetric.get(c.area_slug)[c.metric] = c;
    }
    const rows = sortAreasServedFirst(snapshotRows).map((s) => ({ ...s, changes: changesByAreaMetric.get(s.area_slug) || {} }));
    const servedRows = rows.filter((r) => SERVED_AREA_ORDER.includes(r.area_slug));

    const totalSold = snapshotRows.reduce((sum, r) => sum + (r.units_sold_month || 0), 0);
    const totalNewListings = snapshotRows.reduce((sum, r) => sum + (r.new_listings_count || 0), 0);
    const citywide = await getCitywideStats(supabase, reportedMonthStart, reportedMonthEnd, 'month-end', captureDate, { persist: !preview });

    // ---- Headline metric: deterministic rule, not a judgment call ----
    // Largest |MoM%| among the 7 served areas, across the narrated metrics,
    // skipping small samples: a count needs at least 10 last month (5 -> 12
    // sales is "+140%" but says little), and a price or ratio needs 5+ sales
    // in both months.
    const COUNT_METRICS = ['units_sold_month', 'new_listings_count'];
    const SALE_BASED = ['median_sold_price_month', 'avg_sale_to_list_ratio_month'];
    const bigEnough = (r, m, c) => {
      if (COUNT_METRICS.includes(m.key)) return Number(c.mom_previous_value) >= 10;
      if (SALE_BASED.includes(m.key)) {
        const sales = r.changes.units_sold_month;
        return Number(r.units_sold_month) >= 5 && Number(sales?.mom_previous_value) >= 5;
      }
      return true;
    };
    let headline = null;
    for (const r of servedRows) {
      for (const m of REPORT_METRICS) {
        const c = r.changes[m.key];
        if (c?.mom_pct_change == null || !bigEnough(r, m, c)) continue;
        if (!headline || Math.abs(c.mom_pct_change) > Math.abs(headline.change.mom_pct_change)) {
          headline = { area: r, metric: m, change: c };
        }
      }
    }

    // ---- Card copy: mirrors Justin's manually-designed monthly covers
    // (topic + bold stat, "HERE'S THE STORY.", a green/red pill pair) --
    // built from the same headline computed above, not a separate pick.
    const cardCopy = buildCardCopy({ headline, totalSold, monthLabel, citywide });

    // ---- Prose: template + phrase bank, zero generation ----
    const introSentence = headline
      ? `${totalSold} homes sold across London Ontario in ${monthLabel}, with ${esc(headline.area.area_name)}'s ${headline.metric.label} the biggest mover of the month -- ${magnitudeWord(headline.change.mom_pct_change)} ${fmtPct(headline.change.mom_pct_change)} from the month before.`
      : `${totalSold} homes sold across London Ontario in ${monthLabel}. Here's the full neighbourhood-by-neighbourhood breakdown.`;

    const servedTableRows = servedRows.map((r) => {
      const soldChange = r.changes.units_sold_month;
      const priceChange = r.changes.median_sold_price_month;
      return `<tr>
        <td><a href="/areas/${esc(r.area_slug)}/">${esc(r.area_name)}</a></td>
        <td>${r.units_sold_month ?? 'n/a'}</td>
        <td>${fmtPrice(r.median_sold_price_month)}</td>
        <td>${fmtPct(priceChange?.mom_pct_change)}</td>
        <td>${r.months_of_inventory != null ? `${r.months_of_inventory.toFixed(1)} mo` : 'n/a'}</td>
      </tr>`;
    }).join('');

    const areaNarratives = servedRows.map((r) => {
      const priceChange = r.changes.median_sold_price_month;
      const dirWord = directionPhrase(r.area_slug + 'median_sold_price', priceChange?.mom_pct_change);
      if (!dirWord || r.median_sold_price_month == null) {
        return `<li><strong>${esc(r.area_name)}</strong>: ${r.units_sold_month ?? 'n/a'} homes sold, median price ${fmtPrice(r.median_sold_price_month)}.</li>`;
      }
      return `<li><strong>${esc(r.area_name)}</strong>: ${r.units_sold_month ?? 'n/a'} homes sold, median price ${dirWord} to ${fmtPrice(r.median_sold_price_month)} (${fmtPct(priceChange.mom_pct_change)} month-over-month).</li>`;
    }).join('');

    const notable = (changeRows || [])
      .filter((c) => c.is_notable && SERVED_AREA_ORDER.includes(c.area_slug))
      .sort((a, b) => Math.abs(b.mom_pct_change) - Math.abs(a.mom_pct_change))
      .slice(0, 5);
    const notableHtml = notable.length > 0
      ? `<ul>${notable.map((c) => {
          const m = METRIC_BY_KEY[c.metric];
          const dir = c.mom_pct_change > 0 ? '▲' : '▼';
          return `<li>${dir} <strong>${esc(c.area_name)}</strong> -- ${esc(m?.shortLabel || c.metric)}: ${fmtPct(c.mom_pct_change)} month-over-month (now ${m ? m.fmt(c.current_value) : c.current_value}).</li>`;
        }).join('')}</ul>`
      : '<p>No single-metric move of 10%+ this month among our 7 served areas -- a comparatively steady month.</p>';

    // ---- Oakridge spotlight: always featured, same standing section the
    // manual posts this pipeline replaced always included (Oakridge is
    // Justin's flagship area, not a data-driven pick like `headline` above).
    const oakridgeRow = servedRows.find((r) => r.area_slug === 'oakridge') || null;
    const oakridgePriceChange = oakridgeRow?.changes.median_sold_price_month;
    const oakridgeHtml = oakridgeRow ? `
      <h2>How Did Oakridge Perform in ${esc(monthLabel)}?</h2>
      <p>${oakridgeRow.units_sold_month ?? 'n/a'} homes sold in Oakridge in ${esc(monthLabel)} at a median price of ${fmtPrice(oakridgeRow.median_sold_price_month)}${oakridgePriceChange?.mom_pct_change != null ? ` (${fmtPct(oakridgePriceChange.mom_pct_change)} month-over-month)` : ''}.${oakridgeRow.avg_sale_to_list_ratio_month != null ? ` The average sale-to-list ratio came in at ${(oakridgeRow.avg_sale_to_list_ratio_month * 100).toFixed(1)}%.` : ''}${oakridgeRow.months_of_inventory != null ? ` At the current sales pace, Oakridge is carrying about ${oakridgeRow.months_of_inventory.toFixed(1)} months of inventory -- a ${moiTierLabel(oakridgeRow.months_of_inventory)}.` : ''} For a closer look at the neighbourhood itself, see our <a href="/areas/oakridge/">Oakridge neighbourhood guide</a>.</p>
    ` : '';

    // ---- One area outside our usual seven, if its data earns a mention --
    // same mechanical rule the "Notable Moves" list above already uses
    // (largest |MoM%| among is_notable rows), just run against the other
    // 32 mapped neighbourhoods instead of the 7 served ones. Mirrors the
    // manual posts' standing "one neighbourhood worth flagging" callout
    // (e.g. Medway in the July 2026 post) -- the sentence is fixed, only
    // which area/numbers fill it in is picked mechanically.
    // Gate on a minimum sales volume (matches the real "sixteen closings"
    // scale of the July post's own Medway callout) -- without it, the
    // largest |MoM%| among the other 32 areas is reliably some 0-2-sale
    // area where a metric swung 200%+ on a sample too small to mean
    // anything (confirmed empirically against real August 2026 data:
    // the unfiltered top hit was an area with 0 sold homes that month).
    const nonServedNotable = (changeRows || [])
      .filter((c) => c.is_notable && !SERVED_AREA_ORDER.includes(c.area_slug))
      .filter((c) => (rows.find((r) => r.area_slug === c.area_slug)?.units_sold_month ?? 0) >= 10)
      .sort((a, b) => Math.abs(b.mom_pct_change) - Math.abs(a.mom_pct_change))[0] || null;
    const nonServedRow = nonServedNotable ? rows.find((r) => r.area_slug === nonServedNotable.area_slug) : null;
    const nonServedHtml = (nonServedNotable && nonServedRow) ? `
      <p>One neighbourhood worth flagging outside our usual seven: <strong>${esc(nonServedRow.area_name)}</strong> had a genuinely notable ${esc(monthLabel)} -- ${esc(METRIC_BY_KEY[nonServedNotable.metric]?.shortLabel || nonServedNotable.metric)} ${nonServedNotable.mom_pct_change > 0 ? 'up' : 'down'} ${fmtPct(nonServedNotable.mom_pct_change)} month-over-month, with ${nonServedRow.units_sold_month ?? 'n/a'} homes sold at a median price of ${fmtPrice(nonServedRow.median_sold_price_month)}. It's not an area we get asked about as often as Oakridge or Byron, but the activity there this month says it deserves a closer look.</p>
    ` : '';

    // ---- Buy/sell guidance: keyed on the citywide average sale-to-list
    // ratio across the 7 served areas -- see SELL_GUIDANCE/BUY_GUIDANCE
    // above for why this is still selection, not generation.
    const citywideSaleToList = average(servedRows.map((r) => r.avg_sale_to_list_ratio_month));
    const marketTier = sellerMarketTier(citywideSaleToList);
    const sellBuyHtml = citywideSaleToList != null ? `
      <h2>Is Now a Good Time to Sell in London Ontario?</h2>
      <p>${SELL_GUIDANCE[marketTier]} Across our 7 west-end neighbourhoods, the average sale-to-list ratio sat at ${(citywideSaleToList * 100).toFixed(1)}% in ${esc(monthLabel)}. Not sure where your own home stands? A <a href="/services/home-evaluation/">complimentary home evaluation</a> gets you a real, current number.</p>

      <h2>Is Now a Good Time to Buy in London Ontario?</h2>
      <p>${BUY_GUIDANCE[marketTier]} Buyers weighing where their budget goes furthest can explore <a href="/areas/">all the areas we serve</a> or dig into the numbers themselves on the <a href="/market-map/">interactive Neighbourhood Heat Map</a>.</p>
    ` : '';

    // Fallback CTA for the rare month citywideSaleToList is unavailable and
    // sellBuyHtml renders empty -- otherwise the post would end with no
    // call-to-action at all. When sellBuyHtml IS present it already covers
    // both the seller and buyer CTA, so this only ever renders once.
    const closingHtml = `
      <p>Not sure where your own home stands this month? A <a href="/services/home-evaluation/">complimentary home evaluation</a> gets you a real, current number. Buyers can explore <a href="/areas/">all the areas we serve</a> or dig into the numbers themselves on the <a href="/market-map/">interactive Neighbourhood Heat Map</a>.</p>
    `;

    const bodyHtml = `
      <p>${introSentence}</p>

      <h2>How Did London Ontario's Housing Market Perform in ${esc(monthLabel)}?</h2>
      <p>${totalSold} homes sold citywide, with ${totalNewListings} new listings coming onto the market across all 39 mapped neighbourhoods. Citywide, the median sale price was ${fmtPrice(citywide.medianSoldPrice)}${citywide.momMedianSoldPrice != null ? ` (${fmtPct(citywide.momMedianSoldPrice)} month-over-month)` : ''}, the median list price sat at ${fmtPrice(citywide.medianListPrice)}${citywide.momMedianListPrice != null ? ` (${fmtPct(citywide.momMedianListPrice)} month-over-month)` : ''}, and homes still for sale had been listed an average of ${citywide.avgDaysOnMarket ?? 'n/a'} days${citywide.momAvgDaysOnMarket != null ? ` (${fmtPct(citywide.momAvgDaysOnMarket)} month-over-month)` : ''}.${citywide.monthsOfInventory != null ? ` At the current sales pace, London is carrying about ${citywide.monthsOfInventory.toFixed(1)} months of inventory${citywide.momMonthsOfInventory != null ? ` (${fmtPct(citywide.momMonthsOfInventory)} month-over-month)` : ''} -- a ${moiTierLabel(citywide.monthsOfInventory)}.` : ''}</p>

      ${oakridgeHtml}

      <h2>How Are West London's Neighbourhoods Comparing This Month?</h2>
      <table>
        <thead><tr><th>Neighbourhood</th><th>Homes Sold</th><th>Median Price</th><th>Month-over-Month</th><th>Months of Inventory</th></tr></thead>
        <tbody>${servedTableRows}</tbody>
      </table>
      <ul>${areaNarratives}</ul>
      ${nonServedHtml}

      <h2>Notable Moves This Month</h2>
      ${notableHtml}

      ${sellBuyHtml || closingHtml}

      <p style="font-size:12px;color:#888;">Source: MLS® resale data, compiled ${esc(captureDate)}. This post is generated automatically from live market data -- every number above is a direct lookup or plain arithmetic against already-computed aggregates; no AI system interprets or writes commentary on the underlying sold-price data.</p>
    `;

    // ---- Chart: headline area's headline metric, trailing history ----
    let charts = [];
    if (headline) {
      const { data: history } = await supabase
        .from('market_map_snapshots')
        .select('capture_date, ' + headline.metric.key)
        .eq('period_type', 'month-end')
        .eq('area_slug', headline.area.area_slug)
        .order('capture_date', { ascending: true })
        .limit(6);
      if (history && history.length >= 2) {
        charts = [{
          title: `${headline.area.area_name} -- ${headline.metric.shortLabel}, last ${history.length} months`,
          color: '#e8b84b',
          // Same run-date-vs-reported-month offset as monthLabel above --
          // each row's own capture_date is the day the snapshot ran, one
          // month after the data it holds, so the label needs the same
          // one-month-back shift or a "6 months" chart reads one month
          // ahead of every point in it (caught alongside the main bug:
          // this rendered "Aug/Sep" for what was really July/August data).
          labels: history.map((h) => {
            const rowDate = new Date(`${h.capture_date}T00:00:00Z`);
            const reportedDate = new Date(Date.UTC(rowDate.getUTCFullYear(), rowDate.getUTCMonth() - 1, 1));
            return reportedDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
          }),
          values: history.map((h) => Math.round(Number(h[headline.metric.key]) || 0)),
        }];
      }
    }

    // ---- FAQs (templated) -- expanded to match the depth of the manual
    // posts this pipeline replaced (5 questions, not 2), same
    // selection-only rule: every answer slots real numbers into a fixed
    // sentence, nothing is generated per-question.
    const faqs = [
      {
        question: `How many homes sold in London Ontario in ${esc(monthLabel)}?`,
        answer: `${totalSold} homes sold in London Ontario in ${esc(monthLabel)}, with ${totalNewListings} new listings coming onto the market.`,
      },
      ...(headline ? [{
        question: `What was the biggest market move in ${esc(monthLabel)}?`,
        answer: `${esc(headline.area.area_name)}'s ${headline.metric.label} was the biggest single move among our 7 served areas -- ${magnitudeWord(headline.change.mom_pct_change)} ${fmtPct(headline.change.mom_pct_change)} month-over-month, now at ${headline.metric.fmt(headline.change.current_value)}.`,
      }] : []),
      ...(citywideSaleToList != null ? [{
        question: `Is London Ontario a buyer's or seller's market right now?`,
        answer: `${marketTier === 'hot' ? "Conditions favour sellers." : marketTier === 'soft' ? 'Conditions favour buyers.' : 'Conditions are close to balanced.'} Across our 7 west-end neighbourhoods, the average sale-to-list ratio was ${(citywideSaleToList * 100).toFixed(1)}% in ${esc(monthLabel)} -- ${marketTier === 'soft' ? 'accurately priced homes are still selling, but buyers have room to negotiate.' : 'accurately priced homes are finding motivated buyers close to (or above) asking.'}`,
      }] : []),
      ...(oakridgeRow ? [{
        question: `How is the Oakridge, London Ontario real estate market doing?`,
        answer: `${oakridgeRow.units_sold_month ?? 'n/a'} homes sold in Oakridge in ${esc(monthLabel)} at a median price of ${fmtPrice(oakridgeRow.median_sold_price_month)}${oakridgePriceChange?.mom_pct_change != null ? ` (${fmtPct(oakridgePriceChange.mom_pct_change)} month-over-month)` : ''}.`,
      }] : []),
      ...(citywideSaleToList != null ? [{
        question: `Is now a good time to sell a home in London Ontario?`,
        answer: SELL_GUIDANCE[marketTier],
      }] : []),
    ];

    // ---- Card/hero image ----
    const imagePath = `public/images/${slug}.webp`;
    const imageWebp = await renderStatCardWebp({
      monthLabel,
      locationLabel: 'LONDON, ON',
      ...cardCopy,
    });

    // ---- Assemble the BlogPost entry as a source string ----
    const title = `${monthLabel} London Ontario Real Estate Market Update`;
    const description = `${totalSold} homes sold across London Ontario in ${monthLabel}. See the full breakdown by neighbourhood and what it means for buyers and sellers.`;
    const dateDisplay = publishDateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    const postEntry = `  {
    slug: '${slug}',
    title: \`${escJs(title)}\`,
    description: \`${escJs(description)}\`,
    date: '${captureDate}',
    dateDisplay: '${dateDisplay}',
    category: 'Market Updates',
    author: 'Justin Skrypnyk',
    readTime: '6 min read',
    image: '/images/${slug}.webp',
    imageAlt: '${escJs(title)}',
    content: \`${bodyHtml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`,
    ${charts.length > 0 ? `charts: ${JSON.stringify(charts)},` : ''}
    faqs: ${JSON.stringify(faqs)},
  },
`;

    const marker = 'export const BLOG_POSTS: BlogPost[] = [';
    const insertAt = blogTsContent.indexOf(marker);
    if (insertAt === -1) throw new Error('Could not find BLOG_POSTS marker in blog.ts -- file format may have changed');
    const updatedBlogTs =
      blogTsContent.slice(0, insertAt + marker.length) + '\n' + postEntry +
      blogTsContent.slice(insertAt + marker.length);

    if (preview) {
      return new Response(JSON.stringify({ slug, postEntry, image: Buffer.from(imageWebp).toString('base64') }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---- Default (scheduled) run: email Justin the numbers and the hero
    // preview so the post can be written together. Nothing is published.
    if (!publish) {
      const row = (r) => `<tr><td style="padding:3px 10px;">${esc(r.area_name)}</td><td style="padding:3px 10px;">${r.units_sold_month ?? 0}</td><td style="padding:3px 10px;">${fmtPrice(r.median_sold_price_month)}</td><td style="padding:3px 10px;">${fmtPct(r.changes.median_sold_price_month?.mom_pct_change ?? null)}</td><td style="padding:3px 10px;">${r.active_count ?? 'n/a'}</td><td style="padding:3px 10px;">${r.new_listings_count ?? 'n/a'}</td><td style="padding:3px 10px;">${r.months_of_inventory != null ? `${r.months_of_inventory.toFixed(1)} mo` : 'n/a'}</td></tr>`;
      const html = `
        <p>Hi Justin,</p>
        <p>The ${esc(monthLabel)} numbers are in. Nothing has been published: let's write this month's market update together, the same way as September (your read on the month first, then keywords and an outline for you to approve).</p>
        <p><b>To start:</b> open Claude Code in the london-realtor project and say <i>"Let's write the ${esc(monthLabel)} market update."</i> Have ready: what you saw with buyers and sellers this month, and if you can, an MLS Quick CMA for Oakridge (sold by firm date in ${esc(monthLabel)}, plus active) so we can check the numbers home by home.</p>
        <h3 style="margin:18px 0 6px;">London, ${esc(monthLabel)}</h3>
        <p>${citywide.unitsSold} sales by firm date${citywide.momUnitsSold != null ? ` (${fmtPct(citywide.momUnitsSold)} vs last month)` : ''} &middot; median sale price ${fmtPrice(citywide.medianSoldPrice)}${citywide.momMedianSoldPrice != null ? ` (${fmtPct(citywide.momMedianSoldPrice)})` : ''} &middot; ${citywide.activeCount} homes for sale &middot; ${citywide.monthsOfInventory != null ? `${citywide.monthsOfInventory.toFixed(1)} months of inventory` : 'months of inventory n/a'}</p>
        <table style="border-collapse:collapse;font-size:13px;"><tr style="font-weight:bold;"><td style="padding:3px 10px;">Area</td><td style="padding:3px 10px;">Sales</td><td style="padding:3px 10px;">Median</td><td style="padding:3px 10px;">MoM</td><td style="padding:3px 10px;">For sale</td><td style="padding:3px 10px;">New</td><td style="padding:3px 10px;">Inventory</td></tr>${servedRows.map(row).join('')}</table>
        <p>The attached hero image is a starting point (headline: "${esc(cardCopy.line1)} ${esc(cardCopy.line2)}"). We'll set the headline to match the story we pick.</p>
`;
      await sendNotifyEmail(`${monthLabel} market update: numbers ready, let's write it`, html, [{ filename: `${slug}-hero-draft.webp`, content: Buffer.from(imageWebp).toString('base64') }], false);
      return new Response(`monthly-blog-post: draft numbers emailed for ${monthLabel}, nothing published`);
    }

    // ---- Publish: two commits, to whichever branch this run targeted.
    // Real scheduled runs always target main and trigger the normal deploy;
    // a test run lands on the throwaway branch and deploys nowhere.
    await githubPut(
      imagePath,
      imageWebp,
      undefined,
      `Auto-publish: add card image for ${monthLabel} market update`,
      branch
    );
    await githubPut(
      BLOG_DATA_PATH,
      updatedBlogTs,
      blogTsSha,
      `Auto-publish: ${title}\n\nGenerated by monthly-blog-post-background.mjs -- template + precomputed data only, no LLM involved in writing or interpreting this post.`,
      branch
    );

    const postUrl = `${SITE_URL}/blog/${slug}/`;

    // Word-doc backup of the full post text, attached below -- so Justin
    // has an off-site copy saved every month even if the live site goes
    // down. Failure here must never take down the publish-confirmation
    // email itself (the post already published successfully by this
    // point), so it's isolated in its own try/catch.
    let docxAttachments = [];
    try {
      const docxBuffer = await renderPostDocx({ title, dateDisplay, description, bodyHtml, faqs, postUrl });
      docxAttachments = [{ filename: `${slug}.docx`, content: docxBuffer.toString('base64') }];
    } catch (docxErr) {
      console.error('monthly-blog-post: docx backup generation failed (email will still send without it):', docxErr.message);
    }

    await sendNotifyEmail(
      `${isTest ? '[TEST] ' : '✅ '}Published: ${title}`,
      `<p>${isTest ? `Test run -- committed to branch <code>${esc(branch)}</code>, nothing deployed.` : 'Auto-published this month\'s market update. A Word-doc backup of the full text is attached.'}</p><p><a href="${postUrl}">${postUrl}</a></p>`,
      docxAttachments
    );

    const summary = `monthly-blog-post: published ${slug} (${totalSold} sold, ${servedRows.length} served areas)`;
    console.log(summary);
    return new Response(summary);
  } catch (err) {
    console.error('monthly-blog-post: FAILED:', err);
    await sendNotifyEmail(
      '⚠️ Monthly blog post FAILED to publish',
      `<p>${esc(err.message)}</p><pre style="white-space:pre-wrap;font-size:11px;">${esc(err.stack || '')}</pre>`
    );
    return new Response(`Failed: ${err.message}`, { status: 500 });
  }
};

export const config = {
  schedule: '15 11,12 1 * *', // 7:15 a.m. London on the 1st (see src/lib/london-time.mjs) -- after the 7:00 Full Month Review
};
