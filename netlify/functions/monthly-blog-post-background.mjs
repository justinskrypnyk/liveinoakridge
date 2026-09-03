// Scheduled job -- writes and publishes a monthly market-update blog post
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
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
  balanced: 'For accurately priced homes, yes. The citywide average sale-to-list ratio is holding close to full asking price -- well-priced homes are still finding motivated buyers; overpriced ones are the ones sitting.',
  soft: "Only if you price to today's market, not last season's. The citywide average sale-to-list ratio has softened, giving buyers more room to negotiate on anything priced ahead of the market.",
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
function buildCardCopy({ headline, totalSold, monthLabel }) {
  const monthWord = monthLabel.split(' ')[0];
  if (!headline) {
    return {
      topicLine: 'London Ontario Homes Sold',
      boldLine: `${totalSold} This Month`,
      pillGreenText: `${totalSold} SOLD CITYWIDE`,
      pillRedText: `${SERVED_AREA_ORDER.length} AREAS TRACKED`,
      captionLine: `The Full ${monthWord} Market Breakdown`,
    };
  }
  const pct = headline.change.mom_pct_change;
  const pillGreenText = `${headline.metric.shortLabel.toUpperCase()} ${pct >= 0 ? 'UP' : 'DOWN'} ${Math.abs(pct * 100).toFixed(1)}%`;

  // Contrast stat: a different metric for the same headline area, so the
  // two pills tell two different halves of the story (e.g. sales up,
  // price down) -- the exact "Sales Up 6.1% / Prices Down 7.2%" pairing
  // Justin's own template uses. Falls back to a citywide total on the
  // rare month the headline area has no second metric with MoM data yet.
  let pillRedText = `${totalSold} SOLD CITYWIDE`;
  for (const m of REPORT_METRICS) {
    if (m.key === headline.metric.key) continue;
    const c = headline.area.changes[m.key];
    if (c?.mom_pct_change == null) continue;
    pillRedText = `${m.shortLabel.toUpperCase()} ${c.mom_pct_change >= 0 ? 'UP' : 'DOWN'} ${Math.abs(c.mom_pct_change * 100).toFixed(1)}%`;
    break;
  }

  return {
    topicLine: `${headline.area.area_name} ${headline.metric.shortLabel}`,
    boldLine: `${capitalize(magnitudeWord(pct))} ${fmtPct(pct)}`,
    pillGreenText,
    pillRedText,
    captionLine: `The Full ${monthWord} Market Breakdown`,
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
export async function renderStatCardWebp({ monthLabel, locationLabel, topicLine, boldLine, pillGreenText, pillRedText, captionLine }) {
  ensureCardFonts();
  const W = 1200, H = 630; // standard blog og-image aspect, matches other post images
  const PHOTO_W = 460; // left photo panel width, fades out over its right ~180px into the background
  const TEXT_X = 545;

  const GOLD = '#ffc159';
  const GOLD_LINE = '#efad10';
  const GREEN = '#128040';
  const RED = '#c31f1f';

  const pillFontSize = 20;
  const pillPadX = 22;
  const pillH = 46;
  const pillGap = 18;
  const greenW = estimateTextWidth(pillGreenText, pillFontSize) + pillPadX * 2;
  const redW = estimateTextWidth(pillRedText, pillFontSize) + pillPadX * 2;
  const pillY = 400;

  const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0d0c34" />
          <stop offset="100%" stop-color="#201f81" />
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)" />

      <line x1="${PHOTO_W + 40}" y1="45" x2="${PHOTO_W + 40}" y2="${H - 45}" stroke="${GOLD_LINE}" stroke-width="3" />

      <text x="${TEXT_X}" y="70" font-family="PT Sans" font-size="20" font-weight="bold" fill="${GOLD}" letter-spacing="1.5">${esc(locationLabel)}  &#8226;  ${esc(monthLabel).toUpperCase()}</text>

      <text x="${TEXT_X}" y="150" font-family="PT Sans" font-size="38" fill="#ffffff">${esc(topicLine)}</text>
      <text x="${TEXT_X}" y="205" font-family="PT Sans" font-size="46" font-weight="bold" fill="#ffffff">${esc(boldLine)}</text>

      <text x="${TEXT_X}" y="270" font-family="PT Sans" font-size="30" font-weight="bold" fill="${GOLD}" letter-spacing="0.5">HERE&#8217;S THE STORY.</text>
      <line x1="${TEXT_X}" y1="290" x2="${W - 70}" y2="290" stroke="${GOLD_LINE}" stroke-width="2" />

      <rect x="${TEXT_X}" y="${pillY}" width="${greenW}" height="${pillH}" rx="${pillH / 2}" fill="${GREEN}" />
      <text x="${TEXT_X + greenW / 2}" y="${pillY + pillH / 2 + 7}" font-family="PT Sans" font-size="${pillFontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(pillGreenText)}</text>

      <rect x="${TEXT_X + greenW + pillGap}" y="${pillY}" width="${redW}" height="${pillH}" rx="${pillH / 2}" fill="${RED}" />
      <text x="${TEXT_X + greenW + pillGap + redW / 2}" y="${pillY + pillH / 2 + 7}" font-family="PT Sans" font-size="${pillFontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(pillRedText)}</text>

      <text x="${TEXT_X}" y="${H - 55}" font-family="PT Sans" font-size="19" fill="#ffffff" opacity="0.85" letter-spacing="0.5">${esc(captionLine).toUpperCase()}  &#8594;</text>
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

export default async (req) => {
  // Real scheduled invocations (Netlify's own cron trigger) carry no usable
  // JSON body -- branch defaults to 'main'. A manual test POST can override
  // it, e.g. {"branch": "test/auto-blog-dry-run"}, so a first real run can
  // be pointed at a throwaway branch instead of production before this is
  // ever trusted unattended. isTest just labels the slug/email so a test
  // run can never be mistaken for the real monthly post even if the branch
  // gets merged by accident.
  let branch = 'main';
  try {
    const body = await req?.json?.();
    if (body?.branch && typeof body.branch === 'string') branch = body.branch;
  } catch {
    // no body / not JSON -- fine, stay on 'main'
  }
  const isTest = branch !== 'main';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !GITHUB_TOKEN) {
    const msg = 'monthly-blog-post: missing required env vars';
    console.error(msg, {
      SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      RESEND_API_KEY: !!RESEND_API_KEY, GITHUB_TOKEN: !!GITHUB_TOKEN,
    });
    await sendNotifyEmail('⚠️ Monthly blog post FAILED to publish', `<p>${esc(msg)}</p><p>Check Netlify env vars, especially GITHUB_TOKEN.</p>`, undefined, false);
    return new Response(msg, { status: 500 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: latestMonthEnd } = await supabase
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

    // ---- Idempotency guard: check blog.ts BEFORE doing any real work ----
    const { content: blogTsContent, sha: blogTsSha } = await githubGet(BLOG_DATA_PATH, branch);
    if (blogTsContent.includes(`slug: '${slug}'`)) {
      console.log(`monthly-blog-post: ${slug} already published, skipping`);
      return new Response(`Already published: ${slug}`);
    }

    // ---- Pull the same data monthly-digest-background.mjs already computed ----
    const [{ data: snapshotRows, error: snapError }, { data: changeRows, error: changeError }] = await Promise.all([
      supabase
        .from('market_map_snapshots')
        .select(['area_slug', 'area_name', 'capture_date', ...REPORT_METRICS.map((m) => m.key)].join(','))
        .eq('period_type', 'month-end')
        .eq('capture_date', captureDate),
      supabase
        .from('market_map_changes')
        .select('area_slug, area_name, metric, current_value, mom_pct_change, yoy_pct_change, is_notable')
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

    // ---- Headline metric: deterministic rule, not a judgment call ----
    // Largest |MoM%| among the 7 served areas, across the narrated metrics.
    let headline = null;
    for (const r of servedRows) {
      for (const m of REPORT_METRICS) {
        const c = r.changes[m.key];
        if (c?.mom_pct_change == null) continue;
        if (!headline || Math.abs(c.mom_pct_change) > Math.abs(headline.change.mom_pct_change)) {
          headline = { area: r, metric: m, change: c };
        }
      }
    }

    // ---- Card copy: mirrors Justin's manually-designed monthly covers
    // (topic + bold stat, "HERE'S THE STORY.", a green/red pill pair) --
    // built from the same headline computed above, not a separate pick.
    const cardCopy = buildCardCopy({ headline, totalSold, monthLabel });

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
      <p>${oakridgeRow.units_sold_month ?? 'n/a'} homes sold in Oakridge in ${esc(monthLabel)} at a median price of ${fmtPrice(oakridgeRow.median_sold_price_month)}${oakridgePriceChange?.mom_pct_change != null ? ` (${fmtPct(oakridgePriceChange.mom_pct_change)} month-over-month)` : ''}.${oakridgeRow.avg_sale_to_list_ratio_month != null ? ` The average sale-to-list ratio came in at ${(oakridgeRow.avg_sale_to_list_ratio_month * 100).toFixed(1)}%.` : ''} For a closer look at the neighbourhood itself, see our <a href="/areas/oakridge/">Oakridge neighbourhood guide</a>.</p>
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
      <p>${SELL_GUIDANCE[marketTier]} The citywide average sale-to-list ratio sat at ${(citywideSaleToList * 100).toFixed(1)}% in ${esc(monthLabel)}. Not sure where your own home stands? A <a href="/services/home-evaluation/">complimentary home evaluation</a> gets you a real, current number.</p>

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
      <p>${totalSold} homes sold citywide, with ${totalNewListings} new listings coming onto the market across all 39 mapped neighbourhoods.</p>

      ${oakridgeHtml}

      <h2>How Are West London's Neighbourhoods Comparing This Month?</h2>
      <table>
        <thead><tr><th>Neighbourhood</th><th>Homes Sold</th><th>Median Price</th><th>Month-over-Month</th></tr></thead>
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
        answer: `${marketTier === 'hot' ? "Conditions favour sellers." : marketTier === 'soft' ? 'Conditions favour buyers.' : 'Conditions are close to balanced.'} The citywide average sale-to-list ratio was ${(citywideSaleToList * 100).toFixed(1)}% in ${esc(monthLabel)} -- ${marketTier === 'soft' ? 'accurately priced homes are still selling, but buyers have room to negotiate.' : 'accurately priced homes are finding motivated buyers close to (or above) asking.'}`,
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
  schedule: '0 14 1 * *', // 1st of month, 2pm UTC -- after heat-map-snapshot's 9am capture and monthly-digest's 1pm email
};
