(() => {
  'use strict';

  let renderBusy = false;
  let renderTimer = null;
  let lastStaffSignature = '';

  function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
  }

  async function api(url, options = {}) {
    const config = { method: 'GET', credentials: 'same-origin', ...options };
    config.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && typeof options.body !== 'string') {
      config.body = JSON.stringify(options.body);
      config.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, config);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) throw new Error(payload?.message || `Actie mislukt (${response.status})`);
    return payload;
  }

  function optionLabel(entry) {
    const status = entry.googleEmail
      ? entry.googleVerified ? ' · Google gekoppeld' : ' · mail vooraf gekoppeld'
      : '';
    return `${entry.name || 'Onbekend'}${status}`;
  }

  function staffSignature(entries) {
    return (entries || [])
      .filter((entry) => entry?.role !== 'admin')
      .map((entry) => [entry.id, entry.name, entry.googleEmail, Boolean(entry.googleVerified)].join('|'))
      .sort()
      .join('\n');
  }

  function addEmailForm(section, { entries, endpoint, idField, domain }) {
    const form = make('form', { className: 'google-manage__form' });
    const select = document.createElement('select');
    select.required = true;
    select.append(new Option('Kies een docent', ''));
    for (const entry of entries || []) {
      if (entry.role === 'admin') continue;
      const option = new Option(optionLabel(entry), entry.id);
      option.dataset.email = entry.googleEmail || '';
      option.dataset.verified = entry.googleVerified ? 'true' : 'false';
      select.append(option);
    }

    const email = make('input');
    email.type = 'email';
    email.placeholder = `naam@${domain}`;
    email.required = true;
    const save = make('button', { className: 'btn btn--secondary', text: 'Schoolmail koppelen', type: 'submit' });
    const status = make('p', { className: 'hint' });

    select.addEventListener('change', () => {
      const option = select.selectedOptions[0];
      email.value = option?.dataset.email || '';
      if (!option?.value) status.textContent = '';
      else if (option.dataset.verified === 'true') status.textContent = 'Dit Google-account is geverifieerd.';
      else if (option.dataset.email) status.textContent = 'Schoolmail staat klaar voor de eerste Google-login.';
      else status.textContent = 'Nog geen schoolmail gekoppeld.';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!select.value) return;
      save.disabled = true;
      status.textContent = 'Koppeling wordt opgeslagen…';
      try {
        const result = await api(endpoint, {
          method: 'POST',
          body: { [idField]: select.value, email: email.value },
        });
        const option = select.selectedOptions[0];
        option.dataset.email = result.googleEmail || email.value;
        option.dataset.verified = result.googleVerified ? 'true' : 'false';
        status.textContent = result.googleVerified
          ? 'Schoolmail gekoppeld en Google-account geverifieerd.'
          : 'Schoolmail gekoppeld. Google verifieert dit bij de eerste login.';
        lastStaffSignature = '';
        scheduleRender();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });

    form.append(select, email, save);
    section.append(form, status);
  }

  async function render() {
    const dashboard = document.querySelector('#admin-dashboard');
    const host = document.querySelector('#admin-modern-google-host');
    if (!dashboard || dashboard.classList.contains('hidden') || !host || renderBusy) return;

    renderBusy = true;
    try {
      const data = await api('/api/auth/google/manage');
      if (data.role !== 'admin') return;
      const signature = staffSignature(data.staff || []);
      const existing = host.querySelector('.admin-modern-google-links');
      if (existing && signature === lastStaffSignature) return;
      lastStaffSignature = signature;
      host.querySelectorAll('.admin-modern-google-links').forEach((node) => node.remove());

      const panel = make('section', { className: 'google-manage panel admin-modern-google-links' });
      const header = make('div', { className: 'panel__header' });
      const headerText = make('div');
      headerText.append(
        make('h3', { text: 'Docentaccounts' }),
        make('p', {
          className: 'panel__subtitle',
          text: 'Een schoolmail vooraf koppelen mag, maar hoeft niet. Zonder vooraf gekoppeld adres vraagt Boekenbaai Beheer de eerste Google-login eenmalig goed te keuren.',
        })
      );
      header.append(headerText);
      panel.append(header);

      const staffSection = make('div', { className: 'google-manage__section' });
      addEmailForm(staffSection, {
        entries: data.staff || [],
        endpoint: '/api/auth/google/staff-email',
        idField: 'staffId',
        domain: data.domain || 'koraaledu.nl',
      });
      panel.append(staffSection);
      host.append(panel);
    } catch (error) {
      // Het paneel is aanvullend; de rest van beheer blijft bruikbaar.
    } finally {
      renderBusy = false;
    }
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 150);
  }

  function install() {
    const dashboard = document.querySelector('#admin-dashboard');
    if (!dashboard) return;
    scheduleRender();
    const observer = new MutationObserver(() => {
      if (dashboard.classList.contains('hidden')) {
        lastStaffSignature = '';
        return;
      }
      scheduleRender();
      const host = document.querySelector('#admin-modern-google-host');
      if (host) {
        host.querySelectorAll('.google-manage:not(.admin-modern-google-links)').forEach((node) => node.remove());
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
