// Reads the twice-monthly neighbourhood market-stats snapshot written by
// netlify/functions/market-stats-snapshot-background.mjs into the
// 'market-stats' Blobs store. One snapshot feeds two different surfaces:
//  - src/pages/api/market-stats.json.ts, fetched client-side by MarketTicker.astro
//  - the static "as of [date]..." sentence block on each area page (SSR,
//    read directly at request time — see src/pages/areas/[area]/index.astro)
import { getStore } from '@netlify/blobs';

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
