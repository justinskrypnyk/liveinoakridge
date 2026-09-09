// Infers what the AskWidget chatbot should already know about a visitor —
// their likely intent (buying vs. selling), which neighbourhood they're
// looking at, and (for a handful of pages with a distinct enough audience)
// a specific persona that swaps in a more targeted opening line — purely
// from the URL, so most pages need zero extra wiring.
// A page with richer server-side data (e.g. a listing page that already
// resolved a real neighbourhood from lat/lng) should pass explicit
// `chatIntent`/`chatNeighbourhood` props to Base to override this guess —
// see src/pages/search/[listingKey].astro for that pattern.
import { getArea } from '@/data/areas';

export type ChatIntent = 'buyer' | 'seller';

// Personas only ever override the ENTRY greeting/options in AskWidget —
// the downstream timeline/pre-approval/seller-stage steps are already
// broadly applicable, so there's no need for a persona-specific tree past
// the first step.
export type ChatPersona = 'first-time-buyer' | 'downsizer' | 'upsizer' | 'relocation' | 'investor' | 'home-search';

export interface ChatContext {
  intent?: ChatIntent;
  neighbourhood?: string;
  persona?: ChatPersona;
}

// Downsizing/upsizing default to 'seller' -- both services are genuinely
// dual-sided (sell current + buy next), but each service page's own CTA
// and process both lead with the sale ("Sell High" / "List & Sell" before
// finding the next home), and the existing seller branch already offers
// an "Actually, I'm buying" escape hatch either way.
const SELLER_PATHS = ['/services/selling/', '/services/home-evaluation/', '/home-value-estimate/', '/services/downsizing/', '/services/upsizing/'];
const BUYER_PATHS = ['/services/buying/', '/services/first-time-buyers/', '/mortgages/', '/services/relocation/', '/services/investment/'];

// Persona lookup is separate from (and layered on top of) the intent
// lookup above -- most entries here just narrow one of the buyer/seller
// paths above to a more specific greeting. 'home-search' is the one
// exact-path entry (not a prefix) so it doesn't also match individual
// listing detail pages under /search/<listingKey>/, which already pass
// their own explicit chatIntent/chatNeighbourhood and should get the
// normal buyer flow, not a "still browsing" greeting.
const PERSONA_PATHS: [string, ChatPersona, 'prefix' | 'exact'][] = [
  ['/services/first-time-buyers/', 'first-time-buyer', 'prefix'],
  ['/services/downsizing/', 'downsizer', 'prefix'],
  ['/services/upsizing/', 'upsizer', 'prefix'],
  ['/services/relocation/', 'relocation', 'prefix'],
  ['/services/investment/', 'investor', 'prefix'],
  ['/search/', 'home-search', 'exact'],
];

export function inferChatContext(pathname: string): ChatContext {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const context: ChatContext = {};

  const areaMatch = path.match(/^\/areas\/([^/]+)\//);
  if (areaMatch) {
    const area = getArea(areaMatch[1]);
    if (area) context.neighbourhood = area.name;
  }

  if (SELLER_PATHS.some((p) => path.startsWith(p))) {
    context.intent = 'seller';
  } else if (BUYER_PATHS.some((p) => path.startsWith(p))) {
    context.intent = 'buyer';
  }

  const personaMatch = PERSONA_PATHS.find(([p, , mode]) => (mode === 'exact' ? path === p : path.startsWith(p)));
  if (personaMatch) context.persona = personaMatch[1];

  return context;
}
