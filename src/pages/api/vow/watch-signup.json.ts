// Combined VOW registration + "watch my home" signup for public,
// not-yet-VOW-registered visitors (the /search page popup -- see
// WatchNearbyModal.astro). Unlike api/vow/watch-address.json.ts, which
// requires an existing VOW session, this is the entry point for someone who
// isn't registered yet: it geocodes the address up front (so a bad address
// fails before we ever send an email), then sends the same magic-link OTP
// as request-link.json.ts, carrying the pending watch address/coordinates
// in the OTP's user_metadata. api/vow/session.json.ts reads that metadata
// on confirmation and creates the home_watch_subscriptions row there --
// PropTx's VOW rules still require the registered/authenticated step, this
// just collapses "register" and "watch this address" into one form instead
// of two.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';
import { geocodeFreeformAddress } from '@/lib/ddf';
import { SITE } from '@/data/site';
import { pushRecommendationToGhl } from '@/lib/ghl-recommend';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  const termsAccepted = body?.termsAccepted === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'A valid email is required.' }), { status: 400 });
  }
  if (!firstName || !lastName) {
    return new Response(JSON.stringify({ error: 'First and last name are required.' }), { status: 400 });
  }
  if (!address) {
    return new Response(JSON.stringify({ error: 'An address is required.' }), { status: 400 });
  }
  if (!termsAccepted) {
    return new Response(JSON.stringify({ error: 'You must accept the terms of use to continue.' }), { status: 400 });
  }

  const geo = await geocodeFreeformAddress(address);
  if (!geo) {
    return new Response(JSON.stringify({ error: "Couldn't find that address -- try adding the city, e.g. \"123 Oak St, London, ON\"" }), { status: 422 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Sign-in is not configured right now.' }), { status: 500 });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${SITE.url}/vow/callback/`,
      data: {
        first_name: firstName,
        last_name: lastName,
        phone,
        terms_accepted_at: new Date().toISOString(),
        watch_address: address,
        watch_lat: geo.lat,
        watch_lng: geo.lng,
        watch_frequency: 'weekly',
      },
    },
  });

  if (error) {
    console.error('vow watch-signup failed:', error.message);
    return new Response(JSON.stringify({ error: 'Could not send sign-in link. Please try again.' }), { status: 500 });
  }

  await pushRecommendationToGhl({
    email,
    firstName,
    lastName,
    phone,
    tag: 'vow-signup',
    intro: `New "Watch a home near you" signup for ${address}`,
  });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
