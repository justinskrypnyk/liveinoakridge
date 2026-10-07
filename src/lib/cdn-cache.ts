// Server-rendered public pages (area pages, listing pages, /properties/,
// /market-map/, /market-faq/) used to run the function on every visit, and a
// cold instance re-fetches the MLS feed first: real visitors waited 6-9s on
// area pages and up to ~30s on listing pages (in-house heatmap speed
// readings, 2026-10-06; /areas/oakridge/ measured 6.6s TTFB cold, 0.4s warm).
//
// This lets Netlify's CDN keep the rendered HTML for 10 minutes and, after
// that, keep serving it instantly for up to a day while it re-renders in the
// background (stale-while-revalidate), so no visitor waits on a cold
// function. Every deploy clears it. Never use it on a page that reads
// cookies or shows anything per visitor (the VOW sold-map pages).
export const PUBLIC_PAGE_CDN_CACHE = 'public, durable, s-maxage=600, stale-while-revalidate=86400';

export function cachePublicPage(headers: Headers) {
  headers.set('Netlify-CDN-Cache-Control', PUBLIC_PAGE_CDN_CACHE);
}
