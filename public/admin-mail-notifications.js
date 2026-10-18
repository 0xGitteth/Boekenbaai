'use strict';
// Separate administration-wide recipients. The shared admin login is not
// attached to a Google mailbox. Verification is server-side only.
const panel = document.getElementById('admin-mail-notifications-panel');
if (panel) {
  const list = document.getElementById('admin-mail-notifications-list');
  const status = document.getElementById('admin-mail-notifications-status');
  const form = document.getElementById('admin-mail-add-form');
  const newEmail = document.getElementById('admin-mail-new-address');
  const delivery = document.getElementById('admin-mail-delivery');
  const categoryKeys = ['transfers', 'google', 'books'];
  const categoryLabels = {
    transfers: 'Afgewezen klaswissels',
    google: 'Google-koppelverzoeken',
    books: 'Boekcontroles die naar beheer zijn geëscaleerd',
  };
  const configuredBase = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const base = (window.BOEKENBAAI_API_BASE || configuredBase
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const url = route => base ? base.replace(/\/$/, '') + route : route;
  let busy = false;
  let serial = 0;
  async function api(body) {
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) throw Error('Log opnieuw in als beheerder.');
    const response = await fetch(url('/api/admin/mail-notifications'), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'Deze wijziging is niet opgeslagen.');
    return data;
  }
  function element(tag, value) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    return node;
  }
  function render(data) {
    list.replaceChildren();
    delivery.textContent = data.deliveryConfigured ? ''
      : 'De Gmail-verzending is nog niet ingesteld. Verificatiemails zijn nu uitgeschakeld.';
    newEmail.disabled = !data.deliveryConfigured;
    form.querySelector('button').disabled = !data.deliveryConfigured;
    const all = data.recipients || [];
    if (!all.length) list.append(element('p', 'Nog geen beheerdersadressen bevestigd.'));
    for (const item of all) {
      const row = element('div');
      row.className = 'form-field';
      const info = element('strong', item.email);
      const state = element('span', item.verified ? 'Geverifieerd'
        : 'Verificatie vereist');
      row.append(info, state);
      if (!item.verified) {
        const verify = element('form');
        const code = element('input');
        code.type = 'text';
        code.inputMode = 'numeric';
        code.maxLength = 8;
        code.pattern = '[0-9]{8}';
        code.placeholder = 'Achtcijferige code';
        code.required = true;
        const send = element('button', 'Adres bevestigen');
        send.className = 'btn btn--secondary';
        send.type = 'submit';
        verify.append(code, send);
        verify.addEventListener('submit', e => {
          e.preventDefault();
          submit({ action: 'confirm_address', email: item.email, code: code.value.trim() },
            'Adres is bevestigd.');
        });
        row.append(verify);
      }
      const remove = element('button', 'Verwijderen');
      remove.className = 'btn btn--ghost';
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm('Dit adres verwijderen uit de beheerdersmeldingen?')) return;
        submit({ action: 'remove_address', email: item.email },
          'Adres is verwijderd.');
      });
      row.append(remove);
      if (item.verified) {
        const preferences = element('form');
        preferences.className = 'admin-mail-recipient__preferences';
        const title = element('h4', 'Meldingen voor dit e-mailadres');
        const options = element('div');
        options.className = 'admin-mail-recipient__options';
        const checkboxes = new Map();
        for (const key of categoryKeys) {
          const label = element('label');
          const checkbox = element('input');
          checkbox.type = 'checkbox';
          checkbox.checked = Boolean(item.categories?.[key]);
          checkboxes.set(key, checkbox);
          label.append(checkbox, document.createTextNode(categoryLabels[key]));
          options.append(label);
        }
        const save = element('button', 'Voorkeuren opslaan');
        save.type = 'submit';
        save.className = 'btn btn--secondary';
        preferences.append(title, options, save);
        preferences.addEventListener('submit', event => {
          event.preventDefault();
          const categories = Object.fromEntries(categoryKeys.map(key =>
            [key, checkboxes.get(key).checked]));
          submit({ action: 'update_recipient_categories', email: item.email, categories },
            'Voorkeuren voor ' + item.email + ' opgeslagen.');
        });
        row.append(preferences);
      }
      list.append(row);
    }
  }
  async function load() {
    const current = ++serial;
    if (panel.classList.contains('hidden')) return;
    try {
      const data = await api();
      if (current !== serial) return;
      render(data);
    } catch (error) {
      if (current === serial) status.textContent = error.message;
    }
  }
  async function submit(body, message) {
    if (busy) return;
    const current = serial;
    busy = true;
    status.textContent = '';
    try {
      const data = await api(body);
      if (current !== serial) return;
      render(data);
      status.textContent = message;
    } catch (error) {
      if (current === serial) status.textContent = error.message;
    } finally { busy = false; }
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    submit({ action: 'request_address', email: newEmail.value.trim() },
      'Een verificatiecode is verzonden.');
  });
  window.addEventListener('boekenbaai:staff-refresh', load);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    // A shared browser can switch between admin and teacher sessions. Do
    // not retain administrators' addresses, even in a hidden dashboard.
    ++serial;
    list.replaceChildren();
    delivery.textContent = '';
    status.textContent = '';
    newEmail.value = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  load();
}
