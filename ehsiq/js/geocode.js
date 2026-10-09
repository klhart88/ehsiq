// ============================================
// EHS-IQ — Geocoding module
// (Copied unchanged from HomeAccessIQ, which reused
// it from AreaIQ)
//
// Converts a user-entered address into a
// structured LocationContext object using
// OpenStreetMap's Nominatim geocoder.
// Free, CORS-friendly, no key required.
//
// EHS-IQ calls this once, for the homeowner's
// property address.
//
// Attribution: data © OpenStreetMap contributors
// ============================================

import { API_ENDPOINTS, CACHE_TTL } from './config.js';
import { cacheGet, cacheSet } from './cache.js';
import { getCensusGeographies } from './census-block.js';


// Map of full state name → 2-letter abbreviation.
// Nominatim returns state names, but we use codes
// internally.
const STATE_NAME_TO_CODE = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC'
};


// Public function: takes a raw address string,
// returns a normalized LocationContext or
// throws an error if geocoding fails.
export async function geocodeAddress(rawAddress) {
  const address = rawAddress.trim();
  if (!address) {
    throw new Error('Please enter an address to search.');
  }

  // Nominatim geocodes buildings and street segments, not individual
  // units -- apartment/suite/unit numbers in the query often cause
  // zero results even when the underlying street address is valid
  // and geocodable on its own (confirmed 8/18/26: "484 Convent Ave
  // #54" failed, "11 Saint Nicholas Ave" -- same city, no unit --
  // succeeded). This app only ever uses geocoding to resolve
  // state/county/census-tract, all of which are building-level, not
  // unit-level, so stripping the unit designator loses no precision
  // that matters here.
  const geocodingAddress = address.replace(
    /[,\s]*(#|apt\.?|apartment|unit|ste\.?|suite)\s*\S+/gi,
    ''
  ).trim();

  // Cache key is based on the stripped address, not the raw one --
  // different units in the same building resolve to the same
  // state/county/tract data, so they should share one cache entry
  // rather than each triggering a separate geocode call.
  const cacheKey = `geo:${geocodingAddress.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    q: geocodingAddress,
    format: 'json',
    addressdetails: '1',
    countrycodes: 'us',
    limit: '1'
  });

  const url = `${API_ENDPOINTS.geocoder}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error('Network error — please check your connection and try again.');
  }

  if (!response.ok) {
    throw new Error(`Geocoder returned status ${response.status}. Please try again later.`);
  }

  const results = await response.json();

  if (!results || results.length === 0) {
    throw new Error('No match found. Please check the address and try again.');
  }

  const match = results[0];
  const addr = match.address || {};

  const stateName = addr.state || '';
  const stateCode = STATE_NAME_TO_CODE[stateName] || stateName;

  const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';

  const location = {
    address: match.display_name,
    lat: parseFloat(match.lat),
    lng: parseFloat(match.lon),
    state: stateCode,
    stateName: stateName,
    city: city,
    zip: addr.postcode || '',
    countyName: (addr.county || '').replace(/ County$/, ''),
    countyFips: null,
    censusTract: null,
    stateFips: null
  };

  // Enrich with Census geographies via FCC API
  const geographies = await getCensusGeographies(location.lat, location.lng);
  if (geographies) {
    location.censusTract = geographies.censusTract;
    location.countyFips = geographies.countyFips;
    location.stateFips = geographies.stateFips;
    if (geographies.countyName) location.countyName = geographies.countyName;
  }

  cacheSet(cacheKey, location, CACHE_TTL.geocode);
  return location;
}
