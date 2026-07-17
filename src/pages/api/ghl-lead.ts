// Receives Netlify's "form submission" outgoing-webhook notification and
// upserts the lead into GoHighLevel as a contact. Shared by every Netlify
// form on the site (contact, home-value-lead, newsletter, save-listing...)
// — configure ONE outgoing webhook in the Netlify dashboard (Site
// configuration -> Forms -> Form notifications -> Outgoing webhook,
// applying to "all forms"), URL https://www.liveinoakridge.ca/api/ghl-lead,
// with GHL_WEBHOOK_SECRET pasted into the notification's own "JWS secret
// token" field.
//
// That field does NOT make Netlify send a plain header with the raw
// secret — it signs the request as a compact JWS (HS256) and sends that in
// `X-Webhook-Signature`, payload `{ sha256: <hex sha256 of the raw body> }`.
// verifyNetlifySignature() below re-derives that signature and the body
// hash itself; a plain string-equality check against a header (this
// endpoint's original approach) would reject every single real request.
import type { APIRoute } from 'astro';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const prerender = false;

const GHL_API_TOKEN = import.meta.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = import.meta.env.GHL_LOCATION_ID;
const WEBHOOK_SECRET = import.meta.env.GHL_WEBHOOK_SECRET;

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifyNetlifySignature(signatureHeader: string, secret: string, rawBody: string): boolean {
  const parts = signatureHeader.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  const expectedSig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const actualSig = base64UrlDecode(signatureB64);
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) return false;

  let payload: { sha256?: string };
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8'));
  } catch {
    return false;
  }
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  return payload.sha256 === bodyHash;
}

export const POST: APIRoute = async ({ request }) => {
  if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
    console.error('GHL env vars missing');
    return new Response('Not configured', { status: 500 });
  }

  const rawBody = await request.text();

  if (WEBHOOK_SECRET) {
    const signatureHeader = request.headers.get('x-webhook-signature');
    if (!signatureHeader || !verifyNetlifySignature(signatureHeader, WEBHOOK_SECRET, rawBody)) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Netlify's outgoing-webhook notification wraps the submission in `payload`;
  // other trigger paths (e.g. a named submission-created function) send the
  // same shape unwrapped. Handle both rather than assuming one.
  const submission = body.payload ?? body;
  const data = submission.data ?? {};

  const email = data.email;
  if (!email) {
    return new Response('Missing email', { status: 400 });
  }

  // Different forms on the site split the name differently — ContactForm
  // uses first-name/last-name, home-value-estimate uses a single `name`
  // field. Handle both rather than assuming one shape.
  const firstName = data['first-name'] || '';
  const lastName = data['last-name'] || '';
  const splitName = [firstName, lastName].filter(Boolean).join(' ');
  const fullName = splitName || data.name || '';

  // The "save listing" heart on /search/ and /properties/ posts the same
  // shape as every other form here, plus property-address/mls-number — give
  // those leads a distinct, filterable tag. Per Justin: keep the contact
  // record itself to name/email/phone, and put the property/MLS context plus
  // whatever the person typed in the message/comment as a note on the
  // contact instead — simpler than guessing at custom-field IDs that may not
  // exist in his GHL account, and easier to actually read.
  const propertyAddress = data['property-address'];
  const mlsNumber = data['mls-number'];
  const FORM_TAG_LABELS: Record<string, string> = {
    'save-listing': 'Saved Listing Lead',
  };

  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${GHL_API_TOKEN}`,
    Version: '2021-07-28',
  };

  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      name: fullName || undefined,
      email,
      phone: data.phone || undefined,
      locationId: GHL_LOCATION_ID,
      // form_name tags each lead by which form sent it (e.g. "home-value-lead",
      // "newsletter", "contact") so they're segmentable in GHL; data.service
      // adds the "I'm interested in..." selection from the contact form;
      // FORM_TAG_LABELS adds a friendlier, distinctly-filterable tag for
      // forms that want one (e.g. "Saved Listing Lead").
      tags: ['website-lead', submission.form_name, FORM_TAG_LABELS[submission.form_name], data.service].filter(Boolean),
      source: `Website — ${data.subject || submission.form_name || 'Contact Form'}`,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('GHL upsert failed:', res.status, errText);
    return new Response('GHL upsert failed', { status: 502 });
  }

  // Property/MLS context (save-listing) and the free-text message/comment
  // (any form with one) go on the contact as a note rather than jammed into
  // `source` or a tag. A note failure shouldn't fail the whole request — the
  // contact itself is already saved at this point.
  const noteLines = [
    propertyAddress && `Property: ${propertyAddress}`,
    mlsNumber && `MLS®: ${mlsNumber}`,
    data.message,
  ].filter(Boolean);

  if (noteLines.length > 0) {
    try {
      const upserted = await res.json();
      const contactId = upserted?.contact?.id;
      if (contactId) {
        const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ body: noteLines.join('\n') }),
        });
        if (!noteRes.ok) {
          console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));
        }
      }
    } catch (err) {
      console.error('GHL note failed:', err);
    }
  }

  return new Response('OK', { status: 200 });
};
