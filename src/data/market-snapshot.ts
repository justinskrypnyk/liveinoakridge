export interface MarketSnapshot {
  monthLabel: string;
  blogSlug: string;
  areaName: string;
  medianPrice: string;
  medianDaysOnMarket: string;
  soldAboveList: string;
  salesVolume: string;
}

// The home page "Market Pulse" strip. Update this each month when the new
// market update post goes live (now the 6th -- see the monthly playbook),
// from the same firm-date MLS numbers as the post: sales by the date they
// went firm, placed in the area by its real boundary. September 2026 matched
// Justin's MLS Quick CMA home by home (11 sales, $730K median).
export const MARKET_SNAPSHOT: MarketSnapshot = {
  monthLabel: 'September 2026',
  blogSlug: 'september-2026-london-ontario-housing-market',
  areaName: 'Oakridge',
  medianPrice: '$730,000',
  medianDaysOnMarket: '43 days',
  soldAboveList: '2 of 11',
  salesVolume: '11',
};
