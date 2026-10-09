// ============================================
// EHS-IQ — Intake page
// Agent-entry form for one homeowner, then the matched programs.
// ============================================

import { sessionReady } from '/js/authGuard.js';
import { geocodeAddress } from '/js/geocode.js';
import { REPAIR_CATEGORIES, STATUS_LABELS, STATUS_ORDER } from '/js/engineCore.js';
import { matchProfile } from '/js/matchingEngine.js';
import { getProfile, saveProfile, readIdFromUrl } from '/js/profiles.js';
import { el, contactLines, PROGRAM_TYPE_LABELS, formatMoney, showError } from '/js/ui.js';

const form = document.getElementById('intake-form');
const resultsSection = document.getElementById('results');
const formError = document.getElementById('form-error');
const lookupStatus = document.getElementById('lookup-status');

const NUMBER_FIELDS = ['years_in_home', 'age_oldest_owner', 'household_size', 'va_disability_rating'];
const MONEY_FIELDS = ['household_income', 'cost_estimate_low', 'cost_estimate_high'];
const NOT_IN_CITY = ['Speedway', 'Beech Grove', 'Lawrence', 'Southport'];

let profileId = readIdFromUrl();
let addressLookedUp = '';

// ---------- Build the repeated controls ----------

const triFields = [];
for (const group of document.querySelectorAll('.tri-group')) {
  for (const pair of group.dataset.tri.split(';')) {
    const [field, label] = pair.split('|');
    triFields.push(field);
    const radios = [['true', 'Yes'], ['false', 'No'], ['', 'Unknown']].map(([value, text]) =>
      el('label', { class: 'tri-option' },
        el('input', { type: 'radio', name: field, value, checked: value === '' }),
        text));
    group.append(el('div', { class: 'tri-row', role: 'radiogroup', 'aria-label': label },
      el('span', { class: 'tri-label', text: label }), el('span', { class: 'tri-options' }, radios)));
  }
}

const repairBox = document.getElementById('repair-checks');
for (const [key, label] of Object.entries(REPAIR_CATEGORIES)) {
  repairBox.append(el('label', { class: 'check' },
    el('input', { type: 'checkbox', name: 'repair_categories', value: key }), label));
}

for (const input of form.querySelectorAll('[data-money]')) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^\d]/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  });
}

// ---------- Address lookup ----------

async function lookUpAddress() {
  const address = form.property_address.value.trim();
  if (!address) {
    lookupStatus.textContent = 'Enter an address first.';
    return false;
  }
  lookupStatus.textContent = 'Looking up the address...';
  try {
    const loc = await geocodeAddress(address);
    form.state_code.value = loc.state || '';
    form.county_fips.value = loc.countyFips || '';
    form.census_tract.value = loc.censusTract || '';
    form.county_name.value = loc.countyName ? loc.countyName.replace(/ County$/, '') : '';
    form.property_city.value = loc.city || form.property_city.value;
    form.property_zip.value = loc.zip || form.property_zip.value;
    addressLookedUp = address;

    let note = `Found ${form.county_name.value || 'unknown'} County${loc.censusTract ? `, census tract ${loc.censusTract}` : ''}.`;
    if (loc.state !== 'IN') note += ' This address is outside Indiana; EHS-IQ only covers Indiana.';
    const cityChoice = form.querySelector('input[name="in_city_indianapolis"]:checked');
    if (cityChoice && cityChoice.value === '' && loc.state === 'IN') {
      if (loc.city === 'Indianapolis') {
        setTri('in_city_indianapolis', true);
        note += ' Marked "inside the City of Indianapolis" from the city name; confirm it.';
      } else if (NOT_IN_CITY.includes(loc.city)) {
        setTri('in_city_indianapolis', false);
        note += ` ${loc.city} is outside the City of Indianapolis for city programs.`;
      }
    }
    if (!loc.countyFips) note += ' County could not be confirmed from census data; programs that depend on county will show as "Worth a call".';
    lookupStatus.textContent = note;
    return true;
  } catch (err) {
    lookupStatus.textContent = `${err.message} You can still save; county-based programs will show as "Worth a call".`;
    return false;
  }
}

document.getElementById('lookup-btn').addEventListener('click', lookUpAddress);

// ---------- Read and write the form ----------

function setTri(field, value) {
  const target = value === true ? 'true' : value === false ? 'false' : '';
  for (const radio of form.querySelectorAll(`input[name="${field}"]`)) radio.checked = radio.value === target;
}

function readForm() {
  const data = {};
  const text = (name) => {
    const v = form[name].value.trim();
    return v === '' ? null : v;
  };
  for (const name of ['client_name', 'client_phone', 'completed_for_client_by', 'consent_date', 'consent_method',
    'property_address', 'property_city', 'property_zip', 'state_code', 'county_fips', 'county_name',
    'census_tract', 'township', 'title_issue', 'home_type', 'urgency', 'savings_band', 'prior_assistance', 'notes']) {
    data[name] = text(name);
  }
  for (const name of NUMBER_FIELDS) {
    const v = form[name].value.trim();
    data[name] = v === '' ? null : Number(v);
  }
  for (const name of MONEY_FIELDS) {
    const v = form[name].value.replace(/[^\d]/g, '');
    data[name] = v === '' ? null : Number(v);
  }
  for (const field of triFields) {
    const checked = form.querySelector(`input[name="${field}"]:checked`);
    data[field] = !checked || checked.value === '' ? null : checked.value === 'true';
  }
  data.consent_given = form.consent_given.checked;
  data.repair_categories = [...form.querySelectorAll('input[name="repair_categories"]:checked')].map(c => c.value);
  return data;
}

function fillForm(profile) {
  for (const [key, value] of Object.entries(profile)) {
    if (triFields.includes(key)) { setTri(key, value); continue; }
    if (key === 'repair_categories') {
      for (const box of form.querySelectorAll('input[name="repair_categories"]')) box.checked = (value || []).includes(box.value);
      continue;
    }
    if (key === 'consent_given') { form.consent_given.checked = !!value; continue; }
    const input = form.elements.namedItem(key);
    if (!input || input instanceof RadioNodeList) continue;
    input.value = value === null || value === undefined ? ''
      : MONEY_FIELDS.includes(key) ? Number(value).toLocaleString('en-US') : value;
  }
  addressLookedUp = profile.property_address || '';
}

// ---------- Save and match ----------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  if (!form.client_name.value.trim()) { formError.textContent = 'Enter the homeowner\'s name.'; return; }
  if (!form.consent_given.checked) { formError.textContent = 'Record the homeowner\'s consent before saving.'; return; }

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  try {
    if (form.property_address.value.trim() && form.property_address.value.trim() !== addressLookedUp) {
      saveBtn.textContent = 'Looking up the address...';
      await lookUpAddress();
    }
    saveBtn.textContent = 'Saving...';
    const saved = await saveProfile(readForm(), profileId);
    profileId = saved.id;
    history.replaceState(null, '', `/intake.html?id=${saved.id}`);
    saveBtn.textContent = 'Finding programs...';
    await showResults(saved);
  } catch (err) {
    formError.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save and find programs';
  }
});

document.getElementById('edit-again').addEventListener('click', () => {
  resultsSection.hidden = true;
  form.hidden = false;
  document.querySelector('.lede').hidden = false;
  document.getElementById('page-title').hidden = false;
  window.scrollTo({ top: 0 });
});

// ---------- Results ----------

async function showResults(profile) {
  const list = document.getElementById('results-list');
  document.getElementById('results-client').textContent = profile.client_name;
  document.getElementById('print-link').href = `/plan.html?id=${profile.id}`;
  form.hidden = true;
  document.querySelector('.lede').hidden = true;
  document.getElementById('page-title').hidden = true;
  resultsSection.hidden = false;
  list.replaceChildren(el('p', { class: 'muted', text: 'Matching...' }));
  window.scrollTo({ top: 0 });

  try {
    const results = await matchProfile(profile);
    list.replaceChildren();
    const intros = {
      likely_fit: 'Every rule passes and the program is open.',
      worth_a_call: 'Nothing rules these out, but something needs confirming. The questions to ask are listed.',
      closed: 'These would fit but are not taking applications now.',
      not_fit: 'Ruled out, with the reason. Shown so you can see why a program is missing.'
    };
    for (const status of STATUS_ORDER) {
      const group = results.filter(r => r.status === status);
      if (group.length === 0) continue;
      const heading = el('h3', { class: `group-head status-${status}` }, `${STATUS_LABELS[status]} (${group.length})`);
      const cards = group.map(r => resultCard(r));
      if (status === 'not_fit') {
        list.append(el('details', { class: 'not-fit' }, el('summary', {}, heading), el('p', { class: 'muted', text: intros[status] }), cards));
      } else {
        list.append(heading, el('p', { class: 'muted', text: intros[status] }), ...cards);
      }
    }
  } catch (err) {
    showError(list, err);
  }
}

function resultCard(result) {
  const p = result.program;
  const asks = [...result.verify, ...(p.open_questions || [])];
  return el('article', { class: `result-card status-${result.status}` },
    el('div', { class: 'card-head' },
      el('h4', { text: p.name }),
      el('span', { class: 'badge', text: PROGRAM_TYPE_LABELS[p.program_type] || p.program_type })),
    el('p', { text: p.benefit_summary || p.description || '' }),
    p.max_amount ? el('p', { class: 'muted', text: `Up to ${formatMoney(p.max_amount)}` }) : null,
    result.status === 'not_fit'
      ? el('p', { class: 'reason', text: result.unmet.join('; ') })
      : null,
    result.status === 'closed'
      ? el('p', { class: 'reason', text: [p.status_note, p.reopens_note].filter(Boolean).join(' ') })
      : null,
    result.status !== 'not_fit' && p.strings_attached
      ? el('p', { class: 'strings' }, el('strong', { text: 'Strings attached: ' }), p.strings_attached)
      : null,
    result.status !== 'not_fit' && asks.length
      ? el('div', { class: 'asks' }, el('strong', { text: 'Ask when you call:' }), el('ul', {}, asks.map(a => el('li', { text: a }))))
      : null,
    result.status !== 'not_fit' && result.contacts.length
      ? el('div', { class: 'contacts' }, result.contacts.map(contactLines))
      : null
  );
}

// ---------- Start ----------

(async () => {
  await sessionReady;
  if (!profileId) {
    form.consent_date.value = new Date().toLocaleDateString('en-CA');
    return;
  }
  document.getElementById('page-title').textContent = 'Homeowner intake';
  try {
    const profile = await getProfile(profileId);
    fillForm(profile);
    await showResults(profile);
  } catch (err) {
    formError.textContent = err.message;
  }
})();
