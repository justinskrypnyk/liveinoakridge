// Verifies a Supabase Auth access token (received from the magic-link
// callback's URL fragment -- see /vow/callback.astro, which is why this has
// to be a POST from client JS rather than something the callback page's own
// server-side render could handle: fragments never reach the server) and
// mints this site's own signed session cookie (src/lib/vow-session.ts).
// Also upserts the profiles row here, on first successful verification --
// not at request-link time -- so a profiles row only ever exists for an
// email that actually confirmed ownership.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';
import { setVowSessionCookie } from '@/lib/vow-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'Missing access token.' }), { status: 400 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Sign-in is not configured right now.' }), { status: 500 });
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'That sign-in link is invalid or expired.' }), { status: 401 });
  }

  const user = data.user;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: typeof meta.full_name === 'string' ? meta.full_name : null,
      phone: typeof meta.phone === 'string' ? meta.phone : null,
      terms_accepted_at: typeof meta.terms_accepted_at === 'string' ? meta.terms_accepted_at : new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (upsertError) {
    console.error('vow session: profile upsert failed:', upsertError.message);
    // Not fatal to the login itself -- the session below still gets set.
  }

  setVowSessionCookie(cookies, { userId: user.id, email: user.email ?? '' });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
