// "Notify me about homes like this" on /search -- captures the visitor's
// current filter criteria (area/price/type/beds) tied to their email, so
// saved-search-alerts-background.mjs can email new matching active listings
// going forward. Public (no VOW session needed): active/DDF listing data,
// same public feed /search already shows to anyone.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500 });
  }

  const propertyTypes = Array.isArray(body.propertyTypes)
    ? body.propertyTypes.filter((t: unknown) => typeof t === 'string')
    : [];

  const { error } = await supabase.from('saved_searches').insert({
    email,
    first_name: typeof body.firstName === 'string' ? body.firstName.trim() || null : null,
    last_name: typeof body.lastName === 'string' ? body.lastName.trim() || null : null,
    phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
    area_slug: typeof body.area === 'string' ? body.area.trim() || null : null,
    min_price: Number(body.minPrice) || null,
    max_price: Number(body.maxPrice) || null,
    property_types: propertyTypes.length > 0 ? propertyTypes : null,
    min_beds: Number(body.minBeds) || null,
    min_baths: Number(body.minBaths) || null,
    frequency: ['daily', 'weekly', 'monthly'].includes(body.frequency) ? body.frequency : 'weekly',
  });

  if (error) {
    console.error('saved_searches insert failed:', error.message);
    return new Response(JSON.stringify({ error: 'Something went wrong saving that' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
