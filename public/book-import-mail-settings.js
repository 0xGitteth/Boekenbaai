'use strict';
// PR7: self-service reminders. All values are fetched for the signed-in staff
// account only. Neither addresses nor codes are placed in localStorage.
const mailPanel = document.getElementById('book-import-mail-preferences-panel');
if (mailPanel) {
  const status = document.getElementById('book-import-mail-status');
  const modeForm = document.getElementById('book-import-mail-mode-form');
  const mode = document.getElementById('book-import-mail-mode');
  const school = document.getElementById('book-import-mail-school');
  const alternate = document.getElementById('book-import-mail-alternate');
  const requestForm = document.getElementById('book-import-mail-request-form');
  const addressInput = document.getElementById('book-import-mail-request-address');
  const codeForm = document.getElementById('book-import-mail-code-form');
  const codeInput = document.getElementById('book-import-mail-code');
  const pending = document.getElementById('book-import-mail-pending');
  const configMessage = document.getElementById('book-import-mail-config');
  let serial = 0;
  let busy = false;
  let hasVerifiedAlternative = false;
  const configuredBase = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const base = (window.BOEKENBAAI_API_BASE || configuredBase
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const url = route => base ? base.replace(/\/$/, '') + route : route;
  const route = '/api/staff/book-import-mail-preferences';
  async function api(action) {
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) throw Error('Log eerst opnieuw in als medewerker.');
    const response = await fetch(url(route), {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(action ? { 'Content-Type': 'application/json' } : {}) },
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.message || 'Opslaan is niet gelukt.');
    return body;
  }
  async function load() {
    const current = ++serial;
    if (!localStorage.getItem('boekenbaai_token')
      || mailPanel.classList.contains('hidden')) return;
    try {
      const data = await api();
      if (current !== serial) return;
      mode.value = data.mode;
      school.textContent = data.schoolEmail
        || 'Nog geen gekoppeld @koraaledu.nl-adres';
      alternate.textContent = data.alternateEmail || 'Nog geen bevestigd adres';
      hasVerifiedAlternative = Boolean(data.alternateEmail);
      pending.textContent = data.pendingEmail
        ? 'Verificatiecode aangevraagd voor: ' + data.pendingEmail : '';
      codeForm.hidden = !data.pendingEmail;
      configMessage.textContent = data.deliveryConfigured ? ''
        : 'Automatische e-mailverzending moet nog door beheer worden geactiveerd. '
          + 'De herinneringen in Boekenbaai blijven beschikbaar.';
      requestForm.hidden = !data.deliveryConfigured;
      // The saved preference is independent from the Google login account.
      status.textContent = '';
    } catch (error) {
      if (current === serial) status.textContent = error.message;
    }
  }
  async function submit(action, successText) {
    if (busy) return;
    busy = true;
    status.textContent = '';
    try {
      await api(action);
      await load();
      status.textContent = successText;
    } catch (error) {
      status.textContent = error.message;
    } finally { busy = false; }
  }
  modeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode.value === 'alternate' && !hasVerifiedAlternative) {
      status.textContent = 'Verifieer eerst een alternatief adres.';
      return;
    }
    submit({ action: mode.value === 'school' ? 'use_school'
      : mode.value === 'off' ? 'disable' : 'use_alternate' },
    'Je voorkeur is opgeslagen.');
  });
  requestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submit({ action: 'request_alternative', email: addressInput.value.trim() },
      'Verificatiecode verzonden. Controleer je mailbox.');
  });
  codeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submit({ action: 'confirm_alternative', code: codeInput.value.trim() },
      'Je alternatieve e-mailadres is bevestigd en actief.');
    codeInput.value = '';
  });
  window.addEventListener('boekenbaai:staff-refresh', load);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    ++serial; status.textContent = ''; school.textContent = '';
    alternate.textContent = ''; pending.textContent = '';
    requestForm.hidden = true; codeForm.hidden = true;
    addressInput.value = ''; codeInput.value = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  load();
}
