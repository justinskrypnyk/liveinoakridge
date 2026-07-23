import type { APIRoute } from 'astro';
import { clearVowSessionCookie } from '@/lib/vow-session';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  clearVowSessionCookie(cookies);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
