// "Watch my home" signup -- the Nosy Neighbour-style alert (get notified
// when something sells near your own address). Deliberately requires an
// active VOW session rather than being a public email-only form like
// save-listing/market-map-notify: the alert itself is built from real
// closed sale prices out of vow_sold_listings, and PropTx's VOW rules
// require the recipient to be a registered/authenticated VOW user for that
// data, regardless of which channel (site vs. email) delivers it.
import type { APIRoute } from 'astro';
import { getVowSession } from '@/lib/vow-session';
import { geocodeFreeformAddress } from '@/lib/ddf';
import { getServiceRoleClient } from '@/lib/supabase';

export const prerender = false;

const VALID_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = getVowSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });
  }

  let body: { address?: string; frequency?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
  }

  const address = (body.address || '').trim();
  const frequency = VALID_FREQUENCIES.has(body.frequency || '') ? body.frequency! : 'weekly';
  if (!address) {
    return new Response(JSON.stringify({ error: 'Address is required' }), { status: 400 });
  }

  const geo = await geocodeFreeformAddress(address);
  if (!geo) {
    return new Response(JSON.stringify({ error: "Couldn't find that address -- try adding the city, e.g. \"123 Oak St, London, ON\"" }), { status: 422 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone')
    .eq('id', session.userId)
    .maybeSingle();

  const { error } = await supabase.from('home_watch_subscriptions').insert({
    email: session.email,
    first_name: profile?.first_name || null,
    last_name: profile?.last_name || null,
    phone: profile?.phone || null,
    address_label: address,
    latitude: geo.lat,
    longitude: geo.lng,
    frequency,
  });

  if (error) {
    console.error('home_watch_subscriptions insert failed:', error.message);
    return new Response(JSON.stringify({ error: 'Something went wrong saving that' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
