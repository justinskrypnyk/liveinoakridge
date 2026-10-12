// Weekly "your competition" reports for the listings Justin ticked on
// /admin/my-listings/ (Justin, 2026-10-12). One email per listing, to Justin
// only ("you first, then forward"), Tuesday mornings after the 12:30 UTC comps
// index rebuild. All the logic, including sending, is runListingWatch() in
// src/lib/listing-watch.mjs, shared with the admin page's "Send now" button
// (scheduled functions can't be called by URL).
//
// Blobs (store `listing-watch`):
//   list           { listings: [{ k, a, seller, addedAt }] } -- written by the admin page
//   state/<key>    the competing set as of the last report, for "what changed"
//   chapman-seen   Chapman listing keys already in the "any of these yours?"
//                  reminder, so each new one is mentioned once
import { getStore } from '@netlify/blobs';
import { runListingWatch } from '../../src/lib/listing-watch.mjs';

export default async () => {
  try {
    const out = await runListingWatch({ getStore });
    console.log('listing-watch:', JSON.stringify(out.results.map((r) => r.subject || r.skipped || r.reminder)));
  } catch (err) {
    console.error('listing-watch failed:', err);
    throw err;
  }
};

export const config = {
  // Tuesdays 13:00 UTC (Justin, 2026-10-12): 9am Toronto in summer time, 8am in winter. The comps
  // index rebuilds daily at 12:30 UTC.
  schedule: '0 13 * * 2',
};
