// EHS-IQ offline engine test.
// Runs the real engine (js/engineCore.js) against the real catalog
// (data/catalog.json) for five made-up homeowners, and checks the
// outcomes a person would expect. No database or browser needed.
//
//   node tools/test_engine.mjs          (from the project root)

import { readFileSync } from 'node:fs';
import { evaluateProgram, rankResults, buildLookup, fillCallScript, STATUS_LABELS } from '../js/engineCore.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));

// ---------- Build rows the way the seed would ----------
const tables = [];
const values = [];
for (const t of catalog.lookup_tables) {
  tables.push({ id: t.table_name, table_name: t.table_name });
  const series = t.poverty_multiple
    ? [{ county_fips: null, by_household_size: catalog.poverty_guidelines_2026.map(p => Math.round(p * t.poverty_multiple)) }]
    : (t.values || []);
  for (const s of series) {
    s.by_household_size.forEach((amount, i) => values.push({
      lookup_table_id: t.table_name, state_code: 'IN', county_fips: s.county_fips, household_size: i + 1, numeric_value: amount
    }));
  }
}
const lookup = buildLookup(tables, values);
const programs = catalog.programs.map(p => ({ ...p, id: p.slug, is_active: true }));
const rulesBySlug = Object.fromEntries(catalog.programs.map(p => [p.slug, p.rules.map((r, i) => ({ ...r, id: `${p.slug}#${i}`, evaluation_order: i }))]));

function run(profile) {
  const results = programs.map(p => evaluateProgram(p, rulesBySlug[p.slug], profile, lookup));
  return rankResults(results, profile);
}

// ---------- Test homeowners ----------
const base = { consent_given: true, repair_categories: [] };

const homeowners = {
  'A: 74, inside Indianapolis, furnace out in winter, $18k': {
    ...base, client_name: 'Test A', age_oldest_owner: 74, household_size: 1, household_income: 18000,
    state_code: 'IN', county_fips: '18097', county_name: 'Marion', property_zip: '46208',
    in_city_indianapolis: true, inside_i465: true, owner_on_deed: true, primary_residence: true,
    taxes_current: true, mortgage_current: true, insurance_current: true, home_type: 'site_built',
    repair_categories: ['heating'], urgency: 'emergency'
  },
  'B: 68 veteran in Avon (Hendricks), needs a ramp, $40k for 2': {
    ...base, client_name: 'Test B', age_oldest_owner: 68, household_size: 2, household_income: 40000,
    state_code: 'IN', county_fips: '18063', county_name: 'Hendricks', property_zip: '46123',
    in_city_indianapolis: false, inside_i465: false, owner_on_deed: true, primary_residence: true,
    is_veteran: true, va_service_connected: true, va_disability_rating: 70, uses_mobility_device: true,
    has_disability: true, home_type: 'site_built', repair_categories: ['ramp'], urgency: 'soon'
  },
  'C: 66 on the east side (46218), roof, $70k (over the limit)': {
    ...base, client_name: 'Test C', age_oldest_owner: 66, household_size: 1, household_income: 70000,
    state_code: 'IN', county_fips: '18097', county_name: 'Marion', property_zip: '46218',
    in_city_indianapolis: true, owner_on_deed: true, primary_residence: true, taxes_current: true,
    mortgage_current: true, title_issue: 'none', repair_categories: ['roof'], urgency: 'can_wait'
  },
  'D: almost nothing known except Marion County and a roof': {
    ...base, client_name: 'Test D', state_code: 'IN', county_fips: '18097', county_name: 'Marion',
    repair_categories: ['roof']
  },
  'E: nothing known except Marion County': {
    ...base, client_name: 'Test E', state_code: 'IN', county_fips: '18097', county_name: 'Marion'
  }
};

// ---------- Expectations ----------
const expect = {
  'A: 74, inside Indianapolis, furnace out in winter, $18k': {
    'send-emergency': 'likely_fit', 'hrg-home-repair': 'likely_fit', 'hrg-home-stabilization': 'likely_fit',
    'cagi-weatherization': 'worth_a_call', 'indianapolis-hrp': 'closed', 'fhlbi-revive': 'closed',
    'usda-504-grant': 'worth_a_call', 'cicoa-home-mods': 'not_fit', 'va-hisa': 'not_fit', 'ocra-oor': 'not_fit'
  },
  'B: 68 veteran in Avon (Hendricks), needs a ramp, $40k for 2': {
    'cicoa-home-mods': 'likely_fit', 'va-hisa': 'worth_a_call', 'va-sah-sha': 'worth_a_call',
    'saws-ramps': 'worth_a_call', 'ihcda-ramp-up': 'worth_a_call', 'indianapolis-hrp': 'not_fit',
    'hrg-home-repair': 'not_fit', 'send-emergency': 'not_fit'
  },
  'C: 66 on the east side (46218), roof, $70k (over the limit)': {
    'englewood-cdc': 'not_fit', 'hrg-home-repair': 'not_fit', 'indianapolis-hrp': 'not_fit',
    'usda-504-grant': 'worth_a_call'
  },
  'D: almost nothing known except Marion County and a roof': {
    'indianapolis-hrp': 'closed', 'hrg-home-repair': 'worth_a_call', 'englewood-cdc': 'worth_a_call'
  },
  'E: nothing known except Marion County': {}
};

let failures = 0;
const check = (ok, message) => { if (!ok) { failures++; console.log(`  FAIL: ${message}`); } };

for (const [label, profile] of Object.entries(homeowners)) {
  const results = run(profile);
  console.log(`\n=== ${label}`);
  for (const r of results) {
    const why = r.status === 'not_fit' ? r.unmet.join('; ') : r.verify.join(' | ');
    console.log(`  ${STATUS_LABELS[r.status].padEnd(13)} ${r.program.slug.padEnd(24)} ${why.slice(0, 110)}`);
  }
  const bySlug = Object.fromEntries(results.map(r => [r.program.slug, r]));
  for (const [slug, status] of Object.entries(expect[label])) {
    check(bySlug[slug]?.status === status, `${slug} expected ${status}, got ${bySlug[slug]?.status}`);
  }
  // Unknown answers must never cause a not_fit: every not_fit reason
  // has to come from an answer that was actually recorded.
  if (label.startsWith('E')) {
    const notFit = results.filter(r => r.status === 'not_fit').map(r => r.program.slug);
    check(JSON.stringify(notFit) === JSON.stringify(['ocra-oor']),
      `with nothing known, only the Marion-excluded program should be ruled out; got ${notFit.join(', ')}`);
  }
}

// Emergency routes rank first among likely fits for an emergency.
const a = run(homeowners['A: 74, inside Indianapolis, furnace out in winter, $18k']);
check(a[0].program.slug === 'send-emergency', `emergency route should rank first, got ${a[0].program.slug}`);

// Loans rank after grants and free services in the same group.
const b = run(homeowners['B: 68 veteran in Avon (Hendricks), needs a ramp, $40k for 2']).filter(r => r.status === 'worth_a_call');
const loanIndex = b.findIndex(r => r.program.program_type === 'low_interest_loan');
check(loanIndex === -1 || loanIndex === b.length - 1 || b.slice(loanIndex).every(r => r.program.program_type === 'low_interest_loan'),
  'loans should come last within a group');

// Income limits come out as published.
check(lookup('fpl_150_2026', 'IN', '18097', 1) === 23940, '150% poverty for 1 person should be $23,940');
check(lookup('fpl_200_2026', 'IN', '18063', 4) === 66000, '200% poverty for 4 should be $66,000');
check(lookup('in_80ami_2026', 'IN', '18097', 2) === 70600, '80% AMI Marion for 2 should be $70,600');
check(lookup('in_80ami_2026', 'IN', '18063', 2) === null, 'Hendricks 80% AMI is not loaded and must return null');
check(lookup('fpl_150_2026', 'IN', '18097', 11) === 83580, 'households over 8 use the 8-person figure');

// Call scripts fill in, and missing values show as [brackets].
const script = fillCallScript(catalog.programs.find(p => p.slug === 'hrg-home-repair').call_script, homeowners['A: 74, inside Indianapolis, furnace out in winter, $18k']);
check(script.includes('age 74') && script.includes('$18,000') && script.includes('a heating or furnace problem'), `call script not filled: ${script}`);
check(fillCallScript('Hello {name}, age {age}', { client_name: 'X' }) === 'Hello X, age [age]', 'missing values should show as [age]');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
