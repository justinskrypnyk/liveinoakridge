// Scheduled job -- catches the exact failure mode found 2026-07-30: Netlify
// silently disables an outgoing form-notification webhook after enough
// delivery failures pile up, and nothing tells you it happened. That's how
// showing/info-request leads went to GHL for hours with zero visible error
// (the site itself returned 200 the whole time -- Netlify's own email
// notification is a separate hook, unaffected, so it kept firing and masked
// the problem). This just asks Netlify's API once a day whether the
// /api/ghl-lead hook is still enabled, and emails Justin directly (via
// Resend, same as the digest emails -- deliberately NOT via GHL, since GHL
// itself is what would be silently broken) if it isn't.
const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_ID = '55088671-90b8-4e17-a8f6-afe1e06fcfda';
const GHL_HOOK_URL = 'https://www.liveinoakridge.ca/api/ghl-lead';
const ALERT_TO = 'info@homeswithjustin.ca';

async function sendAlert(subject, text) {
  if (!RESEND_API_KEY) {
    console.error('ghl-webhook-health: RESEND_API_KEY missing, cannot send alert:', subject);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Live In Oakridge Alerts <onboarding@resend.dev>',
      to: [ALERT_TO],
      subject,
      text,
    }),
  });
  if (!res.ok) console.error('ghl-webhook-health: alert email failed:', res.status, await res.text().catch(() => ''));
}

export default async () => {
  if (!NETLIFY_API_TOKEN) {
    console.error('ghl-webhook-health: NETLIFY_API_TOKEN missing');
    return new Response('Missing NETLIFY_API_TOKEN', { status: 500 });
  }

  const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/hooks`, {
    headers: { Authorization: `Bearer ${NETLIFY_API_TOKEN}` },
  });
  if (!res.ok) {
    console.error('ghl-webhook-health: Netlify hooks API failed:', res.status, await res.text().catch(() => ''));
    return new Response('Netlify API call failed', { status: 502 });
  }

  const hooks = await res.json();
  const hook = hooks.find((h) => h.type === 'url' && h.event === 'submission_created' && h.data?.url === GHL_HOOK_URL);

  if (!hook) {
    await sendAlert(
      'GHL lead webhook is missing',
      `The Netlify -> GHL outgoing webhook (submission_created -> ${GHL_HOOK_URL}) no longer exists on the site at all. ` +
      `Showing/info-request leads will NOT reach GHL until it's recreated: Netlify dashboard -> Site configuration -> Forms -> Form notifications -> Add notification -> Outgoing webhook.`
    );
    console.log('ghl-webhook-health: hook missing, alert sent');
    return new Response('Hook missing, alert sent');
  }

  if (hook.disabled) {
    await sendAlert(
      'GHL lead webhook is disabled — leads are not reaching GHL',
      `Netlify disabled the outgoing webhook that forwards showing/info-request (and every other) form submission to GHL. ` +
      `This is the exact issue from 2026-07-30 -- forms still show "Message sent!" on the site and you'll still get Netlify's own email notification, but nothing reaches GHL (no contact, no tag, no push notification) until this is re-enabled.\n\n` +
      `Fix: Netlify dashboard -> Site configuration -> Forms -> Form notifications -> find the webhook to ${GHL_HOOK_URL} -> re-enable it. ` +
      `Or ask Claude to re-enable it via the Netlify API (hook id ${hook.id}).`
    );
    console.log('ghl-webhook-health: hook disabled, alert sent');
    return new Response('Hook disabled, alert sent');
  }

  console.log('ghl-webhook-health: hook enabled, all good');
  return new Response('OK');
};

export const config = {
  schedule: '0 12 * * *', // daily, 12pm UTC -- cheap single API call, once a day is enough to catch this within hours, not weeks
};
