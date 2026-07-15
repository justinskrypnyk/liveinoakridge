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
      customPages: [],
    }),
    mdx(),
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
