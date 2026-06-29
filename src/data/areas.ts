export interface LocalBusiness {
  name: string;
  category: string;
  icon: string;
  description: string;
  highlight: string;
}

export interface AreaFaq {
  q: string;
  a: string;
}

export interface SchoolEntry {
  name: string;
  address: string;
  grades: string;
  board: 'TVDSB' | 'LDCSB';
  notes?: string;
}

export interface SchoolsData {
  elementary: SchoolEntry[];
  secondary: SchoolEntry[];
  sectionNote?: string;
}

export interface ParkEntry {
  name: string;
  address: string;
  amenities: string[];
  highlight?: string;
}

export interface ParksData {
  parks: ParkEntry[];
}

export interface Area {
  slug: string;
  name: string;
  shortName: string;
  headline: string;
  description: string;
  longDescription: string;
  mapEmbedId: string;
  geo: { lat: number; lng: number };
  image: string;
  imageAlt: string;
  highlights: string[];
  avgPrice: string;
  homingTypes: string[];
  schools: string[];
  nearbyAmenities: string[];
  localBusinesses?: LocalBusiness[];
  schoolsData?: SchoolsData;
  parksData?: ParksData;
  faqs: AreaFaq[];
  metaTitle: string;
  metaDescription: string;
}

export const AREAS: Area[] = [
  {
    slug: 'oakridge',
    name: 'Oakridge',
    shortName: 'Oakridge',
    headline: 'London\'s Most Established West-End Neighbourhood',
    description:
      'Mature trees, large lots, top-rated schools, and a true sense of community — Oakridge has been the heart of West London since the 1950s.',
    longDescription:
      'Oakridge sits between Wonderland Road and Sanatorium Road along the Oxford Street corridor in West London. Most homes were built between the 1950s and 1980s, offering buyers solid construction on generous lots lined with mature trees. The neighbourhood is centred around Oakridge Optimist Park, Sifton Bog conservation area, and some of London\'s highest-rated elementary and secondary schools. Residents enjoy walkable access to Hyde Park Road shops, Oxford Street businesses, and a tight-knit community that throws block parties and knows its neighbours by name.',
    mapEmbedId: 'Oakridge,+London,+Ontario,+Canada',
    geo: { lat: 42.9849, lng: -81.2453 },
    image: '/images/areas/oakridge-neighbourhood-london-ontario.webp',
    imageAlt: 'Tree-lined street in Oakridge neighbourhood, London Ontario',
    highlights: [
      'Mature tree-lined streets on generous lots',
      'Walking distance to Sifton Bog Nature Reserve',
      'Oakridge Optimist Park — fields, tennis, splash pad',
      'Top-rated elementary and secondary schools',
      '10-minute drive to downtown London',
      'Excellent walkability to shops on Hyde Park & Oxford',
    ],
    avgPrice: '$650,000–$850,000',
    homingTypes: ['Detached', 'Semi-Detached', 'Townhomes', 'Bungalows'],
    schools: ['Clara Brenton PS', 'John Dearness PS', 'St. Paul Catholic School', 'Oakridge Secondary School', 'St. Thomas Aquinas Catholic Secondary'],
    nearbyAmenities: ['Remark Fresh Markets', 'Chopped Leaf', 'Gordon\'s Gold Jewellers', 'Starbucks', 'Shoppers Drug Mart', 'Sifton Bog Conservation Area'],
    localBusinesses: [
      {
        name: 'Remark Fresh Markets',
        category: 'Grocery & Specialty Food',
        icon: '🛒',
        description:
          'A west London landmark since 2004, Remark Fresh Markets sits right at the Oxford & Hyde Park intersection. This is a family-run operation — Gerry Remark\'s name is on the door, and it shows in every aisle. Think premium produce, fresh-cut meats, house-baked goods, full-service deli, sushi, and specialty items you simply won\'t find at a big-box grocer. Remark changed the way west London shops for food, and Oakridge residents have been the biggest beneficiaries.',
        highlight: 'Family-owned, locally rooted — London\'s most beloved grocer',
      },
      {
        name: 'Chopped Leaf',
        category: 'Restaurant — Healthy Fast-Casual',
        icon: '🥗',
        description:
          'At 640 Hyde Park Road, Chopped Leaf brings chef-designed salads, wraps, and bowls to the neighbourhood. The London location is locally owned by a family who moved here specifically to build something good in this community — and it shows. Bold signature dressings, fresh ingredients, and fully customizable options for every dietary need. This is the lunch spot that makes eating well feel effortless.',
        highlight: 'Local ownership. Fresh ingredients. Zero compromise on taste.',
      },
      {
        name: 'Gordon\'s Gold Jewellers',
        category: 'Fine Jewellery',
        icon: '💎',
        description:
          'A Oakridge institution since 1983 and a multi-time winner of London\'s "Best Jewellers," Gordon\'s Gold at 760 Hyde Park Road is west London\'s home for engagement rings, diamonds, custom goldsmith work, and rare gemstones. They hold American Gemological Society standing for ethical business practices and are proud members of the London Chamber of Commerce. The kind of local business that earns loyalty across generations.',
        highlight: 'West London\'s most trusted jeweller — 40+ years and counting',
      },
      {
        name: 'Starbucks — Hyde Park Plaza',
        category: 'Coffee',
        icon: '☕',
        description:
          'The Hyde Park Plaza Starbucks at Oxford & Hyde Park is one of west London\'s busiest coffee stops — and for good reason. It\'s become the daily ritual for Oakridge families: morning school runs, weekend coffee walks, after-practice pick-me-ups. Conveniently part of the same plaza as Remark and Shoppers, it anchors the Oxford & Hyde Park intersection as the true neighbourhood hub.',
        highlight: 'The Oxford & Hyde Park corner — Oakridge\'s daily meeting place',
      },
      {
        name: 'Shoppers Drug Mart',
        category: 'Pharmacy & Health',
        icon: '💊',
        description:
          'A full-service Shoppers Drug Mart anchors Hyde Park Plaza alongside Remark, offering prescriptions, Beauté Boutique cosmetics, a Canada Post outlet, and all the everyday essentials a family needs. Having a pharmacy and health hub this close to home is one of those practical advantages Oakridge residents quietly rely on every week.',
        highlight: 'Full-service pharmacy and post office steps from home',
      },
      {
        name: 'Sifton Bog Conservation Area',
        category: 'Parks & Nature',
        icon: '🌿',
        description:
          'One of the rarest natural features in any Canadian city — a genuine kettle bog preserved within the urban fabric of west London. Sifton Bog is home to carnivorous plants, migratory birds, and a unique ecosystem found almost nowhere else in southwestern Ontario. The walking trails are just minutes from most Oakridge homes. Having something like this as a backyard amenity is something money genuinely cannot buy elsewhere.',
        highlight: 'One of Canada\'s most unique urban nature reserves — right here',
      },
      {
        name: 'Oakridge Optimist Community Park',
        category: 'Parks & Recreation',
        icon: '⚽',
        description:
          'The neighbourhood\'s social and athletic heart. Run in partnership with the Optimist Club of Oakridge Acres — chartered since 1957 — the park hosts baseball diamonds, soccer fields, tennis courts, and a splash pad. The Optimist Club\'s sport programs serve over 2,000 local youth each year. It\'s where kids grow up, where neighbours meet, and where the community spirit that makes Oakridge special is built and maintained.',
        highlight: '2,000+ youth served annually — the true heart of Oakridge',
      },
    ],
    schoolsData: {
      elementary: [
        { name: 'Clara Brenton Public School', address: '1025 St. Croix Avenue', grades: 'JK–8', board: 'TVDSB' },
        { name: 'John Dearness Public School', address: '555 Sanatorium Road', grades: 'JK–8', board: 'TVDSB' },
        { name: 'St. Paul Catholic School', address: '1090 Guildwood Boulevard', grades: 'JK–8', board: 'LDCSB', notes: 'Serves Oak Park, Oakridge Acres, Huntington, and Hunt Club' },
      ],
      secondary: [
        { name: 'Oakridge Secondary School', address: '1040 Oxford Street West', grades: '9–12', board: 'TVDSB' },
        { name: 'St. Thomas Aquinas Catholic Secondary School', address: '1360 Oxford Street West', grades: '9–12', board: 'LDCSB' },
      ],
    },
    parksData: {
      parks: [
        {
          name: 'Oakridge Optimist Community Park',
          address: '825 Valetta Street',
          amenities: ['2 baseball diamonds', 'Batting cage', 'Outdoor pool', 'Spray pad', '2 tennis courts', 'Pickleball courts', 'Arena (1 ice pad)', '2 play structures', 'Swing set', 'Recreation centre', 'Washrooms', 'Accessible'],
          highlight: 'Community hub run by the Optimist Club since 1957 — 2,000+ youth served annually',
        },
        {
          name: 'Sifton Bog Conservation Area',
          address: 'Oxford Street West (west of Hyde Park Road)',
          amenities: ['2.8 km walking trail', '370 m boardwalk', 'Viewing platform', 'Birdwatching', 'Nature education'],
          highlight: 'Most southerly large acidic bog in Canada — carnivorous plants, migratory birds, and rare ecosystems',
        },
        {
          name: 'Hazelden Park',
          address: '430 Hyde Park Road',
          amenities: ['Baseball diamond', 'Soccer field', 'Play structure', 'Swings', 'Parking'],
          highlight: 'Neighbourhood park serving the Hazelden pocket of Oakridge',
        },
        {
          name: 'Thames Valley Golf Course',
          address: '1287 Oxford Street West',
          amenities: ['18-hole public course', '9-hole public course', 'Thames River valley setting', 'Clubhouse'],
          highlight: 'Public golf along the Thames River — established 1924, one of London\'s most scenic courses',
        },
      ],
    },
    faqs: [
      {
        q: 'Are there homes for sale in Oakridge, London Ontario right now?',
        a: 'Yes — Oakridge has an active real estate market year-round. Detached homes, bungalows, and semi-detached properties come to market regularly. Contact Justin Skrypnyk to get current listings and off-market opportunities in Oakridge before they hit the public portals.',
      },
      {
        q: 'How much do homes cost in Oakridge, London Ontario?',
        a: 'Oakridge homes for sale typically range from $650,000 to $850,000 for detached properties. Bungalows and semi-detached homes can start around $600,000, while larger renovated homes or premium lots can exceed $900,000. Prices reflect the neighbourhood\'s mature lots, top-rated schools, and central West London location.',
      },
      {
        q: 'Is Oakridge a good place to buy a home in London Ontario?',
        a: 'Oakridge is consistently one of London Ontario\'s most sought-after neighbourhoods for families. Its combination of mature tree-lined streets, top-rated schools (Oakridge Public, Mother Teresa Catholic, Oakridge Secondary), walkable amenities, Sifton Bog conservation access, and strong community culture make it one of the best investments in West London real estate.',
      },
      {
        q: 'What are the schools like in Oakridge?',
        a: 'Oakridge has some of London\'s highest-rated schools. Oakridge Public School and Mother Teresa Catholic Elementary serve younger students, and Oakridge Secondary School is well-regarded for academics and extracurriculars. The school catchments are a major reason families specifically seek out Oakridge homes.',
      },
    ],
    metaTitle: 'Oakridge London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Looking to buy or sell in Oakridge, London Ontario? Justin Skrypnyk is the local expert. Explore homes, get a complimentary evaluation, and find out why Oakridge is West London\'s best-kept secret.',
  },
  {
    slug: 'byron',
    name: 'Byron',
    shortName: 'Byron',
    headline: 'Trails, Parks & Timeless Community in Southwest London',
    description:
      'Nestled along the Thames River with Springbank Park as its backyard, Byron blends outdoor living with a small-town feel inside a big city.',
    longDescription:
      'Byron is one of London\'s most desirable southwest communities, bordered by the Thames River and anchored by Springbank Park — the largest park in London. Originally a village before amalgamation, Byron has retained its unique character, quiet streets, and strong community pride. Homes range from post-war bungalows to large executive two-storeys. Byron Secondary School consistently ranks among the region\'s top high schools. Whether you\'re cycling the river trails at sunrise or grabbing a coffee on Commissioners Road, Byron delivers a lifestyle that buyers rarely leave.',
    mapEmbedId: 'Byron,+London,+Ontario,+Canada',
    geo: { lat: 42.9507, lng: -81.2842 },
    image: '/images/areas/byron-neighbourhood-london-ontario.webp',
    imageAlt: 'Springbank Park in Byron neighbourhood, London Ontario',
    highlights: [
      'Springbank Park — London\'s largest park at your doorstep',
      'Thames River trail system for cycling and walking',
      'Byron Secondary School — top academic ranking',
      'Strong community identity and active neighbourhood association',
      'Diverse housing from bungalows to executive estates',
      'Village-feel shops and cafés along Commissioners Road',
    ],
    avgPrice: '$700,000–$950,000',
    homingTypes: ['Detached', 'Bungalows', 'Executive Homes', 'Semi-Detached'],
    schools: ['Byron Northview Public School', 'St. John French Immersion', 'Byron Secondary School'],
    nearbyAmenities: ['Springbank Park', 'Thames Valley Parkway', 'Commissioners Road Shops'],
    localBusinesses: [
      {
        name: 'Springbank Park',
        category: 'Parks & Nature',
        icon: '🌳',
        description:
          'London\'s largest park is Byron\'s backyard — over 200 acres of river valley, gardens, picnic areas, and the beloved Storybook Gardens. The Thames River runs along its edge, giving residents access to one of the most scenic stretches of the Thames Valley Parkway. Byron residents walk, jog, and cycle here year-round. It\'s not a short drive away — it\'s around the corner.',
        highlight: 'London\'s largest park — 200+ acres of trails and river valley',
      },
      {
        name: 'Thames Valley Parkway',
        category: 'Recreation & Trails',
        icon: '🚴',
        description:
          'The Thames Valley Parkway is a 35-kilometre multi-use trail that winds through London along the river — and Byron sits at one of its most scenic stretches. Cyclists, walkers, and runners use this trail year-round to commute and recreate without ever getting in a car. For active families, living in Byron means this is simply part of daily life.',
        highlight: '35km of river trail — commute, run, or ride from your front door',
      },
      {
        name: 'Commissioners Road Village',
        category: 'Shopping & Dining',
        icon: '🛍️',
        description:
          'The Commissioners Road corridor through Byron is a genuine neighbourhood main street — independent coffee shops, restaurants, a pharmacy, grocery, and service businesses that feel local because they are. Byron residents rarely need to leave the community for their everyday needs, and that self-sufficiency is a huge part of what makes the neighbourhood so liveable.',
        highlight: 'A real neighbourhood main street — walkable, local, and complete',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Byron, London Ontario right now?',
        a: 'Byron has an active market year-round, though listings move quickly given the neighbourhood\'s strong demand. Detached homes, bungalows, and executive two-storeys come to market regularly. Contact Justin to access current Byron listings and be notified the moment new properties hit the market.',
      },
      {
        q: 'How much do homes cost in Byron, London Ontario?',
        a: 'Byron homes for sale typically range from $700,000 to $950,000 for detached properties, with executive homes near Springbank Park exceeding $1 million. The neighbourhood commands a premium over the London Ontario average reflecting its unique lifestyle, Springbank Park access, and Byron Secondary School\'s academic reputation.',
      },
      {
        q: 'Is Byron a good neighbourhood to buy a home in London Ontario?',
        a: 'Byron is one of London\'s most consistently desirable communities. Springbank Park — London\'s largest park — is at residents\' doorstep, the Thames River trail system provides direct active transportation, Byron Secondary School ranks among the top high schools in the region, and the Commissioners Road corridor gives the neighbourhood an authentic village-feel. Properties hold their value well.',
      },
      {
        q: 'How does Byron compare to Oakridge for buying a home?',
        a: 'Byron typically commands a modest price premium over Oakridge and offers a quieter, more nature-focused lifestyle anchored by Springbank Park and the Thames River. Oakridge offers slightly more walkable everyday amenities and a more central West London location. Both are excellent — the right choice depends on whether outdoor lifestyle or daily convenience is your priority.',
      },
    ],
    metaTitle: 'Byron London Ontario Real Estate | Buy & Sell in Byron | Justin Skrypnyk',
    metaDescription:
      'Explore Byron real estate in London Ontario with local Real Estate Broker Justin Skrypnyk. Homes near Springbank Park, great schools, and Thames River trails. Get a complimentary home evaluation today.',
  },
  {
    slug: 'westmount',
    name: 'Westmount',
    shortName: 'Westmount',
    headline: 'Established & Evolving — West London\'s Urban-Suburban Sweet Spot',
    description:
      'Westmount offers convenient access to everything London has to offer, with a diverse mix of housing and a strong commercial corridor.',
    longDescription:
      'Westmount developed primarily in the 1960s and has since evolved into one of West London\'s most versatile communities. The neighbourhood offers a wide range of housing — from modest bungalows to larger detached homes and high-rise apartments along Wonderland and Commissioners. Westmount residents enjoy easy access to Western University, University Hospital, White Oaks Mall, and the extensive retail corridor along Wonderland Road South. The area\'s central location makes it attractive for young professionals, growing families, and downsizers who want proximity to amenities without sacrificing neighbourhood feel.',
    mapEmbedId: 'Westmount,+London,+Ontario,+Canada',
    geo: { lat: 42.9638, lng: -81.2628 },
    image: '/images/areas/westmount-neighbourhood-london-ontario.webp',
    imageAlt: 'Residential street in Westmount, London Ontario',
    highlights: [
      'Minutes from Western University and University Hospital',
      'Diverse housing options at varied price points',
      'Wonderland Road — extensive retail and dining corridor',
      'Easy transit access across the city',
      'Great for professionals, families, and investors',
    ],
    avgPrice: '$550,000–$750,000',
    homingTypes: ['Detached', 'Semi-Detached', 'Condos', 'Townhomes', 'Apartments'],
    schools: ['Princess Anne French Immersion', 'St. Thomas Aquinas Catholic', 'Westmount Secondary School'],
    nearbyAmenities: ['White Oaks Mall', 'Wonderland Road Retail', 'University Hospital'],
    localBusinesses: [
      {
        name: 'White Oaks Mall',
        category: 'Shopping Centre',
        icon: '🛍️',
        description:
          'One of London\'s premier shopping destinations, White Oaks Mall on Wellington Road puts Westmount residents within minutes of over 150 stores, services, and restaurants. From major fashion retailers to specialty shops, a busy food court, and a cinema — it\'s a complete retail destination that most neighbourhoods would envy.',
        highlight: '150+ stores minutes from home — London\'s south shopping anchor',
      },
      {
        name: 'Wonderland Road Corridor',
        category: 'Dining & Retail',
        icon: '🍽️',
        description:
          'Wonderland Road South through Westmount is one of London\'s most complete commercial corridors — grocers, pharmacies, restaurants from fast-casual to sit-down, banks, and specialty services all within a short drive or bus ride. Residents have genuine choice without ever needing to leave the west end.',
        highlight: 'Every service, every cuisine — all on one corridor',
      },
      {
        name: 'University Hospital',
        category: 'Healthcare',
        icon: '🏥',
        description:
          'One of Canada\'s top academic medical centres, University Hospital (part of London Health Sciences Centre) is minutes from Westmount. For families, seniors, and medical professionals, proximity to world-class healthcare is a practical advantage that quietly makes a real difference in daily life. LHSC is also one of London\'s largest employers.',
        highlight: 'World-class healthcare — minutes from your front door',
      },
      {
        name: 'Western University',
        category: 'Education & Culture',
        icon: '🎓',
        description:
          'One of Canada\'s top research universities sits on Westmount\'s doorstep. Beyond its academic reputation, Western brings significant economic activity, cultural programming, athletics, and a vibrant youthful energy to the entire west end. For investors, proximity to Western means perpetually strong rental demand.',
        highlight: 'Canada\'s top university — neighbour, employer, and economic engine',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Westmount, London Ontario?',
        a: 'Yes — Westmount has one of the most active and diverse markets in West London, with condos, semis, and detached homes coming to market regularly. The neighbourhood\'s range of property types means buyers at many price points can find something that works.',
      },
      {
        q: 'How much do homes cost in Westmount, London Ontario?',
        a: 'Westmount offers London Ontario\'s widest price range in a single neighbourhood — condos and apartments from below $350,000, semi-detached homes from $450,000 to $600,000, and larger detached homes from $600,000 to $750,000. This diversity makes Westmount accessible to first-time buyers, families, and investors alike.',
      },
      {
        q: 'Is Westmount a good area to invest in London Ontario real estate?',
        a: 'Westmount is one of London\'s strongest investment neighbourhoods. Its proximity to Western University drives consistent rental demand, University Hospital is a major employer, and the diverse housing stock means multiple investment strategies work here — student rentals, long-term rentals, and appreciation plays.',
      },
      {
        q: 'What is Westmount like as a neighbourhood for families?',
        a: 'Westmount works well for families thanks to its strong schools (Princess Anne French Immersion, St. Thomas Aquinas Catholic, Westmount Secondary), proximity to University Hospital, and excellent transit connections. The Wonderland Road and Commissioners corridors put every daily need within easy reach.',
      },
    ],
    metaTitle: 'Westmount London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Westmount London Ontario homes for sale. Justin Skrypnyk helps buyers and sellers navigate this diverse West London neighbourhood. Complimentary home evaluation available.',
  },
  {
    slug: 'lambeth',
    name: 'Lambeth',
    shortName: 'Lambeth',
    headline: 'Suburban Calm with Small-Town Heart in Southwest London',
    description:
      'Lambeth offers newer construction, quiet streets, excellent schools, and fast access to Highways 401 and 402 — a commuter\'s dream.',
    longDescription:
      'Lambeth is a thriving community in the southwest corner of London, immediately north of Highway 402 and anchored by Colonel Talbot Road. It blends original village character — found along Main Street Lambeth — with an expanding landscape of new estate communities like Heathwoods and Privé. Lambeth attracts buyers who want newer, larger homes without sacrificing community. Fraser Institute school ratings here consistently exceed the provincial average. Quick access to Highways 401 and 402 makes Lambeth ideal for commuters travelling to Windsor, Kitchener-Waterloo, or Toronto. Big-box retail on Wellington Road is minutes away.',
    mapEmbedId: 'Lambeth,+London,+Ontario,+Canada',
    geo: { lat: 42.9199, lng: -81.2441 },
    image: '/images/areas/lambeth-neighbourhood-london-ontario.webp',
    imageAlt: 'New homes in Lambeth, London Ontario',
    highlights: [
      'Direct access to Hwy 401 & 402 — ideal for commuters',
      'New estate communities: Heathwoods, Privé',
      'Original village character on Main Street Lambeth',
      'High Fraser Institute school ratings',
      'Family-oriented with newer large-lot homes',
    ],
    avgPrice: '$700,000–$1,100,000',
    homingTypes: ['Executive Detached', 'Estate Homes', 'New Construction'],
    schools: ['Lambeth Public School', 'St. Nicholas Catholic Elementary', 'Sir Frederick Banting Secondary'],
    nearbyAmenities: ['Wellington Road Big Box Retail', 'Lambeth Arena', 'Springwater Conservation Area'],
    localBusinesses: [
      {
        name: 'Main Street Lambeth',
        category: 'Village Core',
        icon: '🏘️',
        description:
          'Before Lambeth became part of the City of London, it was its own village — and Main Street still carries that identity. Independent shops, a post office, and the kind of local character that newer subdivisions spend years trying to manufacture. Lambeth residents get both worlds: brand-new estate homes and genuine small-town walkability.',
        highlight: 'Real village character that predates the subdivision — and still thrives',
      },
      {
        name: 'Lambeth Arena',
        category: 'Recreation',
        icon: '🏒',
        description:
          'A community fixture for Lambeth families, the Lambeth Arena provides year-round ice and programming for hockey, skating, and community events. For hockey families in particular, this is an invaluable neighbourhood asset — the kind of facility that becomes the backbone of a child\'s early years.',
        highlight: 'Year-round ice and community programming for Lambeth families',
      },
      {
        name: 'Wellington Road Big-Box Retail',
        category: 'Shopping & Services',
        icon: '🛒',
        description:
          'Wellington Road South puts Lambeth within minutes of London\'s most complete big-box corridor — Costco, Home Depot, Best Buy, Cineplex, and a full complement of restaurants, grocers, and services. Commuters heading to Hwy 401 pass it daily. For families who want everything nearby without paying inner-city prices, this access is a genuine practical advantage.',
        highlight: 'Costco, Home Depot, Cineplex — all on your way out of town',
      },
      {
        name: 'Springwater Conservation Area',
        category: 'Parks & Nature',
        icon: '🌲',
        description:
          'Located just south of Lambeth, Springwater Conservation Area offers forest trails, open meadows, and natural green space managed by the Upper Thames River Conservation Authority. A quiet escape from the subdivision streets, accessible within minutes for morning walks or weekend hikes without ever hitting a highway.',
        highlight: 'Forest trails and conservation land minutes from your driveway',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Lambeth, London Ontario right now?',
        a: 'Lambeth has a healthy mix of new construction and established resale homes available throughout the year. Estate communities like Heathwoods and Privé bring new inventory regularly, while established streets also see consistent turnover. Contact Justin for current Lambeth listings and builder inventory.',
      },
      {
        q: 'How much do homes cost in Lambeth, London Ontario?',
        a: 'Lambeth home prices range from approximately $700,000 for established detached homes to over $1.1 million for large estate builds in communities like Heathwoods and Privé. New construction executive homes on premium lots often exceed $900,000. Lambeth commands a premium over the London average reflecting the newer builds, larger lots, and excellent schools.',
      },
      {
        q: 'Is Lambeth a good place to buy a house in London Ontario?',
        a: 'Lambeth is one of London\'s strongest communities for families who want newer, larger homes with excellent schools and highway access. Fraser Institute school ratings consistently exceed the provincial average, Highway 401 and 402 access is direct, and the mix of original village character and estate communities is genuinely unique in the London market.',
      },
      {
        q: 'How far is Lambeth from downtown London?',
        a: 'Lambeth is approximately 15 to 20 minutes from downtown London by car, and quick access to Highways 401 and 402 makes it ideal for commuters heading to Windsor, Kitchener-Waterloo, or Toronto. Wellington Road provides a straight shot to the city\'s south commercial corridor.',
      },
    ],
    metaTitle: 'Lambeth London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Buy or sell a home in Lambeth, London Ontario with Real Estate Broker Justin Skrypnyk. Estate communities, great schools, and quick highway access. Contact us for a complimentary evaluation.',
  },
  {
    slug: 'whitehills',
    name: 'Whitehills',
    shortName: 'Whitehills',
    headline: 'Northwest London Family Living — Three Schools, Five Parks, and London\'s Best Aquatic Centre at Your Doorstep',
    description:
      'Whitehills is an established northwest London neighbourhood where three in-boundary elementary schools, a 12-acre park, and the Canada Games Aquatic Centre make it one of the most family-complete communities in the city.',
    longDescription:
      'Whitehills developed through the 1970s and 1980s along the Wonderland Road North and Fanshawe Park corridor, and it has the lived-in character of a neighbourhood that knows what it is. The housing stock is primarily 1970s-era bungalows, split-levels, and two-storey homes on well-kept lots, alongside newer townhouse developments that attract buyers looking for lower-maintenance options at accessible prices. Three elementary schools — Emily Carr Public School, Wilfrid Jury Public School, and St. Marguerite d\'Youville Catholic School — sit within the neighbourhood boundaries, meaning most families never put their kids on a bus for elementary school. For recreation, Whitehills punches above its weight: the Canada Games Aquatic Centre at 1045 Wonderland Road North houses London\'s largest indoor pool, Medway Park brings a spray pad and the Medway-Kiwanis Skate Bowls, and Jaycee Park\'s 12.6 acres deliver a baseball diamond, soccer field, multi-sport court, and proper walking trails. The Fox Hollow Ravine corridor connects residents directly to the Medway Valley Heritage Forest — one of London\'s most significant Carolinian forest systems — without ever leaving the neighbourhood on foot.',
    mapEmbedId: 'Whitehills,+London,+Ontario,+Canada',
    geo: { lat: 42.998, lng: -81.279 },
    image: '/images/areas/whitehills-neighbourhood-london-ontario.webp',
    imageAlt: 'Residential street in Whitehills, northwest London Ontario',
    highlights: [
      'Three elementary schools within the neighbourhood — Emily Carr, Wilfrid Jury, St. Marguerite d\'Youville',
      'Canada Games Aquatic Centre — London\'s largest indoor pool at 1045 Wonderland Road North',
      'Jaycee Park: 12.6 acres with baseball diamond, soccer field, multi-sport court, and trails',
      'Medway Park: spray pad, Medway-Kiwanis Skate Bowls, community centre, and arena',
      'Norwest Optimist Park: baseball, soccer, playgrounds next to Emily Carr PS',
      'Fox Hollow Ravine trail access to Medway Valley Heritage Forest',
      'Sherwood Forest Mall with London Public Library branch at the southern edge',
      '1970s–80s detached homes at strong value with newer townhouse options',
    ],
    avgPrice: '$520,000–$720,000',
    homingTypes: ['Detached Bungalows', 'Split-Levels', 'Two-Storeys', 'Townhomes'],
    schools: [
      'Emily Carr Public School (JK–8) — 44 Hawthorne Rd',
      'Wilfrid Jury Public School (JK–8) — 950 Lawson Rd',
      'St. Marguerite d\'Youville Catholic School (JK–8) — 170 Hawthorne Rd',
      'Sir Frederick Banting Secondary School — 125 Sherwood Forest Square',
    ],
    nearbyAmenities: [
      'Canada Games Aquatic Centre (1045 Wonderland Rd N)',
      'Medway Community Centre & Skate Bowls',
      'Jaycee Park (1830 Aldersbrook Rd)',
      'Norwest Optimist Park (48 Hawthorn Rd)',
      'Sherwood Forest Mall',
      'Medway Valley Heritage Forest Trails',
    ],
    localBusinesses: [
      {
        name: 'Canada Games Aquatic Centre',
        category: 'Aquatics & Recreation',
        icon: '🏊',
        description:
          'The Canada Games Aquatic Centre at 1045 Wonderland Road North is London\'s largest indoor pool facility — and it sits steps from Medway Park, right in the heart of the Whitehills neighbourhood. Competitive lanes, recreational swimming, diving boards, swimming lessons, aquatic fitness classes, and facilities for swim meets make this the most complete aquatic centre in the city. For Whitehills families, having London\'s top pool as a neighbourhood amenity is a daily quality-of-life advantage that most communities can only wish for.',
        highlight: 'London\'s largest indoor pool — a Whitehills neighbourhood amenity',
      },
      {
        name: 'Medway Park & Skate Bowls',
        category: 'Parks & Recreation',
        icon: '🛹',
        description:
          'Medway Park on Wonderland Road North brings together a spray pad, a large playground, and the Medway-Kiwanis Skate Bowls — an intermediate-to-advanced skate facility with waves, a pump track, bowled corners, and a generous deck area. The adjacent Medway Community Centre at 119 Sherwood Forest Square houses the Ray Lanctin Memorial Arena with one ice surface, heated spectator seating, and public skating through the winter season. One corner of Wonderland Road North covers most of what a Whitehills family needs for active recreation.',
        highlight: 'Skate park, spray pad, arena, and community centre — all in one complex',
      },
      {
        name: 'Jaycee Park',
        category: 'Parks & Recreation',
        icon: '⚽',
        description:
          'Jaycee Park at 1830 Aldersbrook Road is Whitehills\' largest neighbourhood green space — 12.6 acres with a baseball diamond, soccer field, multi-sport court, playground, and well-maintained walking and running trails. The park is dog-friendly, fully accessible, and free year-round. For families who want an active outdoor life from their front door rather than a drive to a conservation area, Jaycee\'s size and variety of sports infrastructure delivers real value.',
        highlight: '12.6 acres — baseball, soccer, multi-sport court, and trails',
      },
      {
        name: 'Norwest Optimist Park',
        category: 'Parks & Recreation',
        icon: '🏟️',
        description:
          'Norwest Optimist Park at 48 Hawthorn Road sits directly beside Emily Carr Public School — a practical detail that makes after-school time seamless for local families. The park features baseball diamond(s), soccer fields, a treehouse-themed big-kid playground, a toddler playground, 4 standard swings and 2 baby swings, and a large open green valley ideal for tobogganing in winter. It\'s an unpretentious, well-used neighbourhood park that earns its place as one of Whitehills\' daily gathering spots.',
        highlight: 'Right beside Emily Carr PS — baseball, soccer, and playgrounds for every age',
      },
      {
        name: 'Medway Valley Heritage Forest',
        category: 'Parks & Nature',
        icon: '🌲',
        description:
          'The Medway Valley Heritage Forest is one of London\'s most significant natural areas — a mature Carolinian forest system with kilometres of trail accessible directly from Whitehills residential streets via the Fox Hollow Ravine corridor. Wildlife habitat, birding, and peaceful trail walking are part of the daily routine for residents who choose to use it. In a city where most neighbourhoods have to drive to reach serious nature, Whitehills residents can lace up and walk in.',
        highlight: 'Carolinian forest trail access — walking distance from Whitehills homes',
      },
    ],
    schoolsData: {
      elementary: [
        { name: 'Emily Carr Public School', address: '44 Hawthorne Road', grades: 'JK–8', board: 'TVDSB' },
        { name: 'Wilfrid Jury Public School', address: '950 Lawson Road', grades: 'JK–8', board: 'TVDSB' },
        { name: 'St. Marguerite d\'Youville Catholic School', address: '170 Hawthorne Road', grades: 'JK–8', board: 'LDCSB' },
      ],
      secondary: [
        { name: 'Sir Frederick Banting Secondary School', address: '125 Sherwood Forest Square', grades: '9–12', board: 'TVDSB' },
        { name: 'St. Thomas Aquinas Catholic Secondary School', address: '1360 Oxford Street West', grades: '9–12', board: 'LDCSB' },
      ],
    },
    parksData: {
      parks: [
        {
          name: 'Norwest Optimist Park',
          address: '48 Hawthorn Road',
          amenities: ['Baseball diamond', 'Soccer fields', 'Big-kid treehouse playground', 'Toddler playground', '4 standard swings', '2 baby swings', 'Toboggan hill (winter)', 'Open green space'],
          highlight: 'Right beside Emily Carr Public School — the daily gathering point for Whitehills families',
        },
        {
          name: 'Jaycee Park',
          address: '1830 Aldersbrook Road',
          amenities: ['Baseball diamond', 'Mini soccer field', 'Multi-sport court', 'Playground', 'Walking & biking paths', 'Open fields', 'Parking'],
          highlight: '12.6-acre park with trails — Whitehills\' largest green space',
        },
        {
          name: 'Medway Park & Medway-Kiwanis Skate Bowls',
          address: 'Wonderland Road North',
          amenities: ['Spray pad', 'Playground', 'Intermediate skate facility', 'Pump track', 'Skate bowls', 'Bench seating area'],
          highlight: 'Spray pad, skate park, and playground in one complex — adjacent to Medway Community Centre and arena',
        },
        {
          name: 'Canada Games Aquatic Centre',
          address: '1045 Wonderland Road North',
          amenities: ['Indoor pool (London\'s largest)', 'Competitive lanes', 'Recreational swimming', 'Diving boards', 'Swim lessons', 'Aquatic fitness classes', 'Parking'],
          highlight: 'London\'s top aquatic facility — steps from Medway Park in the heart of Whitehills',
        },
        {
          name: 'Medway Valley Heritage Forest',
          address: 'Via Fox Hollow Ravine corridor',
          amenities: ['Multi-km trail system', 'Carolinian forest', 'Wildlife habitat', 'Birdwatching', 'Off-leash dog area'],
          highlight: 'One of London\'s most significant natural areas — walk-in access from Whitehills residential streets',
        },
      ],
    },
    faqs: [
      {
        q: 'Are there homes for sale in Whitehills, London Ontario?',
        a: 'Whitehills has consistent inventory throughout the year — detached bungalows, two-storeys, split-levels, and townhomes across a range of price points. The neighbourhood\'s combination of three in-boundary elementary schools and strong recreation infrastructure makes it a steady choice for families. Contact Justin for current Whitehills listings.',
      },
      {
        q: 'How much do homes cost in Whitehills, London Ontario?',
        a: 'Whitehills home prices generally range from approximately $520,000 to $720,000 for detached properties, with townhomes available at more accessible price points. The neighbourhood offers real value in the northwest end — solid 1970s and 1980s construction on good lots, with some of London\'s best recreation infrastructure within walking distance.',
      },
      {
        q: 'What schools are in Whitehills, London Ontario?',
        a: 'Three elementary schools sit within the Whitehills neighbourhood boundaries: Emily Carr Public School (JK–8) at 44 Hawthorne Road, Wilfrid Jury Public School (JK–8) at 950 Lawson Road, and St. Marguerite d\'Youville Catholic School (JK–8) at 170 Hawthorne Road. High school students attend Sir Frederick Banting Secondary School at 125 Sherwood Forest Square. Having three elementary schools within walking distance is one of Whitehills\' most practical family advantages.',
      },
      {
        q: 'What parks are in Whitehills, London Ontario?',
        a: 'Whitehills has five significant parks and recreation assets: Jaycee Park (1830 Aldersbrook Rd — 12.6 acres with baseball, soccer, multi-sport court, and trails), Norwest Optimist Park (48 Hawthorn Rd — baseball, soccer, and playgrounds beside Emily Carr PS), Medway Park on Wonderland Road North (spray pad, skate facility), Gainsborough Meadows Park, and Thistledown Park. The Canada Games Aquatic Centre at 1045 Wonderland Road North — London\'s largest indoor pool — is also within the neighbourhood.',
      },
    ],
    metaTitle: 'Whitehills London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Whitehills London Ontario homes for sale. Northwest London neighbourhood with three in-boundary schools, the Canada Games Aquatic Centre, and five parks. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'west-london',
    name: 'West London',
    shortName: 'West London',
    headline: 'Established, Convenient & Genuinely Liveable — Right in the Heart of the West End',
    description:
      'West London offers mature streets, solid housing stock, and easy access to everything — anchored by Cherry Hill Mall along Commissioners Road West.',
    longDescription:
      'West London is one of the city\'s most practical and underrated communities. Centred along the Commissioners Road West corridor, the area is anchored by Cherry Hill Mall and surrounded by decades of established residential streets. Homes here are primarily bungalows and two-storeys built between the 1960s and 1980s, sitting on generous lots with mature trees and genuine neighbourhood character. Residents enjoy quick access to downtown London, the Thames River trail system, and strong transit connections in every direction. It\'s a neighbourhood that attracts buyers who want real value, central location, and a settled community feel without paying Oakridge or Byron prices.',
    mapEmbedId: 'Cherry+Hill+Mall,+Commissioners+Rd+W,+London,+Ontario,+Canada',
    geo: { lat: 42.9601, lng: -81.2171 },
    image: '/images/areas/west-london-neighbourhood-london-ontario.webp',
    imageAlt: 'Residential street in West London neighbourhood near Cherry Hill Mall, London Ontario',
    highlights: [
      'Cherry Hill Mall — retail anchor at Commissioners & Wharncliffe',
      'Mature tree-lined streets with generous lot sizes',
      'Short drive to downtown London and the Thames River',
      'Well-established bungalows and two-storeys at strong value',
      'Central location with easy access to all major corridors',
      'Practical community with parks, schools, and transit nearby',
    ],
    avgPrice: '$520,000–$720,000',
    homingTypes: ['Detached Bungalows', 'Two-Storeys', 'Semi-Detached', 'Townhomes'],
    schools: ['Mountsview Public School', 'St. Martin Catholic School', 'Sir Wilfrid Laurier Secondary School'],
    nearbyAmenities: ['Cherry Hill Mall', 'Commissioners Road West Shopping', 'Thames River Trail', 'Downtown London'],
    localBusinesses: [
      {
        name: 'Cherry Hill Mall',
        category: 'Shopping Centre',
        icon: '🛍️',
        description:
          'The anchor of West London\'s commercial core, Cherry Hill Mall at Commissioners Road West and Wharncliffe provides residents with grocery, pharmacy, banking, dining, and retail all in one walkable stop. For decades it has been the practical backbone of the neighbourhood — close enough to walk, complete enough to cover most of what a family needs.',
        highlight: 'West London\'s neighbourhood anchor — everything in one stop',
      },
      {
        name: 'Thames River Trail',
        category: 'Parks & Nature',
        icon: '🛤️',
        description:
          'West London sits close to one of London\'s most scenic stretches of the Thames Valley Parkway. The river trail connects residents on foot or bike to Springbank Park, Byron, and downtown London without touching a major road. A surprisingly underrated asset that active residents discover and never stop using.',
        highlight: 'Bike or walk to downtown London — car optional',
      },
      {
        name: 'Commissioners Road West Corridor',
        category: 'Dining & Services',
        icon: '🍽️',
        description:
          'Commissioners Road West is a well-established commercial strip with grocery, pharmacy, restaurants, and service businesses that cater to the neighbourhood\'s practical needs. It\'s not glamorous — it\'s reliable. And in a city where sprawl often separates people from services, West London\'s walkability to this corridor is genuinely valuable.',
        highlight: 'Daily essentials within walking distance — a true neighbourhood corridor',
      },
    ],
    schoolsData: {
      elementary: [
        { name: 'Byron Northview Public School', address: '1370 Commissioners Road West', grades: 'JK–8', board: 'TVDSB', notes: 'Consolidating into Riverbend Public School (Sept 2027)' },
        { name: 'Byron Somerset Public School', address: '175 Whisperwood Avenue', grades: 'JK–8', board: 'TVDSB', notes: 'Consolidating into Riverbend Public School (Sept 2027)' },
        { name: 'Byron Southwood Public School', address: '1379 Lola Street', grades: 'JK–8', board: 'TVDSB', notes: 'Consolidating into Riverbend Public School (Sept 2027)' },
        { name: 'Westmount Public School', address: '1011 Viscount Road', grades: 'JK–8', board: 'TVDSB' },
        { name: 'St. George Catholic School', address: '375 Lynden Crescent', grades: 'JK–8', board: 'LDCSB', notes: 'Serves Byron east of Boler Road and Lambeth' },
        { name: 'St. Theresa Catholic School', address: '1164 Commissioners Road West', grades: 'JK–8', board: 'LDCSB' },
        { name: 'St. Nicholas Catholic School', address: '1956 Shore Road', grades: 'JK–8', board: 'LDCSB' },
      ],
      secondary: [
        { name: 'Saunders Secondary School', address: '941 Viscount Road', grades: '9–12', board: 'TVDSB', notes: 'Serves Byron, Westmount, Lambeth, Riverbend — largest school in TVDSB (~2,000 students)' },
        { name: 'St. Thomas Aquinas Catholic Secondary School', address: '1360 Oxford Street West', grades: '9–12', board: 'LDCSB' },
      ],
      sectionNote: 'Byron Northview, Byron Somerset, and Byron Southwood public schools are consolidating into the new Riverbend Public School at 1000 Upperpoint Avenue, expected to open September 2027.',
    },
    parksData: {
      parks: [
        {
          name: 'Springbank Park',
          address: '1085 Commissioners Road West',
          amenities: ['30+ km Thames River trails', '4 mini soccer pitches', 'Picnic shelters', 'Bandshell & pavilion', 'Skate park', 'Playground', 'Wading pool', 'Storybook Gardens (paid admission)', 'BBQ stoves (bookable)', 'Parking'],
          highlight: 'London\'s largest park at 140 hectares — trails, picnics, and Storybook Gardens along the Thames River',
        },
        {
          name: 'Basil Grover Park',
          address: '555 Wharncliffe Road South',
          amenities: ['Skateboard park', 'Junior play structure', 'Senior play structure', 'Accessible swing seat', 'Soccer & open fields', 'Washrooms', 'Parking'],
          highlight: 'District park at Wharncliffe & Commissioners — skate park and accessible playground for all ages',
        },
        {
          name: 'Reservoir Park',
          address: '869 Commissioners Road West',
          amenities: ['2 mini soccer fields', 'Walking paths', 'Open green space', 'Parking'],
          highlight: 'Neighbourhood green space anchoring the Commissioners corridor',
        },
        {
          name: 'Westmount Lions Park',
          address: '784 Viscount Road',
          amenities: ['Full-size soccer field', 'Playground', 'Swings', 'Walking paths', 'Parking'],
          highlight: 'Community park in the heart of Westmount — field space and family-friendly amenities',
        },
        {
          name: 'Westmount Park',
          address: '196 McMaster Drive',
          amenities: ['Baseball diamond', 'Open green space'],
          highlight: 'Neighbourhood diamond park serving the Westmount residential streets',
        },
      ],
    },
    faqs: [
      {
        q: 'What is the cheapest area to buy a house in West London Ontario?',
        a: 'West London near the Commissioners Road West corridor offers some of the most accessible prices for an established west-end neighbourhood in London Ontario. Entry-level semi-detached homes and bungalows start in the $520,000 to $580,000 range, with larger detached two-storeys in the $620,000 to $720,000 range. It is the best value in the west end.',
      },
      {
        q: 'Are there homes for sale in West London Ontario right now?',
        a: 'West London has consistent inventory of detached bungalows, two-storeys, and semi-detached homes throughout the year. The area\'s range of price points and property types means buyers at many budgets can find opportunities here. Contact Justin for current listings.',
      },
      {
        q: 'Is West London a safe and good neighbourhood?',
        a: 'West London is an established, mature community with strong neighbourhood character and practical amenity access. Cherry Hill Mall anchors the commercial core, schools and parks are well-integrated, and transit connects the area in every direction. It is particularly well-suited to buyers seeking value in an authentic west-end London Ontario neighbourhood.',
      },
      {
        q: 'How far is West London from downtown London Ontario?',
        a: 'West London is approximately a 10 to 15 minute drive from downtown London. The Thames River trail system also provides a pleasant cycling connection through the river valley directly into the city core — no major roads required.',
      },
    ],
    metaTitle: 'West London Real Estate Broker | Justin Skrypnyk | London Ontario',
    metaDescription:
      'Homes for sale in West London, Ontario near Cherry Hill Mall. Established bungalows, central location, and genuine neighbourhood character. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'hyde-park',
    name: 'Hyde Park',
    shortName: 'Hyde Park',
    headline: 'Northwest London\'s Premier Growth Community',
    description:
      'Hyde Park is one of London\'s fastest-growing neighbourhoods — new builds, great schools, and a family-friendly atmosphere at the city\'s northwest edge.',
    longDescription:
      'Hyde Park has emerged as one of London\'s most sought-after communities for young families and move-up buyers. Located in Northwest London along Hyde Park Road and Sunningdale Drive, this neighbourhood features contemporary new-construction homes on well-designed streets. The area offers access to strong public and Catholic elementary schools, Hyde Park shopping, and the growing retail corridor at Wonderland and Sunningdale. Hyde Park is close enough to the city centre for quick commutes but far enough to offer a quieter suburban lifestyle with modern homes and pristine parks.',
    mapEmbedId: 'Hyde+Park,+London,+Ontario,+Canada',
    geo: { lat: 43.0248, lng: -81.2847 },
    image: '/images/areas/hyde-park-neighbourhood-london-ontario.webp',
    imageAlt: 'New homes in Hyde Park, London Ontario',
    highlights: [
      'One of London\'s fastest-growing residential communities',
      'Modern new construction on planned streets',
      'Strong family-oriented atmosphere',
      'Hyde Park Road shopping and services',
      'Growing Sunningdale retail node close by',
    ],
    avgPrice: '$700,000–$1,050,000',
    homingTypes: ['New Construction', 'Detached', 'Semi-Detached', 'Townhomes'],
    schools: ['Arthur Ford Public School', 'Holy Cross Catholic Elementary', 'A.B. Lucas Secondary School'],
    nearbyAmenities: ['Chopped Leaf', 'Gordon\'s Gold Jewellers', 'Starbucks', 'Walmart Supercenter', 'Medway Community Centre'],
    localBusinesses: [
      {
        name: 'Chopped Leaf — Hyde Park Road',
        category: 'Restaurant — Healthy Fast-Casual',
        icon: '🥗',
        description:
          'Right on Hyde Park Road, Chopped Leaf serves chef-designed salads, wraps, and bowls that have become a staple for the neighbourhood\'s health-conscious families. Locally owned and operated, the Hyde Park location was born from a belief that nutritious food should be fast, delicious, and accessible — not a compromise. Bold signature dressings and fully customizable options for every diet.',
        highlight: 'Nutritious, fast, and genuinely delicious — a Hyde Park Road staple',
      },
      {
        name: 'Gordon\'s Gold Jewellers',
        category: 'Fine Jewellery',
        icon: '💎',
        description:
          'At 760 Hyde Park Road, Gordon\'s Gold has been serving west London since 1983. A multi-time winner of London\'s "Best Jewellers," this is the neighbourhood\'s go-to for engagement rings, custom goldsmith work, diamonds, and rare gemstones. American Gemological Society certified and proud member of the London Chamber of Commerce — the kind of independent jeweller that keeps generations of local families coming back.',
        highlight: 'West London\'s most trusted jeweller — 40+ years on Hyde Park Road',
      },
      {
        name: 'Walmart Supercenter — Hyde Park',
        category: 'Grocery & Retail',
        icon: '🛒',
        description:
          'A full Walmart Supercenter in Hyde Park means residents have access to full grocery, pharmacy, clothing, electronics, and general merchandise all in one location. Combined with the specialty shops along the corridor, Hyde Park residents enjoy retail coverage that many newer communities have to drive much further to reach.',
        highlight: 'Full Supercenter grocery and retail — complete neighbourhood coverage',
      },
      {
        name: 'Medway Community Centre',
        category: 'Recreation',
        icon: '🏊',
        description:
          'The Medway Community Centre provides Hyde Park families with year-round recreation — an indoor pool, fitness facilities, ice surface, and programming for all ages. For families with young kids and active adults, having a full-service community centre within the neighbourhood eliminates the need to drive across the city for fitness and recreation.',
        highlight: 'Pool, ice, and fitness — complete recreation without leaving the neighbourhood',
      },
    ],
    faqs: [
      {
        q: 'Are there new homes for sale in Hyde Park, London Ontario?',
        a: 'Yes — Hyde Park has some of London\'s most active new construction markets, with builders regularly releasing new inventory in planned communities throughout the neighbourhood. Resale homes also come to market consistently. Contact Justin to access current Hyde Park listings and new builder releases.',
      },
      {
        q: 'How much do homes cost in Hyde Park, London Ontario?',
        a: 'Hyde Park homes for sale typically range from $700,000 to $1,050,000 for detached properties. New construction two-storeys on well-designed streets are in the $750,000 to $950,000 range, with larger executive builds above that. Semi-detached and townhomes offer more accessible entry points from $550,000.',
      },
      {
        q: 'Is Hyde Park a good place to raise a family in London Ontario?',
        a: 'Hyde Park is one of London\'s top communities for young families. Modern new construction, strong schools (Arthur Ford, Holy Cross Catholic, A.B. Lucas Secondary), the Medway Community Centre\'s pool and ice facilities, and a family-oriented community culture make it one of the most sought-after areas in northwest London.',
      },
      {
        q: 'What schools are in Hyde Park, London Ontario?',
        a: 'Hyde Park is served by Arthur Ford Public School and Holy Cross Catholic Elementary at the elementary level, and A.B. Lucas Secondary School for high school. The area has seen consistent school expansion to keep pace with its rapid residential growth.',
      },
    ],
    metaTitle: 'Hyde Park London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Hyde Park London Ontario homes for sale. New construction, family-friendly streets, great schools. Work with local Real Estate Broker Justin Skrypnyk to find your perfect Hyde Park home.',
  },
  {
    slug: 'komoka',
    name: 'Komoka',
    shortName: 'Komoka',
    headline: 'Small-Town Charm, 10 Minutes from London',
    description:
      'Komoka offers peaceful small-town living, conservation areas, and a strong community spirit — with the City of London just minutes away.',
    longDescription:
      'Komoka is a charming community in Middlesex Centre, located just 10 minutes west of London along the Thames River. The town features a unique mix of older character homes on large lots, newer subdivisions, and rural estate properties that appeal to buyers seeking space and tranquillity. Komoka Provincial Park offers hiking, wildlife, and natural river scenery right at residents\' doorsteps. The community has its own elementary school, recreation centre, and a growing selection of local businesses. For buyers who want space, nature, and small-town character without sacrificing city proximity, Komoka is an exceptional choice.',
    mapEmbedId: 'Komoka,+Ontario,+Canada',
    geo: { lat: 42.9709, lng: -81.4092 },
    image: '/images/areas/komoka-ontario-real-estate.webp',
    imageAlt: 'Scenic Komoka Ontario community near the Thames River',
    highlights: [
      'Komoka Provincial Park — trails, river, and wildlife',
      '10 minutes west of London via Commissioners Rd W',
      'Large lots and peaceful small-town atmosphere',
      'Mix of older character homes and newer builds',
      'Strong community feel with local events and businesses',
    ],
    avgPrice: '$600,000–$900,000',
    homingTypes: ['Detached', 'Rural Estates', 'Character Homes', 'New Builds'],
    schools: ['Komoka Public School', 'St. Patrick Catholic Elementary'],
    nearbyAmenities: ['Komoka Provincial Park', 'Middlesex Centre Recreation', 'Thames River Trails'],
    localBusinesses: [
      {
        name: 'Komoka Provincial Park',
        category: 'Parks & Nature',
        icon: '🌲',
        description:
          'One of Ontario\'s most scenic provincial parks sits at Komoka\'s edge — forested trails, Thames River frontage, and wildlife habitat that make this feel genuinely removed from city life. Hiking, birdwatching, cross-country skiing, and simple riverside walks are all part of the weekly rhythm for Komoka residents. This is not a "nearby park" — it is the community\'s defining feature.',
        highlight: 'Ontario Provincial Park — your backyard, not a day trip',
      },
      {
        name: 'Middlesex Centre Recreation',
        category: 'Recreation',
        icon: '🏒',
        description:
          'Komoka\'s community recreation centre provides residents with ice programs, fitness space, and community event capacity that punches well above a town this size. Middlesex Centre has invested consistently in recreation infrastructure, and it shows — families relocating from London are often surprised by the quality of what\'s available here.',
        highlight: 'Amenities that rival the city — at a fraction of the property tax',
      },
      {
        name: 'Thames River Access',
        category: 'Parks & Nature',
        icon: '🚣',
        description:
          'Komoka sits along the Thames River in one of its most scenic stretches west of London. Fishing, kayaking, nature walks, and simple river-watching are part of everyday life here. The river corridor connects Komoka to the broader Thames Valley conservation network — giving residents access to natural space that urban neighbourhoods simply cannot offer.',
        highlight: 'River access, fishing, kayaking — a natural lifestyle built in',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Komoka, Ontario right now?',
        a: 'Komoka has a steady market of character homes, newer builds, and rural estate properties. Inventory is smaller than urban London but turns over consistently throughout the year. Contact Justin for current Komoka listings — he serves Middlesex Centre and the surrounding communities west of London.',
      },
      {
        q: 'How much do homes cost in Komoka, Ontario?',
        a: 'Komoka home prices range from approximately $600,000 to $900,000, with larger rural estate properties exceeding that. The price reflects the generous lot sizes, Komoka Provincial Park access, and the premium buyers place on the small-town lifestyle within 10 minutes of London\'s amenities.',
      },
      {
        q: 'How far is Komoka from London Ontario?',
        a: 'Komoka is approximately 10 minutes west of London along Commissioners Road West / Highway 2. It is part of Middlesex Centre and considered a genuine alternative to urban London living for buyers who want more space, nature, and community character without a long commute.',
      },
      {
        q: 'Is Komoka a good investment for real estate?',
        a: 'Komoka offers a unique value proposition: large lots, natural amenity access (Komoka Provincial Park, Thames River), and small-town character at prices below what comparable land and space would cost inside the City of London. As London continues to grow westward, Komoka\'s proximity to the city supports long-term property value.',
      },
    ],
    metaTitle: 'Komoka Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Komoka Ontario homes for sale. Peaceful small-town living 10 minutes from London. Real Estate Broker Justin Skrypnyk specializes in Komoka and West London real estate. Call 519.639.5176.',
  },
  {
    slug: 'old-north',
    name: 'Old North',
    shortName: 'Old North',
    headline: 'London\'s Most Storied Heritage Neighbourhood',
    description:
      'Old North is London\'s premier heritage district — wide streets lined with Victorian and Edwardian homes, walkable to Western University, and rich with architectural history.',
    longDescription:
      'Old North occupies the wedge north of downtown between Richmond Street and Adelaide Street, stretching up to Fanshawe Park Road. The neighbourhood is defined by its exceptional stock of Victorian, Edwardian, and early 20th-century homes on large lots with mature canopy trees. Richmond Row — London\'s most vibrant dining and nightlife strip — runs along the western edge. Western University is steps away, as is the Thames River trail system. Old North consistently attracts buyers who value character, walkability, and proximity to the city\'s best cultural amenities.',
    mapEmbedId: 'Old+North,+London,+Ontario,+Canada',
    geo: { lat: 43.003, lng: -81.270 },
    image: '/images/areas/old-north-neighbourhood-london-ontario.webp',
    imageAlt: 'Heritage homes on a tree-lined street in Old North, London Ontario',
    highlights: [
      'Victorian and Edwardian heritage homes on large lots',
      'Walking distance to Western University and Richmond Row',
      'Thames River trail access and Gibbons Park nearby',
      'Some of London\'s most architecturally significant residential streets',
      'Strong rental and investment demand from the university community',
    ],
    avgPrice: '$600,000–$950,000',
    homingTypes: ['Detached Heritage', 'Semi-Detached', 'Converted Flats', 'Infill New Builds'],
    schools: ['Lorne Avenue Public School', 'St. Michael Catholic Elementary', 'A.B. Lucas Secondary School'],
    nearbyAmenities: ['Richmond Row', 'Western University', 'Gibbons Park', 'Thames River Trail', 'Covent Garden Market'],
    localBusinesses: [
      {
        name: 'Richmond Row',
        category: 'Dining & Nightlife',
        icon: '🍷',
        description:
          'Richmond Street between Oxford and Cheapside is one of southern Ontario\'s best independent dining and nightlife districts. Dozens of restaurants, bars, patios, and boutiques line this strip, bringing a lively urban energy that Old North residents can walk to in minutes. Whether it\'s a Friday night dinner or a Saturday afternoon browse, Richmond Row is at the doorstep.',
        highlight: 'Southern Ontario\'s best independent restaurant strip — walkable from home',
      },
      {
        name: 'Gibbons Park',
        category: 'Parks & Nature',
        icon: '🌳',
        description:
          'One of London\'s most beloved urban parks, Gibbons Park runs along the North Branch of the Thames River in Old North. Mature trees, open meadows, a wading pool, and riverside walking paths make it a daily destination for residents. The Thames Valley Parkway passes directly through, connecting Old North walkers and cyclists to Springbank Park and beyond.',
        highlight: 'London\'s most beloved urban park — right in the neighbourhood',
      },
      {
        name: 'Western University',
        category: 'Education & Culture',
        icon: '🎓',
        description:
          'One of Canada\'s top research universities is Old North\'s neighbour and defining economic anchor. Western brings cultural events, athletic facilities, community programming, and — for investors — perpetually strong rental demand. The proximity to campus makes Old North properties consistently attractive to university-affiliated buyers and long-term rental investors.',
        highlight: 'Canada\'s top university — cultural hub and investment driver',
      },
      {
        name: 'Covent Garden Market',
        category: 'Food & Culture',
        icon: '🥕',
        description:
          'A short cycle or drive from Old North, Covent Garden Market in downtown London is the city\'s year-round public market — fresh produce, artisan goods, local vendors, and prepared food. It anchors the western edge of the downtown core and is a Saturday morning ritual for many Old North families who make the short trip into the city\'s cultural heart.',
        highlight: 'London\'s public market heart — a quick ride from Old North',
      },
    ],
    faqs: [
      {
        q: 'Are there heritage homes for sale in Old North, London Ontario?',
        a: 'Yes — Old North has the largest concentration of heritage Victorian and Edwardian homes in London Ontario. Properties come to market throughout the year, ranging from original character homes needing renovation to fully updated heritage properties ready to move into. Contact Justin for current Old North listings.',
      },
      {
        q: 'How much do homes cost in Old North, London Ontario?',
        a: 'Old North home prices range from approximately $600,000 to $950,000 for detached heritage properties, with significant variation based on size, condition, and proximity to Western University and Richmond Row. Smaller semis and converted properties can start around $500,000, while large fully-renovated Victorian homes can exceed $1 million.',
      },
      {
        q: 'Is Old North a good investment neighbourhood in London Ontario?',
        a: 'Old North is one of London\'s strongest investment neighbourhoods. Proximity to Western University drives consistently high rental demand, heritage properties are irreplaceable and appreciate well, and the walkability to Richmond Row and downtown makes it attractive to both students and young professionals. Many investors maintain multi-unit properties in Old North.',
      },
      {
        q: 'What is Old North, London Ontario known for?',
        a: 'Old North is London\'s premier heritage residential neighbourhood — known for its architectural character (Victorian and Edwardian homes), mature tree canopy, walkability to Western University and Richmond Row, and the community culture of one of London\'s most engaged and historically conscious neighbourhoods.',
      },
    ],
    metaTitle: 'Old North London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Old North London Ontario homes for sale. Heritage properties, walk to Western University and Richmond Row. Real Estate Broker Justin Skrypnyk serves all of London Ontario.',
  },
  {
    slug: 'masonville',
    name: 'Masonville',
    shortName: 'Masonville',
    headline: 'North London\'s Upscale Hub for Families and Professionals',
    description:
      'Masonville combines premium shopping, excellent schools, and newer suburban streets — making it one of London\'s most desirable north-end communities.',
    longDescription:
      'Masonville sits in north London centred around Masonville Place — the city\'s most upscale shopping mall — at the intersection of Richmond Street and Fanshawe Park Road. The neighbourhood attracts families and professionals who want newer construction, proximity to Western University, and access to London\'s most complete north-end retail and dining corridor. Streets are well-planned with parks and green space integrated throughout. Strong school options and a short commute to downtown or the hospital corridor make Masonville a consistently competitive market.',
    mapEmbedId: 'Masonville,+London,+Ontario,+Canada',
    geo: { lat: 43.025, lng: -81.249 },
    image: '/images/areas/masonville-neighbourhood-london-ontario.webp',
    imageAlt: 'Residential street in Masonville, north London Ontario',
    highlights: [
      'Masonville Place — London\'s premier shopping destination',
      'Newer construction with modern layouts and finishes',
      'Short drive to Western University and hospital corridor',
      'Excellent north London school options',
      'Richmond Street corridor for dining and services',
    ],
    avgPrice: '$650,000–$950,000',
    homingTypes: ['Detached', 'Semi-Detached', 'Townhomes', 'Condos'],
    schools: ['Masonville Public School', 'St. Catherine of Siena Catholic Elementary', 'Sir Frederick Banting Secondary'],
    nearbyAmenities: ['Masonville Place Mall', 'Richmond Street Dining', 'Western University', 'Stoney Creek Conservation Area'],
    localBusinesses: [
      {
        name: 'Masonville Place',
        category: 'Shopping Centre',
        icon: '🛍️',
        description:
          'London\'s most upscale shopping destination anchors the Masonville neighbourhood — over 180 stores including major department stores, designer brands, specialty retailers, and a complete dining options. Masonville Place at Richmond and Fanshawe puts residents within walking distance of London\'s premier retail experience. It\'s the north end\'s definitive lifestyle anchor.',
        highlight: 'London\'s premier shopping destination — steps from home',
      },
      {
        name: 'Richmond Street Dining Corridor',
        category: 'Dining & Services',
        icon: '🍽️',
        description:
          'Richmond Street north through Masonville offers one of London\'s best concentrations of casual and upscale dining, coffee shops, fitness studios, and specialty services. Whether it\'s a weeknight dinner or a weekend brunch run, Masonville residents have the full spectrum of dining and service at their immediate disposal.',
        highlight: 'Complete dining and service corridor — walking distance from most homes',
      },
      {
        name: 'Stoney Creek Conservation Area',
        category: 'Parks & Nature',
        icon: '🌿',
        description:
          'A tucked-away natural gem in north London, the Stoney Creek valley and conservation corridor winds through the Masonville area, offering walking trails, natural forest, and a genuine escape from the suburban grid. For residents who want nature accessible without a long drive, this quiet conservation corridor is a meaningful quality-of-life asset.',
        highlight: 'Nature trail access hidden within north London\'s urban fabric',
      },
      {
        name: 'Western University',
        category: 'Education & Culture',
        icon: '🎓',
        description:
          'One of Canada\'s top research universities is minutes from Masonville\'s doorstep. Western drives significant economic and cultural activity in the north end — from sports events and concerts at Western\'s facilities to ongoing employment for thousands of local residents. For investors, proximity to campus supports strong long-term rental demand.',
        highlight: 'Canada\'s top university — minutes away and economically transformative',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Masonville, London Ontario?',
        a: 'Masonville has consistent inventory of detached homes, semis, townhomes, and condos throughout the year. The neighbourhood\'s desirability means listings move quickly in most market conditions. Contact Justin for current Masonville listings and to be notified as new properties come available.',
      },
      {
        q: 'How much do homes cost in Masonville, London Ontario?',
        a: 'Masonville home prices range from approximately $650,000 to $950,000 for detached properties. Condos and townhomes can start below $500,000. The neighbourhood commands a north-end premium reflecting proximity to Masonville Place, Western University, and strong school options.',
      },
      {
        q: 'Is Masonville a good neighbourhood for families in London Ontario?',
        a: 'Masonville is one of London\'s top family neighbourhoods in the north end. Strong schools (Masonville Public, St. Catherine of Siena Catholic, Sir Frederick Banting Secondary), walkable access to Masonville Place for everyday needs, proximity to Western University, and well-planned streets with parks make it consistently competitive for family buyers.',
      },
      {
        q: 'What is Masonville like for shopping and amenities?',
        a: 'Masonville has arguably London\'s best concentration of retail and dining in a single corridor. Masonville Place offers over 180 stores, and the Richmond Street corridor provides restaurants, services, and specialty shops in every direction. Residents describe having everything they need within a 5-minute walk or drive.',
      },
    ],
    metaTitle: 'Masonville London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Masonville London Ontario homes for sale. North London\'s upscale neighbourhood near Masonville Place and Western University. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'sunningdale',
    name: 'Sunningdale',
    shortName: 'Sunningdale',
    headline: 'Far North London\'s Fastest-Growing Family Community',
    description:
      'Sunningdale is one of London\'s newest and fastest-growing neighbourhoods — modern homes, excellent schools, and a strong sense of community at the city\'s northern edge.',
    longDescription:
      'Sunningdale runs along Sunningdale Road in the far north of London, where the city gives way to open countryside. This is predominantly new construction — planned subdivisions with modern two-storeys, townhomes, and executive homes on well-designed streets. The neighbourhood is popular with young families who want larger, newer homes at slightly more accessible prices than Masonville or Hyde Park. The North Thames River and conservation corridors are nearby, giving residents access to natural greenspace. Retail is growing quickly at the Sunningdale Road intersections, and the area has seen consistent school expansion to meet demand.',
    mapEmbedId: 'Sunningdale,+London,+Ontario,+Canada',
    geo: { lat: 43.048, lng: -81.262 },
    image: '/images/areas/sunningdale-neighbourhood-london-ontario.webp',
    imageAlt: 'New homes in Sunningdale, north London Ontario',
    highlights: [
      'New construction communities at London\'s northern growth edge',
      'Family-oriented streets with parks and green corridors',
      'Growing retail at Sunningdale & Richmond, and Sunningdale & Hyde Park',
      'North Thames River conservation access nearby',
      'Strong school growth tracking the community\'s expansion',
    ],
    avgPrice: '$650,000–$1,000,000',
    homingTypes: ['New Construction', 'Detached', 'Semi-Detached', 'Townhomes'],
    schools: ['Sunningdale Public School', 'St. Kateri Tekakwitha Catholic Elementary', 'Sir Frederick Banting Secondary'],
    nearbyAmenities: ['North Thames River Trails', 'Sunningdale Road Retail', 'Medway Heritage Forest'],
    localBusinesses: [
      {
        name: 'Medway Heritage Forest',
        category: 'Parks & Nature',
        icon: '🌲',
        description:
          'The Medway Heritage Forest is one of London\'s most significant urban forest reserves — a mature Carolinian forest system adjacent to the Sunningdale community that provides walking trails, wildlife habitat, and a genuinely rare urban natural space. Sunningdale families access these trails directly, making outdoor recreation a routine part of daily life rather than a weekend drive.',
        highlight: 'Carolinian urban forest — rare natural access right from the neighbourhood',
      },
      {
        name: 'North Thames River Conservation Corridor',
        category: 'Parks & Nature',
        icon: '🚶',
        description:
          'The North Thames River runs near Sunningdale, and its conservation corridor provides trail access, natural green space, and a quiet river environment that contrasts beautifully with the neighbourhood\'s newer residential streets. As Sunningdale grows, this natural buffer has been protected, giving long-term residents a meaningful outdoor asset.',
        highlight: 'Natural river corridor and trails — preserved alongside residential growth',
      },
      {
        name: 'Sunningdale Road Retail Nodes',
        category: 'Shopping & Services',
        icon: '🛍️',
        description:
          'The retail nodes at Sunningdale & Richmond and Sunningdale & Hyde Park Road are growing rapidly to serve the area\'s expanding population. Grocery, pharmacy, coffee, and service businesses are establishing here — and the pace of new retail development is tracking closely with the community\'s residential growth. Residents already have meaningful day-to-day amenity without leaving Sunningdale.',
        highlight: 'Growing retail infrastructure keeping pace with one of London\'s fastest communities',
      },
    ],
    faqs: [
      {
        q: 'Are there new homes for sale in Sunningdale, London Ontario?',
        a: 'Sunningdale is one of London\'s most active new construction markets, with multiple builders releasing new inventory in planned communities along the Sunningdale Road corridor. Resale homes from early phases of development also come to market regularly. Contact Justin for current Sunningdale listings and new builder releases.',
      },
      {
        q: 'How much do homes cost in Sunningdale, London Ontario?',
        a: 'Sunningdale home prices range from approximately $650,000 to $1,000,000, with new construction two-storeys in the $700,000 to $900,000 range and executive builds above that. Prices reflect the newer construction, modern layouts, and the area\'s strong growth trajectory.',
      },
      {
        q: 'Is Sunningdale a good place to buy a new home in London Ontario?',
        a: 'Sunningdale is an excellent choice for buyers who want new construction in a growing north London community. Modern home layouts, strong schools (including Sir Frederick Banting Secondary), proximity to Medway Heritage Forest and North Thames River trails, and growing retail amenity make it one of London\'s most compelling options for young families.',
      },
      {
        q: 'What is being built in Sunningdale, London Ontario?',
        a: 'Sunningdale is seeing active development from multiple London-area builders, with new phases of planned subdivisions offering detached two-storeys, semi-detached homes, and townhomes. The Sunningdale & Richmond and Sunningdale & Hyde Park retail nodes are also expanding with grocery, pharmacy, and service businesses.',
      },
    ],
    metaTitle: 'Sunningdale London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Sunningdale London Ontario homes for sale. New construction in north London with great schools and growing amenities. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'fox-hollow',
    name: 'Fox Hollow',
    shortName: 'Fox Hollow',
    headline: 'Northwest London Family Living Near the Thames and Trails',
    description:
      'Fox Hollow is a quiet northwest London neighbourhood with newer homes, natural ravine access, and easy reach of Hyde Park Road amenities and the Thames River trail system.',
    longDescription:
      'Fox Hollow occupies the northwest corner of London near the North Thames River and Medway Creek corridors. The neighbourhood is predominantly newer suburban construction — clean streets, well-kept lots, and a family-focused community atmosphere. Residents enjoy direct access to London\'s ravine trail network and conservation areas, while still being minutes from the Hyde Park Road commercial corridor at Oxford Street. It\'s a neighbourhood that attracts buyers who want space, nature, and good schools without paying the premium of Hyde Park to the south.',
    mapEmbedId: 'Fox+Hollow,+London,+Ontario,+Canada',
    geo: { lat: 43.040, lng: -81.310 },
    image: '/images/areas/fox-hollow-neighbourhood-london-ontario.webp',
    imageAlt: 'Family homes near natural ravine in Fox Hollow, London Ontario',
    highlights: [
      'Backing onto North Thames River and Medway Creek ravine trails',
      'Newer family homes in a quiet northwest pocket of the city',
      'Minutes from Hyde Park Road shops and Oxford Street',
      'Conservation land access without leaving the neighbourhood',
      'Strong community feel with low through-traffic streets',
    ],
    avgPrice: '$600,000–$900,000',
    homingTypes: ['Detached', 'Semi-Detached', 'Townhomes'],
    schools: ['Fox Hollow Public School', 'Holy Cross Catholic Elementary', 'A.B. Lucas Secondary School'],
    nearbyAmenities: ['Medway Heritage Forest', 'Thames Valley Parkway', 'Hyde Park Road Retail', 'Stoney Creek Conservation'],
    localBusinesses: [
      {
        name: 'Medway Heritage Forest',
        category: 'Parks & Nature',
        icon: '🌿',
        description:
          'The Medway Heritage Forest is one of London\'s most significant conservation areas — a mature Carolinian forest with walking trails, wildlife corridors, and protected natural habitat directly accessible from Fox Hollow. This is not a neighbourhood amenity across town — it is at the edge of the community, making outdoor life genuinely part of the daily routine for Fox Hollow residents.',
        highlight: 'Carolinian forest trail access — from your neighbourhood, not a drive away',
      },
      {
        name: 'Thames Valley Parkway — Northwest Stretch',
        category: 'Recreation & Trails',
        icon: '🚴',
        description:
          'The Thames Valley Parkway\'s northwest section runs close to Fox Hollow, connecting residents on foot or bike to the broader 35-kilometre trail network that winds through London. Cyclists can reach downtown London or Springbank Park without touching a major road. For active families, this trail access is one of Fox Hollow\'s most underappreciated assets.',
        highlight: '35km of connected trail — northwest London\'s recreational backbone',
      },
      {
        name: 'Hyde Park Road Commercial Corridor',
        category: 'Shopping & Services',
        icon: '🛒',
        description:
          'Hyde Park Road at Oxford Street puts Fox Hollow residents within minutes of one of west London\'s most complete commercial corridors — Walmart Supercenter, Chopped Leaf, Gordon\'s Gold Jewellers, pharmacy, and a full range of service businesses. The convenience of Hyde Park Road access, combined with Fox Hollow\'s quieter residential streets, is a combination that attracts buyers who want both.',
        highlight: 'Complete commercial corridor — minutes from the front door',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Fox Hollow, London Ontario?',
        a: 'Fox Hollow has consistent inventory of detached, semi-detached, and townhome properties throughout the year. The neighbourhood\'s quieter location and nature access attract a loyal buyer profile. Contact Justin for current Fox Hollow listings.',
      },
      {
        q: 'How much do homes cost in Fox Hollow, London Ontario?',
        a: 'Fox Hollow home prices typically range from $600,000 to $900,000 for detached properties. Semi-detached and townhomes can start below $550,000. Prices are generally more accessible than nearby Hyde Park while offering comparable access to nature trails, schools, and Hyde Park Road amenities.',
      },
      {
        q: 'What makes Fox Hollow a good neighbourhood in London Ontario?',
        a: 'Fox Hollow\'s combination of newer family homes, direct Medway Heritage Forest and Thames Valley Parkway trail access, low through-traffic streets, and proximity to Hyde Park Road amenities creates an unusually liveable northwest London community. It is particularly suited to nature-focused families who want good schools and an active outdoor lifestyle.',
      },
      {
        q: 'What schools serve Fox Hollow in London Ontario?',
        a: 'Fox Hollow is served by Fox Hollow Public School and Holy Cross Catholic Elementary at the elementary level, and A.B. Lucas Secondary School for high school students — the same well-regarded schools serving the broader Hyde Park / northwest London area.',
      },
    ],
    metaTitle: 'Fox Hollow London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Fox Hollow London Ontario homes for sale. Northwest London neighbourhood with ravine trails and family homes. Real Estate Broker Justin Skrypnyk serves all of London Ontario.',
  },
  {
    slug: 'downtown',
    name: 'Downtown London',
    shortName: 'Downtown',
    headline: 'London\'s Urban Core — Culture, Dining, and a Growing Condo Market',
    description:
      'Downtown London is the city\'s beating heart — Budweiser Gardens, Covent Garden Market, Richmond Row, Dundas Place, and a rapidly growing residential condo scene.',
    longDescription:
      'Downtown London spans the core of the city between the two branches of the Thames River. The neighbourhood has undergone significant revitalization — Dundas Place is now a pedestrian-flex street lined with patios and events, Covent Garden Market anchors the west end of downtown, and new high-rise residential development is bringing hundreds of new residents into the core each year. Budweiser Gardens hosts major concerts and the London Knights. Richmond Row provides one of southern Ontario\'s best independent dining and nightlife strips. For buyers who want an urban lifestyle — walking to work, culture at your doorstep, and no need for a car — downtown London is the only answer.',
    mapEmbedId: 'Downtown+London,+Ontario,+Canada',
    geo: { lat: 42.984, lng: -81.245 },
    image: '/images/areas/downtown-london-ontario.webp',
    imageAlt: 'Downtown London Ontario skyline with Dundas Street',
    highlights: [
      'Dundas Place — London\'s pedestrian flex street and event hub',
      'Budweiser Gardens for concerts, Knights hockey, and major events',
      'Covent Garden Market — year-round local food and artisan hub',
      'Richmond Row dining and nightlife — the best in southwestern Ontario',
      'Growing condo market with strong urban rental demand',
    ],
    avgPrice: '$350,000–$700,000',
    homingTypes: ['Condos', 'Lofts', 'Converted Heritage', 'High-Rise Apartments'],
    schools: ['Simcoe Street Public School', 'St. Peter\'s Catholic Secondary', 'H.B. Beal Secondary School'],
    nearbyAmenities: ['Budweiser Gardens', 'Covent Garden Market', 'Richmond Row', 'Dundas Place', 'Victoria Park', 'Museum London'],
    localBusinesses: [
      {
        name: 'Budweiser Gardens',
        category: 'Entertainment',
        icon: '🎵',
        description:
          'London\'s premier entertainment venue hosts the London Knights — one of the OHL\'s most storied franchises — along with major concerts, family shows, and sporting events year-round. For downtown residents, Budweiser Gardens is a literal walk away: no parking, no commute, just a short stroll to world-class entertainment. This is the kind of urban amenity that defines downtown living.',
        highlight: 'London Knights, major concerts, year-round events — walk there from home',
      },
      {
        name: 'Covent Garden Market',
        category: 'Food & Culture',
        icon: '🥕',
        description:
          'London\'s year-round public market is one of the most beloved institutions in the city. Fresh produce, local vendors, artisan foods, prepared meals, and specialty items from southwestern Ontario\'s farming community all converge here on a daily basis. Saturday mornings at Covent Garden are a downtown ritual — the kind of market culture that makes urban living genuinely rich.',
        highlight: 'London\'s public market heart — year-round and genuinely local',
      },
      {
        name: 'Dundas Place',
        category: 'Urban Culture',
        icon: '🎭',
        description:
          'Dundas Place is London\'s bold pedestrian-flex street experiment — a block of Dundas Street transformed into a programmable urban space with retractable bollards, patio culture, street festivals, and events that activate the downtown core year-round. It represents London\'s urban ambition and has drawn new residents, businesses, and cultural energy into the heart of the city.',
        highlight: 'London\'s most ambitious urban street — festivals, patios, and culture year-round',
      },
      {
        name: 'Richmond Row',
        category: 'Dining & Nightlife',
        icon: '🍷',
        description:
          'Richmond Street from Oxford to Cheapside is one of southern Ontario\'s best independent dining and nightlife districts — dozens of restaurants, bars, patios, and boutiques that consistently punch above London\'s population weight. For downtown condo residents, Richmond Row is an extension of their living room: the place to eat, drink, and spend a weekend evening without ever getting in a car.',
        highlight: 'Southern Ontario\'s best restaurant row — your backyard as a downtown resident',
      },
      {
        name: 'Victoria Park',
        category: 'Parks & Events',
        icon: '🌳',
        description:
          'Downtown London\'s centrepiece park hosts the London Rib Fest, Sunfest, and dozens of other community events throughout the year. The park\'s mature trees, central fountain, and open lawns provide a genuine urban green space within steps of downtown condo buildings. For downtown residents, Victoria Park is the neighbourhood\'s outdoor living room.',
        highlight: 'Year-round festivals and events — London\'s downtown backyard',
      },
    ],
    faqs: [
      {
        q: 'Are there condos for sale in downtown London Ontario?',
        a: 'Yes — downtown London has a growing and active condo market, with both established buildings and new high-rise developments offering a range of units. Studio, one-bedroom, and two-bedroom condos are the most common, with prices ranging from $350,000 to $700,000 depending on size, floor, and building. Contact Justin for current downtown London condo listings.',
      },
      {
        q: 'How much does a condo cost in downtown London Ontario?',
        a: 'Downtown London condo prices range from approximately $350,000 for smaller studio and one-bedroom units to $700,000+ for larger two-bedroom units with premium finishes and views. Converted heritage lofts and new high-rise units command varying premiums based on building and location.',
      },
      {
        q: 'Is downtown London Ontario a good place to buy real estate?',
        a: 'Downtown London is experiencing significant revitalization investment with Dundas Place, Covent Garden Market improvements, new residential development, and a growing cultural and hospitality scene. For urban lifestyle buyers and investors seeking rental income near Budweiser Gardens and Richmond Row, downtown London offers compelling value compared to equivalent urban addresses in larger Canadian cities.',
      },
      {
        q: 'What is there to do in downtown London Ontario?',
        a: 'Downtown London offers Budweiser Gardens (London Knights hockey, major concerts), Covent Garden Market (year-round public market), Dundas Place (pedestrian flex street with events), Richmond Row (southern Ontario\'s best independent restaurant strip), Victoria Park (festivals and events), and Museum London. It is one of the most culturally rich addresses in southwestern Ontario.',
      },
    ],
    metaTitle: 'Downtown London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Downtown London Ontario condos and homes for sale. Urban lifestyle near Richmond Row, Budweiser Gardens, and Covent Garden Market. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'south-london',
    name: 'South London',
    shortName: 'South London',
    headline: 'Established South-End Living Between Downtown and the 401',
    description:
      'South London sits between the city\'s core and its southern highway edge — a mix of post-war bungalows, infill new builds, and convenient access to Wellington Road retail.',
    longDescription:
      'South London encompasses the established residential neighbourhoods south of Commissioners Road and north of the 401 corridor, roughly between Wharncliffe Road and Wellington Road. The area is made up primarily of post-war bungalows and two-storeys on solidly sized lots, with a growing number of infill new builds as the neighbourhood attracts renovation and reinvestment. Residents have fast access to White Oaks Mall, Wellington Road big-box retail, and Hwy 401. South London is a value-oriented neighbourhood that consistently attracts buyers who want proximity to the south end\'s amenities without the price premium of Lambeth.',
    mapEmbedId: 'South+London,+Ontario,+Canada',
    geo: { lat: 42.963, lng: -81.243 },
    image: '/images/areas/south-london-neighbourhood-ontario.webp',
    imageAlt: 'Residential street in South London, Ontario',
    highlights: [
      'Post-war bungalows and two-storeys at solid value',
      'Minutes to White Oaks Mall and Wellington Road retail',
      'Quick access to Hwy 401 and Lambeth',
      'Growing infill new build activity',
      'Convenient to both downtown and south London amenities',
    ],
    avgPrice: '$490,000–$700,000',
    homingTypes: ['Detached Bungalows', 'Two-Storeys', 'Semi-Detached', 'New Infill'],
    schools: ['Brigadoon Public School', 'St. Paul Catholic Elementary', 'South Secondary School'],
    nearbyAmenities: ['White Oaks Mall', 'Wellington Road Retail', 'Rotary Park', 'Highway 401 Access'],
    localBusinesses: [
      {
        name: 'Wellington Road Retail Corridor',
        category: 'Shopping & Services',
        icon: '🛒',
        description:
          'Wellington Road South is one of London\'s most complete commercial corridors — Costco, Home Depot, Best Buy, Cineplex, major grocery chains, and dozens of restaurants and service businesses that serve the entire south end. South London residents are within minutes of this complete retail environment, making daily errands and major purchases equally convenient.',
        highlight: 'Costco, Cineplex, major grocers — London\'s most complete south-end corridor',
      },
      {
        name: 'Victoria Hospital',
        category: 'Healthcare',
        icon: '🏥',
        description:
          'London Health Sciences Centre\'s Victoria Campus is one of Canada\'s largest trauma and teaching hospitals, located minutes from South London. For families, seniors, and healthcare workers, proximity to world-class acute care and emergency services is a quiet but meaningful practical advantage. LHSC is also one of London\'s largest employers, making South London a practical choice for healthcare staff.',
        highlight: 'One of Canada\'s largest trauma hospitals — minutes from home',
      },
      {
        name: 'Rotary Park',
        category: 'Parks & Recreation',
        icon: '🌳',
        description:
          'Rotary Park is South London\'s neighbourhood green anchor — a well-maintained community park with sports fields, a splash pad, walking paths, and community programming throughout the summer. It serves as a gathering point for South London families and represents the kind of practical green space infrastructure that makes established neighbourhoods genuinely liveable.',
        highlight: 'Community park, sports fields, and splash pad — neighbourhood life in action',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in South London Ontario?',
        a: 'South London has consistent inventory of post-war bungalows, two-storeys, semi-detached homes, and newer infill builds throughout the year. Contact Justin for current South London listings — the area offers some of London\'s best value for established-neighbourhood buyers on a moderate budget.',
      },
      {
        q: 'How much do homes cost in South London Ontario?',
        a: 'South London home prices range from approximately $490,000 to $700,000 for detached properties. Semi-detached homes and townhomes can be found below $480,000. The neighbourhood consistently offers strong value for buyers who want proximity to Wellington Road retail, Victoria Hospital, and Highway 401 without paying west-end premiums.',
      },
      {
        q: 'Is South London Ontario a good area to buy a home?',
        a: 'South London is a practical, established community with genuine value for buyers who prioritize access over prestige. Wellington Road\'s complete retail corridor, Victoria Hospital employment anchor, Rotary Park green space, and consistent infill new build investment indicate a neighbourhood in gradual, steady improvement. Good choice for first-time buyers and practical families.',
      },
      {
        q: 'How far is South London from downtown London Ontario?',
        a: 'South London is approximately 10 to 15 minutes from downtown London by car, and is well-served by transit routes that connect south-end residents to the hospital corridor and downtown core. Highway 401 access from South London is also direct — within 5 minutes for commuters heading east or west.',
      },
    ],
    metaTitle: 'South London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'South London Ontario homes for sale. Established bungalows and great value south of Commissioners Road. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'river-bend',
    name: 'River Bend',
    shortName: 'River Bend',
    headline: 'Northwest London Living Along the North Thames River',
    description:
      'River Bend is a quiet northwest pocket of London with newer homes, exceptional ravine and river trail access, and a close-knit community feel.',
    longDescription:
      'River Bend sits in northwest London adjacent to the North Thames River and Medway Creek, one of the city\'s most scenic natural corridors. The neighbourhood is predominantly newer construction — well-maintained semi-detached and detached homes on calm streets backing onto the river valley. The Thames Valley Parkway runs directly through the area, giving residents walking and cycling access to trails that connect across the city. Despite its serene natural setting, River Bend is only minutes from Hyde Park Road retail and Oxford Street services. It\'s an underrated neighbourhood that delivers genuine nature access within a complete urban context.',
    mapEmbedId: 'River+Bend,+London,+Ontario,+Canada',
    geo: { lat: 43.012, lng: -81.325 },
    image: '/images/areas/river-bend-neighbourhood-london-ontario.webp',
    imageAlt: 'Homes backing onto the North Thames River in River Bend, London Ontario',
    highlights: [
      'North Thames River and Medway Creek ravine access',
      'Thames Valley Parkway trail directly through the neighbourhood',
      'Newer homes on quiet streets backing onto natural land',
      'Minutes from Hyde Park Road commercial corridor',
      'One of London\'s best-kept secrets for nature-focused buyers',
    ],
    avgPrice: '$580,000–$850,000',
    homingTypes: ['Detached', 'Semi-Detached', 'Townhomes'],
    schools: ['River Bend Public School', 'Holy Cross Catholic Elementary', 'A.B. Lucas Secondary School'],
    nearbyAmenities: ['Thames Valley Parkway', 'Medway Heritage Forest', 'North Thames River Trails', 'Hyde Park Road Retail'],
    localBusinesses: [
      {
        name: 'North Thames River Corridor',
        category: 'Parks & Nature',
        icon: '🚣',
        description:
          'The North Thames River flows along River Bend\'s edge, providing one of London\'s most scenic natural corridors directly accessible from the neighbourhood. The river corridor supports hiking, cycling, wildlife observation, and peaceful waterfront walks without leaving the community. Properties backing directly onto the river valley are among London\'s most uniquely positioned real estate assets.',
        highlight: 'River valley access directly from your back door — rare in any city',
      },
      {
        name: 'Thames Valley Parkway — Northwest',
        category: 'Recreation & Trails',
        icon: '🚴',
        description:
          'The Thames Valley Parkway runs directly through River Bend, connecting residents on foot or bike to the 35-kilometre trail network that winds across the entire city. Cyclists can reach Springbank Park, the North Thames conservation areas, and downtown London via connected trail without touching a major road. For active families and commuter cyclists, River Bend\'s trail access is exceptional.',
        highlight: 'Thames Valley Parkway through the neighbourhood — cycle anywhere in the city',
      },
      {
        name: 'Hyde Park Road Amenities',
        category: 'Shopping & Services',
        icon: '🛒',
        description:
          'Despite its nature-forward character, River Bend is only minutes from the Hyde Park Road commercial corridor — Walmart Supercenter, Chopped Leaf, Gordon\'s Gold Jewellers, pharmacy, and a full range of daily service businesses. Residents get the best of both worlds: a peaceful, nature-backed neighbourhood with complete urban amenity just minutes away. This combination is River Bend\'s defining practical advantage.',
        highlight: 'Nature at home, full retail corridor minutes away — the best of both worlds',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in River Bend, London Ontario?',
        a: 'River Bend has a steady market of detached, semi-detached, and townhome properties, with particular demand for properties backing onto the river valley or conservation corridor. Contact Justin for current River Bend listings — homes with natural backing sell quickly when they come to market.',
      },
      {
        q: 'How much do homes cost in River Bend, London Ontario?',
        a: 'River Bend home prices range from approximately $580,000 to $850,000 for detached properties, with a premium for homes backing directly onto the North Thames River or conservation land. Semi-detached and townhomes start in the $500,000 to $600,000 range.',
      },
      {
        q: 'What makes River Bend unique as a neighbourhood in London Ontario?',
        a: 'River Bend is one of London\'s best-kept secrets for nature-focused buyers. The North Thames River and Medway Creek corridors provide direct trail access, the Thames Valley Parkway runs through the neighbourhood, and newer homes on quiet streets back onto protected natural land — while still being minutes from Hyde Park Road commercial amenities. This combination is rare in any Canadian city.',
      },
      {
        q: 'Is River Bend a good place to raise a family?',
        a: 'River Bend is excellent for families who value outdoor lifestyle. Quiet, low-traffic streets, direct trail system access, good schools (River Bend Public School, Holy Cross Catholic, A.B. Lucas Secondary), and proximity to Hyde Park Road services create a genuinely liveable community. The natural setting is a daily quality-of-life advantage for active families.',
      },
    ],
    metaTitle: 'River Bend London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'River Bend London Ontario homes for sale. Northwest London neighbourhood on the North Thames River with trail access and newer homes. Contact Real Estate Broker Justin Skrypnyk.',
  },
  {
    slug: 'medway',
    name: 'Medway',
    shortName: 'Medway',
    headline: 'West London\'s Established Mid-Point — Convenient, Mature, and Undervalued',
    description:
      'Medway sits between Hyde Park and the city core — an established west London community with mature streets, solid housing stock, and outstanding daily convenience.',
    longDescription:
      'Medway occupies the central-west portion of London between Oxford Street and the Fanshawe Park Road corridor, roughly between Wonderland Road and Hyde Park Road. The neighbourhood is fully built out with homes from the 1960s through 1990s, offering buyers solid construction on well-sized lots at prices that typically undercut neighbouring Hyde Park and Oakridge. Medway Creek and its trail system run through parts of the area, giving residents natural greenspace. Proximity to Western University, the hospital corridor, and the Hyde Park Road commercial node makes Medway a practical, unflashy choice that holds its value well.',
    mapEmbedId: 'Medway,+London,+Ontario,+Canada',
    geo: { lat: 43.008, lng: -81.290 },
    image: '/images/areas/medway-neighbourhood-london-ontario.webp',
    imageAlt: 'Tree-lined street in Medway neighbourhood, west London Ontario',
    highlights: [
      'Mature established streets at lower price points than Hyde Park',
      'Medway Creek trail system through the neighbourhood',
      'Minutes to Western University and the hospital corridor',
      'Hyde Park Road commercial amenities within easy reach',
      'Solid post-war and 70s-era housing on well-sized lots',
    ],
    avgPrice: '$520,000–$760,000',
    homingTypes: ['Detached', 'Bungalows', 'Semi-Detached', 'Townhomes'],
    schools: ['Medway High School', 'St. George Catholic Elementary', 'Medway Secondary School'],
    nearbyAmenities: ['Medway Creek Trails', 'Western University', 'Hyde Park Road Retail', 'Wonderland Road Corridor'],
    localBusinesses: [
      {
        name: 'Medway Creek Conservation Corridor',
        category: 'Parks & Nature',
        icon: '🌿',
        description:
          'Medway Creek and its valley trail system run through the Medway neighbourhood, providing residents with direct access to a natural green corridor within the urban fabric. The creek connects to the broader Medway Heritage Forest and eventually the Thames River system, meaning walkers and cyclists in Medway can access kilometres of connected natural trail without ever leaving the west end.',
        highlight: 'Natural creek trail through the neighbourhood — connected to the broader system',
      },
      {
        name: 'Western University',
        category: 'Education & Employment',
        icon: '🎓',
        description:
          'One of Canada\'s top research universities is just minutes from Medway\'s eastern edge. Western is one of London\'s largest employers and a major driver of economic and cultural activity in the west end. For investors, Medway\'s proximity to campus makes it a reliable rental market; for professionals who work at Western, it\'s an exceptionally short commute without paying Masonville or Old North prices.',
        highlight: 'Canada\'s top university — short commute, strong rental market',
      },
      {
        name: 'Hyde Park Road Corridor',
        category: 'Shopping & Services',
        icon: '🛍️',
        description:
          'Medway residents are within minutes of the Hyde Park Road commercial corridor — one of west London\'s most complete retail strips with Walmart Supercenter, Gordon\'s Gold Jewellers, Chopped Leaf, and a full range of pharmacy, banking, and service businesses. Being between Hyde Park Road and Wonderland Road means Medway residents have two separate major commercial corridors within easy reach.',
        highlight: 'Two major west-end commercial corridors — Medway sits between both',
      },
    ],
    faqs: [
      {
        q: 'Are there homes for sale in Medway, London Ontario?',
        a: 'Medway has consistent inventory of detached homes, bungalows, semi-detached properties, and townhomes throughout the year. The neighbourhood\'s lower price point relative to neighbouring Hyde Park and Oakridge creates steady buyer interest. Contact Justin for current Medway listings.',
      },
      {
        q: 'How much do homes cost in Medway, London Ontario?',
        a: 'Medway home prices range from approximately $520,000 to $760,000 for detached properties. Bungalows and semi-detached homes can start around $500,000. Prices are typically 10 to 15 percent lower than comparable homes in neighbouring Hyde Park or Oakridge, making Medway one of West London\'s strongest value propositions.',
      },
      {
        q: 'Why is Medway undervalued compared to Hyde Park and Oakridge?',
        a: 'Medway\'s homes are older than Hyde Park\'s new construction and don\'t carry Oakridge\'s brand recognition — but the location, trail access, school options, and daily convenience are comparable. That gap in perception creates a genuine price opportunity for buyers who do their research rather than following the crowd.',
      },
      {
        q: 'Is Medway a good neighbourhood for investment in London Ontario?',
        a: 'Medway is a strong investment neighbourhood. Proximity to Western University drives rental demand, the lower price points mean better cash flow prospects, and the area\'s established character and improving transit options support long-term appreciation. For investors seeking west London exposure at below-Oakridge pricing, Medway consistently delivers.',
      },
    ],
    metaTitle: 'Medway London Ontario Real Estate | Justin Skrypnyk Real Estate Broker',
    metaDescription:
      'Medway London Ontario homes for sale. Established west London neighbourhood near Western University and Hyde Park. Contact Real Estate Broker Justin Skrypnyk.',
  },
];

export function getArea(slug: string): Area | undefined {
  return AREAS.find((a) => a.slug === slug);
}
