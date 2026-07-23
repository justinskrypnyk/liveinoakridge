// Sends a Supabase Auth magic link -- server-side, using the service-role
// client (no anon/publishable key needed at all for this flow). Name/phone
// are carried in the OTP call's user_metadata so /api/vow/session.json.ts
// can copy them into profiles once the user actually verifies the link
// (rather than writing a profiles row for an email that never confirms).
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';
import { SITE } from '@/data/site';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const termsAccepted = body?.termsAccepted === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'A valid email is required.' }), { status: 400 });
  }
  if (!fullName) {
    return new Response(JSON.stringify({ error: 'Name is required.' }), { status: 400 });
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
      data: { full_name: fullName, phone, terms_accepted_at: new Date().toISOString() },
    },
  });

  if (error) {
    console.error('vow request-link failed:', error.message);
    return new Response(JSON.stringify({ error: 'Could not send sign-in link. Please try again.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
