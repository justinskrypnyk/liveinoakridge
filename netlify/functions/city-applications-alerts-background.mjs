// Daily email to Justin when the City of London opens or updates a planning
// application (rezoning, site plan, subdivision, condo, severance...) inside
// our 7 areas (Justin, 2026-10-15). Quiet on days with nothing new. All the
// logic is runCityApplications() in src/lib/city-applications.mjs.
//
// Also the daily check for a new quarterly City permit report: Justin gets a
// loud "ACTION NEEDED ... tell Claude 'load it'" email the day one appears,
// repeated weekly until it's loaded (remindNewPermitReport).
//
// Manual run: ?run_now=true. A JSON body {"dryRun": true} returns the email
// without sending or saving state.
import { getStore } from '@netlify/blobs';
import { wrongLondonHour } from '../../src/lib/london-time.mjs';
import { runCityApplications } from '../../src/lib/city-applications.mjs';
import { remindNewPermitReport } from '../../src/lib/neighbourhood-activity.mjs';

export default async (req) => {
  if (await wrongLondonHour(req, 7)) return;
  let body = {};
  try {
    body = (await req.clone().json()) || {};
  } catch {
    // scheduled runs carry no usable body
  }
  // Separate from the planning run so a failure in one never skips the other.
  try {
    const r = await remindNewPermitReport({ getStore, dryRun: body.dryRun === true });
    console.log('permit-report-reminder:', JSON.stringify({ waiting: r.waiting, loaded: r.loaded, sent: r.sent ?? false }));
  } catch (err) {
    console.error('permit-report-reminder failed:', err);
  }
  try {
    const out = await runCityApplications({ getStore, dryRun: body.dryRun === true });
    const { email, ...summary } = out;
    console.log('city-applications:', JSON.stringify({ ...summary, subject: email?.subject ?? null }));
  } catch (err) {
    console.error('city-applications failed:', err);
    throw err;
  }
};

export const config = {
  schedule: '0 11,12 * * *', // 7:00 a.m. London daily (see src/lib/london-time.mjs)
};
