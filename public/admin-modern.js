(() => {
  'use strict';

  const state = {
    upgraded: false,
    activeView: 'overview',
    activePeopleView: 'students',
    relocatedPanels: [],
    catalogOpened: false,
  };

  function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    if (options.id) element.id = options.id;
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
    if (!response.ok) {
      throw new Error(payload?.message || `Actie mislukt (${response.status})`);
    }
    return payload;
  }

  function randomLegacyPassword() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function installTechnicalPasswordShim(formSelector, inputSelector) {
    const form = document.querySelector(formSelector);
    if (!form || form.dataset.googleFirstPasswordShim) return;
    form.dataset.googleFirstPasswordShim = 'true';
    form.addEventListener('submit', () => {
      const input = document.querySelector(inputSelector);
      if (input && !input.value) input.value = randomLegacyPassword();
    }, true);
  }

  function hideLegacyPasswordUi() {
    const teacherPasswordForm = document.querySelector('#admin-teacher-password-form');
    if (teacherPasswordForm) teacherPasswordForm.hidden = true;

    const studentPasswordForm = document.querySelector('#admin-student-detail-password-form');
    const studentPasswordSection = studentPasswordForm?.closest('.admin-student-details__section');
    if (studentPasswordSection) studentPasswordSection.hidden = true;

    const teacherAddPassword = document.querySelector('#admin-teacher-add-password');
    const teacherAddPasswordField = teacherAddPassword?.closest('.form-field');
    if (teacherAddPasswordField) teacherAddPasswordField.hidden = true;

    const studentAddPassword = document.querySelector('#admin-student-password');
    const studentAddPasswordField = studentAddPassword?.closest('.form-field');
    if (studentAddPasswordField) studentAddPasswordField.hidden = true;

    document.querySelectorAll('[data-reset-teacher="true"], #admin-student-detail-password-generate, #admin-student-password-generate, #admin-teacher-add-password-generate')
      .forEach((element) => { element.hidden = true; });

    setTextIfChanged(
      document.querySelector('.admin-card--teachers .admin-card__heading .hint'),
      'Maak docenten aan, koppel klassen en beheer hun schoolaccount voor Google-inlog.'
    );
    setTextIfChanged(
      document.querySelector('.admin-card--students .admin-card__heading .hint'),
      'Maak leerlingaccounts aan, beheer klasindelingen en koppel schoolaccounts voor Google-inlog.'
    );

    installTechnicalPasswordShim('#admin-teacher-add-form', '#admin-teacher-add-password');
    installTechnicalPasswordShim('#admin-student-form', '#admin-student-password');
  }

  function expandCard(card) {
    if (!card) return;
    card.classList.remove('admin-card--collapsed');
    const content = card.querySelector('.admin-card__content');
    if (content) content.hidden = false;
    const toggle = card.querySelector('[data-card-toggle]');
    if (toggle) toggle.hidden = true;
  }


  function setActiveView(name) {
    if (!['overview', 'books', 'people', 'loans', 'tasks', 'imports', 'settings'].includes(name)) return;
    state.activeView = name;
    const dashboard = document.getElementById('admin-dashboard');
    dashboard?.querySelectorAll('[data-admin-modern-view]').forEach((view) => {
      view.hidden = view.dataset.adminModernView !== name;
    });
    document.querySelectorAll('#bb-admin-v31-sidebar [data-admin-modern-tab]').forEach((button) => {
      const active = button.dataset.adminModernTab === name;
      button.classList.toggle('admin-modern__tab--active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (name === 'overview') refreshOverview();
    if (name === 'books' && !state.catalogOpened) {
      state.catalogOpened = true;
      const content = document.getElementById('staff-book-overview-content');
      if (content?.hidden) document.getElementById('staff-book-overview-toggle')?.click();
    }
    updateCatalogToggle();
    closeMobileNavigation();
    if (document.body.classList.contains('bb-admin-v31')) {
      dashboard?.querySelector('[data-admin-modern-view="' + name + '"] h2')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }



  function setPeopleView(name) {
    if (!['students', 'teachers', 'classes'].includes(name)) return;
    state.activePeopleView = name;
    const dashboard = document.getElementById('admin-dashboard');
    dashboard?.querySelectorAll('[data-admin-people-view]').forEach((view) => {
      view.hidden = view.dataset.adminPeopleView !== name;
    });
    dashboard?.querySelectorAll('[data-admin-people-tab]').forEach((button) => {
      const active = button.dataset.adminPeopleTab === name;
      button.classList.toggle('admin-modern__subtab--active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }



  function syncMobileNavigation() {
    const sidebar = document.getElementById('bb-admin-v31-sidebar');
    if (!sidebar) return;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const closed = mobile && !document.body.classList.contains('bb-admin-v31--open');
    sidebar.inert = closed || !document.body.classList.contains('bb-admin-v31');
    sidebar.setAttribute('aria-hidden', String(closed || !document.body.classList.contains('bb-admin-v31')));
  }

  function closeMobileNavigation() {
    document.body.classList.remove('bb-admin-v31--open');
    const menu = document.getElementById('bb-admin-v31-menu');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Navigatie openen');
    syncMobileNavigation();
  }

  function createTabs(dashboard) {
    const main = dashboard.closest('main');
    if (!main || document.getElementById('bb-admin-v31-sidebar')) return;
    const sidebar = make('aside', { className: 'bb-admin-v31-sidebar', id: 'bb-admin-v31-sidebar' });
    const subtitle = make('div', { className: 'bb-admin-v31-sidebar-label', text: 'BEHEER' });
    const tabs = make('nav', { className: 'admin-modern__tabs' });
    tabs.setAttribute('aria-label', 'Beheernavigatie');
    const items = [
      ['overview', 'Start', '▦'],
      ['books', 'Boeken', '▤'],
      ['people', 'Personen en klassen', '♙'],
      ['loans', 'Uitlenen en innemen', '⇄'],
      ['tasks', 'Taken', '☑'],
      ['imports', 'Importeren', '⇧'],
      ['settings', 'Instellingen', '⚙'],
    ];
    for (const [key, label, symbol] of items) {
      const button = make('button', { className: 'admin-modern__tab', type: 'button' });
      button.dataset.adminModernTab = key;
      const icon = make('span', { className: 'bb-admin-v31-nav-icon', text: symbol });
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, make('span', { text: label }));
      button.addEventListener('click', () => setActiveView(key));
      tabs.append(button);
    }
    sidebar.append(subtitle, tabs);
    sidebar.append(make('div', { className: 'bb-admin-v31-sidebar-footer', text: 'Boekenbaai · VSO Het Dok' }));
    main.prepend(sidebar);

    const hero = document.querySelector('.hero--staff');
    if (hero) {
      const toggle = make('button', { className: 'bb-admin-v31-menu', id: 'bb-admin-v31-menu', type: 'button', text: '☰' });
      toggle.setAttribute('aria-label', 'Navigatie openen');
      toggle.setAttribute('aria-controls', sidebar.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const open = !document.body.classList.contains('bb-admin-v31--open');
        document.body.classList.toggle('bb-admin-v31--open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Navigatie sluiten' : 'Navigatie openen');
        syncMobileNavigation();
        if (open) sidebar.querySelector('button')?.focus();
      });
      hero.prepend(toggle);
    }
    const scrim = make('button', { className: 'bb-admin-v31-scrim', id: 'bb-admin-v31-scrim', type: 'button' });
    scrim.setAttribute('aria-label', 'Navigatie sluiten');
    scrim.addEventListener('click', () => {
      closeMobileNavigation();
      document.getElementById('bb-admin-v31-menu')?.focus();
    });
    document.body.append(scrim);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('bb-admin-v31--open')) {
        closeMobileNavigation();
        document.getElementById('bb-admin-v31-menu')?.focus();
      }
    });
    window.matchMedia('(max-width: 760px)').addEventListener('change', syncMobileNavigation);
  }



  function createOverviewView() {
    const view = make('section', { className: 'admin-modern__view admin-modern__overview' });
    view.dataset.adminModernView = 'overview';
    view.innerHTML = [
      '<div class="bb-admin-v31-heading"><div><p class="bb-admin-v31-eyebrow">Boekenbaai Beheer</p>',
      '<h2 tabindex="-1">Start</h2><p>De belangrijkste cijfers en taken op één vaste plek.</p></div></div>',
      '<div class="admin-modern__metrics" id="admin-modern-metrics" aria-live="polite"></div>',
      '<div class="bb-admin-v31-grid">',
      '<div class="bb-admin-v31-column">',
      '<section class="bb-admin-v31-card bb-admin-v31-card--actions"><div class="bb-admin-v31-card-head"><h3>Acties die aandacht vragen</h3>',
      '<button type="button" class="bb-admin-v31-link" data-v31-go="tasks">Alle taken →</button></div>',
      '<div id="admin-modern-actions" class="admin-modern__actions-list" aria-live="polite"></div></section>',
      '<section class="bb-admin-v31-card bb-admin-v31-card--stats"><h3>Schoolstatistieken</h3>',
      '<p>Bekijk uitleen- en leesstatistieken van de school.</p>',
      '<div id="bb-admin-v31-stats"></div></section></div>',
      '<div class="bb-admin-v31-column bb-admin-v31-column--activity">',
      '<section class="bb-admin-v31-card bb-admin-v31-card--activity"><div class="bb-admin-v31-card-head">',
      '<h3>Recente activiteit</h3><div id="bb-admin-v31-activity-actions"></div></div>',
      '<div id="bb-admin-v31-activity"></div></section></div></div>',
    ].join('');
    view.querySelector('[data-v31-go="tasks"]').addEventListener('click', () => setActiveView('tasks'));
    return view;
  }



  function createPeopleView(teacherCard, studentCard, classesCard) {
    const view = make('section', { className: 'admin-modern__view admin-modern__people' });
    view.dataset.adminModernView = 'people';
    const intro = make('div', { className: 'bb-admin-v31-heading' });
    intro.innerHTML = '<div><p class="bb-admin-v31-eyebrow">Boekenbaai Beheer</p><h2 tabindex="-1">Personen en klassen</h2>' +
      '<p>Beheer leerlingen, docenten, klasindelingen en schoolaccounts op één plek.</p></div>';
    view.append(intro);
    const tabs = make('div', { className: 'admin-modern__subtabs' });
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Personen en klassen');
    [['students', 'Leerlingen'], ['teachers', 'Docenten'], ['classes', 'Klassen']].forEach(([key, label]) => {
      const button = make('button', { className: 'admin-modern__subtab', text: label, type: 'button' });
      button.dataset.adminPeopleTab = key;
      button.setAttribute('role', 'tab');
      button.id = 'bb-people-tab-' + key;
      button.setAttribute('aria-controls', 'bb-people-panel-' + key);
      button.addEventListener('click', () => setPeopleView(key));
      button.addEventListener('keydown', (event) => {
        const order = ['students', 'teachers', 'classes'];
        const index = order.indexOf(key);
        const next = event.key === 'ArrowRight' ? (index + 1) % order.length
          : event.key === 'ArrowLeft' ? (index + order.length - 1) % order.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        const destination = order[next];
        setPeopleView(destination);
        view.querySelector('[data-admin-people-tab="' + destination + '"]')?.focus();
      });
      tabs.append(button);
    });
    view.append(tabs);
    const googleHost = make('div', { className: 'admin-modern__google-host', id: 'admin-modern-google-host' });
    for (const [name, card] of [['students', studentCard], ['teachers', teacherCard], ['classes', classesCard]]) {
      const panel = make('section', { className: 'admin-modern__people-view' });
      panel.dataset.adminPeopleView = name;
      panel.id = 'bb-people-panel-' + name;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'bb-people-tab-' + name);
      if (name === 'teachers') panel.append(googleHost);
      if (card) panel.append(card);
      view.append(panel);
    }
    return view;
  }


  function createSimpleView(name, card) {
    const view = make('section', { className: 'admin-modern__view' });
    view.dataset.adminModernView = name;
    if (card) view.append(card);
    return view;
  }

  function moveDangerousBookAction(booksView) {
    const deleteAll = document.getElementById('admin-books-delete-all');
    const heading = booksView?.querySelector('.bb-admin-v31-heading');
    if (!deleteAll || !heading) return;
    // Reuse the exact admin-only button and existing confirmation handler.
    // Keep the destructive action distinct from primary "Nieuw boek".
    deleteAll.classList.add('bb-admin-v31-delete-library');
    const actions = make('div', { className: 'bb-admin-v31-books-actions' });
    actions.append(deleteAll);
    heading.append(actions);
  }

  function organizeMailSettings() {
    const panel = document.getElementById('admin-mail-notifications-panel');
    if (!panel || panel.dataset.v31SettingsOrganized) return;
    const recipientList = panel.querySelector('#admin-mail-notifications-list');
    const addForm = panel.querySelector('#admin-mail-add-form');
    const categories = panel.querySelector('#admin-mail-categories');
    const delivery = panel.querySelector('#admin-mail-delivery');
    const status = panel.querySelector('#admin-mail-notifications-status');
    if (!recipientList || !addForm || !categories || !delivery || !status) return;
    panel.dataset.v31SettingsOrganized = 'true';
    const layout = make('div', { className: 'bb-admin-v31-settings-layout' });
    const addresses = make('section', { className: 'bb-admin-v31-settings-section' });
    addresses.append(make('h3', { text: 'Ontvangstadressen' }), delivery, recipientList);
    addresses.append(make('h4', { text: 'Beheerdersadres toevoegen' }), addForm);
    const preferences = make('section', { className: 'bb-admin-v31-settings-section' });
    preferences.append(categories, status);
    layout.append(addresses, preferences);
    panel.append(layout);
  }

  function modernizeImports() {
    const configs = [
      {
        formId: 'student-import-form',
        fileId: 'student-import-file',
        resultsId: 'student-import-results',
        messageId: 'student-import-message',
        kind: 'student',
        noun: 'leerlingen',
      },
      {
        formId: 'teacher-import-form',
        fileId: 'teacher-import-file',
        resultsId: 'teacher-import-results',
        messageId: 'teacher-import-message',
        kind: 'teacher',
        noun: 'docenten',
      },
    ];

    for (const config of configs) {
      const form = document.getElementById(config.formId);
      if (!form || form.dataset.googleFirstImport) continue;
      form.dataset.googleFirstImport = 'true';
      const section = form.closest('.admin-card__section--import');
      const hint = section?.querySelector('.hint');
      if (hint) {
        hint.innerHTML = config.kind === 'student'
          ? 'Upload Excel met <strong>naam</strong> of voornaam/achternaam, bij voorkeur <strong>schoolmail</strong>, plus optioneel <strong>klas(sen)</strong>, <strong>leerjaar</strong> en een bestaande <strong>gebruikersnaam</strong>. Gebruikersnaam en technisch wachtwoord worden automatisch geregeld als ze ontbreken.'
          : 'Upload Excel met <strong>naam</strong> of voornaam/achternaam, bij voorkeur <strong>schoolmail</strong>, plus optioneel <strong>klas(sen)</strong> en een bestaande <strong>gebruikersnaam</strong>. Gebruikersnaam en technisch wachtwoord worden automatisch geregeld als ze ontbreken.';
      }

      const submit = section?.querySelector(`[type="submit"][form="${config.formId}"]`);
      if (submit) submit.textContent = 'Voorcontrole';

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const fileInput = document.getElementById(config.fileId);
        const results = document.getElementById(config.resultsId);
        const message = document.getElementById(config.messageId);
        const file = fileInput?.files?.[0];
        if (!file) {
          if (message) message.textContent = 'Kies eerst een Excelbestand.';
          return;
        }
        if (message) message.textContent = 'Voorcontrole wordt uitgevoerd…';
        if (results) results.innerHTML = '';
        try {
          const fileData = await readFileBase64(file);
          const preview = await api('/api/admin/google-first/import', {
            method: 'POST',
            body: { kind: config.kind, file: fileData, preview: true },
          });
          if (message) message.textContent = 'Voorcontrole gereed. Controleer de samenvatting voordat je importeert.';
          renderImportPreview(config, preview, fileData);
        } catch (error) {
          if (message) message.textContent = error.message;
        }
      }, true);
    }
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Kon het Excelbestand niet lezen.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',').pop() : value);
      };
      reader.readAsDataURL(file);
    });
  }

  function summaryMetric(label, value) {
    const card = make('div', { className: 'admin-modern__metric' });
    const icons = { Boekexemplaren: '▤', Leerlingen: '♙', Docenten: '◉', Klassen: '▦' };
    if (icons[label]) {
      const icon = make('span', { className: 'bb-admin-v31-metric-icon', text: icons[label] });
      icon.setAttribute('aria-hidden', 'true');
      card.append(icon);
    }
    const figures = make('div', { className: 'bb-admin-v31-metric-figures' });
    figures.append(
      make('strong', { text: String(value ?? 0) }),
      make('span', { text: label })
    );
    card.append(figures);
    return card;
  }

  function renderImportPreview(config, payload, fileData) {
    const results = document.getElementById(config.resultsId);
    if (!results) return;
    const summary = payload?.summary || {};
    const wrapper = make('div', { className: 'admin-modern__import-preview' });
    const grid = make('div', { className: 'admin-modern__preview-grid' });
    grid.append(
      summaryMetric('Nieuwe accounts', summary.created),
      summaryMetric('Bijwerken', summary.updated),
      summaryMetric('Schoolmail gekoppeld', summary.linked),
      summaryMetric('Zonder schoolmail', summary.missingEmail),
      summaryMetric('Ongeldige schoolmail', summary.invalidEmail),
      summaryMetric('Overgeslagen', summary.skipped)
    );
    wrapper.append(grid);

    const warnings = (payload.results || []).filter(
      (entry) => entry.status === 'skipped' || entry.emailState === 'invalid' || entry.emailState === 'conflict' || entry.emailState === 'missing'
    );
    if (warnings.length) {
      const warningBox = make('div', { className: 'admin-modern__import-warnings' });
      warningBox.append(make('h5', { text: `Aandachtspunten (${warnings.length})` }));
      const list = make('ul');
      warnings.slice(0, 20).forEach((entry) => {
        const detail = entry.reason || entry.message || (entry.emailState === 'missing' ? 'Geen schoolmail opgegeven.' : 'Controleer deze rij.');
        list.append(make('li', { text: `Rij ${entry.row}${entry.name ? ` · ${entry.name}` : ''}: ${detail}` }));
      });
      if (warnings.length > 20) list.append(make('li', { text: `En nog ${warnings.length - 20} aandachtspunten.` }));
      warningBox.append(list);
      wrapper.append(warningBox);
    }

    const actions = make('div', { className: 'admin-modern__preview-actions' });
    const confirm = make('button', { className: 'btn', text: `Importeer ${config.noun}`, type: 'button' });
    const cancel = make('button', { className: 'btn btn--ghost', text: 'Annuleren', type: 'button' });
    cancel.addEventListener('click', () => { results.innerHTML = ''; });
    confirm.addEventListener('click', async () => {
      const message = document.getElementById(config.messageId);
      confirm.disabled = true;
      cancel.disabled = true;
      if (message) message.textContent = 'Import wordt uitgevoerd…';
      try {
        const result = await api('/api/admin/google-first/import', {
          method: 'POST',
          body: { kind: config.kind, file: fileData, preview: false },
        });
        const summary = result.summary || {};
        if (message) {
          message.textContent = `${summary.created || 0} aangemaakt, ${summary.updated || 0} bijgewerkt en ${summary.linked || 0} schoolaccounts gekoppeld.`;
        }
        results.innerHTML = '';
        const done = make('div', { className: 'admin-modern__import-done' });
        done.textContent = 'Import voltooid. De personenlijsten worden bijgewerkt.';
        results.append(done);
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        confirm.disabled = false;
        cancel.disabled = false;
        if (message) message.textContent = error.message;
      }
    });
    actions.append(confirm, cancel);
    wrapper.append(actions);
    results.innerHTML = '';
    results.append(wrapper);
  }

  async function refreshOverview() {
    const metrics = document.getElementById('admin-modern-metrics');
    const actions = document.getElementById('admin-modern-actions');
    if (!metrics || !actions) return;
    metrics.innerHTML = '<p class="hint">Overzicht laden…</p>';
    actions.innerHTML = '';
    try {
      const data = await api('/api/admin/google-first/summary');
      metrics.innerHTML = '';
      metrics.append(
        summaryMetric('Boekexemplaren', data.books),
        summaryMetric('Leerlingen', data.students),
        summaryMetric('Docenten', data.teachers),
        summaryMetric('Klassen', data.classes)
      );
      const pending = [];
      if (data.pendingRequests) pending.push([`${data.pendingRequests} openstaande Google-koppelverzoeken`, 'people']);
      if (data.teachersUnlinked) pending.push([`${data.teachersUnlinked} docenten zonder schoolaccount`, 'people']);
      if (data.studentsUnlinked) pending.push([`${data.studentsUnlinked} leerlingen zonder schoolaccount`, 'people']);
      const actionCard = actions.closest('.bb-admin-v31-card--actions');
      actionCard?.classList.toggle('bb-admin-v31-card--empty-actions', !pending.length);
      if (!pending.length) {
        actions.append(make('p', { className: 'bb-admin-v31-empty-actions', text: 'Geen openstaande accountacties.' }));
      } else {
        for (const [label, target] of pending) {
          const row = make('button', { className: 'admin-modern__action-row', text: label, type: 'button' });
          row.addEventListener('click', () => setActiveView(target));
          actions.append(row);
        }
      }
    } catch (error) {
      metrics.innerHTML = '';
      actions.closest('.bb-admin-v31-card--actions')?.classList.remove('bb-admin-v31-card--empty-actions');
      actions.append(make('p', { className: 'hint', text: 'Accountacties konden niet worden geladen.' }));
      metrics.append(make('p', { className: 'hint', text: error.message }));
    }
  }


  // Audit A07: keep keyboard focus inside an active book-details modal.
  // app.js continues to own open/close, Escape and focus restoration.
  function installAdminBookModalFocusTrap() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !document.body.classList.contains('bb-admin-v31')) return;
      const modal = document.getElementById('book-detail');
      if (!modal || modal.classList.contains('hidden') || modal.getAttribute('aria-hidden') === 'true') return;
      const dialog = modal.querySelector('.book-detail__dialog');
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll(
        'a[href], button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), ' +
        'select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.getClientRects().length > 0);
      if (!focusables.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function moveGooglePanel() {
    const host = document.getElementById('admin-modern-google-host');
    const panel = document.querySelector('#teacher-dashboard .google-manage');
    if (!host || !panel || host.contains(panel)) return;
    panel.classList.add('admin-modern__google-panel');
    host.append(panel);
  }

  function mountSharedPanel(id, hostId) {
    const element = id.startsWith('.') ? document.querySelector(id) : document.getElementById(id);
    const host = document.getElementById(hostId);
    if (!element || !host) return;
    let slot = state.relocatedPanels.find((entry) => entry.element === element);
    if (!slot) {
      const marker = document.createComment('Boekenbaai: oorspronkelijke positie ' + id);
      element.before(marker);
      slot = { element, marker, host };
      state.relocatedPanels.push(slot);
    }
    if (element.parentElement !== host) host.append(element);
  }

  function restoreSharedPanels() {
    for (const { element, marker } of state.relocatedPanels) {
      if (marker.isConnected && element.previousSibling !== marker) marker.after(element);
    }
  }

  function activateAdminLayout(active) {
    if (!state.upgraded) return;
    document.body.classList.toggle('bb-admin-v31', active);
    if (!active) {
      closeMobileNavigation();
      state.catalogOpened = false;
      restoreSharedPanels();
      const title = document.querySelector('.hero--staff h1');
      const intro = document.querySelector('.hero--staff .hero__content p');
      if (title) title.textContent = 'Docentenportaal Boekenbaai';
      if (intro) intro.textContent = 'Houd zicht op de voortgang van jouw leerlingen en beheer je klassen.';
      const logo = document.querySelector('.hero--staff .hero__logo');
      if (logo) {
        // Restore Vite's original (possibly fingerprinted) URL rather than
        // constructing a source URL that may not exist in production dist.
        if (logo.dataset.v31OriginalSrc) logo.setAttribute('src', logo.dataset.v31OriginalSrc);
        logo.alt = '';
        logo.closest('.hero__illustration')?.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    mountSharedPanel('.teacher-layout__overview', 'bb-admin-v31-catalog');
    mountSharedPanel('staff-loan-panel', 'bb-admin-v31-loans');
    mountSharedPanel('book-import-followups-panel', 'bb-admin-v31-tasks');
    mountSharedPanel('history-panel', 'bb-admin-v31-activity');
    // Keep the original privileged logbook button and live status near
    // the activity title; the original header slot is restored on logout.
    mountSharedPanel('history-actions', 'bb-admin-v31-activity-actions');
    mountSharedPanel('admin-mail-notifications-panel', 'bb-admin-v31-settings');
    const legacyList = document.getElementById('admin-book-list');
    const legacySection = legacyList?.closest('.admin-card__section');
    if (legacySection) legacySection.hidden = true;
    syncMobileNavigation();
    const name = document.querySelector('.hero--staff h1');
    const intro = document.querySelector('.hero--staff .hero__content p');
    if (name) name.textContent = 'Boekenbaai';
    // The right-hand account identity already identifies Boekenbaai Beheer.
    if (intro) intro.textContent = '';
    const logo = document.querySelector('.hero--staff .hero__logo');
    if (logo) {
      logo.dataset.v31OriginalSrc ||= logo.getAttribute('src') || '';
      logo.src = 'logo/het-dok-header-v31.svg';
      logo.alt = 'Het Dok';
      logo.closest('.hero__illustration')?.removeAttribute('aria-hidden');
    }
  }

  function updateCatalogToggle() {
    const button = document.getElementById('bb-admin-v31-toggle-catalog');
    const content = document.getElementById('staff-book-overview-content');
    if (!button || !content) return;
    const expanded = !content.hidden;
    button.textContent = expanded ? 'Catalogus inklappen' : 'Catalogus uitklappen';
    button.setAttribute('aria-expanded', String(expanded));
  }

  function viewHeading(name, title, description) {
    const view = make('section', { className: 'admin-modern__view' });
    view.dataset.adminModernView = name;
    const heading = make('div', { className: 'bb-admin-v31-heading' });
    heading.innerHTML = '<div><p class="bb-admin-v31-eyebrow">Boekenbaai Beheer</p><h2 tabindex="-1">' + title + '</h2>' +
      '<p>' + description + '</p></div>';
    view.append(heading);
    return view;
  }

  function showBookEditor(newBook) {
    setActiveView('books');
    const card = document.querySelector('#admin-dashboard .admin-card--books');
    if (!card) return;
    if (newBook) {
      // This existing application handler clears book ID, themes, crop and
      // selection state even if its button is hidden in create mode.
      const cancel = document.getElementById('admin-book-cancel');
      if (!cancel) return;
      cancel.click();
    }
    // The cancel event closes the previous editor, so reveal it afterwards.
    card.hidden = false;
    document.getElementById('admin-book-title')?.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function installBookEditorControls(booksCard) {
    if (!booksCard || booksCard.dataset.v31EditorInstalled) return;
    booksCard.dataset.v31EditorInstalled = 'true';
    booksCard.hidden = true;
    const heading = make('div', { className: 'bb-admin-v31-editor-heading' });
    heading.append(make('h3', { text: 'Boek toevoegen of bewerken' }));
    const close = make('button', { className: 'btn btn--ghost', text: 'Annuleren', type: 'button' });
    close.addEventListener('click', () => {
      // Invoke the full app.js reset for *both* edit and create modes.
      const cancel = document.getElementById('admin-book-cancel');
      if (!cancel) return;
      cancel.click();
      booksCard.hidden = true;
      document.getElementById('bb-admin-v31-open-editor')?.focus();
    });
    heading.append(close);
    booksCard.prepend(heading);
    document.getElementById('admin-book-cancel')?.addEventListener('click', () => {
      booksCard.hidden = true;
    });
    // The existing book-detail handler in app.js runs after this capture listener.
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-book-detail-edit]')) showBookEditor(false);
    }, true);
  }



  function upgradeAdmin() {
    const dashboard = document.getElementById('admin-dashboard');
    const container = dashboard?.querySelector('.admin-dashboard');
    if (!dashboard || !container || state.upgraded) return;
    state.upgraded = true;
    hideLegacyPasswordUi();
    createTabs(dashboard);

    const booksCard = container.querySelector('.admin-card--books');
    const teacherCard = container.querySelector('.admin-card--teachers');
    const classesCard = container.querySelector('.admin-card--classes');
    const studentCard = container.querySelector('.admin-card--students');
    const importsCard = container.querySelector('.admin-card--imports');
    [booksCard, teacherCard, classesCard, studentCard, importsCard].forEach(expandCard);

    const overviewView = createOverviewView();
    const booksView = viewHeading('books', 'Boeken', 'Zoek, bekijk en beheer de catalogus en fysieke exemplaren.');
    const catalogHost = make('div', { id: 'bb-admin-v31-catalog' });
    booksView.append(catalogHost);
    const newBook = make('button', { className: 'btn', type: 'button', text: '+ Nieuw boek', id: 'bb-admin-v31-open-editor' });
    newBook.addEventListener('click', () => showBookEditor(true));
    booksView.querySelector('.bb-admin-v31-heading').append(newBook);
    booksView.append(booksCard);
    const peopleView = createPeopleView(teacherCard, studentCard, classesCard);
    const loansView = viewHeading('loans', 'Uitlenen en innemen', 'Leen specifieke exemplaren uit en registreer innames.');
    loansView.append(make('div', { id: 'bb-admin-v31-loans' }));
    const tasksView = viewHeading('tasks', 'Taken', 'Controleer openstaande verzoeken en boekimportcontroles.');
    tasksView.append(make('div', { id: 'bb-admin-v31-tasks' }));
    const accountTaskLinks = make('section', { className: 'bb-admin-v31-card' });
    accountTaskLinks.append(make('h3', { text: 'Andere beheertaken' }));
    accountTaskLinks.append(make('p', { text: 'Behandel klaswissels en Google-koppelverzoeken via Personen en klassen.' }));
    const taskActions = make('div', { className: 'bb-admin-v31-task-actions' });
    for (const [label, kind] of [['Leerling- en klasverzoeken openen', 'students'], ['Docent- en Google-koppelingen openen', 'teachers']]) {
      const link = make('button', { className: 'btn btn--secondary', text: label, type: 'button' });
      link.addEventListener('click', () => { setActiveView('people'); setPeopleView(kind); });
      taskActions.append(link);
    }
    accountTaskLinks.append(taskActions);
    tasksView.append(accountTaskLinks);
    const importsView = viewHeading('imports', 'Importeren', 'Boeken en personen veilig importeren met voorcontrole.');
    importsView.append(importsCard);
    const settingsView = viewHeading('settings', 'Instellingen', 'Beheerdersmeldingen en geverifieerde e-mailadressen.');
    settingsView.append(make('div', { id: 'bb-admin-v31-settings' }));

    container.append(overviewView, booksView, peopleView, loansView, tasksView, importsView, settingsView);
    moveDangerousBookAction(booksView);
    organizeMailSettings();
    installBookEditorControls(booksCard);
    installAdminBookModalFocusTrap();
    modernizeImports();

    const schoolStats = document.querySelector('.panel__header-actions--admin');
    if (schoolStats) overviewView.querySelector('#bb-admin-v31-stats')?.append(schoolStats);
    overviewView.querySelector('#bb-admin-v31-stats')?.querySelector('#admin-stats-button')?.classList.add('bb-admin-v31-stats-button');
    setActiveView('overview');
    setPeopleView('students');
    moveGooglePanel();
    activateAdminLayout(true);
    updateCatalogToggle();

    const observer = new MutationObserver(() => {
      hideLegacyPasswordUi();
      moveGooglePanel();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }



  function watchForAdmin() {
    const dashboard = document.getElementById('admin-dashboard');
    if (!dashboard) return;
    const refresh = () => {
      const visible = !dashboard.classList.contains('hidden');
      if (visible && !state.upgraded) upgradeAdmin();
      if (state.upgraded) activateAdminLayout(visible);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  }


  document.addEventListener('DOMContentLoaded', watchForAdmin);
})();
