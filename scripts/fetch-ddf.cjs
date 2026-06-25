'use strict';
/* eslint-disable no-console */

const rets = require('rets-client');
const fs = require('fs');
const path = require('path');

const LOGIN_URL = process.env.DDF_LOGIN_URL;
const USERNAME = process.env.DDF_USERNAME;
const PASSWORD = process.env.DDF_PASSWORD;
const OUTPUT_PATH = path.join(__dirname, '../src/data/listings.json');

if (!LOGIN_URL || !USERNAME || !PASSWORD) {
  console.error('Missing DDF credentials. Check your .env file.');
  process.exit(1);
}

const clientSettings = {
  loginUrl: LOGIN_URL,
  username: USERNAME,
  password: PASSWORD,
  version: 'RETS/1.7.2',
  userAgent: 'LiveInOakridge/1.0',
  method: 'GET',
};

// Confirmed available fields from DDF metadata
const COLUMNS = [
  'ListingKey', 'ListingId',
  'ListPrice',
  'BedroomsTotal', 'BathroomsTotal', 'BathroomsHalf',
  'StreetNumber', 'StreetName', 'StreetSuffix', 'UnitNumber', 'UnparsedAddress',
  'City', 'StateOrProvince', 'PostalCode',
  'SubdivisionName',
  'PropertyType',
  'BuildingAreaTotal', 'BuildingAreaUnits',
  'YearBuilt',
  'GarageSpaces', 'ParkingTotal', 'GarageYN',
  'PublicRemarks',
  'ListingContractDate', 'ModificationTimestamp',
  'PhotosCount',
  'Latitude', 'Longitude',
  'MoreInformationLink',
  'Levels', 'Heating', 'Cooling', 'CoolingYN',
  'FireplacesTotal', 'PoolYN', 'WaterfrontYN',
  'LotSizeArea', 'LotSizeUnits',
  'ListAgentFullName', 'ListOfficeName',
].join(',');

// DDF National Shared Pool only exposes active listings — no Status filter needed
const QUERIES = [
  '(City=London),(StateOrProvince=Ontario)',
  '(City=London),(StateOrProvince=ON)',
  '(City=London)',
];

rets.getAutoLogoutClient(clientSettings, async function (client) {
  console.log('Connected to CREA DDF');

  let searchResults = null;

  for (const query of QUERIES) {
    try {
      console.log('Trying query:', query);
      const result = await client.search.query('Property', 'Property', query, {
        limit: 500,
        offset: 1,
        columns: COLUMNS,
        count: 1,
      });
      console.log(`  → ${result.rowsReceived} results (${result.totalCount} total matches)`);
      if (result.rowsReceived > 0) {
        searchResults = result;
        break;
      }
    } catch (err) {
      console.log('  → failed:', err.message);
    }
  }

  if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
    console.error('No listings returned. Check your DDF feed status on CREA\'s portal.');
    const empty = { fetchedAt: new Date().toISOString(), count: 0, listings: [] };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2));
    return 0;
  }

  const listings = searchResults.results;
  console.log(`\nFetched ${listings.length} listings`);

  // Attempt to get preferred photo URL via Location header for each listing
  const enriched = [];
  for (const listing of listings) {
    const id = listing.ListingKey || listing.ListingId;
    let photoUrl = null;

    if (id) {
      try {
        photoUrl = await new Promise((resolve) => {
          const photoIds = { [id]: '0' };
          client.objects.stream.getObjects('Property', 'Photo', photoIds, {
            alwaysGroupObjects: true,
            location: 1,
          }).then(function (stream) {
            stream.objectStream.on('data', function (event) {
              if (event.type === 'location' && event.headerInfo?.location && !photoUrl) {
                resolve(event.headerInfo.location);
              }
            });
            stream.objectStream.on('end', () => resolve(null));
            stream.objectStream.on('error', () => resolve(null));
          }).catch(() => resolve(null));
        });
      } catch (_) {
        // photos are optional
      }
    }

    enriched.push({ ...listing, _photoUrl: photoUrl });
  }

  const photosFound = enriched.filter(l => l._photoUrl).length;
  console.log(`Photos found: ${photosFound}/${enriched.length}`);

  const output = {
    fetchedAt: new Date().toISOString(),
    totalCount: searchResults.totalCount,
    count: enriched.length,
    listings: enriched,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${output.count} listings → src/data/listings.json`);
  if (output.count < (output.totalCount || 0)) {
    console.log(`(${output.totalCount - output.count} more available — raise limit in fetch-ddf.cjs)`);
  }

  return output.count;
}).catch(function (err) {
  console.error('\nDDF fetch failed:', err.message || err);
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ fetchedAt: null, count: 0, listings: [] }, null, 2));
  }
  process.exit(1);
});
