export interface ServiceFaq {
  q: string;
  a: string;
}

export interface Service {
  slug: string;
  name: string;
  shortName: string;
  icon: string;
  headline: string;
  description: string;
  longDescription: string;
  benefits: string[];
  process: { step: string; title: string; body: string }[];
  image: string;
  imageAlt: string;
  metaTitle: string;
  metaDescription: string;
  ctaText: string;
  faqs: ServiceFaq[];
}

export const SERVICES: Service[] = [
  {
    slug: 'buying',
    name: 'Buying a Home',
    shortName: 'Buying',
    icon: '🏡',
    headline: 'Find Your Perfect Home in West London',
    description:
      'Whether it\'s your first home or your fifth, Justin guides you through every step of the buying process with local expertise and zero pressure.',
    longDescription:
      'Buying a home in London Ontario is one of the biggest financial decisions you\'ll ever make. With Justin Skrypnyk as your Real Estate Broker, you get a knowledgeable advocate who understands the West London market inside and out — from Oakridge to Byron to Komoka. Justin\'s approach is straightforward: listen first, advise second, and never push you toward a decision that isn\'t right for you.',
    benefits: [
      'Deep knowledge of West London\'s neighbourhoods and micro-markets',
      'Access to MLS® listings before they hit the public portals',
      'Negotiation expertise that protects your budget',
      'Trusted network of inspectors, lawyers, and mortgage professionals',
      'Zero-pressure approach — we move at your pace',
    ],
    process: [
      { step: '01', title: 'Discovery Call', body: 'We learn about your must-haves, timeline, and budget — no forms, just a conversation.' },
      { step: '02', title: 'Pre-Approval', body: 'We connect you with a trusted mortgage professional to confirm your purchasing power.' },
      { step: '03', title: 'Home Search', body: 'You receive curated listings matched to your criteria, including off-market opportunities.' },
      { step: '04', title: 'Viewings & Offers', body: 'We tour homes together, evaluate value, and craft a competitive, strategic offer.' },
      { step: '05', title: 'Conditions & Close', body: 'Home inspection, financing confirmation, and title search — we manage every detail.' },
      { step: '06', title: 'Welcome Home', body: 'Keys in hand. Justin is still available after closing for any questions or referrals.' },
    ],
    image: '/images/services/buying-home-london-ontario.webp',
    imageAlt: 'Happy couple receiving keys to their new home in London Ontario',
    metaTitle: 'Buy a Home in London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Ready to buy a home in London Ontario? Justin Skrypnyk helps buyers find the right home in Oakridge, Byron, Westmount, Lambeth, and beyond. Start your search today.',
    ctaText: 'Start Your Home Search',
    faqs: [
      {
        q: 'Do I need a real estate agent to buy a house in London Ontario?',
        a: 'You are not legally required to use a real estate professional to buy a home in Ontario, but in practice buyers almost always benefit from representation. In London Ontario, buyer representation is at no direct cost to you — the seller\'s brokerage compensates the buyer\'s broker through co-operating commission. Working with a local expert gives you access to MLS® listings before they hit public portals, negotiation expertise, and guidance through conditions, inspections, and closing.',
      },
      {
        q: 'How long does it take to buy a home in London Ontario?',
        a: 'The timeline depends on your situation. Once pre-approved, most buyers find a home within 2 to 8 weeks in a typical London Ontario market. Once an offer is accepted, closing typically takes 30 to 90 days. The full process from initial search to keys is commonly 2 to 4 months, though motivated buyers in a hot market can move faster.',
      },
      {
        q: 'What is the best area to buy a home in London Ontario?',
        a: 'The best area depends on your budget, lifestyle, and commute. Oakridge and Byron are consistently top choices for families wanting established west-end communities. Hyde Park and Sunningdale offer newer construction for families. Westmount and Medway offer strong value near Western University. Downtown London has a growing condo market for urban lifestyle buyers. Justin helps narrow this down based on your specific priorities.',
      },
      {
        q: 'How much do I need for a down payment to buy a home in London Ontario?',
        a: 'In Canada, the minimum down payment is 5% on homes up to $500,000, and 5% on the first $500,000 plus 10% on the portion above $500,000 up to $999,999. For homes $1 million and above, the minimum is 20%. In London Ontario, where average home prices are in the $625,000 to $660,000 range, most buyers need at least 5–10% down plus closing costs.',
      },
    ],
  },
  {
    slug: 'selling',
    name: 'Selling Your Home',
    shortName: 'Selling',
    icon: '📈',
    headline: 'Sell Faster, Sell Higher in West London',
    description:
      'Strategic pricing, professional marketing, and relentless negotiation — Justin delivers results that outperform the London Ontario average.',
    longDescription:
      'Selling your home in London Ontario requires more than just putting a sign on the lawn. Justin Skrypnyk delivers a full-service listing experience: professional photography, targeted digital marketing, strategic pricing based on real local data, and an active open house strategy that generates buzz and competition. Justin\'s negotiation skills protect your equity and get you to the closing table with confidence.',
    benefits: [
      'Accurate pricing strategy built on hyper-local market data',
      'Professional photography, virtual tour, and floor plans included',
      'Social media and digital marketing to reach qualified buyers',
      'Staging consultation at no extra cost',
      'Active communication — you\'re never left wondering',
    ],
    process: [
      { step: '01', title: 'Complimentary Home Evaluation', body: 'Justin visits your home and provides a detailed, data-backed market value analysis.' },
      { step: '02', title: 'Listing Prep', body: 'Staging advice, professional photography, floor plans, and all marketing materials produced.' },
      { step: '03', title: 'Strategic Launch', body: 'Your home goes live on MLS®, Realtor.ca, and targeted social and digital channels.' },
      { step: '04', title: 'Showings & Open Houses', body: 'Justin manages all showings and open houses, maximizing buyer exposure.' },
      { step: '05', title: 'Offer Review', body: 'Multiple offers? We review together and negotiate the best possible price and terms.' },
      { step: '06', title: 'Smooth Closing', body: 'Justin coordinates lawyers, lenders, and buyers to ensure a seamless closing day.' },
    ],
    image: '/images/services/selling-home-london-ontario.webp',
    imageAlt: 'Sold real estate sign in front of a West London Ontario home',
    metaTitle: 'Sell Your Home in London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Selling your home in London Ontario? Get a complimentary evaluation from Justin Skrypnyk. Expert pricing, professional marketing, and top-dollar results in Oakridge and West London.',
    ctaText: 'Get a Complimentary Home Evaluation',
    faqs: [
      {
        q: 'How long does it take to sell a house in London Ontario?',
        a: 'In the current London Ontario market, well-priced homes in desirable west-end areas are selling in 14 to 21 days on average. Overpriced listings sit significantly longer. Once a firm deal is reached, closing typically takes 30 to 90 days. The total timeline from listing to keys-in-hand is most commonly 45 to 90 days.',
      },
      {
        q: 'What is the best time of year to sell a house in London Ontario?',
        a: 'Spring (March through May) is consistently London Ontario\'s most active selling period — highest buyer competition, most showings, and fastest sales. Fall (September through October) is the second strongest window. Summer and winter are slower but still active markets. The honest answer is that the best time to sell is when you are properly prepared and priced accurately.',
      },
      {
        q: 'How much commission does a real estate broker charge to sell a home in London Ontario?',
        a: 'Real estate commissions in Ontario are negotiable and vary by brokerage. Justin Skrypnyk provides a full-service listing experience — professional photography, virtual tour, staging consultation, MLS® and digital marketing — and will discuss his fee structure transparently during your complimentary home evaluation consultation. There is no obligation.',
      },
      {
        q: 'Should I do renovations before selling my home in London Ontario?',
        a: 'Not necessarily. In most cases, cosmetic improvements (fresh paint, clean landscaping, decluttering) offer the best return relative to cost. Major renovations rarely recoup their full investment at sale. Justin will advise during your complimentary home evaluation which specific improvements — if any — are worth completing before listing, based on your neighbourhood, price point, and buyer expectations.',
      },
    ],
  },
  {
    slug: 'home-evaluation',
    name: 'Complimentary Home Evaluation',
    shortName: 'Home Evaluation',
    icon: '📋',
    headline: 'Find Out What Your Home Is Worth — For Free',
    description:
      'Get an accurate, no-obligation home valuation from a Real Estate Broker who knows your street, your neighbourhood, and your market.',
    longDescription:
      'Your home\'s market value isn\'t just a number pulled from an algorithm — it\'s shaped by your specific street, your home\'s condition, recent comparable sales, and current buyer demand. Justin Skrypnyk provides complimentary home evaluations for London Ontario homeowners. Whether you\'re thinking of selling this spring or simply curious about your equity position, Justin gives you real numbers you can act on.',
    benefits: [
      'Complimentary — no obligation, no pressure',
      'Hyper-local data from your specific street and neighbourhood',
      'Honest assessment, not an inflated number to win your listing',
      'Written report with comparable sales you can review',
      'Available for all West London neighbourhoods',
    ],
    process: [
      { step: '01', title: 'Book Online or Call', body: 'Choose a time that works for you — Justin comes to your home.' },
      { step: '02', title: 'Walk-Through', body: 'Justin tours your home, noting features, condition, and recent improvements.' },
      { step: '03', title: 'Market Analysis', body: 'Comparable sales, active listings, and current demand are analyzed for your area.' },
      { step: '04', title: 'Your Report', body: 'You receive a clear, written valuation with supporting data — no fluff.' },
    ],
    image: '/images/services/free-home-evaluation-london-ontario.webp',
    imageAlt: 'Real Estate Broker conducting a home evaluation in London Ontario',
    metaTitle: 'Complimentary Home Evaluation London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Get a complimentary home evaluation in London Ontario from Justin Skrypnyk. Find out what your home is worth in today\'s market — no obligation, no pressure. Call 519.639.5176.',
    ctaText: 'Book Your Complimentary Evaluation',
    faqs: [
      {
        q: 'What is included in a complimentary home evaluation in London Ontario?',
        a: 'Justin\'s complimentary home evaluation includes a walk-through of your property, a review of recent comparable sales in your specific neighbourhood, an analysis of active competing listings, and a written report showing your home\'s current market value range with supporting data. There is no obligation to list, and no charge for the evaluation.',
      },
      {
        q: 'How accurate is a home evaluation in London Ontario?',
        a: 'A professionally conducted home evaluation by a local broker who knows your specific neighbourhood is far more accurate than any online automated estimate. Justin\'s evaluations are based on recent sold data from your specific street and comparable properties, adjusted for your home\'s condition, size, and features. Online estimates routinely miss by 5 to 15 percent in either direction.',
      },
      {
        q: 'How long does a home evaluation take in London Ontario?',
        a: 'The walk-through portion of Justin\'s home evaluation typically takes 30 to 60 minutes depending on the size of your home. The written report with comparable sales data is usually ready within 24 to 48 hours. The total process is designed to be efficient and unobtrusive.',
      },
      {
        q: 'Do I have to sell if I get a home evaluation?',
        a: 'Absolutely not. Justin provides complimentary home evaluations with zero obligation. Many homeowners request evaluations simply to understand their equity position, plan for a future sale, or compare their home\'s value against their mortgage balance. There is no pressure and no follow-up pitch.',
      },
    ],
  },
  {
    slug: 'first-time-buyers',
    name: 'First-Time Home Buyers',
    shortName: 'First-Time Buyers',
    icon: '🔑',
    headline: 'Your First Home. Done Right.',
    description:
      'First-time buying is exciting and overwhelming in equal measure. Justin breaks it down step by step so you arrive at closing day confident.',
    longDescription:
      'First-time home buyers in London Ontario have more options — and more questions — than ever before. What neighbourhood fits your lifestyle? How much should you put down? What hidden costs should you prepare for? Justin Skrypnyk has guided countless first-time buyers through this process in West London and understands exactly what you\'re feeling. His patient, educational approach ensures you make a decision you\'ll be proud of for years to come.',
    benefits: [
      'Patient guidance with no jargon — plain English every step',
      'First-time buyer programs: FHSA, RRSP Home Buyers\' Plan, tax credits',
      'Budget breakdown including closing costs, land transfer tax, and insurance',
      'Pre-approval connection to trusted London Ontario mortgage specialists',
      'Neighbourhood comparisons tailored to your lifestyle and commute',
    ],
    process: [
      { step: '01', title: 'Education Session', body: 'We walk through the entire process before you look at a single home — so there are no surprises.' },
      { step: '02', title: 'Budget & Pre-Approval', body: 'Understand your true budget including programs like the FHSA and Home Buyers\' Plan.' },
      { step: '03', title: 'Neighbourhood Match', body: 'We identify which London Ontario areas fit your lifestyle, commute, and price range.' },
      { step: '04', title: 'Find & Secure', body: 'Tour homes, write a competitive offer, and navigate inspection and closing with confidence.' },
    ],
    image: '/images/services/first-time-home-buyers-london-ontario.webp',
    imageAlt: 'First-time home buyers signing documents in London Ontario',
    metaTitle: 'First-Time Home Buyers London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'First-time buying a home in London Ontario? Justin Skrypnyk makes it simple. Education, neighbourhood guidance, and expert advocacy from search to keys.',
    ctaText: 'Start Your First-Home Journey',
    faqs: [
      {
        q: 'What programs are available for first-time home buyers in London Ontario?',
        a: 'First-time buyers in Ontario can access the First Home Savings Account (FHSA) — up to $8,000/year, $40,000 lifetime, tax-free; the RRSP Home Buyers\' Plan — up to $35,000 ($70,000 per couple) withdrawn tax-free; the First-Time Home Buyers\' Tax Credit — up to $1,500 tax reduction; and the Land Transfer Tax Refund for first-time buyers in Ontario. Justin walks every first-time buyer through which programs apply to their situation.',
      },
      {
        q: 'What is the minimum down payment for a first-time buyer in London Ontario?',
        a: 'In Canada, the minimum down payment is 5% of the purchase price for homes up to $500,000. For a $600,000 home (close to the London Ontario average), the minimum is 5% on the first $500,000 ($25,000) plus 10% on the remaining $100,000 ($10,000), for a total minimum of $35,000 plus closing costs.',
      },
      {
        q: 'How does the home buying process work for first-time buyers in Ontario?',
        a: 'The process follows six key steps: (1) Understand your budget and get pre-approved; (2) Access government programs (FHSA, Home Buyers\' Plan); (3) Work with a local broker to search and view homes; (4) Write a competitive offer with appropriate conditions; (5) Complete your home inspection and financing; (6) Close and receive keys. Justin walks first-time buyers through each step with no jargon and no pressure.',
      },
      {
        q: 'What are the closing costs for first-time home buyers in London Ontario?',
        a: 'Closing costs in London Ontario typically include Ontario Land Transfer Tax (partially refunded for first-time buyers up to $4,000), legal fees ($1,200 to $1,800), title insurance ($200 to $400), home inspection ($450 to $600), and moving costs. Total closing costs are typically 1.5% to 3% of the purchase price, in addition to your down payment.',
      },
    ],
  },
  {
    slug: 'downsizing',
    name: 'Downsizing',
    shortName: 'Downsizing',
    icon: '🏘️',
    headline: 'Downsize with Dignity and Maximum Return',
    description:
      'Moving to a smaller home is a major life transition. Justin helps you time the market, maximize your sale, and find the right next home.',
    longDescription:
      'Downsizing in London Ontario is one of the most emotionally complex real estate moves you\'ll make. The family home carries decades of memories, and finding the right next chapter — whether it\'s a bungalow, condo, or retirement community — requires a Real Estate Broker who listens. Justin Skrypnyk has helped many West London families make this transition smoothly, selling their larger home at top dollar while securing the perfect smaller space that fits their next stage of life.',
    benefits: [
      'Experienced with the emotional side of selling a long-term family home',
      'Timing strategy to maximize sale price before your next move',
      'Condo, bungalow, and retirement community expertise',
      'Bridge financing guidance so you don\'t feel rushed',
      'Trusted moving and storage referrals',
    ],
    process: [
      { step: '01', title: 'Life Stage Consultation', body: 'Understand your timeline, future home preferences, and financial goals.' },
      { step: '02', title: 'Sell High', body: 'Prepare and market your current home to achieve the best price in today\'s market.' },
      { step: '03', title: 'Find the Right Fit', body: 'Explore bungalows, condos, or accessible homes matched to your lifestyle needs.' },
      { step: '04', title: 'Seamless Transition', body: 'Coordinate closings, moving logistics, and bridge financing with zero stress.' },
    ],
    image: '/images/services/downsizing-home-london-ontario.webp',
    imageAlt: 'Couple reviewing downsizing options with Real Estate Broker in London Ontario',
    metaTitle: 'Downsizing Your Home in London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Ready to downsize in London Ontario? Justin Skrypnyk helps you sell your family home for top dollar and find the perfect smaller space. Call 519.639.5176 for a free consultation.',
    ctaText: 'Book a Downsizing Consultation',
    faqs: [
      {
        q: 'When is the right time to downsize your home in London Ontario?',
        a: 'The right time to downsize is when your current home no longer fits your life stage — whether that\'s empty nest, retirement, health considerations, or simply wanting less maintenance. From a market perspective, selling in a seller-favourable market maximizes what you net from your family home. Justin helps you think through both the lifestyle and financial timing.',
      },
      {
        q: 'What types of homes are best for downsizing in London Ontario?',
        a: 'London Ontario offers excellent downsizing options across multiple neighbourhoods and property types: bungalows in Oakridge and Byron (single-level, mature neighbourhood), condos in Westmount and downtown London (low maintenance, amenities), and smaller detached homes in West London and South London at accessible prices. The right choice depends on your lifestyle, mobility needs, and budget.',
      },
      {
        q: 'Should I sell my home before buying a smaller one in London Ontario?',
        a: 'In most cases, yes — selling first gives you certainty about your budget, eliminates the risk of carrying two properties, and strengthens your position as a buyer. Bridge financing is available if the timing doesn\'t align perfectly. Justin helps coordinate the sale and purchase timing to minimize disruption and carrying costs.',
      },
      {
        q: 'How much equity can I expect to unlock when downsizing in West London?',
        a: 'It depends on the value of your current home and your target property. Downsizers in Oakridge and Byron moving from a $750,000 to $900,000 detached home to a $400,000 to $550,000 condo or bungalow can unlock $200,000 to $500,000 in equity after all costs. A complimentary home evaluation is the right first step to understand exactly what you would net.',
      },
    ],
  },
  {
    slug: 'upsizing',
    name: 'Upsizing',
    shortName: 'Upsizing',
    icon: '⬆️',
    headline: 'Ready to Move Up? Let\'s Find Your Forever Home.',
    description:
      'Your family has outgrown your current home. Justin helps you sell strategically and move into more space without missing a beat.',
    longDescription:
      'When your family grows, so do your real estate needs. Upsizing in London Ontario — moving from a condo to a semi, or a semi to a full detached — requires careful coordination between selling your current home and purchasing your next. Justin Skrypnyk helps West London families make this move confidently, with strategic timing that protects your equity and secures your ideal next home in a competitive market.',
    benefits: [
      'Strategic coordination between your sale and purchase',
      'Access to executive and family-sized homes in West London',
      'Competitive offer strategies to win in multiple-offer scenarios',
      'Market timing guidance based on real data',
      'Full-service support for both sell and buy sides',
    ],
    process: [
      { step: '01', title: 'Equity Assessment', body: 'Understand what you\'ll net from your sale and how much you can spend on your next home.' },
      { step: '02', title: 'List & Sell', body: 'Get maximum value from your current home with Justin\'s proven marketing system.' },
      { step: '03', title: 'Search & Secure', body: 'Find and win the home that fits your growing family\'s next chapter.' },
      { step: '04', title: 'Coordinated Close', body: 'Align closing dates to minimize carrying costs and moving disruption.' },
    ],
    image: '/images/services/upsizing-home-london-ontario.webp',
    imageAlt: 'Family moving into a larger home in West London Ontario',
    metaTitle: 'Upsizing Your Home in London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Upsizing in London Ontario? Justin Skrypnyk coordinates your sale and next home purchase seamlessly. Find the space your family needs in West London.',
    ctaText: 'Plan Your Move-Up',
    faqs: [
      {
        q: 'How do I upsize my home in London Ontario without missing a beat?',
        a: 'Upsizing successfully requires coordinating the sale of your current home with the purchase of your next — ideally aligning closing dates to avoid carrying two mortgages or moving twice. Justin helps you determine the sequence (sell first, buy first, or conditional on sale), negotiate bridge financing if needed, and close both transactions efficiently.',
      },
      {
        q: 'What neighbourhoods are best for upsizing in West London Ontario?',
        a: 'Lambeth is the top choice for upsizing buyers who want larger, newer estate homes with excellent schools and highway access. Hyde Park offers new construction family homes in a rapidly growing northwest community. Oakridge and Byron provide larger lot sizes in established west-end settings. The right choice depends on your budget and whether you prefer new construction or mature streetscapes.',
      },
      {
        q: 'How much does it cost to upsize a home in London Ontario?',
        a: 'The cost depends entirely on the price difference between your current home and your target property. Beyond the purchase price, budget for Land Transfer Tax, legal fees, moving costs, and any immediate renovation or upgrade costs in the new home. Justin provides a detailed net equity analysis before you commit to any strategy.',
      },
      {
        q: 'Can I buy my next home before selling in London Ontario?',
        a: 'Yes, but it carries risk — you may end up owning two properties simultaneously if your current home takes longer to sell than expected. Bridge financing can cover the gap for a set period. In most cases Justin recommends a firm sale on your current home before committing to a purchase, but the right approach depends on your financial position and the specific market conditions at the time.',
      },
    ],
  },
  {
    slug: 'relocation',
    name: 'Relocation',
    shortName: 'Relocation',
    icon: '📦',
    headline: 'Moving to London Ontario? We\'ll Help You Land Right.',
    description:
      'Relocating from out of town is stressful enough. Justin makes finding your home in London Ontario simple, fast, and surprisingly enjoyable.',
    longDescription:
      'Whether you\'re relocating from Toronto, Ottawa, Vancouver, or anywhere else in Canada, London Ontario is welcoming more newcomers than ever — drawn by affordability, quality of life, and a growing economy. But knowing which neighbourhood is right for your commute, your kids\' schools, and your lifestyle takes local knowledge. Justin Skrypnyk specializes in helping relocating buyers navigate London Ontario without wasted trips or wrong decisions.',
    benefits: [
      'Virtual tours and remote buying options for out-of-town buyers',
      'Neighbourhood matching based on your lifestyle, commute, and family needs',
      'School district guidance for families with children',
      'Trusted network: lawyers, inspectors, movers — all London-local',
      'Same-day responsiveness for buyers working on a tight timeline',
    ],
    process: [
      { step: '01', title: 'Virtual Discovery', body: 'A detailed video call to understand your needs, budget, and ideal London Ontario lifestyle.' },
      { step: '02', title: 'Neighbourhood Shortlist', body: 'Justin identifies the 2–3 London areas that best match your priorities.' },
      { step: '03', title: 'Focused Tour Day', body: 'When you\'re in town, we tour targeted homes efficiently — no wasted viewings.' },
      { step: '04', title: 'Remote Buying Support', body: 'We can execute the full transaction remotely — offer, inspection review, and closing.' },
    ],
    image: '/images/services/relocation-london-ontario.webp',
    imageAlt: 'Family relocating to London Ontario with moving boxes',
    metaTitle: 'Relocating to London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Relocating to London Ontario? Justin Skrypnyk helps out-of-town buyers find the right neighbourhood and home. Virtual tours available. Call 519.639.5176.',
    ctaText: 'Book a Relocation Consult',
    faqs: [
      {
        q: 'Is London Ontario a good city to relocate to from Toronto?',
        a: 'London Ontario is one of Canada\'s top relocation destinations for GTA buyers. Home prices are significantly more accessible (London average $625,000–$660,000 vs. GTA $1.1M+), commuter rail connects London to Toronto in under 2 hours, Western University and London Health Sciences Centre provide major employment anchors, and the quality of life in west-end neighbourhoods like Oakridge and Byron is genuinely excellent.',
      },
      {
        q: 'Can I buy a home in London Ontario remotely?',
        a: 'Yes — Justin routinely works with out-of-town buyers and can handle the entire transaction remotely. Virtual tours, video walkthroughs, remote offer signing, and digital document management mean you can purchase a London Ontario home without making multiple trips. A single focused tour day when you are in town is usually the most efficient approach.',
      },
      {
        q: 'Which London Ontario neighbourhood is best for relocating families?',
        a: 'For families relocating to London Ontario, Oakridge and Byron in the west end are the most consistently recommended for their top-rated schools, mature community character, and lifestyle quality. Hyde Park and Lambeth are excellent for families who prefer newer construction. Justin provides a detailed neighbourhood match based on your commute, school priorities, and lifestyle preferences.',
      },
      {
        q: 'How far is London Ontario from Toronto?',
        a: 'London Ontario is approximately 190 kilometres west of Toronto — about 2 hours by car on Highway 401, or just under 2 hours by Via Rail train. London is also well-positioned for commuters to Windsor, Kitchener-Waterloo, and Hamilton. For remote workers who need to visit Toronto occasionally, London offers a genuinely liveable base at a fraction of GTA housing costs.',
      },
    ],
  },
  {
    slug: 'investment',
    name: 'Investment Properties',
    shortName: 'Investment',
    icon: '💰',
    headline: 'Build Wealth Through London Ontario Real Estate',
    description:
      'From first rental to multi-unit portfolio, Justin provides the market data and investment perspective to help you build long-term real estate wealth.',
    longDescription:
      'London Ontario\'s real estate market has attracted investors from across Canada seeking better cap rates than Toronto or Vancouver while still benefiting from a growing, diversified city economy. Western University and Fanshawe College drive consistent rental demand, while London\'s expanding tech and healthcare sectors support long-term appreciation. Justin Skrypnyk helps investors identify the right asset, the right neighbourhood, and the right entry point to maximize returns.',
    benefits: [
      'Cap rate and cash flow analysis for target properties',
      'Student rental expertise near Western and Fanshawe',
      'Duplex, triplex, and multiplex identification',
      'Off-market investment opportunities through local network',
      'Portfolio growth strategy from single unit to multi-property',
    ],
    process: [
      { step: '01', title: 'Investment Goals Session', body: 'Define your strategy: cash flow, appreciation, student rental, or multi-unit.' },
      { step: '02', title: 'Market & Cap Rate Analysis', body: 'Evaluate target neighbourhoods with real rental income and expense data.' },
      { step: '03', title: 'Property Search', body: 'Identify properties that meet your return criteria, including off-market options.' },
      { step: '04', title: 'Acquisition', body: 'Negotiate, inspect, and close on your investment property with full support.' },
    ],
    image: '/images/services/investment-property-london-ontario.webp',
    imageAlt: 'Investment property for sale in London Ontario',
    metaTitle: 'Investment Properties London Ontario | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Build your real estate portfolio in London Ontario. Justin Skrypnyk identifies high-yield investment properties near Western University, Fanshawe, and across West London.',
    ctaText: 'Explore Investment Opportunities',
    faqs: [
      {
        q: 'Is London Ontario a good city to invest in real estate?',
        a: 'London Ontario is consistently attractive for Canadian real estate investors. Home prices are significantly more accessible than Toronto or Vancouver, while the city\'s diversified economy (Western University, London Health Sciences Centre, tech sector, manufacturing) supports stable rental demand. Cap rates are generally stronger than major metros, and the student rental market near Western University and Fanshawe College provides a reliable tenant base.',
      },
      {
        q: 'What are the best areas for rental investment in London Ontario?',
        a: 'Old North and Westmount near Western University offer the strongest student rental demand and consistent occupancy. Downtown London condos attract young professionals. East London provides the lowest acquisition costs and positive cash flow potential. West London and Medway offer strong long-term appreciation in established communities. Justin provides cap rate and cash flow analysis for any target neighbourhood.',
      },
      {
        q: 'How much can I rent a house for in London Ontario?',
        a: 'Rental rates in London Ontario vary significantly by property type, condition, and neighbourhood. Detached homes in west-end areas like Oakridge and Byron rent for $2,800 to $4,000 per month. Multi-unit properties near Western University can command $800 to $1,400 per room in student rentals. Condos in Westmount and downtown rent for $1,600 to $2,400 per month. Justin can model specific properties against current rental comparables.',
      },
      {
        q: 'Are duplexes and triplexes available to buy in London Ontario?',
        a: 'Yes — London Ontario has an active market for duplex and triplex properties, concentrated primarily in Old North, East London, and along the Commissioners and Oxford corridors. Justin identifies multi-unit properties that meet cash flow criteria, including off-market opportunities through his local network.',
      },
    ],
  },
];

export function getService(slug: string): Service | undefined {
  return SERVICES.find((s) => s.slug === slug);
}
