// Hot-lead scoring (Justin, 2026-09-29). Turns what a lead did on the site
// before filling in a form into a simple points score with reasons in plain
// words, so Justin and his second agent know who to call first. Used by
// api/ghl-lead.ts, which adds a "Hot Lead" or "Warm Lead" tag in GHL and
// the reasons as a line on the contact note.
//
// The signals come from attribution-client.ts (the visitor's own browser,
// since 2026-09-29), so people who first visited before then score a
// little low until they browse again.

export type LeadLevel = 'Hot' | 'Warm' | 'Early';
export type LeadScore = { points: number; level: LeadLevel; reasons: string[] };

// Tunable. A showing request plus a couple of real browsing signals should
// reach Hot; a newsletter sign-up after one visit should stay Early.
const HOT_AT = 6;
const WARM_AT = 3;

/** Parses the compact `signals` field ("l=7;so=2;se=3;d=3;p=24;vt=1;sm=0"). */
export function parseSignals(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of String(raw || '').split(';')) {
    const [k, v] = part.split('=');
    const n = Number(v);
    if (k && Number.isFinite(n) && n >= 0) out[k.trim()] = Math.min(n, 10000);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function scoreLead(input: {
  formName?: string;
  subjectTag?: string;
  visits?: unknown;
  signals?: unknown;
  hasPhone?: boolean;
  chatIntent?: string;
}): LeadScore {
  const s = parseSignals(input.signals);
  const visits = Math.max(0, Number(input.visits) || 0);
  const reasons: string[] = [];
  let points = 0;
  const add = (n: number, why: string) => {
    points += n;
    reasons.push(why);
  };

  // What they asked for.
  if (input.subjectTag === 'showing-request') add(4, 'asked to see a home');
  else if (input.subjectTag === 'listing-inquiry') add(3, 'asked about a specific listing');
  else if (input.formName === 'home-value-lead') add(3, 'asked what their home is worth');
  else if (input.formName === 'save-listing') add(1, 'saved a listing');
  else if (input.formName === 'call-request') add(4, 'asked Justin to call them');
  else if (input.formName === 'similar-homes') add(1, 'asked for new homes like ones they viewed');
  if (input.chatIntent === 'Buyer' || input.chatIntent === 'Seller') add(1, `told the chat assistant they're a ${input.chatIntent.toLowerCase()}`);

  // How much real looking they've done.
  const listings = s.l || 0;
  if (listings >= 8) add(3, `opened ${listings} listings`);
  else if (listings >= 4) add(2, `opened ${listings} listings`);
  else if (listings >= 2) add(1, `opened ${listings} listings`);
  if ((s.se || 0) >= 3) add(1, `ran ${s.se} filtered searches`);
  if ((s.so || 0) >= 2 || s.sm) add(1, 'researched sold prices');
  if (s.vt && input.formName !== 'home-value-lead') add(1, 'used the home value tool');

  // Keeps coming back.
  if (visits >= 4) add(2, `${plural(visits, 'visit')} to the site`);
  else if (visits >= 2) add(1, `${plural(visits, 'visit')} to the site`);
  if ((s.d || 0) >= 3) add(1, `came back on ${s.d} different days`);

  if (input.hasPhone) add(1, 'left a phone number');

  const level: LeadLevel = points >= HOT_AT ? 'Hot' : points >= WARM_AT ? 'Warm' : 'Early';
  return { points, level, reasons };
}

/** One line for the GHL contact note. */
export function describeScore(score: LeadScore): string {
  const why = score.reasons.length ? `: ${score.reasons.join(', ')}` : ' (not much browsing before this form)';
  return `Lead score: ${score.level} (${plural(score.points, 'point')})${why}`;
}
