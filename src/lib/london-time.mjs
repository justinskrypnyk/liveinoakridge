// Netlify cron runs on UTC with no daylight saving, so a job meant for 7:00
// in London is scheduled at BOTH UTC hours it can fall on (11:00 in summer,
// 12:00 in winter) and calls this first: the run at the wrong local hour
// skips itself. Justin's times (2026-10-01): Full Month Review 7:00, blog
// numbers email 7:15, London Letter draft 7:30 -- all on the 6th since
// 2026-10-02, once late-reported sales are in -- and mid-month report 7:45
// on the 16th.
//
// Manual runs always go ahead: anything sent with ?run_now=true or a body
// carrying its own options (dryRun, test, branch, preview, publish...).
// Scheduled invocations only ever carry Netlify's {"next_run": ...}.

export function londonHour(date = new Date()) {
  return Number(date.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hourCycle: 'h23' }));
}

async function isManualRun(req) {
  try {
    if (req && new URL(req.url).searchParams.get('run_now') === 'true') return true;
  } catch {
    // no usable URL -- treat as scheduled
  }
  let body = null;
  try {
    body = await req?.clone?.().json();
  } catch {
    // no body
  }
  return Boolean(body && Object.keys(body).some((k) => k !== 'next_run'));
}

/** True when this is a scheduled run that fired at the wrong London hour and should exit. */
export async function wrongLondonHour(req, hour) {
  if (await isManualRun(req)) return false;
  return londonHour() !== hour;
}

// The move to the 6th went live in October 2026, after September had already
// gone out on the 1st -- so the first scheduled 6th-of-month send is Nov 6
// (October). Without this, Oct 6 would re-send September's reports.
export const SIXTH_OF_MONTH_SENDS_START = '2026-11-01';

/** True for a scheduled run before the first 6th-of-month send (manual runs always go ahead). */
export async function beforeSixthOfMonthStart(req) {
  if (await isManualRun(req)) return false;
  return new Date().toISOString().slice(0, 10) < SIXTH_OF_MONTH_SENDS_START;
}
