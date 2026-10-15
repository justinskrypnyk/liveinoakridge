import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@astrojs/netlify';

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
      // /areas/[area]/ is server-rendered (live listings), and the sitemap
      // plugin skips dynamic server routes, so list the area hubs by hand.
      // Keep in sync with the slugs in src/data/areas.ts.
      customPages: ['byron', 'westmount', 'riverbend', 'lambeth', 'whitehills', 'west-london']
        .map((slug) => `https://www.liveinoakridge.ca/areas/${slug}/`),
      // Drop admin, the sign-in redirect page, and the noindex legal pages.
      filter: (page) => !/\/(admin|vow\/callback|privacy-policy|terms-of-use)\//.test(page),
    }),
    mdx(),
    // Partytown (GA4 off the main thread, ~238ms TBT win) was removed
    // 2026-08-30 -- it silently ate every GA4 hit for two weeks (see the
    // comment on the GA4 script tags in Base.astro). Meta Pixel was already
    // main-thread only for the same class of bug. Revisit only with a way
    // to confirm hits actually reach google-analytics.com under Partytown.
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
