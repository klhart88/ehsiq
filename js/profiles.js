// ============================================
// EHS-IQ — Homeowner profile storage
// One row per client. Readable and writable only by the active
// agent (row-level security in sql/01_schema.sql).
// ============================================

import { supabaseClient } from '/js/supabaseClient.js';

const LIST_COLUMNS = 'id, client_name, county_name, property_city, urgency, repair_categories, created_at, updated_at, data_retention_expires_at';

export async function listProfiles() {
  const { data, error } = await supabaseClient
    .from('homeowner_profiles')
    .select(LIST_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not load clients: ${error.message}`);
  return data || [];
}

export async function getProfile(id) {
  const { data, error } = await supabaseClient
    .from('homeowner_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load this client: ${error.message}`);
  if (!data) throw new Error('Client not found. It may have been deleted.');
  return data;
}

export async function saveProfile(fields, id = null) {
  const query = id
    ? supabaseClient.from('homeowner_profiles').update(fields).eq('id', id)
    : supabaseClient.from('homeowner_profiles').insert(fields);
  const { data, error } = await query.select().single();
  if (error) throw new Error(`Could not save: ${error.message}`);
  return data;
}

export async function deleteProfile(id) {
  const { error } = await supabaseClient.from('homeowner_profiles').delete().eq('id', id);
  if (error) throw new Error(`Could not delete: ${error.message}`);
}

export function readIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}
