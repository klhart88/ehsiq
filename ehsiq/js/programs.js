// ============================================
// EHS-IQ — Program status admin
// Updates only the fields an agent changes between catalog
// releases: funding status, notes, open questions, verified date.
// Row-level security allows updates, not inserts or deletes.
// ============================================

import { sessionReady } from '/js/authGuard.js';
import { supabaseClient } from '/js/supabaseClient.js';
import { el, formatDate, daysSince, showError, FUNDING_STATUS_LABELS, PROGRAM_TYPE_LABELS } from '/js/ui.js';
import { STALE_AFTER_DAYS } from '/js/config.js';

const list = document.getElementById('program-list');
const staleOnly = document.getElementById('stale-only');
let programs = [];

function today() {
  return new Date().toLocaleDateString('en-CA');
}

async function save(program, fields, card) {
  const statusEl = card.querySelector('.save-status');
  statusEl.textContent = 'Saving...';
  const { data, error } = await supabaseClient
    .from('programs')
    .update(fields)
    .eq('id', program.id)
    .select()
    .single();
  if (error) {
    statusEl.textContent = `Not saved: ${error.message}`;
    return;
  }
  Object.assign(program, data);
  // Replace only this card, so unsaved edits in other cards survive.
  const fresh = programCard(program);
  fresh.querySelector('.save-status').textContent =
    `Saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  card.replaceWith(fresh);
}

function programCard(p) {
  const age = daysSince(p.last_verified_date);
  const stale = age > STALE_AFTER_DAYS;

  const statusSelect = el('select', { 'aria-label': 'Funding status' },
    Object.entries(FUNDING_STATUS_LABELS).map(([value, label]) =>
      el('option', { value, selected: p.funding_status === value, text: label })));
  const statusNote = el('input', { type: 'text', value: p.status_note || '', 'aria-label': 'Status note' });
  const reopensNote = el('input', { type: 'text', value: p.reopens_note || '', 'aria-label': 'Reopening note' });
  const questions = el('textarea', { rows: 3, 'aria-label': 'Open questions, one per line' });
  questions.value = (p.open_questions || []).join('\n');
  const notes = el('textarea', { rows: 2, 'aria-label': 'Agent notes' });
  notes.value = p.agent_notes || '';

  const collect = () => ({
    funding_status: statusSelect.value,
    status_note: statusNote.value.trim() || null,
    reopens_note: reopensNote.value.trim() || null,
    open_questions: questions.value.split('\n').map(s => s.trim()).filter(Boolean),
    agent_notes: notes.value.trim() || null
  });

  const card = el('article', { class: `program-card${stale ? ' stale' : ''}` },
    el('div', { class: 'card-head' },
      el('div', {},
        el('h3', {}, el('a', { href: p.source_url, target: '_blank', rel: 'noopener', text: p.name })),
        el('p', { class: 'muted', text: `${PROGRAM_TYPE_LABELS[p.program_type] || p.program_type} · ${p.administering_entity}` })),
      el('span', { class: `badge verified${stale ? ' warn' : ''}`, text: `Verified ${formatDate(p.last_verified_date)}${stale ? ` · ${age} days ago` : ''}` })),
    el('div', { class: 'grid-3' },
      el('label', {}, 'Funding status', statusSelect),
      el('label', {}, 'Status note', statusNote),
      el('label', {}, 'Reopening note', reopensNote)),
    el('div', { class: 'grid-2' },
      el('label', {}, 'Ask when you call (one per line, prints on plans)', questions),
      el('label', {}, 'Your notes (not printed)', notes)),
    el('div', { class: 'card-actions' },
      el('button', { type: 'button', text: 'Save', onclick: () => save(p, collect(), card) }),
      el('button', { type: 'button', class: 'secondary', text: 'Save and mark verified today', onclick: () => save(p, { ...collect(), last_verified_date: today() }, card) }),
      el('span', { class: 'save-status', 'aria-live': 'polite' }))
  );
  return card;
}

function render() {
  const shown = staleOnly.checked
    ? programs.filter(p => daysSince(p.last_verified_date) > STALE_AFTER_DAYS)
    : programs;
  list.replaceChildren(...(shown.length
    ? shown.map(programCard)
    : [el('p', { class: 'empty', text: staleOnly.checked ? 'Every program has been checked recently.' : 'No programs found. Run sql/02_seed.sql.' })]));
}

staleOnly.addEventListener('change', render);

(async () => {
  await sessionReady;
  const { data, error } = await supabaseClient.from('programs').select('*').eq('is_active', true).order('name');
  if (error) { showError(list, error); return; }
  programs = data || [];
  render();
})();
