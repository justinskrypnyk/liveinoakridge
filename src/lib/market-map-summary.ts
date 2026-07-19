// Turns a single Supabase snapshot row into a short, genuinely-varying
// natural-language summary -- the actual SEO payload for /market-map/,
// since the Leaflet map itself is client-rendered and invisible to
// crawlers. Sentence choice branches on each area's real numbers, so 39
// neighbourhoods don't read as 39 copies of the same template.
import type { MarketMapSnapshotRow } from './supabase';
import { fmtPrice } from './listings';

export function summarizeArea(s: MarketMapSnapshotRow): string {
  const sentences: string[] = [];

  if (s.active_count === 0) {
    return `${s.area_name} has no active listings in the current snapshot.`;
  }

  const priceLine = s.median_list_price != null
    ? `${s.area_name} has ${s.active_count} active listing${s.active_count === 1 ? '' : 's'} with a median asking price of ${fmtPrice(s.median_list_price)}`
    : `${s.area_name} has ${s.active_count} active listing${s.active_count === 1 ? '' : 's'}`;

  const bedBathLine = s.median_bedrooms != null && s.median_bathrooms != null
    ? `, and a typical home here has ${s.median_bedrooms} bedroom${s.median_bedrooms === 1 ? '' : 's'} and ${s.median_bathrooms} bathroom${s.median_bathrooms === 1 ? '' : 's'}.`
    : '.';
  sentences.push(priceLine + bedBathLine);

  if (s.pct_detached != null) {
    const pct = Math.round(s.pct_detached * 100);
    if (s.pct_detached >= 0.7) {
      sentences.push(`It's a strongly detached-home neighbourhood -- ${pct}% of current listings are single detached houses.`);
    } else if (s.pct_detached <= 0.3) {
      sentences.push(`Most active listings here are condos or townhomes rather than detached houses -- just ${pct}% are detached.`);
    } else {
      sentences.push(`${pct}% of active listings are detached homes, with the rest split between condos and townhomes.`);
    }
  }

  if (s.avg_days_on_market != null) {
    const dom = Math.round(s.avg_days_on_market);
    if (dom <= 30) {
      sentences.push(`Homes are moving quickly here, averaging just ${dom} days on market.`);
    } else if (dom >= 60) {
      sentences.push(`Homes tend to sit longer in ${s.area_name}, averaging ${dom} days on market.`);
    } else {
      sentences.push(`Homes typically sell within ${dom} days of listing.`);
    }
  }

  if (s.new_listings_count != null && s.new_listings_count > 0) {
    sentences.push(`${s.new_listings_count} new listing${s.new_listings_count === 1 ? '' : 's'} came on the market here this period.`);
  }

  return sentences.join(' ');
}
