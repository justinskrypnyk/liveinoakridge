// Reads the twice-monthly neighbourhood market-stats snapshot written by
// netlify/functions/market-stats-snapshot-background.mjs into the
// 'market-stats' Blobs store. One snapshot feeds two different surfaces:
//  - src/pages/api/market-stats.json.ts, fetched client-side by MarketTicker.astro
//  - the static "as of [date]..." sentence block on each area page (SSR,
//    read directly at request time — see src/pages/areas/[area]/index.astro)
import { getStore } from '@netlify/blobs';
import { AREAS } from '@/data/areas';
import { getLatestMarketMapSnapshots, getLatestMarketMapChanges } from '@/lib/supabase';

export type ChangeDirection = 'up' | 'down' | 'flat';

export interface StatChange {
  value: number;
  direction: ChangeDirection;
}

export interface AreaMarketStats {
  slug: string;
  name: string;
  medianListPrice: number | null;
  activeCount: number;
  avgDaysOnMarket: number | null;
  change: {
    medianListPrice: StatChange | null;
    activeCount: StatChange | null;
    avgDaysOnMarket: StatChange | null;
  };
}

export interface MarketStatsSnapshot {
  updatedAt: string; // ISO timestamp of the pull that produced this snapshot
  areas: Record<string, AreaMarketStats>;
}

export interface AreaSoldStats {
  medianSoldPrice: number | null;
  unitsSold: number | null;
  saleToListRatio: number | null; // e.g. 0.988 -> render as "98.8%"
  capturedAsOf: string; // capture_date, e.g. "2026-07-31"
  change: {
    medianSoldPrice: StatChange | null;
    unitsSold: StatChange | null;
  };
}

function changeFromPct(pct: number | null): StatChange | null {
  if (pct == null) return null;
  return { value: pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

// Reads the same twice-monthly market_map_snapshots / market_map_changes
// tables the heat map and monthly digest already populate (see
// heat-map-snapshot-background.mjs) -- no separate pipeline needed, just a
// narrower read scoped to the 7 served areas for the ticker's sold row.
// Areas with no capture yet (or a capture predating VOW access) come back
// with null sold fields, same "shows up once real data lands, no rebuild
// needed" pattern as every other snapshot-fed surface on this site.
export async function getSoldStatsByArea(): Promise<Record<string, AreaSoldStats>> {
  try {
    const [snapshots, changes] = await Promise.all([
      getLatestMarketMapSnapshots(),
      getLatestMarketMapChanges(['median_sold_price', 'units_sold']),
    ]);

    const changesByAreaMetric = new Map<string, Record<string, number | null>>();
    for (const c of changes) {
      if (!changesByAreaMetric.has(c.area_slug)) changesByAreaMetric.set(c.area_slug, {});
      changesByAreaMetric.get(c.area_slug)![c.metric] = c.mom_pct_change;
    }

    const servedSlugs = new Set(AREAS.map((a) => a.slug));
    const result: Record<string, AreaSoldStats> = {};
    for (const row of snapshots) {
      if (!servedSlugs.has(row.area_slug)) continue;
      const areaChanges = changesByAreaMetric.get(row.area_slug) || {};
      result[row.area_slug] = {
        medianSoldPrice: row.median_sold_price,
        unitsSold: row.units_sold,
        saleToListRatio: row.avg_sale_to_list_ratio,
        capturedAsOf: row.capture_date,
        change: {
          medianSoldPrice: changeFromPct(areaChanges.median_sold_price ?? null),
          unitsSold: changeFromPct(areaChanges.units_sold ?? null),
        },
      };
    }
    return result;
  } catch {
    return {};
  }
}

const BLOB_KEY = 'latest';

export async function getMarketStatsSnapshot(): Promise<MarketStatsSnapshot | null> {
  try {
    const store = getStore('market-stats');
    const snapshot = await store.get(BLOB_KEY, { type: 'json' });
    return (snapshot as MarketStatsSnapshot) ?? null;
  } catch {
    // Blobs unavailable (local dev without `netlify dev`, or the scheduled
    // function hasn't run yet on a brand-new site) — callers treat null as
    // "no stats to show yet" rather than erroring.
    return null;
  }
}

export function getAreaStats(snapshot: MarketStatsSnapshot | null, slug: string): AreaMarketStats | null {
  return snapshot?.areas[slug] ?? null;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface AreaFaqGroup {
  slug: string;
  name: string;
  items: FaqItem[];
}

function fmtPrice(n: number): string {
  return `$${n.toLocaleString('en-CA')}`;
}

function pace(days: number): string {
  if (days < 20) return 'a relatively fast pace';
  if (days <= 40) return 'a moderate pace';
  return 'a slower pace than average';
}

// "Buyer's or seller's market" from the DDF feed alone: only active
// (currently-for-sale) listings are available — no closed/sold prices,
// which needs VOW-level board access Justin doesn't have yet (see
// project memory). So this reads days-on-market and active supply as a
// directional signal, not the sold-vs-list-price comparison a "true"
// buyer's/seller's market call would use, and says so in the answer
// rather than implying more certainty than the data supports.
function marketLean(days: number): { label: string; explanation: string } {
  if (days < 20) {
    return {
      label: "leaning toward a seller's market",
      explanation: 'homes are being listed and are attracting buyers quickly, with less time for negotiation',
    };
  }
  if (days > 40) {
    return {
      label: "leaning toward a buyer's market",
      explanation: 'listings are staying active longer, giving buyers more room to negotiate',
    };
  }
  return {
    label: 'fairly balanced between buyers and sellers',
    explanation: 'homes are neither selling immediately nor sitting for an extended period',
  };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Turns the same snapshot MarketTicker.astro and AreaMarketStatsBlock.astro
// read into direct, natural-language answers to the questions
// buyers/sellers actually ask — one group per neighbourhood, grouped for
// on-page display and flattened into schema.org FAQPage markup by whichever
// page renders this (see src/pages/market-faq.astro).
export function buildMarketFaqs(snapshot: MarketStatsSnapshot | null): AreaFaqGroup[] {
  if (!snapshot) return [];
  const asOf = fmtDate(snapshot.updatedAt);

  // Canonical AREAS order (Oakridge first, matching the rest of the site)
  // rather than Record key order, which isn't guaranteed to match.
  // Every served area gets at least the active-listing-count question
  // (pushed unconditionally below) even at zero — "no homes for sale right
  // now" is still a real answer. Only excluded if the snapshot has no entry
  // for it at all (e.g. an area added after the last successful pull).
  return AREAS.map((a) => snapshot.areas[a.slug])
    .filter((area): area is AreaMarketStats => !!area)
    .map((area) => {
      const items: FaqItem[] = [];

      if ((area.medianListPrice ?? 0) > 0) {
        items.push({
          q: `What is the median home price in ${area.name}?`,
          a: `As of ${asOf}, the median list price for active MLS® listings in ${area.name} is ${fmtPrice(area.medianListPrice)}. This reflects current asking prices across every brokerage, not just Justin's, and is refreshed twice monthly.`,
        });
      }

      items.push({
        q: `How many homes are currently for sale in ${area.name}?`,
        a: area.activeCount > 0
          ? `As of ${asOf}, there ${area.activeCount === 1 ? 'is' : 'are'} ${area.activeCount} active MLS® listing${area.activeCount === 1 ? '' : 's'} in ${area.name}.`
          : `There are no active MLS® listings in ${area.name} as of ${asOf}. Contact Justin Skrypnyk at 519.639.5176 to be notified when new listings come up.`,
      });

      if (area.avgDaysOnMarket != null) {
        items.push({
          q: `How fast are homes selling in ${area.name} right now?`,
          a: `Active listings in ${area.name} have been on the market for an average of ${area.avgDaysOnMarket} day${area.avgDaysOnMarket === 1 ? '' : 's'} as of ${asOf} — ${pace(area.avgDaysOnMarket)} for the area. This measures how long current listings have been active, not how long it took past sales to close.`,
        });

        const lean = marketLean(area.avgDaysOnMarket);
        items.push({
          q: `Is ${area.name} a buyer's or seller's market right now?`,
          a: `Based on current listing activity in ${area.name} as of ${asOf} — ${area.activeCount} active listing${area.activeCount === 1 ? '' : 's'} averaging ${area.avgDaysOnMarket} day${area.avgDaysOnMarket === 1 ? '' : 's'} on the market — conditions are ${lean.label}: ${lean.explanation}. This is a read on current asking-price activity, not closed sale prices, since sold data requires MLS® board access (VOW) Justin doesn't have yet. For a proper read on your specific situation, contact Justin Skrypnyk at 519.639.5176.`,
        });
      }

      return { slug: area.slug, name: area.name, items };
    });
}
