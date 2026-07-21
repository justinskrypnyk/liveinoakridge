// Scheduled job — pings IndexNow (Bing/Yandex; Google doesn't support the
// protocol, so GSC's own "request indexing" is still needed there) with the
// site's full current sitemap URL list. Runs daily rather than diffing what
// changed since last run: the sitemap is small (~80 URLs) and IndexNow
// tolerates re-submitting unchanged URLs, so this stays simple and never
// misses a newly published page waiting on manual submission.
//
// The key file at /INDEXNOW_KEY.txt is the required ownership proof --
// IndexNow fetches it to confirm this host authorized the submission. It's
// a public verification token, not a secret, so it's safe to inline here
// rather than pull from env.
const INDEXNOW_KEY = '14a408b455c582c5ff30b939d948e864';
const HOST = 'www.liveinoakridge.ca';
const SITEMAP_INDEX_URL = `https://${HOST}/sitemap-index.xml`;

async function fetchLocs(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

export default async () => {
  const childSitemaps = await fetchLocs(SITEMAP_INDEX_URL);
  const urlLists = await Promise.all(childSitemaps.map(fetchLocs));
  const urlList = urlLists.flat();

  if (urlList.length === 0) {
    return new Response('indexnow-submit: sitemap returned no URLs, skipping', { status: 500 });
  }

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  });

  const summary = `indexnow-submit: submitted ${urlList.length} URLs, IndexNow responded ${res.status}`;
  console.log(summary);
  // 200/202 = accepted. Non-2xx logged but not fatal -- next day's run retries.
  return new Response(summary, { status: res.ok ? 200 : 502 });
};

export const config = {
  schedule: '30 9 * * *', // daily, shortly after the 9am UTC heat-map-snapshot job
};
