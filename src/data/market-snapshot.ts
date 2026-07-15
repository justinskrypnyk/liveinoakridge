export interface MarketSnapshot {
  monthLabel: string;
  blogSlug: string;
  areaName: string;
  avgPrice: string;
  medianDaysOnMarket: string;
  soldAboveList: string;
  salesVolume: string;
}

// Update this each month when a new market update blog post goes live.
// Source the numbers straight from that month's post so the two never disagree.
export const MARKET_SNAPSHOT: MarketSnapshot = {
  monthLabel: 'June 2026',
  blogSlug: 'june-2026-london-ontario-market-update',
  areaName: 'Oakridge',
  avgPrice: '$715,753',
  medianDaysOnMarket: '19 days',
  soldAboveList: '22.9%',
  salesVolume: '35 homes sold',
};
