// ============================================
// EHS-IQ — Auth guard
// (Same pattern as HomeAccessIQ: one Supabase email-and-password
// account, sign-ups disabled.)
//
// Import at the top of every page except login.html and
// reset-password.html. Paths are absolute ('/login.html'), per
// HomeAccessIQ's lesson that relative paths break depending on
// which page loads the module.
// ============================================

import { supabaseClient } from '/js/supabaseClient.js';

document.documentElement.classList.add('auth-pending');

export async function requireAgentSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session) {
    window.location.replace('/login.html');
    return null;
  }
  document.documentElement.classList.remove('auth-pending');
  return session;
}

export async function signOutAgent() {
  await supabaseClient.auth.signOut();
  window.location.replace('/login.html');
}

export const sessionReady = requireAgentSession();

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sign-out]')) {
    e.preventDefault();
    signOutAgent();
  }
});
