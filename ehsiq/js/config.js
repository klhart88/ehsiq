// ============================================
// EHS-IQ — Configuration
// ============================================
// Fill in the two Supabase values from the EHS-IQ project
// (Project Settings > API). Never use HomeAccessIQ's project.
//
// The anon (public) key is safe in client-side code: security
// comes from row-level security, and every EHS-IQ table only
// answers an active agent's login. Never put the service_role
// key here or anywhere in this repository.
// ============================================

export const SUPABASE_URL = 'https://nnpnruqrgvyxlxaidyfk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucG5ydXFyZ3Z5eGx4YWlkeWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0OTkzNTMsImV4cCI6MjEwNzA3NTM1M30.nWWeTJYZixi6mcQx5dVPty2eQG6iMOak18ke5n5K8Jk';

// Free public lookups, no keys needed (same as HomeAccessIQ).
export const API_ENDPOINTS = {
  geocoder: 'https://nominatim.openstreetmap.org/search',
  fccCensusBlock: 'https://geo.fcc.gov/api/census/block/find'
};

const ONE_DAY = 24 * 60 * 60 * 1000;

// Geocode results only. Client data is never cached in the browser.
export const CACHE_TTL = {
  geocode: 30 * ONE_DAY
};

// A program not re-verified within this many days is flagged on
// the dashboard (monthly checks, with two weeks' grace).
export const STALE_AFTER_DAYS = 45;

export const AGENT_DISPLAY_NAME = 'Kelvin Hart';
