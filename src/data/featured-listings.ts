export type FeaturedListing = {
  address: string;
  city: string;
  price: string;
  blurb: string;
  url: string;
  active: boolean;
};

// Add an entry for each landing page you want featured on the homepage.
// Flip active: false (or delete the entry) once a listing is off-market —
// the homepage card only shows entries with active: true.
export const FEATURED_LISTINGS: FeaturedListing[] = [
  {
    address: '916 Oxford Street W',
    city: 'London (Oakridge)',
    price: '$654,900',
    blurb: 'Spacious 4-bed family home in the heart of Oakridge — ~1,759 sq ft, finished lower level, workshop.',
    url: 'https://openhouse.liveinoakridge.ca/916oxfordstreetw',
    active: true,
  },
  {
    address: '136 South Edgeware',
    city: 'St. Thomas',
    price: '$519,900',
    blurb: 'Beautifully updated brick bungalow in an established north-end neighbourhood — finished basement, heated garage.',
    url: 'https://openhouse.liveinoakridge.ca/136southedgeware',
    active: true,
  },
];
