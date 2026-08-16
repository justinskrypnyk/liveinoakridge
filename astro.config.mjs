import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@astrojs/netlify';
import partytown from '@astrojs/partytown';

export default defineConfig({
  site: 'https://www.liveinoakridge.ca',
  // Static by default (fast, cheap). /properties/ and /properties/[listingKey]/
  // opt out via `export const prerender = false` to fetch live DDF listing data
  // on-demand instead of baking it into the build — keeps listings current
  // without spending Netlify build minutes on scheduled rebuilds.
  output: 'static',
  adapter: netlify(),
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      customPages: [],
    }),
    mdx(),
    // Moves GA4 (gtag.js) off the main thread into a web worker -- a
    // third-party marketing script with no site-authored JS anywhere near
    // its size, and (alongside the Meta Pixel) the measured source of
    // ~238ms Total Blocking Time on the homepage (2026-08-16 GTmetrix
    // audit). `forward` lists every global function main-thread code calls
    // on it, so Partytown proxies those calls into the worker instead of
    // dropping them: `gtag`/`dataLayer.push` are called directly from
    // Base.astro's tel: click listener and ContactForm/MarketTicker/
    // newsletter success handlers (see `window.gtag?.('event',
    // 'generate_lead', ...)` in those files).
    //
    // The Meta Pixel is deliberately NOT routed through Partytown -- see the
    // comment above its script tag in Base.astro for why (a real CORS
    // failure on its tracking beacon, confirmed 2026-08-16).
    partytown({
      config: {
        forward: ['dataLayer.push', 'gtag'],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
});
