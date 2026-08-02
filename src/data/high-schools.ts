export interface RankedHighSchool {
  name: string;
  fraserRating: number;
  provincialRank: number;
  board: string;
  boardType: 'Public' | 'Catholic' | 'French Public' | 'French Catholic';
  address?: string;
  servesAreas?: { name: string; slug: string }[];
}

export const PROVINCIAL_TOTAL = 747;
export const FRASER_REPORT_YEAR = '2025';

// Fraser Institute Report Card on Ontario's Secondary Schools, 2025 edition
// (2023-24 EQAO data), compareschoolrankings.org. All 19 secondary schools
// serving the London, Ontario area, ranked by rating out of 10.
export const HIGH_SCHOOLS: RankedHighSchool[] = [
  {
    name: 'London Central Secondary School',
    fraserRating: 8.7,
    provincialRank: 33,
    board: 'Thames Valley DSB',
    boardType: 'Public',
    address: '509 Waterloo St',
  },
  {
    name: 'Oakridge Secondary School',
    fraserRating: 8.0,
    provincialRank: 86,
    board: 'Thames Valley DSB',
    boardType: 'Public',
    address: '1040 Oxford St W',
    servesAreas: [{ name: 'Oakridge', slug: 'oakridge' }],
  },
  {
    name: 'St. Thomas Aquinas Catholic Secondary School',
    fraserRating: 7.8,
    provincialRank: 111,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
    address: '1360 Oxford St W',
    servesAreas: [
      { name: 'Oakridge', slug: 'oakridge' },
      { name: 'Whitehills', slug: 'whitehills' },
    ],
  },
  {
    name: 'A.B. Lucas Secondary School',
    fraserRating: 7.3,
    provincialRank: 158,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
  {
    name: 'École secondaire Gabriel-Dumont',
    fraserRating: 7.2,
    provincialRank: 178,
    board: 'Conseil scolaire Viamonde',
    boardType: 'French Public',
    address: '2463 Boulevard Evans',
  },
  {
    name: 'Mother Teresa Catholic Secondary School',
    fraserRating: 7.1,
    provincialRank: 201,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
  },
  {
    name: 'St. André Bessette Catholic Secondary School',
    fraserRating: 6.8,
    provincialRank: 254,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
    address: '2727 Tokala Trail',
  },
  {
    name: 'Sir Frederick Banting Secondary School',
    fraserRating: 5.9,
    provincialRank: 401,
    board: 'Thames Valley DSB',
    boardType: 'Public',
    address: '125 Sherwood Forest Square',
    servesAreas: [{ name: 'Whitehills', slug: 'whitehills' }],
  },
  {
    name: 'Catholic Central High School',
    fraserRating: 5.6,
    provincialRank: 453,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
    address: '450 Dundas St',
  },
  {
    name: 'Saunders Secondary School',
    fraserRating: 5.6,
    provincialRank: 453,
    board: 'Thames Valley DSB',
    boardType: 'Public',
    address: '941 Viscount Rd',
    servesAreas: [
      { name: 'Byron', slug: 'byron' },
      { name: 'Westmount', slug: 'westmount' },
      { name: 'Riverbend', slug: 'riverbend' },
      { name: 'Lambeth', slug: 'lambeth' },
    ],
  },
  {
    name: 'École secondaire catholique Monseigneur-Bruyère',
    fraserRating: 5.5,
    provincialRank: 478,
    board: 'Conseil scolaire catholique Providence',
    boardType: 'French Catholic',
    address: '920 Huron St',
  },
  {
    name: 'H.B. Beal Secondary School',
    fraserRating: 5.4,
    provincialRank: 497,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
  {
    name: 'London South Secondary School',
    fraserRating: 5.3,
    provincialRank: 513,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
  {
    name: 'Sir Wilfrid Laurier Secondary School',
    fraserRating: 5.3,
    provincialRank: 513,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
  {
    name: 'Regina Mundi Catholic College',
    fraserRating: 4.1,
    provincialRank: 649,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
    address: '5250 Wellington Rd S',
  },
  {
    name: 'John Paul II Catholic Secondary School',
    fraserRating: 4.0,
    provincialRank: 654,
    board: 'London District Catholic SB',
    boardType: 'Catholic',
  },
  {
    name: 'Clarke Road Secondary School',
    fraserRating: 3.7,
    provincialRank: 672,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
  {
    name: 'Montcalm Secondary School',
    fraserRating: 3.1,
    provincialRank: 697,
    board: 'Thames Valley DSB',
    boardType: 'Public',
    address: '1350 Highbury Ave',
  },
  {
    name: 'Westminster Secondary School',
    fraserRating: 2.8,
    provincialRank: 709,
    board: 'Thames Valley DSB',
    boardType: 'Public',
  },
];
