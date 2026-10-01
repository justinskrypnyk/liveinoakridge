// Netlify cron runs on UTC with no daylight saving, so a job meant for 7:00
// in London is scheduled at BOTH UTC hours it can fall on (11:00 in summer,
// 12:00 in winter) and calls this first: the run at the wrong local hour
// skips itself. Justin's times (2026-10-01): Full Month Review 7:00, blog
// numbers email 7:15, London Letter draft 7:30, mid-month report 7:45.
//
// Manual runs always go ahead: anything sent with ?run_now=true or a body
// carrying its own options (dryRun, test, branch, preview, publish...).
// Scheduled invocations only ever carry Netlify's {"next_run": ...}.

export function londonHour(date = new Date()) {
  return Number(date.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hourCycle: 'h23' }));
}

/** True when this is a scheduled run that fired at the wrong London hour and should exit. */
export async function wrongLondonHour(req, hour) {
  try {
    if (req && new URL(req.url).searchParams.get('run_now') === 'true') return false;
  } catch {
    // no usable URL -- treat as scheduled
  }
  let body = null;
  try {
    body = await req?.clone?.().json();
  } catch {
    // no body
  }
  if (body && Object.keys(body).some((k) => k !== 'next_run')) return false;
  return londonHour() !== hour;
}
