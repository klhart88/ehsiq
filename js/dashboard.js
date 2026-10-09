// ============================================
// EHS-IQ — Clients dashboard
// ============================================

import { sessionReady } from '/js/authGuard.js';
import { supabaseClient } from '/js/supabaseClient.js';
import { listProfiles, deleteProfile } from '/js/profiles.js';
import { REPAIR_CATEGORIES } from '/js/engineCore.js';
import { el, formatDate, daysSince, showError, URGENCY_LABELS } from '/js/ui.js';
import { STALE_AFTER_DAYS } from '/js/config.js';

const list = document.getElementById('client-list');
const banner = document.getElementById('stale-banner');

async function renderStaleBanner() {
  const { data, error } = await supabaseClient
    .from('programs')
    .select('name, last_verified_date')
    .eq('is_active', true);
  if (error || !data) return;
  if (data.length === 0) {
    banner.replaceChildren(el('p', { class: 'notice' },
      'No programs are visible. If you just set up EHS-IQ, run sql/02_seed.sql and sql/04_add_agent.sql in Supabase.'));
    return;
  }
  const stale = data.filter(p => daysSince(p.last_verified_date) > STALE_AFTER_DAYS);
  if (stale.length) {
    banner.replaceChildren(el('p', { class: 'notice' },
      `${stale.length} program${stale.length === 1 ? '' : 's'} not verified in over ${STALE_AFTER_DAYS} days. `,
      el('a', { href: '/programs.html', text: 'Review program status' })));
  }
}

async function renderClients() {
  try {
    const clients = await listProfiles();
    if (clients.length === 0) {
      list.replaceChildren(el('p', { class: 'empty' }, 'No clients yet. ', el('a', { href: '/intake.html', text: 'Start an intake' }), '.'));
      return;
    }
    const rows = clients.map(c => el('tr', {},
      el('td', {}, el('a', { href: `/intake.html?id=${c.id}`, text: c.client_name })),
      el('td', { text: [c.property_city, c.county_name ? `${c.county_name} Co.` : null].filter(Boolean).join(', ') }),
      el('td', { text: (c.repair_categories || []).map(r => REPAIR_CATEGORIES[r] || r).join(', ') }),
      el('td', { text: URGENCY_LABELS[c.urgency] || '' }),
      el('td', { text: formatDate(c.updated_at) }),
      el('td', { class: 'row-actions' },
        el('a', { href: `/plan.html?id=${c.id}`, text: 'Plan' }),
        el('button', {
          type: 'button', class: 'link danger', text: 'Delete',
          onclick: async () => {
            if (!confirm(`Delete ${c.client_name}'s record permanently? This can't be undone.`)) return;
            try { await deleteProfile(c.id); await renderClients(); } catch (err) { alert(err.message); }
          }
        }))
    ));
    list.replaceChildren(el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {}, ['Homeowner', 'Location', 'Repair', 'Urgency', 'Updated', ''].map(h => el('th', { text: h })))),
      el('tbody', {}, rows)));
  } catch (err) {
    showError(list, err);
  }
}

(async () => {
  await sessionReady;
  renderStaleBanner();
  renderClients();
})();
