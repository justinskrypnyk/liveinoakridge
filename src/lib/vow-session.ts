// VOW session handling -- a deliberately minimal signed cookie rather than
// wiring up @supabase/ssr's full cookie-refresh dance. Magic-link auth
// delivers tokens as a URL fragment (never sent to the server), so the
// callback page verifies the token client-side-received-then-posted once
// (see /vow/callback.astro + /api/vow/session.json.ts), and from then on
// this signed cookie IS the session -- no repeated round-trips to Supabase
// Auth on every request. Sessions are long-lived (90 days); re-auth is just
// clicking another magic link, so there's no meaningful cost to that.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const COOKIE_NAME = 'vow_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export interface VowSession {
  userId: string;
  email: string;
}

function secret(): string {
  const s = import.meta.env.VOW_SESSION_SECRET;
  if (!s) throw new Error('VOW_SESSION_SECRET is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSessionCookieValue(session: VowSession): string {
  const payload = JSON.stringify({ ...session, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const encoded = Buffer.from(payload).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function setVowSessionCookie(cookies: AstroCookies, session: VowSession): void {
  cookies.set(COOKIE_NAME, createSessionCookieValue(session), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearVowSessionCookie(cookies: AstroCookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

/** Verifies the signed cookie and returns the session, or null if absent/invalid/expired. */
export function getVowSession(cookies: AstroCookies): VowSession | null {
  const raw = cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [encoded, sig] = raw.split('.');
  if (!encoded || !sig) return null;

  const expectedSig = sign(encoded);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}
