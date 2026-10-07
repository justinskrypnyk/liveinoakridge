// Netlify runs a function with this exact name automatically whenever a
// deploy goes live. Production only: kick off warm-pages-background so real
// visitors never get the cold, cache-cleared first render.
export default async (req) => {
  const body = await req.json().catch(() => null);
  const context = body?.payload?.context;
  if (context && context !== 'production') return new Response(`skip: ${context} deploy`);
  const res = await fetch('https://www.liveinoakridge.ca/.netlify/functions/warm-pages-background', { method: 'POST' });
  console.log(`deploy-succeeded: warm-pages-background -> ${res.status}`);
  return new Response('ok');
};
