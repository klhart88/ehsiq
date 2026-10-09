// ============================================
// EHS-IQ — Supabase client
// (Same pattern as HomeAccessIQ.)
//
// Every page must load the Supabase SDK script tag BEFORE any
// module that imports this file:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4"></script>
// ============================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (typeof window.supabase === 'undefined') {
  throw new Error('Supabase SDK not loaded. Add the CDN <script> tag before this module.');
}

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
