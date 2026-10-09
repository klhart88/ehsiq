// ============================================
// EHS-IQ — Matching engine (data layer)
//
// Loads the whole catalog in five queries (programs, rules,
// contacts, requirements, income tables) and hands it to the
// pure evaluator in engineCore.js. HomeAccessIQ queried rules
// per program; with ~20 programs, loading everything at once is
// simpler and faster.
// ============================================

import { supabaseClient } from '/js/supabaseClient.js';
import { evaluateProgram, rankResults, buildLookup } from '/js/engineCore.js';

let catalogPromise = null;

async function selectAll(table, query = (q) => q) {
  const { data, error } = await query(supabaseClient.from(table).select('*'));
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return data || [];
}

export function loadCatalog({ refresh = false } = {}) {
  if (!catalogPromise || refresh) {
    catalogPromise = (async () => {
      const [programs, rules, contacts, requirements, tables, values] = await Promise.all([
        selectAll('programs', q => q.eq('is_active', true).order('name')),
        selectAll('program_eligibility_rules', q => q.order('evaluation_order')),
        selectAll('program_contacts', q => q.order('sort_order')),
        selectAll('program_requirements', q => q.order('sort_order')),
        selectAll('geo_lookup_tables'),
        selectAll('geo_lookup_values')
      ]);
      const group = (rows) => rows.reduce((map, r) => {
        (map[r.program_id] ||= []).push(r);
        return map;
      }, {});
      return {
        programs,
        rulesByProgram: group(rules),
        contactsByProgram: group(contacts),
        requirementsByProgram: group(requirements),
        lookup: buildLookup(tables, values)
      };
    })();
  }
  return catalogPromise;
}

// Returns ranked results, each with the program's contacts and
// requirements attached for the results view and the printed plan.
export async function matchProfile(profile) {
  const catalog = await loadCatalog();
  const results = catalog.programs.map(program => {
    const result = evaluateProgram(program, catalog.rulesByProgram[program.id] || [], profile, catalog.lookup);
    result.contacts = contactsForCounty(catalog.contactsByProgram[program.id] || [], profile.county_fips);
    result.requirements = catalog.requirementsByProgram[program.id] || [];
    return result;
  });
  return rankResults(results, profile);
}

// Contacts with a county_fips apply only to that county; contacts
// without one apply everywhere.
function contactsForCounty(contacts, countyFips) {
  return contacts.filter(c => !c.county_fips || c.county_fips === countyFips);
}
