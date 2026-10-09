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
import { readIntakePdf, toIsoDate, formatPhone } from '/js/pdfImport.js';

const form = document.getElementById('intake-form');
const resultsSection = document.getElementById('results');
const formError = document.getElementById('form-error');
const lookupStatus = document.getElementById('lookup-status');

const NUMBER_FIELDS = ['years_in_home', 'age_oldest_owner', 'household_size', 'va_disability_rating'];
const MONEY_FIELDS = ['household_income', 'cost_estimate_low', 'cost_estimate_high'];
const NOT_IN_CITY = ['Speedway', 'Beech Grove', 'Lawrence', 'Southport'];

let profileId = readIdFromUrl();
let addressLookedUp = '';

// ---------- Help text for the info buttons ----------

const HELP = {
  in_city_indianapolis: 'Indianapolis city limits cover most of Marion County, but Speedway, Beech Grove, Lawrence and Southport are separate cities. The city repair programs only serve homes inside city limits. The address lookup suggests an answer; confirm it.',
  inside_i465: 'Whether the home is inside the I-465 loop. Home Repairs for Good focuses its free repairs there.',
  usda_rural_eligible: 'USDA\'s 504 repair grant and loan only cover addresses USDA counts as rural. Check the address at eligibility.sc.egov.usda.gov (Single Family Housing Repairs). Most of Marion County is not eligible.',
  owner_on_deed: 'Their name is on the deed, the county\'s property record. Nearly every program requires it. For Marion County, check maps.indy.gov.',
  primary_residence: 'They live in this home most of the year. Programs don\'t fund rentals or second homes.',
  receives_ssi: 'Supplemental Security Income: a monthly federal payment for people with low income who are 65 or older, blind or disabled. Not the same as regular Social Security retirement. SSI qualifies a home for weatherization automatically.',
  receives_medicaid: 'Health coverage for people with low income. Needed for the PathWays for Aging waiver, which pays for home modifications.',
  receives_snap: 'Food assistance, formerly called food stamps, paid on an EBT card. Recorded as a sign of low income.',
  receives_energy_assistance: 'LIHEAP, Indiana\'s Energy Assistance Program: help paying heating or electric bills, applied for through the community action agency. It qualifies a home for weatherization automatically.',
  receives_tanf: 'Temporary Assistance for Needy Families: cash assistance, mostly for families with children. Rare for older homeowners. It qualifies a home for weatherization automatically.',
  is_veteran: 'Served in the U.S. military, or is the surviving spouse of someone who did. Opens the VA home-adaptation grants.',
  va_service_connected: 'The VA has rated a disability as caused or worsened by military service. Needed for the larger VA adapted-housing grants, and raises the HISA amount.',
  has_disability: 'Any long-term condition that limits daily life. Some programs serve people with a disability at any age.',
  uses_mobility_device: 'Helps judge whether a ramp or other access changes are needed.',
  recent_falls: 'A fall in the last year makes safety fixes such as grab bars and rails more urgent.',
  needs_daily_help: 'Needs help with bathing, dressing, meals or medications. Relevant to the PathWays waiver, which requires a nursing-facility level of care.',
  taxes_current: 'Property taxes paid, with nothing past due. Most programs require this. The county treasurer\'s site shows the status.',
  mortgage_current: 'Payments are up to date. Answer Yes if there is no mortgage. Having a mortgage is fine; being behind on it usually isn\'t.',
  insurance_current: 'A homeowners insurance policy is in force. Some programs require it, and it may cover storm damage.',
  can_afford_small_payment: 'Only matters for low-interest loans such as USDA\'s 1% repair loan. Answer No if any monthly payment would be a hardship.',
  title_issue: 'How the home is titled. A mortgage is not a title problem: choose "Clear" and answer the mortgage question in section 7. A home still in a late relative\'s name, or bought on a land contract, is shut out of many programs until it\'s fixed.',
  home_type: 'Some programs exclude manufactured homes on rented lots, duplexes or condos.',
  township: 'Used to find the right township trustee for emergency help. Marion County has nine townships: Center, Decatur, Franklin, Lawrence, Perry, Pike, Warren, Washington and Wayne.'
};

let tipCount = 0;
function infoButton(field, label) {
  const id = `tip-${++tipCount}`;
  const tip = el('span', { class: 'tip', id, role: 'tooltip', text: HELP[field] });
  const button = el('button', {
    type: 'button', class: 'info', 'aria-label': `About: ${label}`, 'aria-describedby': id, 'aria-expanded': 'false', text: 'i',
    onclick: (e) => {
      e.preventDefault();
      const open = button.getAttribute('aria-expanded') !== 'true';
      document.querySelectorAll('.info[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
      button.setAttribute('aria-expanded', String(open));
    }
  });
  return el('span', { class: 'info-wrap' }, button, tip);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.info-wrap')) document.querySelectorAll('.info[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.info[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
});

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
      el('span', { class: 'tri-label' }, label, HELP[field] ? infoButton(field, label) : null), el('span', { class: 'tri-options' }, radios)));
  }
}

// Info buttons on the plain fields that have help text.
for (const field of ['title_issue', 'home_type', 'township']) {
  const input = form.elements.namedItem(field);
  const label = input?.closest('label');
  if (label) label.insertBefore(infoButton(field, label.firstChild.textContent.trim()), input);
}

const repairBox = document.getElementById('repair-checks');
for (const [key, label] of Object.entries(REPAIR_CATEGORIES)) {
  repairBox.append(el('label', { class: 'check' },
    el('input', { type: 'checkbox', name: 'repair_categories', value: key }), label));
}

form.client_phone.addEventListener('blur', () => { form.client_phone.value = formatPhone(form.client_phone.value); });

for (const input of form.querySelectorAll('[data-money]')) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^\d]/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  });
}

// ---------- Address lookup ----------

// The lookup needs the whole address. If the street box is missing the city,
// state or ZIP, add them from the other boxes so "3601 Leland Avenue" is
// searched in Indianapolis, Indiana and not wherever else that street exists.
function fullAddress() {
  const street = form.property_address.value.trim();
  if (!street) return '';
  const city = form.property_city.value.trim();
  const zip = form.property_zip.value.trim();
  const hasZip = /\b\d{5}(-\d{4})?\b/.test(street);
  const hasState = /,\s*(IN|Indiana)\b/i.test(street);
  const hasCity = city && street.toLowerCase().includes(city.toLowerCase());
  if (hasZip && hasState) return street;
  return [street, hasCity ? null : city, hasState ? null : `IN${!hasZip && zip ? ` ${zip}` : ''}`]
    .filter(Boolean).join(', ');
}

async function lookUpAddress() {
  const address = fullAddress();
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
    if (loc.state === 'IN') {
      // Only fill city and ZIP from an Indiana match; never overwrite them with a wrong-state guess.
      form.property_city.value = loc.city || form.property_city.value;
      form.property_zip.value = loc.zip || form.property_zip.value;
    }
    addressLookedUp = form.property_address.value.trim();

    let note = `Found ${form.county_name.value || 'unknown'} County${loc.censusTract ? `, census tract ${loc.censusTract}` : ''}.`;
    if (loc.state !== 'IN') note += ` The lookup matched an address outside Indiana (${loc.city || 'unknown city'}, ${loc.state || 'unknown state'}). Check the street, city and ZIP, then look it up again; EHS-IQ only covers Indiana.`;
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

// ---------- Import from a completed PDF form ----------

const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const importResult = document.getElementById('import-result');

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;

  const hasAnswers = form.client_name.value.trim() || form.property_address.value.trim();
  if (hasAnswers && !confirm('Replace the answers on this page with the ones in the PDF?')) return;

  importResult.replaceChildren();
  importBtn.disabled = true;
  importBtn.textContent = 'Reading the PDF...';
  try {
    const { answers, answered, warnings } = await readIntakePdf(file, {
      triFields, repairKeys: Object.keys(REPAIR_CATEGORIES)
    });
    if (answered === 0) {
      throw new Error('The PDF opened, but every box is empty. If the homeowner filled it in, it may have been saved with "Print to PDF", which erases the answers. Ask for the saved file, or enter the answers by hand.');
    }

    // Tidy the typed answers into the shapes the form expects.
    const notes = [];
    for (const name of [...NUMBER_FIELDS, ...MONEY_FIELDS]) {
      if (answers[name] === undefined) continue;
      const raw = answers[name];
      const digits = raw.replace(/\.\d*$/, '').replace(/[^\d]/g, '');
      answers[name] = digits === '' ? null : Number(digits);
      if (digits === '') notes.push(`"${raw}" in ${fieldLabel(name)} isn't a number, so it was left blank.`);
    }
    if (answers.client_phone) answers.client_phone = formatPhone(answers.client_phone);
    if (answers.property_zip) answers.property_zip = (answers.property_zip.match(/\d{5}(-\d{4})?/) || [answers.property_zip])[0];
    if (answers.consent_date !== undefined) {
      const iso = toIsoDate(answers.consent_date);
      if (!iso) notes.push(`The consent date "${answers.consent_date}" couldn't be read, so it was left blank.`);
      answers.consent_date = iso;
    }

    form.reset();
    fillForm(answers);
    form.consent_method.value = answers.consent_given ? 'written_form' : '';
    // The PDF asks for street, city and ZIP separately; the app keeps them in one line.
    if (form.property_address.value.trim()) form.property_address.value = fullAddress();
    addressLookedUp = '';
    lookupStatus.textContent = '';

    const messages = [...warnings, ...notes];
    if (!answers.consent_given) messages.push('The consent box on the form was not ticked. Get the homeowner\'s consent before saving.');
    if (!answers.client_name) messages.push('The homeowner\'s name is blank.');
    importResult.replaceChildren(...[
      el('div', { class: 'success-banner' },
        el('strong', { text: `Imported ${answered} answer${answered === 1 ? '' : 's'} from ${file.name}.` }),
        ' Review every section, then click Save and find programs.'),
      messages.length ? el('div', { class: 'notice' }, el('strong', { text: 'Check these:' }), el('ul', {}, messages.map(m => el('li', { text: m })))) : null
    ].filter(Boolean));
    importResult.scrollIntoView({ block: 'start' });
    if (form.property_address.value.trim()) await lookUpAddress();
  } catch (err) {
    importResult.replaceChildren(el('div', { class: 'error-banner', text: err.message }));
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = 'Import from PDF';
  }
});

function fieldLabel(name) {
  const label = form.elements.namedItem(name)?.closest('label');
  return label ? `"${label.firstChild.textContent.trim()}"` : name;
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
  importResult.replaceChildren();
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
