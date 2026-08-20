(() => {
  'use strict';

  const TOKEN_KEY = 'boekenbaai_token';
  const COOKIE_SENTINEL = 'cookie';
  const query = new URLSearchParams(window.location.search);
  const googleState = query.get('googleAuth') || '';

  function hasAuthHintCookie() {
    return document.cookie
      .split(';')
      .map((part) => part.trim())
      .some((part) => part === 'boekenbaai_auth_hint=1');
  }

  function cleanGoogleQuery() {
    if (!query.has('googleAuth')) return;
    const next = new URL(window.location.href);
    next.searchParams.delete('googleAuth');
    window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`);
  }

  if (googleState === 'success' || hasAuthHintCookie()) {
    localStorage.setItem(TOKEN_KEY, COOKIE_SENTINEL);
  }

  const nativeFetch = window.fetch.bind(window);

  function currentAuthorizationHeader() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...currentAuthorizationHeader(),
      ...(options.headers || {}),
    };
    const config = { ...options, headers };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const response = await nativeFetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Er ging iets mis');
    return payload;
  }

  // De bestaande app.js is een ES-module. Door fetch vóór de module-evaluatie
  // te omwikkelen, kan de bestaande wachtwoordlogin toch optioneel persistent
  // worden gemaakt zonder de huidige inlogcode te wijzigen.
  window.fetch = async function boekenbaaiFetch(input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const remember = document.querySelector('#boekenbaai-remember-login')?.checked;
      if (remember && /\/api\/login-by-name(?:\?|$)/.test(url) && response.ok) {
        const payload = await response.clone().json().catch(() => null);
        if (payload?.token && ['teacher', 'admin'].includes(payload?.user?.role)) {
          await nativeFetch('/api/auth/session/persist', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${payload.token}`,
            },
            body: JSON.stringify({ remember: true }),
          }).catch(() => null);
          // Na het afronden van de bestaande login hoeft de echte bearer-token
          // niet in localStorage te blijven staan. Bij een volgende paginalaad
          // gebruikt app.js de HttpOnly sessiecookie via deze neutrale sentinel.
          window.setTimeout(() => {
            localStorage.setItem(TOKEN_KEY, COOKIE_SENTINEL);
          }, 0);
        }
        if (payload?.token && ['teacher', 'admin'].includes(payload?.user?.role)) {
          window.setTimeout(renderManagePanel, 350);
        }
      }
    } catch (error) {
      console.warn('Ingelogd blijven kon niet worden ingesteld.', error);
    }
    return response;
  };

  function makeElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text) element.textContent = options.text;
    if (options.type) element.type = options.type;
    if (options.id) element.id = options.id;
    if (options.placeholder) element.placeholder = options.placeholder;
    return element;
  }

  function statusMessageForState(state, domain) {
    if (!state || state === 'success' || state === 'link-required') return '';
    const messages = {
      'not-configured': 'Google-inlog is nog niet geconfigureerd door de beheerder.',
      'wrong-domain': `Gebruik je @${domain} schoolaccount.`,
      'staff-unlinked':
        'Dit Google-account is nog niet gekoppeld aan een medewerkeraccount. Een beheerder kan je schoolmailadres koppelen in het docentenportaal.',
      'state-error': 'De Google-inlog kon niet veilig worden afgerond. Probeer opnieuw.',
      'oauth-error': 'De Google-inlog is mislukt. Probeer opnieuw.',
      error: 'De Google-inlog is mislukt. Probeer opnieuw.',
    };
    return messages[state] || messages.error;
  }

  function addLoginControls(config) {
    const isStaff = document.body?.dataset.page === 'staff';
    const panel = document.querySelector(isStaff ? '#staff-login-panel' : '#student-login-panel');
    const form = document.querySelector(isStaff ? '#login-form' : '#student-login-form');
    if (!panel || !form || panel.querySelector('.google-login')) return;

    const block = makeElement('div', { className: 'google-login' });
    const divider = makeElement('div', { className: 'google-login__divider' });
    divider.setAttribute('aria-hidden', 'true');
    divider.innerHTML = '<span>of</span>';
    block.append(divider);

    if (isStaff) {
      const rememberLabel = makeElement('label', { className: 'google-login__remember' });
      const checkbox = makeElement('input', { type: 'checkbox', id: 'boekenbaai-remember-login' });
      rememberLabel.append(checkbox, document.createTextNode(' Ingelogd blijven op dit apparaat (30 dagen)'));
      block.append(rememberLabel);
    }

    const button = makeElement('button', {
      type: 'button',
      className: 'btn google-login__button',
      text: 'Inloggen met Google',
    });
    if (!config.enabled) {
      button.disabled = true;
      button.textContent = 'Google-inlog nog niet ingesteld';
    }
    button.addEventListener('click', () => {
      if (!config.enabled) return;
      const remember = isStaff && document.querySelector('#boekenbaai-remember-login')?.checked;
      const params = new URLSearchParams({ type: isStaff ? 'staff' : 'student' });
      if (remember) params.set('remember', '1');
      window.location.assign(`/api/auth/google/start?${params.toString()}`);
    });
    block.append(button);

    const hint = makeElement('p', {
      className: 'hint google-login__hint',
      text: config.enabled
        ? `Gebruik je @${config.domain} schoolaccount.`
        : 'De bestaande naam- en wachtwoordlogin blijft beschikbaar.',
    });
    block.append(hint);
    form.insertAdjacentElement('afterend', block);

    const message = statusMessageForState(googleState, config.domain);
    if (message) {
      const target = document.querySelector(isStaff ? '#login-message' : '#student-login-message');
      if (target) target.textContent = message;
    }
  }

  function renderPendingLinkPanel(config) {
    if (googleState !== 'link-required') return;
    const panel = document.querySelector('#student-login-panel');
    if (!panel || panel.querySelector('.google-link-request')) return;

    const container = makeElement('section', { className: 'google-link-request' });
    const title = makeElement('h3', { text: 'Koppel je schoolaccount' });
    const intro = makeElement('p', {
      text: 'Je Google-account is nog niet aan een leerlingaccount gekoppeld. Zoek je naam en stuur de koppeling naar je docent ter goedkeuring.',
    });
    const search = makeElement('input', {
      type: 'search',
      className: 'google-link-request__search',
      placeholder: 'Typ je naam',
    });
    search.autocomplete = 'off';
    const results = makeElement('div', { className: 'google-link-request__results' });
    const status = makeElement('p', { className: 'hint google-link-request__status' });
    container.append(title, intro, search, results, status);
    panel.prepend(container);

    let searchTimer = null;

    function renderMatches(matches) {
      results.replaceChildren();
      for (const match of matches || []) {
        const button = makeElement('button', {
          type: 'button',
          className: 'google-link-request__match',
        });
        const name = makeElement('strong', { text: match.displayName || 'Leerling' });
        const classes = makeElement('span', {
          text: (match.classNames || []).join(', ') || 'Geen klas vermeld',
        });
        button.append(name, classes);
        button.addEventListener('click', async () => {
          status.textContent = 'Koppelverzoek wordt verstuurd…';
          try {
            const result = await apiFetch('/api/auth/google/link-request', {
              method: 'POST',
              body: { studentId: match.id },
            });
            if (result.loggedIn) {
              localStorage.setItem(TOKEN_KEY, COOKIE_SENTINEL);
              window.location.replace('/index.html?googleAuth=success');
              return;
            }
            status.textContent =
              'Koppelverzoek verstuurd. Een docent van jouw klas kan het nu goedkeuren.';
            search.disabled = true;
            results.replaceChildren();
          } catch (error) {
            status.textContent = error.message;
          }
        });
        results.append(button);
      }
    }

    search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      const value = search.value.trim();
      if (value.length < 2) {
        results.replaceChildren();
        return;
      }
      searchTimer = window.setTimeout(async () => {
        try {
          const payload = await apiFetch(
            `/api/auth/google/student-options?q=${encodeURIComponent(value)}`
          );
          renderMatches(payload.matches);
        } catch (error) {
          status.textContent = error.message;
        }
      }, 250);
    });

    apiFetch('/api/auth/google/pending')
      .then(async (pending) => {
        if (pending.canComplete) {
          status.textContent = 'Je docent heeft de koppeling goedgekeurd. Je wordt ingelogd…';
          const completed = await apiFetch('/api/auth/google/pending/complete', { method: 'POST' });
          if (completed.loggedIn) {
            localStorage.setItem(TOKEN_KEY, COOKIE_SENTINEL);
            window.location.replace('/index.html?googleAuth=success');
          }
        } else if (pending.requestStatus === 'pending') {
          status.textContent =
            'Je koppelverzoek wacht nog op goedkeuring van een docent van jouw klas.';
        }
      })
      .catch(() => null);
  }

  function optionLabel(entry) {
    const suffix = Array.isArray(entry.classNames) && entry.classNames.length
      ? ` — ${entry.classNames.join(', ')}`
      : '';
    return `${entry.name || 'Onbekend'}${suffix}`;
  }

  async function renderManagePanel() {
    let data;
    try {
      data = await apiFetch('/api/auth/google/manage');
    } catch (error) {
      return;
    }
    const host = document.querySelector('#teacher-dashboard') || document.querySelector('main');
    if (!host || host.querySelector('.google-manage')) return;

    const panel = makeElement('section', { className: 'google-manage panel' });
    const header = makeElement('div', { className: 'panel__header' });
    const headerText = makeElement('div');
    headerText.append(
      makeElement('h3', { text: 'Google-accountkoppelingen' }),
      makeElement('p', {
        className: 'panel__subtitle',
        text: 'Koppel schoolmailadressen en keur verzoeken van leerlingen uit je eigen klassen goed.',
      })
    );
    header.append(headerText);
    panel.append(header);

    if (data.requests?.length) {
      const requests = makeElement('div', { className: 'google-manage__section' });
      requests.append(makeElement('h4', { text: 'Openstaande koppelverzoeken' }));
      for (const request of data.requests) {
        const row = makeElement('div', { className: 'google-manage__request' });
        const info = makeElement('div');
        info.append(
          makeElement('strong', { text: request.studentName }),
          makeElement('span', {
            text: `${(request.classNames || []).join(', ') || 'Geen klas'} · ${request.email}`,
          })
        );
        const actions = makeElement('div', { className: 'google-manage__actions' });
        const approve = makeElement('button', {
          type: 'button',
          className: 'btn btn--secondary',
          text: 'Goedkeuren',
        });
        const deny = makeElement('button', {
          type: 'button',
          className: 'btn btn--ghost',
          text: 'Afwijzen',
        });
        const act = async (action) => {
          approve.disabled = true;
          deny.disabled = true;
          try {
            await apiFetch(`/api/auth/google/link-requests/${request.id}/${action}`, {
              method: 'POST',
            });
            row.remove();
            if (!requests.querySelector('.google-manage__request')) requests.remove();
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
        requests.append(row);
      }
      panel.append(requests);
    }

    const studentSection = makeElement('div', { className: 'google-manage__section' });
    studentSection.append(makeElement('h4', { text: 'Schoolmailadres van een leerling' }));
    const studentForm = makeElement('form', { className: 'google-manage__form' });
    const studentSelect = document.createElement('select');
    studentSelect.required = true;
    studentSelect.append(new Option('Kies een leerling', ''));
    for (const student of data.students || []) {
      const option = new Option(optionLabel(student), student.id);
      option.dataset.email = student.googleEmail || '';
      studentSelect.append(option);
    }
    const studentEmail = makeElement('input', {
      type: 'email',
      placeholder: `naam@${data.domain}`,
    });
    studentEmail.required = true;
    const studentSave = makeElement('button', {
      type: 'submit',
      className: 'btn btn--secondary',
      text: 'E-mailadres koppelen',
    });
    const studentStatus = makeElement('p', { className: 'hint' });
    studentSelect.addEventListener('change', () => {
      studentEmail.value = studentSelect.selectedOptions[0]?.dataset.email || '';
    });
    studentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      studentStatus.textContent = 'Koppeling wordt opgeslagen…';
      try {
        const result = await apiFetch('/api/auth/google/student-email', {
          method: 'POST',
          body: { studentId: studentSelect.value, email: studentEmail.value },
        });
        studentSelect.selectedOptions[0].dataset.email = result.googleEmail || '';
        studentStatus.textContent = result.googleVerified
          ? 'Schoolmailadres gekoppeld en Google-account geverifieerd.'
          : 'Schoolmailadres gekoppeld. Bij de eerste Google-inlog wordt het account geverifieerd.';
      } catch (error) {
        studentStatus.textContent = error.message;
      }
    });
    studentForm.append(studentSelect, studentEmail, studentSave);
    studentSection.append(studentForm, studentStatus);
    panel.append(studentSection);

    if (data.role === 'admin' && data.staff?.length) {
      const staffSection = makeElement('div', { className: 'google-manage__section' });
      staffSection.append(makeElement('h4', { text: 'Schoolmailadres van een medewerker' }));
      const staffForm = makeElement('form', { className: 'google-manage__form' });
      const staffSelect = document.createElement('select');
      staffSelect.required = true;
      staffSelect.append(new Option('Kies een medewerker', ''));
      for (const staff of data.staff) {
        const option = new Option(`${staff.name} (${staff.role})`, staff.id);
        option.dataset.email = staff.googleEmail || '';
        staffSelect.append(option);
      }
      const staffEmail = makeElement('input', {
        type: 'email',
        placeholder: `naam@${data.domain}`,
      });
      staffEmail.required = true;
      const staffSave = makeElement('button', {
        type: 'submit',
        className: 'btn btn--secondary',
        text: 'E-mailadres koppelen',
      });
      const staffStatus = makeElement('p', { className: 'hint' });
      staffSelect.addEventListener('change', () => {
        staffEmail.value = staffSelect.selectedOptions[0]?.dataset.email || '';
      });
      staffForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        staffStatus.textContent = 'Koppeling wordt opgeslagen…';
        try {
          const result = await apiFetch('/api/auth/google/staff-email', {
            method: 'POST',
            body: { staffId: staffSelect.value, email: staffEmail.value },
          });
          staffSelect.selectedOptions[0].dataset.email = result.googleEmail || '';
          staffStatus.textContent = result.googleVerified
            ? 'Schoolmailadres gekoppeld en Google-account geverifieerd.'
            : 'Schoolmailadres gekoppeld. Bij de eerste Google-inlog wordt het account geverifieerd.';
        } catch (error) {
          staffStatus.textContent = error.message;
        }
      });
      staffForm.append(staffSelect, staffEmail, staffSave);
      staffSection.append(staffForm, staffStatus);
      panel.append(staffSection);
    }

    host.append(panel);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    let config = { enabled: false, domain: 'koraaledu.nl' };
    try {
      config = await apiFetch('/api/auth/google/config');
    } catch (error) {
      // De bestaande wachtwoordlogin blijft gewoon bruikbaar.
    }
    addLoginControls(config);
    renderPendingLinkPanel(config);
    window.setTimeout(renderManagePanel, 250);
    cleanGoogleQuery();
  });
})();
