// ============================================
// EHS-IQ — Census Block lookup
// (Copied unchanged from HomeAccessIQ, which reused
// it from AreaIQ)
//
// Converts a latitude/longitude pair into Census
// tract and county FIPS codes using the FCC's
// free Census Block API. CORS-friendly, no key.
//
// Used to resolve county_fips for homeowner profiles,
// which feeds the geo_lookup_values matching in
// program_eligibility_rules.
// ============================================

import { API_ENDPOINTS } from './config.js';


// Public function: takes lat/lng, returns
// { censusTract, countyFips, stateFips }
// or null if the lookup fails.
export async function getCensusGeographies(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    format: 'json',
    censusYear: '2020'
  });

  const url = `${API_ENDPOINTS.fccCensusBlock}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.warn('FCC Census Block lookup failed:', err);
    return null;
  }

  if (!response.ok) {
    console.warn('FCC Census Block returned status', response.status);
    return null;
  }

  const data = await response.json();
  const block = data.Block;
  const county = data.County;
  const state = data.State;

  if (!block || !block.FIPS) {
    return null;
  }

  // The FIPS code in block.FIPS is a 15-digit string structured as:
  // SS CCC TTTTTT BBBB
  // S = state (2), C = county (3), T = tract (6), B = block (4)
  // We extract the first 11 digits to get the Census tract GEOID.
  const fips15 = block.FIPS;

  return {
    stateFips: fips15.substring(0, 2),     // e.g., "18" for Indiana
    countyFips: fips15.substring(0, 5),    // e.g., "18057" for Hamilton County
    censusTract: fips15.substring(0, 11),  // e.g., "18057110900"
    countyName: county?.name || null,
    stateName: state?.name || null
  };
}