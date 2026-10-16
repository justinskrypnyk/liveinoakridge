// Monthly "where the money is going" email to Justin (2026-10-15): big City
// permits and planning files per neighbourhood, our 7 areas first, then the
// rest of London. Logic in src/lib/neighbourhood-activity.mjs.
//
// Manual run: ?run_now=true. A JSON body {"dryRun": true} builds it without
// sending or saving.
import { getStore } from '@netlify/blobs';
import { wrongLondonHour } from '../../src/lib/london-time.mjs';
import { runNeighbourhoodReport } from '../../src/lib/neighbourhood-activity.mjs';

export default async (req) => {
  if (await wrongLondonHour(req, 8)) return;
  let body = {};
  try {
    body = (await req.clone().json()) || {};
  } catch {
    // scheduled runs carry no usable body
  }
  try {
    const out = await runNeighbourhoodReport({ getStore, dryRun: body.dryRun === true });
    console.log('neighbourhood-activity:', out.subject, out.newReportWaiting ? `(new City report waiting: ${out.newReportWaiting})` : '');
  } catch (err) {
    console.error('neighbourhood-activity failed:', err);
    throw err;
  }
};

export const config = {
  // 8:00 a.m. London on the 6th, after the 7:00-7:30 monthly reports (see src/lib/london-time.mjs)
  schedule: '0 12,13 6 * *',
};
