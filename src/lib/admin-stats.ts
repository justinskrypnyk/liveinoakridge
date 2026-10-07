// Numbers for the combined admin panel (Justin, 2026-10-07): /admin/ shows
// liveinoakridge.ca and londonontariohomes.ca side by side. Both sites keep
// the same Blobs stores (heatmap, site-health, price history), so this reads
// either one through adminStore() (src/lib/admin-sites.mjs). Anything a site
// can't supply is null so the panel shows "n/a" instead of a fake zero.
import { adminStore } from '@/lib/admin-sites.mjs';

type AdminSite = { id: string; label: string; origin: string; siteID: string };

export type AdminStats = {
  site: string;
  generatedAt: string;
  visits: { daily: Record<string, number>; source: 'heatmap' | 'ga4' } | null;
  leads: { last7: number; last30: number; recent: { at: string; form: string; name: string; page: string | null }[] } | null;
  forms: Record<string, { started: number; sent: number }> | null;
  topPages: { path: string; views: number }[] | null;
  searches: { total: number; topAreas: [string, number][]; topPrices: [string, number][] } | null;
  listings: { active: number; updatedAt: string } | null;
  health: { checkedAt: string; failures: number; warnings: number; problems: { name: string; detail: string }[] } | null;
};

const DAY = 86400000;
// Team and Claude test submissions, not leads (see the 2026-10-01 lead count:
// all 54 September "leads" turned out to be tests).
const TEST_LEAD = /smile@|padasas|^info(\+[^@]*)?@homeswithjustin\.ca$|claude-test|^test20/i;
const TEST_NAME = /^test\b/i;

const torontoDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
function mondayOf(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}
const top = (o: Record<string, number> = {}, n = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n) as [string, number][];
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`admin-stats: ${label} failed`, err);
    return null;
  }
}

type WeekPages = { pages?: Record<string, { views: number }> };
type WeekSite = { site?: { daily?: Record<string, number>; searches?: number; areas?: Record<string, number>; prices?: Record<string, number>; forms?: Record<string, { started: number; sent: number }> } };

export async function buildAdminStats(siteInfo: AdminSite): Promise<AdminStats> {
  const weeks = adminStore('heatmap-weeks', siteInfo);
  const today = torontoDay(Date.now());
  const thisMonday = mondayOf(today);

  const visits = safe('visits', async () => {
    // Last 30 days span up to 6 week docs. Daily counts start 2026-09-29.
    const mondays = new Set<string>();
    for (let i = 0; i < 30; i++) mondays.add(mondayOf(torontoDay(Date.now() - i * DAY)));
    const daily: Record<string, number> = {};
    const cutoff = torontoDay(Date.now() - 29 * DAY);
    await Promise.all([...mondays].map(async (mon) => {
      const doc = (await weeks.get(`${mon}/site`, { type: 'json' })) as WeekSite | null;
      for (const [day, n] of Object.entries(doc?.site?.daily || {})) if (day >= cutoff) daily[day] = n;
    }));
    return { daily, source: 'heatmap' as const };
  });

  const thisWeek = safe('this week', async () => {
    const [site, d, m] = await Promise.all(['site', 'd', 'm'].map((k) => weeks.get(`${thisMonday}/${k}`, { type: 'json' })));
    const s = (site as WeekSite | null)?.site;
    const views: Record<string, number> = {};
    for (const doc of [d, m] as (WeekPages | null)[]) for (const [path, p] of Object.entries(doc?.pages || {})) views[path] = (views[path] || 0) + (p.views || 0);
    return {
      forms: s?.forms ? Object.fromEntries(Object.entries(s.forms).map(([k, v]) => [k, { started: v.started || 0, sent: v.sent || 0 }])) : null,
      topPages: top(views, 10).map(([path, n]) => ({ path, views: n })),
      searches: s ? { total: s.searches || 0, topAreas: top(s.areas), topPrices: top(s.prices) } : null,
    };
  });

  const leads = safe('leads', async () => {
    const token = process.env.NETLIFY_API_TOKEN || import.meta.env.NETLIFY_API_TOKEN;
    if (!token) return null;
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteInfo.siteID}/submissions?per_page=100`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Netlify API HTTP ${res.status}`);
    const subs = (await res.json()) as { created_at: string; form_name: string; data?: Record<string, string>; email?: string }[];
    const now = Date.now();
    const real = subs.filter((s) => !TEST_LEAD.test(String(s.data?.email || s.email || '').trim())
      && !TEST_NAME.test(String(s.data?.['first-name'] || s.data?.name || '').trim())
      && now - Date.parse(s.created_at) < 30 * DAY);
    return {
      last7: real.filter((s) => now - Date.parse(s.created_at) < 7 * DAY).length,
      last30: real.length,
      recent: real.slice(0, 10).map((s) => {
        const d = s.data || {};
        const first = String(d['first-name'] || d.name || '').trim().split(/\s+/)[0] || '';
        const lastInitial = String(d['last-name'] || '').trim()[0] || '';
        let page: string | null = null;
        try { page = d.referrer ? new URL(d.referrer).pathname : null; } catch { page = null; }
        return { at: s.created_at, form: s.form_name, name: `${first}${lastInitial ? ` ${lastInitial}.` : ''}` || 'No name', page };
      }),
    };
  });

  const listings = safe('listings', async () => {
    // price-drop-alerts records every active London listing it saw on its last run.
    const doc = (await adminStore('listing-price-history', siteInfo).get('latest', { type: 'json' })) as { updatedAt: string; prices: Record<string, { seen: string }> } | null;
    if (!doc) return null;
    return { active: Object.values(doc.prices).filter((p) => p.seen === doc.updatedAt).length, updatedAt: doc.updatedAt };
  });

  const health = safe('health', async () => {
    const doc = (await adminStore('site-health', siteInfo).get('latest', { type: 'json' })) as { checkedAt: string; failures: number; warnings: number; results: { name: string; detail: string; level: string }[] } | null;
    if (!doc) return null;
    return { checkedAt: doc.checkedAt, failures: doc.failures, warnings: doc.warnings, problems: doc.results.filter((r) => r.level !== 'ok').map(({ name, detail }) => ({ name, detail })) };
  });

  const [v, w, l, li, h] = await Promise.all([visits, thisWeek, leads, listings, health]);
  return {
    site: siteInfo.label,
    generatedAt: new Date().toISOString(),
    visits: v,
    leads: l,
    forms: w?.forms ?? null,
    topPages: w?.topPages ?? null,
    searches: w?.searches ?? null,
    listings: li,
    health: h,
  };
}
