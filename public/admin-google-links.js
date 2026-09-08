(() => {
  'use strict';

  let renderedForSession = false;

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
    const classes = Array.isArray(entry.classNames) && entry.classNames.length
      ? ` · ${entry.classNames.join(', ')}`
      : '';
    const status = entry.googleEmail
      ? entry.googleVerified ? ' · Google gekoppeld' : ' · mail vooraf gekoppeld'
      : '';
    return `${entry.name || 'Onbekend'}${classes}${status}`;
  }

  function addEmailForm(section, { title, entries, endpoint, idField, domain }) {
    section.append(make('h4', { text: title }));
    const form = make('form', { className: 'google-manage__form' });
    const select = document.createElement('select');
    select.required = true;
    select.append(new Option('Kies een account', ''));
    for (const entry of entries || []) {
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
      if (!option?.value) {
        status.textContent = '';
      } else if (option.dataset.verified === 'true') {
        status.textContent = 'Dit Google-account is geverifieerd.';
      } else if (option.dataset.email) {
        status.textContent = 'Schoolmail staat klaar; Google verifieert het account bij de eerste login.';
      } else {
        status.textContent = 'Nog geen schoolmail gekoppeld.';
      }
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
          : 'Schoolmail gekoppeld. Bij de eerste Google-login wordt het account geverifieerd.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });

    form.append(select, email, save);
    section.append(form, status);
  }

  function addRequests(panel, requests) {
    if (!requests?.length) return;
    const section = make('div', { className: 'google-manage__section admin-modern-google-links__requests' });
    section.append(make('h4', { text: `Openstaande koppelverzoeken (${requests.length})` }));
    for (const request of requests) {
      const row = make('div', { className: 'google-manage__request' });
      const info = make('div');
      info.append(
        make('strong', { text: request.studentName || 'Onbekende leerling' }),
        make('span', {
          text: `${(request.classNames || []).join(', ') || 'Geen klas'} · ${request.email || ''}`,
        })
      );
      const actions = make('div', { className: 'google-manage__actions' });
      const approve = make('button', { className: 'btn btn--secondary', text: 'Goedkeuren', type: 'button' });
      const deny = make('button', { className: 'btn btn--ghost', text: 'Afwijzen', type: 'button' });
      const act = async (action) => {
        approve.disabled = true;
        deny.disabled = true;
        try {
          await api(`/api/auth/google/link-requests/${request.id}/${action}`, { method: 'POST' });
          row.remove();
          if (!section.querySelector('.google-manage__request')) section.remove();
        } catch (error) {
          approve.disabled = false;
          deny.disabled = false;
          window.alert(error.message);
        }
      };
      approve.addEventListener('click', () => act('approve'));
      deny.addEventListener('click', () => act('deny'));
      actions.append(approve, deny);
      row.append(info, actions);
      section.append(row);
    }
    panel.append(section);
  }

  async function render() {
    const dashboard = document.querySelector('#admin-dashboard');
    const host = document.querySelector('#admin-modern-google-host');
    if (!dashboard || dashboard.classList.contains('hidden') || !host || renderedForSession) return;

    let data;
    try {
      data = await api('/api/auth/google/manage');
    } catch (error) {
      return;
    }
    if (data.role !== 'admin') return;

    renderedForSession = true;
    host.querySelectorAll('.google-manage').forEach((node) => node.remove());

    const panel = make('section', { className: 'google-manage panel admin-modern-google-links' });
    const header = make('div', { className: 'panel__header' });
    const headerText = make('div');
    headerText.append(
      make('h3', { text: 'Schoolaccounts' }),
      make('p', {
        className: 'panel__subtitle',
        text: 'Koppel @koraaledu.nl-adressen en handel eerste leerlinglogins af.',
      })
    );
    header.append(headerText);
    panel.append(header);

    addRequests(panel, data.requests || []);

    const staffSection = make('div', { className: 'google-manage__section' });
    addEmailForm(staffSection, {
      title: 'Docent koppelen',
      entries: data.staff || [],
      endpoint: '/api/auth/google/staff-email',
      idField: 'staffId',
      domain: data.domain || 'koraaledu.nl',
    });
    panel.append(staffSection);

    const studentSection = make('div', { className: 'google-manage__section' });
    addEmailForm(studentSection, {
      title: 'Leerling koppelen',
      entries: data.students || [],
      endpoint: '/api/auth/google/student-email',
      idField: 'studentId',
      domain: data.domain || 'koraaledu.nl',
    });
    panel.append(studentSection);

    host.append(panel);
  }

  function install() {
    const dashboard = document.querySelector('#admin-dashboard');
    if (!dashboard) return;
    render();
    const observer = new MutationObserver(() => {
      if (dashboard.classList.contains('hidden')) {
        renderedForSession = false;
        return;
      }
      render();
      const host = document.querySelector('#admin-modern-google-host');
      if (host) {
        host.querySelectorAll('.google-manage:not(.admin-modern-google-links)').forEach((node) => node.remove());
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
