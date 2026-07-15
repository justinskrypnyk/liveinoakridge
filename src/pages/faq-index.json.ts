import type { APIRoute } from 'astro';
import { FAQ_INDEX } from '@/data/faq-index';

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(FAQ_INDEX), {
    headers: { 'Content-Type': 'application/json' },
  });
};
