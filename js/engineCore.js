// ============================================
// EHS-IQ -- Matching engine core (pure logic)
//
// Adapted from HomeAccessIQ's matchingEngine.js (read-only
// reference). Same rule shape: one row per rule with a
// rule_type and a JSON rule_config, optional exempts_rule_id,
// evaluated in evaluation_order. Same principle: "we don't have
// enough information" (needsVerification) is never reported as
// "ineligible".
//
// Differences from HomeAccessIQ, all deliberate:
//   * No database calls in this file. matchingEngine.js loads the
//     data and passes it in, so this file runs unchanged in the
//     browser and in Node (tools/test_engine.mjs).
//   * Non-matches are returned (status 'not_fit') with the failing
//     reason, so the agent can see why a program is missing.
//     HomeAccessIQ hides them; here the catalog is small.
//   * Closed programs are returned (status 'closed') with their
//     reopening note instead of being filtered out.
//   * Any profile answer may be null, meaning unknown. Unknown
//     always produces a "verify" note, never a fail.
//
// rule_config shapes by rule_type:
//
//   geographic_scope:
//     { scope_level: 'state'|'county'|'zip'|'flag',
//       allowed_values?: [...], excluded_values?: [...],
//       field?, value?            (flag only: a boolean profile field)
//       soft?: true               (flag only: a mismatch is a
//                                  verify note, not a fail)
//       fail_message?, unknown_message? }
//
//   homeowner_status, property_attribute:
//     { mode: 'all'|'any', checks: [{ field, op, value? }],
//       fail_message, unknown_message }
//     ops: is_true, is_false, not_false, eq, neq, gte, lte, in, not_in
//
//   income_threshold:
//     { lookup_table, comparator: 'lte'|'gte', label,
//       categorical_fields?: [...]  (any true = qualifies outright)
//       fallback_message? }
//
//   repair_type:
//     { allowed: [...repair category keys] }
//
//   external_verification:
//     { message }  -- always a verify note
// ============================================

export const REPAIR_CATEGORIES = {
  roof: 'Roof',
  heating: 'Heating / furnace',
  cooling: 'Air conditioning',
  water_heater: 'Water heater',
  plumbing_sewer: 'Plumbing or sewer line',
  septic_well: 'Septic or well',
  electrical: 'Electrical',
  structural: 'Foundation or structural',
  windows_doors: 'Windows or exterior doors',
  insulation_weatherization: 'Insulation or weatherization',
  ramp: 'Wheelchair ramp',
  accessibility: 'Accessibility (bathroom, doorways, rails)',
  safety_fixes: 'Small safety fixes (grab bars, lighting, steps)',
  lead_mold: 'Lead or mold',
  storm_damage: 'Storm damage',
  other: 'Other'
};

// How each repair reads inside a call script ("...who has {repair}").
export const REPAIR_PHRASES = {
  roof: 'a roof problem',
  heating: 'a heating or furnace problem',
  cooling: 'an air-conditioning problem',
  water_heater: 'a water heater problem',
  plumbing_sewer: 'a plumbing or sewer problem',
  septic_well: 'a septic or well problem',
  electrical: 'an electrical problem',
  structural: 'a foundation or structural problem',
  windows_doors: 'a window or door repair',
  insulation_weatherization: 'insulation or weatherization work',
  ramp: 'a wheelchair ramp',
  accessibility: 'accessibility changes such as grab bars or a wider doorway',
  safety_fixes: 'small safety fixes',
  lead_mold: 'a lead or mold problem',
  storm_damage: 'storm damage',
  other: 'a home repair'
};

export const STATUS_ORDER = ['likely_fit', 'worth_a_call', 'closed', 'not_fit'];

export const STATUS_LABELS = {
  likely_fit: 'Likely fit',
  worth_a_call: 'Worth a call',
  closed: 'Closed for now',
  not_fit: 'Not a fit'
};

const TYPE_ORDER = {
  grant: 0,
  free_service: 0,
  rebate: 1,
  forgivable_loan: 2,
  deferred_loan: 2,
  referral: 3,
  low_interest_loan: 4
};

const UNKNOWN = Symbol('unknown');

function isBlank(value) {
  return value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0);
}

// ---------- Single field checks ----------

// Returns true (passes), false (fails) or UNKNOWN.
function checkField(profile, check) {
  const value = profile[check.field];
  if (isBlank(value)) return UNKNOWN;

  switch (check.op) {
    case 'is_true':   return value === true;
    case 'is_false':  return value === false;
    case 'not_false': return value !== false;
    case 'eq':        return value === check.value;
    case 'neq':       return value !== check.value;
    case 'gte':       return Number(value) >= Number(check.value);
    case 'lte':       return Number(value) <= Number(check.value);
    case 'in':        return (check.value || []).includes(value);
    case 'not_in':    return !(check.value || []).includes(value);
    default:
      throw new Error(`Unknown check op: ${check.op}`);
  }
}

function evaluateChecks(config, profile) {
  const outcomes = (config.checks || []).map(c => checkField(profile, c));
  const mode = config.mode || 'all';

  if (mode === 'any') {
    if (outcomes.some(o => o === true)) return pass();
    if (outcomes.some(o => o === UNKNOWN)) return verify(config.unknown_message || 'Information not recorded.');
    return fail(config.fail_message || 'Requirement not met');
  }

  if (outcomes.some(o => o === false)) return fail(config.fail_message || 'Requirement not met');
  if (outcomes.some(o => o === UNKNOWN)) return verify(config.unknown_message || 'Information not recorded.');
  return pass();
}

// ---------- Rule types ----------

function evaluateGeographicScope(config, profile) {
  if (config.scope_level === 'flag') {
    const value = profile[config.field];
    if (isBlank(value)) return verify(config.unknown_message || `${config.field} not recorded.`);
    if (value === config.value) return pass();
    return config.soft
      ? verify(config.fail_message || 'Location may be outside the service area; ask.')
      : fail(config.fail_message || 'Outside the service area');
  }

  const valueByLevel = {
    state: profile.state_code,
    county: profile.county_fips,
    zip: profile.property_zip ? String(profile.property_zip).slice(0, 5) : null
  };
  if (!(config.scope_level in valueByLevel)) {
    throw new Error(`Unknown scope_level: ${config.scope_level}`);
  }
  const value = valueByLevel[config.scope_level];
  if (isBlank(value)) {
    return verify(`The home's ${config.scope_level} could not be determined from the address.`);
  }

  const allowed = config.allowed_values;
  const included = Array.isArray(allowed) ? allowed.includes(value) : true;
  const excluded = (config.excluded_values || []).includes(value);
  return included && !excluded ? pass() : fail(config.fail_message || 'Outside the service area');
}

function evaluateIncomeThreshold(config, profile, lookup) {
  const categorical = (config.categorical_fields || []).find(f => profile[f] === true);
  if (categorical) return pass();

  if (isBlank(profile.household_income)) return verify('Household income not recorded.');
  if (isBlank(profile.household_size)) return verify('Household size not recorded.');

  const limit = lookup(config.lookup_table, profile.state_code, profile.county_fips, Number(profile.household_size));
  if (limit === null || limit === undefined) {
    return verify(config.fallback_message ||
      `The ${config.label || 'income limit'} for this county isn't loaded in EHS-IQ; confirm income with the program.`);
  }

  const income = Number(profile.household_income);
  const passed = config.comparator === 'gte' ? income >= limit : income <= limit;
  return passed
    ? pass()
    : fail(`Income is above ${config.label || 'the limit'} ($${Math.round(limit).toLocaleString('en-US')} for ${profile.household_size})`);
}

function evaluateRepairType(config, profile) {
  const needed = profile.repair_categories || [];
  if (needed.length === 0) return verify('No repair recorded.');
  const allowed = config.allowed || [];
  if (needed.some(r => allowed.includes(r))) return pass();
  const covers = allowed.map(r => REPAIR_CATEGORIES[r] || r).join(', ');
  return fail(`Doesn't cover this repair (covers: ${covers})`);
}

function evaluateRule(rule, profile, lookup) {
  const config = rule.rule_config || {};
  switch (rule.rule_type) {
    case 'geographic_scope':      return evaluateGeographicScope(config, profile);
    case 'homeowner_status':      return evaluateChecks(config, profile);
    case 'property_attribute':    return evaluateChecks(config, profile);
    case 'income_threshold':      return evaluateIncomeThreshold(config, profile, lookup);
    case 'repair_type':           return evaluateRepairType(config, profile);
    case 'external_verification': return verify(config.message || 'Confirm with the program.');
    default:
      return fail(`Unknown rule_type: ${rule.rule_type}`);
  }
}

function pass()         { return { passed: true,  reason: null,    verify: null }; }
function fail(reason)   { return { passed: false, reason,          verify: null }; }
function verify(note)   { return { passed: false, reason: null,    verify: note }; }

// ---------- Program evaluation ----------

// program: a programs row. rules: its program_eligibility_rules rows.
// profile: a homeowner_profiles row. lookup: (table, state, county, size) => number|null
export function evaluateProgram(program, rules, profile, lookup) {
  const ordered = [...rules].sort((a, b) => (a.evaluation_order || 0) - (b.evaluation_order || 0));
  const results = new Map();
  for (const rule of ordered) results.set(rule.id, evaluateRule(rule, profile, lookup));

  // Exemptions, as in HomeAccessIQ: a passing rule waives the rule it names.
  for (const rule of ordered) {
    if (rule.exempts_rule_id && results.get(rule.id)?.passed) {
      const target = results.get(rule.exempts_rule_id);
      if (target && !target.passed) Object.assign(target, pass());
    }
  }

  const unmet = [];
  const verifyNotes = [];
  const met = [];
  for (const rule of ordered) {
    if (rule.exempts_rule_id) continue; // exemption-only rows are not requirements
    const r = results.get(rule.id);
    if (r.verify) verifyNotes.push(r.verify);
    else if (!r.passed) unmet.push(r.reason || `${rule.rule_type} not met`);
    else if (rule.description) met.push(rule.description);
  }

  if (program.funding_status === 'unknown') {
    verifyNotes.push('Confirm the program is taking applications now.');
  } else if (program.funding_status === 'waitlist') {
    verifyNotes.push('The program has a waitlist; ask how long it is.');
  }

  let status;
  if (unmet.length > 0) status = 'not_fit';
  else if (program.funding_status === 'closed') status = 'closed';
  else if (verifyNotes.length > 0) status = 'worth_a_call';
  else status = 'likely_fit';

  return { program, status, unmet, verify: verifyNotes, met };
}

// ---------- Ordering ----------

export function rankResults(results, profile) {
  const emergency = profile.urgency === 'emergency';
  return [...results].sort((a, b) => {
    const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (s !== 0) return s;
    if (emergency) {
      const e = Number(b.program.is_emergency_route) - Number(a.program.is_emergency_route);
      if (e !== 0) return e;
    }
    const t = (TYPE_ORDER[a.program.program_type] ?? 9) - (TYPE_ORDER[b.program.program_type] ?? 9);
    if (t !== 0) return t;
    return a.program.name.localeCompare(b.program.name);
  });
}

// ---------- Lookup helper ----------

// Builds a synchronous lookup function from preloaded rows, using
// HomeAccessIQ's bracket rule: stored household_size is a floor;
// pick the highest bracket the household meets or exceeds.
// tables: [{ id, table_name }]; values: geo_lookup_values rows.
export function buildLookup(tables, values) {
  const idByName = new Map(tables.map(t => [t.table_name, t.id]));
  return function lookup(tableName, stateCode, countyFips, householdSize) {
    const tableId = idByName.get(tableName);
    if (!tableId) return null;
    const rows = values.filter(v => v.lookup_table_id === tableId && v.state_code === stateCode);
    if (rows.length === 0) return null;

    const countyRows = countyFips ? rows.filter(r => r.county_fips === countyFips) : [];
    const candidates = countyRows.length > 0 ? countyRows : rows.filter(r => r.county_fips == null);
    if (candidates.length === 0) return null;

    const sized = candidates.filter(r => r.household_size != null);
    if (sized.length > 0 && householdSize) {
      const met = sized
        .filter(r => r.household_size <= householdSize)
        .sort((a, b) => b.household_size - a.household_size)[0];
      const row = met || sized.sort((a, b) => a.household_size - b.household_size)[0];
      return Number(row.numeric_value);
    }
    const universal = candidates.find(r => r.household_size == null);
    return universal ? Number(universal.numeric_value) : null;
  };
}

// ---------- Call script ----------

export function fillCallScript(script, profile) {
  if (!script) return '';
  const repairs = (profile.repair_categories || []).map(r => REPAIR_PHRASES[r] || r);
  const values = {
    name: profile.client_name,
    age: profile.age_oldest_owner,
    county: profile.county_name,
    zip: profile.property_zip,
    township: profile.township,
    size: isBlank(profile.household_size) ? null : `${profile.household_size} ${Number(profile.household_size) === 1 ? 'person' : 'people'}`,
    income: isBlank(profile.household_income) ? null : Number(profile.household_income).toLocaleString('en-US'),
    repair: repairs.length ? repairs.join(' and ') : null
  };
  // A blank township reads naturally instead of printing "[township] Township".
  if (isBlank(profile.township)) script = script.replace(/in \{township\} Township/g, 'in their township');
  return script.replace(/\{(\w+)\}/g, (_, key) => (isBlank(values[key]) ? `[${key}]` : String(values[key])));
}
