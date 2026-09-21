// Scheduled job -- emails Justin + Smile a weekly website-performance digest:
// GA4 traffic (sessions/users/pageviews/leads, channel mix, top content) and
// Google Search Console visibility (clicks/impressions/position, ranking
// movers, top queries). Same two-part shape as the market digests
// (feedback-digest-report-format): a scannable HTML summary in the body,
// full underlying data attached as CSVs.
//
// Auth: unlike the market digests (which hit DDF/Supabase directly), GA4 +
// GSC need a real Google OAuth identity. A GCP org policy
// (constraints/iam.disableServiceAccountKeyCreation) blocks minting a
// service-account key here, so this authenticates as Justin's own Google
// login instead, via a refresh token -- the same "authorized_user" ADC
// credential shape gcloud writes to
// ~/.config/gcloud/application_default_credentials.json, pasted whole into
// the GOOGLE_OAUTH_CREDENTIALS env var. Since it's Justin's own login, it
// already has access to both GA4 property 542463311 and the
// sc-domain:liveinoakridge.ca Search Console property -- no separate
// permission-granting step needed (Search Console has no API for that
// anyway).
const GOOGLE_OAUTH_CREDENTIALS = process.env.GOOGLE_OAUTH_CREDENTIALS;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';

const GA4_PROPERTY_ID = '542463311';
const GSC_SITE_URL = 'sc-domain:liveinoakridge.ca';
const SITE_ORIGIN = 'https://www.liveinoakridge.ca';

// Best-effort classification of AI-assistant/chatbot referral traffic --
// GA4's default channel grouping doesn't break this out on its own. Not
// exhaustive, just the sources that have actually shown up in this site's
// traffic before (see project-traffic-report memory, 2026-09-09).
const AI_SOURCE_PATTERN = '(chatgpt|openai|perplexity|claude\\.ai|anthropic|copilot|gemini|bard|bing.*chat)';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toCsvValue(v) {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(header, rows) {
  return [header.join(','), ...rows.map((r) => r.map(toCsvValue).join(','))].join('\n');
}

function pctChange(current, prior) {
  if (!prior) return current > 0 ? null : 0; // null = "new" (no prior baseline), not a real 0% change
  return ((current - prior) / prior) * 100;
}
function fmtPct(p) {
  if (p === null) return 'new';
  if (!Number.isFinite(p)) return 'n/a';
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(0)}%`;
}
function fmtNum(n) {
  return new Intl.NumberFormat('en-CA').format(Math.round(n));
}
function fmtCtr(c) {
  return `${(c * 100).toFixed(1)}%`;
}
function fmtPos(p) {
  return p == null ? 'n/a' : p.toFixed(1);
}
function normalizePath(urlOrPath) {
  if (!urlOrPath) return '/';
  if (urlOrPath.startsWith('http')) {
    try {
      return new URL(urlOrPath).pathname || '/';
    } catch {
      return urlOrPath;
    }
  }
  return urlOrPath.split('?')[0] || '/';
}

// ---- Google OAuth (refresh-token grant, authorized_user credential) ----
async function getAccessToken() {
  const creds = JSON.parse(GOOGLE_OAUTH_CREDENTIALS);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth token refresh failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.access_token;
}

// ---- GA4 Data API ----
async function ga4Report(accessToken, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

// Splits a GA4 response into current/prior maps when the request used two
// dateRanges -- GA4 appends an extra "date_range_0"/"date_range_1"
// dimensionValue after the requested dimensions in that case.
function splitGa4ByDateRange(resp, dimCount, metricNames) {
  const current = new Map();
  const prior = new Map();
  for (const row of resp.rows || []) {
    const dims = row.dimensionValues.slice(0, dimCount).map((d) => d.value);
    const key = dims.join('');
    const rangeTag = row.dimensionValues[dimCount]?.value;
    const metrics = {};
    metricNames.forEach((name, i) => { metrics[name] = Number(row.metricValues[i]?.value) || 0; });
    const target = rangeTag === 'date_range_1' ? prior : current;
    target.set(key, { dims, metrics });
  }
  return { current, prior };
}

// ---- Search Console API ----
async function gscQuery(accessToken, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`GSC query failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function sendDigestEmail(subject, html, attachments) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
      to: [DIGEST_TO_EMAIL, 'smile@homeswithjustin.ca'],
      subject,
      html,
      attachments,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

async function sendFailureAlert(message) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
        to: [DIGEST_TO_EMAIL], // internal ops alert -- Justin only, not Smile
        subject: '⚠️ Weekly traffic report FAILED to send',
        html: `<p>${esc(message)}</p>`,
      }),
    });
  } catch {
    // best-effort -- if RESEND_API_KEY itself is the problem, this fails too, same known gap as the other digests' failure alerts
  }
}

export default async () => {
  if (!GOOGLE_OAUTH_CREDENTIALS || !RESEND_API_KEY) {
    console.error('weekly-traffic-digest: missing required env vars', {
      GOOGLE_OAUTH_CREDENTIALS: !!GOOGLE_OAUTH_CREDENTIALS, RESEND_API_KEY: !!RESEND_API_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const now = new Date();
  // Previous Mon-Sun, same window as weekly-digest-background.mjs (this runs Monday morning).
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() - 1);
  const weekStart = new Date(weekEnd); weekStart.setDate(weekStart.getDate() - 6);
  const priorWeekEnd = new Date(weekStart); priorWeekEnd.setDate(priorWeekEnd.getDate() - 1);
  const priorWeekStart = new Date(priorWeekEnd); priorWeekStart.setDate(priorWeekStart.getDate() - 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const weekStartStr = fmt(weekStart), weekEndStr = fmt(weekEnd);
  const priorWeekStartStr = fmt(priorWeekStart), priorWeekEndStr = fmt(priorWeekEnd);

  let accessToken;
  try {
    accessToken = await getAccessToken();

    // ---- GA4: channel breakdown (also gives us site-wide totals by summing rows) ----
    const channelResp = await ga4Report(accessToken, {
      dateRanges: [
        { startDate: weekStartStr, endDate: weekEndStr },
        { startDate: priorWeekStartStr, endDate: priorWeekEndStr },
      ],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'keyEvents' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });
    const { current: channelCurrent, prior: channelPrior } = splitGa4ByDateRange(channelResp, 1, [
      'sessions', 'totalUsers', 'screenPageViews', 'keyEvents',
    ]);
    const allChannelKeys = new Set([...channelCurrent.keys(), ...channelPrior.keys()]);
    const channelRows = [...allChannelKeys]
      .map((key) => {
        const cur = channelCurrent.get(key)?.metrics ?? { sessions: 0, totalUsers: 0, screenPageViews: 0, keyEvents: 0 };
        const pri = channelPrior.get(key)?.metrics ?? { sessions: 0, totalUsers: 0, screenPageViews: 0, keyEvents: 0 };
        const name = channelCurrent.get(key)?.dims[0] ?? channelPrior.get(key)?.dims[0] ?? key;
        return { name, cur, pri };
      })
      .sort((a, b) => b.cur.sessions - a.cur.sessions);

    const totalCur = channelRows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.cur.sessions, totalUsers: acc.totalUsers + r.cur.totalUsers,
        screenPageViews: acc.screenPageViews + r.cur.screenPageViews, keyEvents: acc.keyEvents + r.cur.keyEvents,
      }),
      { sessions: 0, totalUsers: 0, screenPageViews: 0, keyEvents: 0 }
    );
    const totalPri = channelRows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.pri.sessions, totalUsers: acc.totalUsers + r.pri.totalUsers,
        screenPageViews: acc.screenPageViews + r.pri.screenPageViews, keyEvents: acc.keyEvents + r.pri.keyEvents,
      }),
      { sessions: 0, totalUsers: 0, screenPageViews: 0, keyEvents: 0 }
    );

    // ---- GA4: top landing pages ----
    const pagesResp = await ga4Report(accessToken, {
      dateRanges: [
        { startDate: weekStartStr, endDate: weekEndStr },
        { startDate: priorWeekStartStr, endDate: priorWeekEndStr },
      ],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'keyEvents' }, { name: 'engagementRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 100,
    });
    const { current: pagesCurrent, prior: pagesPrior } = splitGa4ByDateRange(pagesResp, 1, [
      'sessions', 'screenPageViews', 'keyEvents', 'engagementRate',
    ]);

    // ---- GA4: AI-assistant referral sessions (best-effort, non-fatal) ----
    let aiCur = 0, aiPri = 0;
    try {
      const aiResp = await ga4Report(accessToken, {
        dateRanges: [
          { startDate: weekStartStr, endDate: weekEndStr },
          { startDate: priorWeekStartStr, endDate: priorWeekEndStr },
        ],
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: AI_SOURCE_PATTERN } },
        },
      });
      const { current: aiCurrent, prior: aiPrior } = splitGa4ByDateRange(aiResp, 1, ['sessions']);
      for (const { metrics } of aiCurrent.values()) aiCur += metrics.sessions;
      for (const { metrics } of aiPrior.values()) aiPri += metrics.sessions;
    } catch (err) {
      console.error('weekly-traffic-digest: AI-referral GA4 call failed (non-fatal)', err);
    }

    // ---- GSC: site-wide totals, current + prior ----
    const [gscTotalsCur, gscTotalsPri] = await Promise.all([
      gscQuery(accessToken, { startDate: weekStartStr, endDate: weekEndStr, dimensions: [] }),
      gscQuery(accessToken, { startDate: priorWeekStartStr, endDate: priorWeekEndStr, dimensions: [] }),
    ]);
    const gscCur = gscTotalsCur.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const gscPri = gscTotalsPri.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    // ---- GSC: queries, current + prior (for ranking movers + full CSV) ----
    const [gscQueriesCurResp, gscQueriesPriResp] = await Promise.all([
      gscQuery(accessToken, { startDate: weekStartStr, endDate: weekEndStr, dimensions: ['query'], rowLimit: 250 }),
      gscQuery(accessToken, { startDate: priorWeekStartStr, endDate: priorWeekEndStr, dimensions: ['query'], rowLimit: 250 }),
    ]);
    const queriesCur = new Map((gscQueriesCurResp.rows ?? []).map((r) => [r.keys[0], r]));
    const queriesPri = new Map((gscQueriesPriResp.rows ?? []).map((r) => [r.keys[0], r]));
    const allQueryKeys = new Set([...queriesCur.keys(), ...queriesPri.keys()]);

    // ---- GSC: pages, current + prior (joined into the content table below) ----
    const [gscPagesCurResp, gscPagesPriResp] = await Promise.all([
      gscQuery(accessToken, { startDate: weekStartStr, endDate: weekEndStr, dimensions: ['page'], rowLimit: 100 }),
      gscQuery(accessToken, { startDate: priorWeekStartStr, endDate: priorWeekEndStr, dimensions: ['page'], rowLimit: 100 }),
    ]);
    const gscPagesCur = new Map((gscPagesCurResp.rows ?? []).map((r) => [normalizePath(r.keys[0]), r]));
    const gscPagesPri = new Map((gscPagesPriResp.rows ?? []).map((r) => [normalizePath(r.keys[0]), r]));

    // ---- Ranking movers: queries present in both weeks, meaningful impressions, sorted by position change ----
    const movers = [...allQueryKeys]
      .filter((q) => queriesCur.has(q) && queriesPri.has(q))
      .map((q) => {
        const c = queriesCur.get(q), p = queriesPri.get(q);
        return { query: q, posCur: c.position, posPri: p.position, change: p.position - c.position, clicksCur: c.clicks, imprCur: c.impressions, imprPri: p.impressions };
      })
      .filter((m) => Math.max(m.imprCur, m.imprPri) >= 10);
    const gainers = [...movers].filter((m) => m.change > 0.5).sort((a, b) => b.change - a.change).slice(0, 5);
    const losers = [...movers].filter((m) => m.change < -0.5).sort((a, b) => a.change - b.change).slice(0, 5);

    const topQueries = [...queriesCur.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 10);

    // ---- Top content: join GA4 landing pages with GSC pages by path ----
    const topPages = [...pagesCurrent.values()]
      .sort((a, b) => b.metrics.sessions - a.metrics.sessions)
      .slice(0, 10)
      .map((row) => {
        const path = normalizePath(row.dims[0]);
        const priMetrics = pagesPrior.get(row.dims.join(''))?.metrics;
        const gscC = gscPagesCur.get(path);
        return {
          path,
          sessions: row.metrics.sessions,
          sessionsPrior: priMetrics?.sessions ?? 0,
          keyEvents: row.metrics.keyEvents,
          engagementRate: row.metrics.engagementRate,
          gscClicks: gscC?.clicks ?? 0,
          gscPosition: gscC?.position ?? null,
        };
      });

    // ---- Build the email ----
    const overviewRow = (label, cur, pri, isPct = false) => `<tr>
      <td style="padding:4px 10px;">${label}</td>
      <td style="padding:4px 10px;">${isPct ? fmtCtr(cur) : fmtNum(cur)}</td>
      <td style="padding:4px 10px;">${isPct ? fmtCtr(pri) : fmtNum(pri)}</td>
      <td style="padding:4px 10px;">${fmtPct(pctChange(cur, pri))}</td>
    </tr>`;

    const channelRowsHtml = channelRows.slice(0, 10).map((r) => `<tr>
      <td style="padding:4px 10px;">${esc(r.name)}</td>
      <td style="padding:4px 10px;">${fmtNum(r.cur.sessions)}</td>
      <td style="padding:4px 10px;">${fmtNum(r.pri.sessions)}</td>
      <td style="padding:4px 10px;">${fmtPct(pctChange(r.cur.sessions, r.pri.sessions))}</td>
    </tr>`).join('');

    const topPagesHtml = topPages.map((p) => `<tr>
      <td style="padding:4px 10px;"><a href="${SITE_ORIGIN}${esc(p.path)}">${esc(p.path)}</a></td>
      <td style="padding:4px 10px;">${fmtNum(p.sessions)}</td>
      <td style="padding:4px 10px;">${fmtPct(pctChange(p.sessions, p.sessionsPrior))}</td>
      <td style="padding:4px 10px;">${fmtNum(p.keyEvents)}</td>
      <td style="padding:4px 10px;">${fmtPos(p.gscPosition)}</td>
    </tr>`).join('');

    const moversHtml = (rows, arrow) => rows.map((m) => `<tr>
      <td style="padding:4px 10px;">${esc(m.query)}</td>
      <td style="padding:4px 10px;">${fmtPos(m.posPri)} ${arrow} ${fmtPos(m.posCur)}</td>
      <td style="padding:4px 10px;">${fmtNum(m.imprCur)}</td>
    </tr>`).join('') || '<tr><td style="padding:4px 10px;" colspan="3">None this week</td></tr>';

    const topQueriesHtml = topQueries.map((q) => `<tr>
      <td style="padding:4px 10px;">${esc(q.keys[0])}</td>
      <td style="padding:4px 10px;">${fmtNum(q.clicks)}</td>
      <td style="padding:4px 10px;">${fmtNum(q.impressions)}</td>
      <td style="padding:4px 10px;">${fmtCtr(q.ctr)}</td>
      <td style="padding:4px 10px;">${fmtPos(q.position)}</td>
    </tr>`).join('');

    const html = `
      <h2>Weekly Traffic Report — ${weekStartStr} to ${weekEndStr}</h2>

      <h3>Traffic Overview (GA4)</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Metric</td><td style="padding:4px 10px;">This Week</td><td style="padding:4px 10px;">Last Week</td><td style="padding:4px 10px;">Change</td></tr>
        ${overviewRow('Sessions', totalCur.sessions, totalPri.sessions)}
        ${overviewRow('Users', totalCur.totalUsers, totalPri.totalUsers)}
        ${overviewRow('Pageviews', totalCur.screenPageViews, totalPri.screenPageViews)}
        ${overviewRow('Key Events (leads/contacts)', totalCur.keyEvents, totalPri.keyEvents)}
        ${overviewRow('AI-Assistant Referrals', aiCur, aiPri)}
      </table>

      <h3>Search Visibility (Google Search Console)</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Metric</td><td style="padding:4px 10px;">This Week</td><td style="padding:4px 10px;">Last Week</td><td style="padding:4px 10px;">Change</td></tr>
        ${overviewRow('Clicks', gscCur.clicks, gscPri.clicks)}
        ${overviewRow('Impressions', gscCur.impressions, gscPri.impressions)}
        ${overviewRow('Avg CTR', gscCur.ctr, gscPri.ctr, true)}
        <tr><td style="padding:4px 10px;">Avg Position</td><td style="padding:4px 10px;">${fmtPos(gscCur.position)}</td><td style="padding:4px 10px;">${fmtPos(gscPri.position)}</td><td style="padding:4px 10px;">${fmtPos((gscPri.position ?? 0) - (gscCur.position ?? 0))} ${(gscPri.position ?? 0) > (gscCur.position ?? 0) ? 'better' : 'worse'}</td></tr>
      </table>

      <h3>Traffic by Channel</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Channel</td><td style="padding:4px 10px;">This Week</td><td style="padding:4px 10px;">Last Week</td><td style="padding:4px 10px;">Change</td></tr>
        ${channelRowsHtml}
      </table>

      <h3>What's Working: Top Content This Week</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Page</td><td style="padding:4px 10px;">Sessions</td><td style="padding:4px 10px;">vs Last Week</td><td style="padding:4px 10px;">Key Events</td><td style="padding:4px 10px;">Avg. Search Position</td></tr>
        ${topPagesHtml}
      </table>

      <h3>Ranking Movers (Search Console)</h3>
      <p style="font-size:13px;margin-bottom:4px;"><strong>Biggest gains</strong></p>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Query</td><td style="padding:4px 10px;">Position (last week → this week)</td><td style="padding:4px 10px;">Impressions</td></tr>
        ${moversHtml(gainers, '→')}
      </table>
      <p style="font-size:13px;margin:12px 0 4px;"><strong>Biggest drops</strong></p>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Query</td><td style="padding:4px 10px;">Position (last week → this week)</td><td style="padding:4px 10px;">Impressions</td></tr>
        ${moversHtml(losers, '→')}
      </table>

      <h3>Top Queries by Clicks</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Query</td><td style="padding:4px 10px;">Clicks</td><td style="padding:4px 10px;">Impressions</td><td style="padding:4px 10px;">CTR</td><td style="padding:4px 10px;">Avg. Position</td></tr>
        ${topQueriesHtml}
      </table>

      <p style="font-size:12px;color:#888;">Auto-generated from live GA4 (property 542463311) and Search Console (liveinoakridge.ca) data -- no AI involved in compiling these numbers. Full query and page-level data attached as CSVs.</p>
    `;

    // ---- CSV attachments ----
    const queriesCsv = toCsv(
      ['query', 'clicks', 'impressions', 'ctr', 'position', 'clicks_prior', 'impressions_prior', 'position_prior', 'position_change'],
      [...allQueryKeys].map((q) => {
        const c = queriesCur.get(q), p = queriesPri.get(q);
        return [
          q, c?.clicks ?? 0, c?.impressions ?? 0, c ? (c.ctr * 100).toFixed(2) : '', c ? c.position.toFixed(1) : '',
          p?.clicks ?? 0, p?.impressions ?? 0, p ? p.position.toFixed(1) : '',
          c && p ? (p.position - c.position).toFixed(1) : '',
        ];
      })
    );

    const allPageKeys = new Set([...pagesCurrent.values()].map((r) => normalizePath(r.dims[0])).concat([...gscPagesCur.keys()]));
    const pagesCsv = toCsv(
      ['page', 'ga4_sessions', 'ga4_sessions_prior', 'ga4_key_events', 'ga4_engagement_rate', 'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_position'],
      [...allPageKeys].map((path) => {
        const ga4c = [...pagesCurrent.values()].find((r) => normalizePath(r.dims[0]) === path);
        const ga4p = [...pagesPrior.values()].find((r) => normalizePath(r.dims[0]) === path);
        const gscc = gscPagesCur.get(path);
        return [
          path, ga4c?.metrics.sessions ?? 0, ga4p?.metrics.sessions ?? 0, ga4c?.metrics.keyEvents ?? 0,
          ga4c ? (ga4c.metrics.engagementRate * 100).toFixed(1) : '',
          gscc?.clicks ?? 0, gscc?.impressions ?? 0, gscc ? (gscc.ctr * 100).toFixed(2) : '', gscc ? gscc.position.toFixed(1) : '',
        ];
      })
    );

    const channelsCsv = toCsv(
      ['channel', 'sessions', 'users', 'pageviews', 'key_events', 'sessions_prior', 'users_prior', 'pageviews_prior', 'key_events_prior'],
      channelRows.map((r) => [r.name, r.cur.sessions, r.cur.totalUsers, r.cur.screenPageViews, r.cur.keyEvents, r.pri.sessions, r.pri.totalUsers, r.pri.screenPageViews, r.pri.keyEvents])
    );

    await sendDigestEmail(`Weekly Traffic Report — ${weekStartStr} to ${weekEndStr}`, html, [
      { filename: `traffic-queries-${weekStartStr}.csv`, content: Buffer.from(queriesCsv).toString('base64') },
      { filename: `traffic-pages-${weekStartStr}.csv`, content: Buffer.from(pagesCsv).toString('base64') },
      { filename: `traffic-channels-${weekStartStr}.csv`, content: Buffer.from(channelsCsv).toString('base64') },
    ]);

    const summary = `weekly-traffic-digest sent: ${fmtNum(totalCur.sessions)} sessions, ${fmtNum(gscCur.clicks)} GSC clicks`;
    console.log(summary);
    return new Response(summary);
  } catch (err) {
    console.error('weekly-traffic-digest failed', err);
    await sendFailureAlert(`Weekly traffic report failed to send: ${err.message}`);
    return new Response(`Failed: ${err.message}`, { status: 500 });
  }
};

export const config = {
  // Monday, 12pm UTC -- 8am Toronto during EDT (as requested). Netlify's
  // cron schedule is fixed UTC year-round and doesn't shift for daylight
  // saving, so this lands at 7am Toronto once EST returns in November --
  // same drift weekly-digest-background.mjs already has at its own time.
  schedule: '0 12 * * 1',
};
