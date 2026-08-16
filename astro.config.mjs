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
    // Moves GA4 (gtag.js) and the Meta Pixel (fbevents.js) off the main
    // thread into a web worker -- both are third-party marketing scripts
    // with no site-authored JS anywhere near their size, and were the
    // measured source of ~238ms Total Blocking Time on the homepage
    // (2026-08-16 GTmetrix audit). `forward` lists every global function
    // main-thread code calls on these scripts, so Partytown proxies those
    // calls into the worker instead of dropping them: `gtag`/`dataLayer.push`
    // are called directly from Base.astro's tel: click listener and
    // ContactForm/MarketTicker/newsletter success handlers (see
    // `window.gtag?.('event', 'generate_lead', ...)` in those files); `fbq`
    // is only called from the Meta Pixel snippet itself but is forwarded
    // for the same reason should that change.
    partytown({
      config: {
        forward: ['dataLayer.push', 'gtag', 'fbq'],
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
