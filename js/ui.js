// ============================================
// EHS-IQ — Small shared display helpers
// ============================================

export const PROGRAM_TYPE_LABELS = {
  grant: 'Grant',
  free_service: 'Free service',
  rebate: 'Rebate',
  forgivable_loan: 'Forgivable lien',
  deferred_loan: 'Deferred loan',
  low_interest_loan: 'Loan',
  referral: 'Referral'
};

export const FUNDING_STATUS_LABELS = {
  open: 'Open',
  waitlist: 'Waitlist',
  closed: 'Closed',
  unknown: 'Unknown'
};

export const URGENCY_LABELS = {
  emergency: 'Emergency',
  soon: 'Needed soon',
  can_wait: 'Can wait'
};

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatDate(value) {
  if (!value) return '';
  const d = typeof value === 'string' && value.length === 10 ? new Date(value + 'T12:00:00') : new Date(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  return '$' + Number(value).toLocaleString('en-US');
}

export function daysSince(dateString) {
  if (!dateString) return Infinity;
  const then = new Date(dateString + 'T12:00:00');
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

export function showError(container, err) {
  container.replaceChildren(el('p', { class: 'error-banner', role: 'alert', text: err.message || String(err) }));
}

// First dialable number in a phone field such as
// "317-803-6131 or 800-432-2422" or "211".
function telHref(phone) {
  const ten = phone.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/);
  const digits = (ten ? ten[0] : phone).replace(/[^\d]/g, '');
  return `tel:${digits.length === 10 ? '+1' + digits : digits}`;
}

// Contact block used on results and on the printed plan.
export function contactLines(contact) {
  return el('div', { class: 'contact' },
    el('strong', { text: contact.label }),
    contact.phone ? el('div', {}, 'Phone: ', el('a', { href: telHref(contact.phone), text: contact.phone })) : null,
    contact.email ? el('div', {}, 'Email: ', el('a', { href: `mailto:${contact.email}`, text: contact.email })) : null,
    contact.website ? el('div', { class: 'contact-web' }, 'Web: ', el('a', { href: contact.website, target: '_blank', rel: 'noopener', text: contact.website.replace(/^https?:\/\//, '').replace(/\/$/, '') })) : null,
    contact.address ? el('div', { text: contact.address }) : null,
    contact.notes ? el('div', { class: 'muted', text: contact.notes }) : null
  );
}
