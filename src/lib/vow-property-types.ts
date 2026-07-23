// Maps the HouseSigma-style property-type filter categories (what the
// /sold-map filter bar shows) to the actual PropertySubType values found in
// the synced vow_sold_listings data (verified empirically against the real
// dataset -- AMPRE's PropertySubType strings are inconsistent, e.g. a
// trailing space on "Semi-Detached ").
export interface PropertyTypeOption {
  slug: string;
  label: string;
}

export const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  { slug: 'detached', label: 'Detached' },
  { slug: 'semi', label: 'Semi-Detached' },
  { slug: 'freehold-townhouse', label: 'Freehold Townhouse' },
  { slug: 'condo-townhouse', label: 'Condo Townhouse' },
  { slug: 'condo-apt', label: 'Condo Apt' },
  { slug: 'multiplex', label: 'Multiplex' },
  { slug: 'vacant-land', label: 'Vacant Land' },
  { slug: 'other', label: 'Other' },
];

const CATEGORY_TO_SUBTYPES: Record<string, string[]> = {
  detached: ['Detached', 'Detached Condo'],
  semi: ['Semi-Detached', 'Semi-Detached ', 'Semi-Detached Condo'],
  'freehold-townhouse': ['Att/Row/Townhouse'],
  'condo-townhouse': ['Condo Townhouse'],
  'condo-apt': ['Condo Apartment', 'Common Element Condo'],
  multiplex: ['Duplex', 'Multiplex', 'Triplex', 'Fourplex'],
  'vacant-land': ['Vacant Land', 'Vacant Land Condo'],
  other: ['Other', 'Lower Level'],
};

/** Category slugs -> the actual DB property_sub_type strings to match, for a Supabase .in() filter. */
export function subtypesForCategories(slugs: string[]): string[] {
  return slugs.flatMap((s) => CATEGORY_TO_SUBTYPES[s] ?? []);
}
