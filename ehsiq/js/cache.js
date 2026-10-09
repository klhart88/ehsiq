// ============================================
// EHS-IQ — Cache module
// (Copied from HomeAccessIQ, which reused it from AreaIQ)
//
// Wraps the browser's localStorage API with
// time-to-live (TTL) support. We use this to
// avoid hitting external APIs repeatedly for
// data we already have.
//
// Each cached entry stores { value, expires }
// where expires is a Unix timestamp in ms.
//
// *** PII BOUNDARY — DO NOT VIOLATE ***
// This cache is for non-sensitive reference data only
// (geocode results only). Homeowner profile fields
// (income, age, health, veteran status) must NEVER be
// passed to cacheSet() — they live only in Supabase,
// readable only by the active agent. localStorage
// has no server-side deletion path, so anything cached
// here can't honor a data-deletion request.
// ============================================


// Read a value from cache. Returns null if not
// found or expired. We auto-clean expired items
// when we encounter them.
export function cacheGet(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    const { value, expires } = JSON.parse(raw);
    if (expires && Date.now() > expires) {
      localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch (err) {
    // Cached value was corrupted; remove and start fresh
    console.warn(`Cache corruption at key "${key}", removing.`);
    localStorage.removeItem(key);
    return null;
  }
}


// Save a value to cache with optional TTL.
// If ttlMs is 0 or null, the value persists
// forever (until manually cleared).
export function cacheSet(key, value, ttlMs) {
  const expires = ttlMs ? Date.now() + ttlMs : null;
  const payload = JSON.stringify({ value, expires });

  try {
    localStorage.setItem(key, payload);
  } catch (err) {
    // Most likely cause: localStorage quota exceeded.
    // Aggressive fallback: clear cache and retry once.
    console.warn('Cache write failed; clearing cache and retrying.', err);
    localStorage.clear();
    try {
      localStorage.setItem(key, payload);
    } catch (retryErr) {
      console.error('Cache write failed even after clear.', retryErr);
    }
  }
}


// Delete a specific cache entry.
export function cacheDelete(key) {
  localStorage.removeItem(key);
}


// Wipe everything. Useful for "refresh data" UI later.
export function cacheClear() {
  localStorage.clear();
}