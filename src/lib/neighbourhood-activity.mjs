// Monthly "where is money going" report (Justin, 2026-10-15): our 7 areas
// ranked first, then notable activity in the rest of London. Two sources:
//
//   Planning files   City map via city-applications.mjs. "Active last month" =
//                    the City edited the file during that month; "new" = the
//                    daily alert first saw it that month (first-seen blob).
//   Major permits    src/data/major-permits.json, loaded each quarter by
//                    scripts/load-major-permits.mjs from the City's Building
//                    Services Report: every permit $1M+ EXCEPT single/semi-
//                    detached houses. Year-to-date, so it lags up to a quarter.
//
// House renovation permits aren't published by the City at all, so they are
// not in here (checked 2026-10-15).
//
// Neighbourhood-level and all-London, so the same numbers can feed the
// city-wide site; each run saves its data to blob `city-applications`
// monthly/YYYY-MM.
import majorPermits from '../data/major-permits.json' with { type: 'json' };
import { OUR_AREAS, fetchApplications, fetchCityPages, describeApps, applicationCard, esc } from './city-applications.mjs';

const REPORTS_PAGE = 'https://london.ca/living-london/building-renovating/building-permits/building-permit-forms-documents-reports';
const NOTABLE_LAYERS = new Set([27, 30, 31, 32]); // subdivisions, rezonings, Official Plan changes
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

export function previousMonth(now = new Date()) {
  const [y, m] = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const key = `${py}-${String(pm).padStart(2, '0')}`;
  const label = new Date(Date.UTC(py, pm - 1, 15)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key, label, year: String(py) };
}

/** Latest year of major permits we have loaded, plus totals by neighbourhood. */
export function permitSummary() {
  const years = Object.keys(majorPermits.years || {}).sort();
  const year = years[years.length - 1];
  if (!year) return null;
  const { period, permits } = majorPermits.years[year];
  const byArea = {};
  for (const p of permits) {
    if (!p.area) continue;
    const a = (byArea[p.area] ??= { area: p.area, areaName: p.areaName, count: 0, value: 0, units: 0, permits: [] });
    a.count++;
    a.value += p.value;
    a.units += p.units || 0;
    a.permits.push(p);
  }
  for (const a of Object.values(byArea)) a.permits.sort((x, y) => y.value - x.value);
  return { year, period, permits, byArea };
}

/** Latest "Quarter N, YYYY" report the City lists, so we can flag one we haven't loaded. */
export async function latestCityReport() {
  try {
    const html = await (await fetch(REPORTS_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const found = [...html.matchAll(/Quarter\s+([1-4]),\s*(\d{4})/g)].map((m) => `${m[2]} Q${m[1]}`);
    return found.sort().pop() ?? null;
  } catch {
    return null;
  }
}

function permitLine(p, { showArea = false } = {}) {
  const what = p.work.replace(/\s*\*{2,}[^*]*\*{2,}\s*/g, ' ').replace(/\s+/g, ' ').slice(0, 150);
  return `<li style="margin:0 0 6px"><b>${money(p.value)}</b> · ${esc(p.address)}${showArea && p.areaName ? ` (${esc(p.areaName)})` : ''}${
    p.units ? ` · ${p.units} units` : ''
  }${p.firstReported && p.firstReported === p.latestPeriod ? ' · <span style="color:#b4541a">new this quarter</span>' : ''}<br><span style="color:#555;font-size:13px">${esc(what)}</span></li>`;
}

export async function runNeighbourhoodReport({ getStore, dryRun = false, to = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca', now = new Date() }) {
  const store = getStore('city-applications');
  const month = previousMonth(now);
  const firstSeen = (await store.get('first-seen', { type: 'json' })) || {};

  // ---- planning activity last month, all of London
  const { apps } = await fetchApplications();
  const active = apps.filter((a) => (a.edited || '').startsWith(month.key));
  for (const a of active) a.isNew = (firstSeen[a.key] || '').startsWith(month.key);
  const ours = active.filter((a) => OUR_AREAS.includes(a.area));
  const elsewhere = active
    .filter((a) => !OUR_AREAS.includes(a.area) && NOTABLE_LAYERS.has(a.layerId))
    .sort((a, b) => b.isNew - a.isNew || (b.edited || '').localeCompare(a.edited || ''))
    .slice(0, 8);
  const pages = await fetchCityPages((await store.get('pages', { type: 'json' })) || {});
  await describeApps([...ours, ...elsewhere], pages);

  // ---- major permits, year to date
  const permits = permitSummary();
  if (permits) for (const p of permits.permits) p.latestPeriod = permits.period;
  const cityReport = await latestCityReport();
  const newReportWaiting = cityReport && permits && cityReport > permits.period ? cityReport : null;

  // ---- our 7, ranked by big-permit dollars, then planning activity
  const planningCount = (slug) => ours.filter((a) => a.area === slug).length;
  const rows = OUR_AREAS.map((slug) => {
    const p = permits?.byArea[slug];
    return {
      slug,
      name: p?.areaName || apps.find((a) => a.area === slug)?.areaName || slug,
      planning: planningCount(slug),
      planningNew: ours.filter((a) => a.area === slug && a.isNew).length,
      value: p?.value || 0,
      count: p?.count || 0,
      units: p?.units || 0,
      top: p?.permits.slice(0, 3) || [],
    };
  }).sort((a, b) => b.value - a.value || b.planning - a.planning);

  const restAreas = permits
    ? Object.values(permits.byArea).filter((a) => !OUR_AREAS.includes(a.area)).sort((a, b) => b.value - a.value)
    : [];
  const restBiggest = permits
    ? permits.permits.filter((p) => !OUR_AREAS.includes(p.area)).sort((a, b) => b.value - a.value).slice(0, 6)
    : [];

  // ---- email
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #e3e1db;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#7a6f5c"';
  const td = 'style="padding:7px 8px;border-bottom:1px solid #eee;font-size:14px"';
  const table = `<table style="border-collapse:collapse;width:100%">
<tr><th ${th}>Area</th><th ${th}>Big permits ${esc(permits?.year || '')}</th><th ${th}>New units</th><th ${th}>Planning files, ${esc(month.label.split(' ')[0])}</th></tr>
${rows
  .map(
    (r, i) => `<tr><td ${td}><b>${i + 1}. ${esc(r.name)}</b></td><td ${td}>${r.count ? `${money(r.value)} <span style="color:#888">(${r.count})</span>` : '–'}</td><td ${td}>${r.units || '–'}</td><td ${td}>${
      r.planning ? `${r.planning}${r.planningNew ? ` <span style="color:#b4541a">(${r.planningNew} new)</span>` : ''}` : '–'
    }</td></tr>`
  )
  .join('')}
</table>`;

  const areaDetails = rows
    .filter((r) => r.top.length || r.planning)
    .map(
      (r) => `<h3 style="font-size:16px;margin:20px 0 6px">${esc(r.name)}</h3>
${r.top.length ? `<ul style="padding-left:18px;margin:0 0 8px">${r.top.map((p) => permitLine(p)).join('')}</ul>` : ''}
${ours.filter((a) => a.area === r.slug).map(applicationCard).join('')}`
    )
    .join('');

  const subject = `${newReportWaiting ? `ACTION NEEDED: load the new City permit report (${newReportWaiting}) · ` : ''}Neighbourhood activity, ${month.label}: ${rows[0].value ? `${rows[0].name} leads your areas` : 'your 7 areas'}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:660px;margin:0 auto;color:#222">
<h1 style="font-size:22px;margin:0 0 4px">Where the money is going: ${esc(month.label)}</h1>
<p style="font-size:14px;color:#555;margin:0 0 16px">Big permits = every City building permit of $1M+ so far in ${esc(permits?.year || '')} (${esc(permits?.period || 'none loaded')} report), not counting single and semi-detached houses. Planning files = applications the City worked on in ${esc(month.label)}.</p>
${newReportWaiting ? `<p style="background:#fff4e5;border-left:4px solid #b4541a;padding:10px 12px;font-size:14px"><b>The City posted a newer permit report (${esc(newReportWaiting)}).</b> Ask Claude to load it so these numbers catch up.</p>` : ''}
<h2 style="font-size:19px;margin:22px 0 8px">Your 7 neighbourhoods</h2>
${table}
${areaDetails}
<h2 style="font-size:19px;margin:30px 0 8px">Rest of London: notable</h2>
${restAreas.length ? `<p style="font-size:14px;margin:0 0 6px"><b>Most big-permit money in ${esc(permits.year)}:</b> ${restAreas
  .slice(0, 5)
  .map((a) => `${esc(a.areaName)} ${money(a.value)}${a.units ? ` (${a.units} units)` : ''}`)
  .join(' · ')}</p>` : ''}
${restBiggest.length ? `<p style="font-size:14px;margin:12px 0 4px"><b>Biggest projects:</b></p><ul style="padding-left:18px;margin:0">${restBiggest.map((p) => permitLine(p, { showArea: true })).join('')}</ul>` : ''}
${elsewhere.length ? `<p style="font-size:14px;margin:16px 0 8px"><b>Rezonings, plan changes and subdivisions the City worked on in ${esc(month.label)}:</b></p>${elsewhere.map(applicationCard).join('')}` : ''}
<p style="font-size:12px;color:#888;margin-top:24px">Sources: City of London Building Services Report (quarterly), City planning map and london.ca application pages. House renovation permits aren't published by the City, so they can't be counted.</p>
</div>`;

  const snapshot = {
    month: month.key,
    permitPeriod: permits?.period ?? null,
    areas: Object.values(permits?.byArea || {}).map(({ permits: _p, ...a }) => a),
    planning: active.map((a) => ({ file: a.file, type: a.type, area: a.area, edited: a.edited, isNew: a.isNew })),
  };
  if (!dryRun) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>', to: [to], subject, html }),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    await store.setJSON(`monthly/${month.key}`, snapshot);
  }
  return { subject, html, snapshot, newReportWaiting };
}

/**
 * Justin wants a strong, explicit nudge when the City posts a quarterly permit
 * report we haven't loaded (2026-10-15), because loading it is a manual step
 * ("tell Claude: load it"). Checked daily by the planning-alert job: emails the
 * day a new report appears, then again every 7 days until it's loaded.
 * Blob `city-applications` permit-report-reminder: { report, lastSent }.
 */
export async function remindNewPermitReport({ getStore, dryRun = false, to = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca', now = new Date() }) {
  const loaded = permitSummary()?.period ?? null;
  const latest = await latestCityReport();
  if (!latest || (loaded && latest <= loaded)) return { waiting: null, loaded, latest };

  const store = getStore('city-applications');
  const state = (await store.get('permit-report-reminder', { type: 'json' })) || {};
  const daysSince = state.report === latest && state.lastSent ? (now - new Date(state.lastSent)) / 86400000 : Infinity;
  if (daysSince < 7) return { waiting: latest, loaded, sent: false };

  const nth = state.report === latest ? (state.count || 1) + 1 : 1;
  const subject = `ACTION NEEDED: new City permit report (${latest}) is out. Tell Claude "load it"${nth > 1 ? ` (reminder #${nth})` : ''}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
<div style="background:#fff4e5;border:2px solid #b4541a;border-radius:8px;padding:18px 20px">
<p style="font-size:20px;font-weight:700;margin:0 0 10px;color:#b4541a">New City permit report: ${esc(latest)}</p>
<p style="font-size:15px;margin:0 0 12px">The City of London just posted its <b>${esc(latest)}</b> Building Services Report. Your monthly neighbourhood report is still using <b>${esc(loaded || 'nothing')}</b>, so its big-permit numbers are out of date until it's loaded.</p>
<p style="font-size:16px;margin:0 0 6px"><b>What to do:</b> open Claude Code in the london-realtor folder and type:</p>
<p style="font-size:18px;font-family:Menlo,Consolas,monospace;background:#fff;border:1px solid #e3e1db;border-radius:6px;padding:10px 12px;margin:0 0 12px">load the new City permit report (${esc(latest)})</p>
<p style="font-size:13px;color:#555;margin:0">Takes Claude a few minutes. This email repeats every 7 days until it's loaded.</p>
</div>
<p style="font-size:12px;color:#888;margin-top:14px">Source: <a href="${REPORTS_PAGE}">london.ca building permit reports</a></p>
</div>`;
  if (!dryRun) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Live In Oakridge Alerts <reports@mail.liveinoakridge.ca>', to: [to], subject, html }),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    await store.setJSON('permit-report-reminder', { report: latest, lastSent: now.toISOString(), count: nth });
  }
  return { waiting: latest, loaded, sent: true, subject, html };
}
