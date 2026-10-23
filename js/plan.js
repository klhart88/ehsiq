// ============================================
// EHS-IQ — Printed action plan
// Built in the browser from the saved profile and the catalog.
// Nothing is emailed or stored beyond the profile itself.
// ============================================

import { sessionReady } from '/js/authGuard.js';
import { matchProfile } from '/js/matchingEngine.js';
import { fillCallScript, STATUS_LABELS } from '/js/engineCore.js';
import { getProfile, readIdFromUrl } from '/js/profiles.js';
import { el, contactLines, PROGRAM_TYPE_LABELS, formatDate, formatMoney, showError } from '/js/ui.js';
import { AGENT_DISPLAY_NAME } from '/js/config.js';

const root = document.getElementById('plan');

const SHARED_DOCUMENTS = [
  'Photo ID and proof of age',
  'Deed or property tax bill showing ownership',
  'Proof of income for everyone in the home: Social Security award letter, pension statement, last tax return',
  'Letters showing any benefits (SSI, Medicaid, SNAP, Energy Assistance)',
  'Homeowners insurance declaration page and property tax status',
  'Photos of the problem and any contractor estimate'
];
const VETERAN_DOCUMENTS = ['DD-214 and VA disability rating letter'];

const FALLBACK_CONTACTS = [
  { label: 'Area Agency on Aging, statewide line', phone: '800-713-9023', notes: 'Help finding services for older adults anywhere in Indiana.' },
  { label: 'Indiana 211', phone: '211', notes: 'Emergency help, utilities and the township trustee for your area.' }
];
const CICOA_COUNTIES = ['18097', '18011', '18057', '18059', '18145', '18081', '18109', '18063'];
const CICOA_CONTACT = { label: 'CICOA Aging & In-Home Solutions (central Indiana)', phone: '317-803-6131 or 800-432-2422' };

// ---------- "How to read this plan" key ----------
// Kept short on purpose: one row per kind of help that appears on THIS plan.
const HELP_KINDS = [
  ['free_service', 'Free service', 'No', 'The program does the repair at no cost.'],
  ['grant', 'Grant', 'No', 'Money for the repair.'],
  ['forgivable_loan', 'Forgivable lien', 'Only if sold early', 'No payments or interest; forgiven over time.'],
  ['deferred_loan', 'Deferred loan', 'Only when the home is sold', 'No monthly payments.'],
  ['rebate', 'Rebate', 'No', 'Get approved before work starts; paid back to you after.'],
  ['low_interest_loan', 'Loan', 'Yes', 'Monthly payments.'],
  ['referral', 'Referral', 'Varies', 'The office decides case by case, often for emergencies.']
];

function readingKey(results) {
  const kinds = new Set(results.map(r => r.program.program_type));
  const rows = HELP_KINDS.filter(([type]) => kinds.has(type));
  return el('section', { class: 'plan-key' },
    el('h2', { text: 'How to read this plan' }),
    el('div', { class: 'key-grid' },
      el('table', { class: 'key-table' },
        el('colgroup', {}, el('col', { class: 'k' }), el('col', { class: 'p' }), el('col')),
        el('thead', {}, el('tr', {}, el('th', { text: 'Kind of help' }), el('th', { text: 'Pay it back?' }), el('th', { text: 'Good to know' }))),
        el('tbody', {}, rows.map(([, label, payBack, note]) => el('tr', {}, el('th', { scope: 'row', text: label }), el('td', { text: payBack }), el('td', { text: note }))))),
      el('table', { class: 'key-table' },
        el('colgroup', {}, el('col', { class: 'k' }), el('col')),
        el('thead', {}, el('tr', {}, el('th', { text: 'Tag on each program' }), el('th', { text: 'What it means' }))),
        el('tbody', {},
          el('tr', {}, el('th', { scope: 'row', text: STATUS_LABELS.likely_fit }), el('td', { text: 'You seem to meet the rules and it is open. Not an approval.' })),
          el('tr', {}, el('th', { scope: 'row', text: STATUS_LABELS.worth_a_call }), el('td', { text: 'Nothing rules you out, but something needs checking. Questions to ask are listed.' })),
          el('tr', {}, el('th', { scope: 'row', text: STATUS_LABELS.closed }), el('td', { text: 'Not taking regular applications now. Some still take emergencies.' }))))),
    el('ul', { class: 'key-notes' },
      el('li', {}, el('strong', { text: 'Check what each program covers. ' }), 'A program can fit you and still not pay for your repair.'),
      el('li', {}, el('strong', { text: 'Out of money is not always a no. ' }), 'Some programs closed for the year still help with emergencies such as no heat in winter or no water.'))
  );
}

function section(title, ...children) {
  return el('section', { class: 'plan-section' }, el('h2', { text: title }), ...children);
}

function programBlock(result, profile, number) {
  const p = result.program;
  const asks = [...new Set([...result.verify, ...(p.open_questions || [])])];
  return el('article', { class: `plan-program status-${result.status}` },
    el('h3', {}, `${number}. ${p.name}`),
    el('p', { class: 'plan-type' },
      el('span', { class: `plan-tag status-${result.status}`, text: STATUS_LABELS[result.status] }),
      [PROGRAM_TYPE_LABELS[p.program_type], p.max_amount ? `up to ${formatMoney(p.max_amount)}` : null].filter(Boolean).join(', ')),
    el('dl', {},
      el('dt', { text: 'What it can cover' }), el('dd', { text: p.benefit_summary || p.description || '' }),
      result.met.length ? [el('dt', { text: 'Why it may fit' }), el('dd', { text: result.met.join('. ') + '.' })] : null,
      p.strings_attached ? [el('dt', { text: 'Strings attached' }), el('dd', { text: p.strings_attached })] : null,
      el('dt', { text: 'Who to call' }), el('dd', {}, result.contacts.length ? result.contacts.map(contactLines) : 'See the program website.'),
      p.call_script ? [el('dt', { text: 'What to say' }), el('dd', { class: 'script', text: `"${fillCallScript(p.call_script, profile)}"` })] : null,
      p.how_to_apply ? [el('dt', { text: 'How to apply' }), el('dd', { text: p.how_to_apply })] : null,
      asks.length ? [el('dt', { text: 'Ask when you call' }), el('dd', {}, el('ul', {}, asks.map(a => el('li', { text: a }))))] : null
    )
  );
}

// The call list keeps one running number, split under the same colored
// group headings as the results screen.
function groupedBlocks(callList, profile) {
  const nodes = [];
  let number = 0;
  for (const status of ['likely_fit', 'worth_a_call']) {
    const group = callList.filter(r => r.status === status);
    if (!group.length) continue;
    nodes.push(el('h3', { class: `plan-group status-${status}`, text: `${STATUS_LABELS[status]} (${group.length})` }));
    for (const r of group) nodes.push(programBlock(r, profile, ++number));
  }
  return nodes;
}

function buildPlan(profile, results) {
  const callList = results.filter(r => r.status === 'likely_fit' || r.status === 'worth_a_call');
  const closed = results.filter(r => r.status === 'closed');
  const emergencyRoutes = callList.filter(r => r.program.is_emergency_route);

  const documents = [...SHARED_DOCUMENTS, ...(profile.is_veteran ? VETERAN_DOCUMENTS : [])];
  for (const r of callList) {
    for (const req of r.requirements) {
      if (req.requirement_type === 'document') documents.push(`${req.description} (${r.program.name})`);
    }
  }

  const fallback = [...FALLBACK_CONTACTS];
  if (CICOA_COUNTIES.includes(profile.county_fips)) fallback.unshift(CICOA_CONTACT);

  const nodes = [
    el('header', { class: 'plan-header' },
      el('div', { class: 'plan-brand' },
        el('img', { src: '/assets/smartiq-mark.png', alt: '' }),
        el('div', { class: 'plan-brand-name' }, 'EHS-', el('span', { text: 'IQ' }), el('small', { text: 'SmartIQ Realty · Fathom Realty' }))),
      el('p', { class: 'plan-kicker', text: 'Home repair help plan' }),
      el('h1', { text: profile.client_name }),
      el('p', { text: [profile.property_address, profile.county_name ? `${profile.county_name} County` : null].filter(Boolean).join(' · ') }),
      el('p', { class: 'muted', text: `Prepared ${formatDate(new Date().toISOString())} by ${AGENT_DISPLAY_NAME}` })
    )
  ];

  // The emergency box stays above everything else; the reading key is the first section.
  const keyNode = (callList.length || closed.length) ? readingKey([...callList, ...closed]) : null;

  if (profile.urgency === 'emergency') {
    nodes.push(el('div', { class: 'call-today' },
      el('h2', { text: 'Call today' }),
      el('p', { text: 'This repair is an emergency. Start with these, in this order:' }),
      el('ol', {},
        emergencyRoutes.map(r => el('li', {}, el('strong', { text: r.program.name }), r.contacts[0] ? ` — ${r.contacts[0].phone || r.contacts[0].email || ''}` : '')),
        el('li', {}, el('strong', { text: 'Indiana 211' }), ' — dial 211 for emergency help and the township trustee'))
    ));
  }

  if (keyNode) nodes.push(keyNode);

  if (callList.length) {
    nodes.push(section('Who to call, in this order',
      el('p', { text: 'Each of these may be able to help. None is guaranteed: the program decides who qualifies and whether money is available. Call them in this order.' }),
      groupedBlocks(callList, profile)));
  } else {
    nodes.push(section('Who to call',
      el('p', { text: 'No program is a clear fit right now. The contacts under "If you need more help" can look further.' })));
  }

  if (closed.length) {
    nodes.push(section('Closed for now, worth watching',
      el('h3', { class: 'plan-group status-closed', text: `${STATUS_LABELS.closed} (${closed.length})` }),
      el('ul', {}, closed.map(r => el('li', {},
        el('strong', { text: r.program.name }), ` (${PROGRAM_TYPE_LABELS[r.program.program_type] || r.program.program_type}): `,
        [r.program.status_note, r.program.reopens_note].filter(Boolean).join(' '),
        r.contacts[0]?.phone ? ` (${r.contacts[0].phone})` : '')))));
  }

  nodes.push(section('Papers to gather before you call',
    el('ul', { class: 'checklist' }, [...new Set(documents)].map(d => el('li', { text: d })))));

  nodes.push(section('If you need more help',
    el('div', { class: 'contacts' }, fallback.map(contactLines))));

  nodes.push(section('Protect yourself',
    el('p', { text: 'Be wary of anyone who asks for an upfront fee to apply, or for payment before work begins. Don\'t sign a contract or let work start until the program has approved it in writing; some programs won\'t pay for work started early.' })));

  nodes.push(el('footer', { class: 'plan-footer' },
    el('p', { text: 'This plan lists programs that may fit, based on the information you gave and program details checked on the date shown for each program. It is not an application and does not guarantee eligibility or funding. Each program makes its own decision. Program rules and funding change often; confirm details directly with the program.' })));

  root.replaceChildren(...nodes);
  document.title = `Repair help plan · ${profile.client_name}`;
}

(async () => {
  await sessionReady;
  const id = readIdFromUrl();
  document.getElementById('back-to-intake').href = id ? `/intake.html?id=${id}` : '/intake.html';
  if (!id) { showError(root, new Error('No client selected. Open a client from the Clients page.')); return; }
  try {
    const profile = await getProfile(id);
    const results = await matchProfile(profile);
    buildPlan(profile, results);
  } catch (err) {
    showError(root, err);
  }
})();
