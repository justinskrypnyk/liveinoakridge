// Sends a Supabase Auth magic link -- server-side, using the service-role
// client (no anon/publishable key needed at all for this flow). Name/phone
// are carried in the OTP call's user_metadata so /api/vow/session.json.ts
// can copy them into profiles once the user actually verifies the link
// (rather than writing a profiles row for an email that never confirms).
// Also pushes the registrant into GHL immediately (not gated on email
// confirmation) so Justin sees every VOW signup attempt as a lead, same as
// the site's other lead-capture forms.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';
import { SITE } from '@/data/site';
import { pushRecommendationToGhl } from '@/lib/ghl-recommend';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const termsAccepted = body?.termsAccepted === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'A valid email is required.' }), { status: 400 });
  }
  if (!firstName || !lastName) {
    return new Response(JSON.stringify({ error: 'First and last name are required.' }), { status: 400 });
  }
  if (!termsAccepted) {
    return new Response(JSON.stringify({ error: 'You must accept the terms of use to continue.' }), { status: 400 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Sign-in is not configured right now.' }), { status: 500 });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${SITE.url}/vow/callback/`,
      data: { first_name: firstName, last_name: lastName, phone, terms_accepted_at: new Date().toISOString() },
    },
  });

  if (error) {
    console.error('vow request-link failed:', error.message);
    return new Response(JSON.stringify({ error: 'Could not send sign-in link. Please try again.' }), { status: 500 });
  }

  await pushRecommendationToGhl({
    email,
    firstName,
    lastName,
    phone,
    tag: 'vow-signup',
    intro: 'New sold-price data (VOW) registration',
  });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
