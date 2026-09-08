(() => {
  'use strict';

  const state = {
    upgraded: false,
    activeView: 'overview',
    activePeopleView: 'students',
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

    const teacherHint = document.querySelector('.admin-card--teachers .admin-card__heading .hint');
    if (teacherHint) {
      teacherHint.textContent = 'Maak docenten aan, koppel klassen en beheer hun schoolaccount voor Google-inlog.';
    }
    const studentHint = document.querySelector('.admin-card--students .admin-card__heading .hint');
    if (studentHint) {
      studentHint.textContent = 'Maak leerlingaccounts aan, beheer klasindelingen en koppel schoolaccounts voor Google-inlog.';
    }

    const teacherAddForm = document.querySelector('#admin-teacher-add-form');
    if (teacherAddForm && !teacherAddForm.dataset.googleFirstPasswordShim) {
      teacherAddForm.dataset.googleFirstPasswordShim = 'true';
      teacherAddForm.addEventListener('submit', () => {
        const input = document.querySelector('#admin-teacher-add-password');
        if (input && !input.value) input.value = randomLegacyPassword();
      }, true);
    }
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
    state.activeView = name;
    document.querySelectorAll('[data-admin-modern-view]').forEach((view) => {
      view.hidden = view.dataset.adminModernView !== name;
    });
    document.querySelectorAll('[data-admin-modern-tab]').forEach((button) => {
      const active = button.dataset.adminModernTab === name;
      button.classList.toggle('admin-modern__tab--active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (name === 'overview') refreshOverview();
  }

  function setPeopleView(name) {
    state.activePeopleView = name;
    document.querySelectorAll('[data-admin-people-view]').forEach((view) => {
      view.hidden = view.dataset.adminPeopleView !== name;
    });
    document.querySelectorAll('[data-admin-people-tab]').forEach((button) => {
      const active = button.dataset.adminPeopleTab === name;
      button.classList.toggle('admin-modern__subtab--active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function createTabs(dashboard) {
    const tabs = make('div', { className: 'admin-modern__tabs' });
    tabs.setAttribute('role', 'tablist');
    const items = [
      ['overview', 'Overzicht'],
      ['books', 'Boeken'],
      ['people', 'Personen'],
      ['classes', 'Klassen'],
      ['imports', 'Importeren'],
    ];
    for (const [key, label] of items) {
      const button = make('button', { className: 'admin-modern__tab', text: label, type: 'button' });
      button.dataset.adminModernTab = key;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => setActiveView(key));
      tabs.append(button);
    }
    dashboard.insertBefore(tabs, dashboard.querySelector('.admin-dashboard'));
  }

  function createOverviewView() {
    const view = make('section', { className: 'admin-modern__view admin-modern__overview' });
    view.dataset.adminModernView = 'overview';
    view.innerHTML = `
      <div class="admin-modern__overview-header">
        <div>
          <h3>Beheeroverzicht</h3>
          <p class="hint">Acties die aandacht nodig hebben en de belangrijkste aantallen.</p>
        </div>
      </div>
      <div class="admin-modern__metrics" id="admin-modern-metrics"></div>
      <div class="admin-modern__actions-panel">
        <h4>Openstaande acties</h4>
        <div id="admin-modern-actions" class="admin-modern__actions-list"></div>
      </div>
    `;
    return view;
  }

  function createPeopleView(teacherCard, studentCard) {
    const view = make('section', { className: 'admin-modern__view admin-modern__people' });
    view.dataset.adminModernView = 'people';

    const header = make('div', { className: 'admin-modern__people-header' });
    const intro = make('div');
    intro.append(
      make('h3', { text: 'Personen' }),
      make('p', { className: 'hint', text: 'Beheer leerlingen, docenten, klasindelingen en Google-schoolaccounts op één plek.' })
    );
    const tabs = make('div', { className: 'admin-modern__subtabs' });
    tabs.setAttribute('role', 'tablist');
    [['students', 'Leerlingen'], ['teachers', 'Docenten']].forEach(([key, label]) => {
      const button = make('button', { className: 'admin-modern__subtab', text: label, type: 'button' });
      button.dataset.adminPeopleTab = key;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => setPeopleView(key));
      tabs.append(button);
    });
    header.append(intro, tabs);
    view.append(header);

    const googleHost = make('div', { className: 'admin-modern__google-host', id: 'admin-modern-google-host' });
    view.append(googleHost);

    const studentView = make('div', { className: 'admin-modern__people-view' });
    studentView.dataset.adminPeopleView = 'students';
    if (studentCard) studentView.append(studentCard);
    const teacherView = make('div', { className: 'admin-modern__people-view' });
    teacherView.dataset.adminPeopleView = 'teachers';
    if (teacherCard) teacherView.append(teacherCard);
    view.append(studentView, teacherView);
    return view;
  }

  function createSimpleView(name, card) {
    const view = make('section', { className: 'admin-modern__view' });
    view.dataset.adminModernView = name;
    if (card) view.append(card);
    return view;
  }

  function moveDangerousBookAction(booksView) {
    const deleteAll = document.querySelector('#admin-books-delete-all');
    if (!deleteAll || !booksView) return;
    const danger = make('section', { className: 'admin-modern__danger' });
    danger.innerHTML = '<div><h4>Geavanceerd</h4><p class="hint">Acties die de volledige collectie beïnvloeden.</p></div>';
    danger.append(deleteAll);
    booksView.append(danger);
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
    card.append(
      make('strong', { text: String(value ?? 0) }),
      make('span', { text: label })
    );
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
        summaryMetric('Boeken', data.books),
        summaryMetric('Leerlingen', data.students),
        summaryMetric('Docenten', data.teachers),
        summaryMetric('Klassen', data.classes)
      );
      const pending = [];
      if (data.pendingRequests) pending.push([`${data.pendingRequests} openstaande Google-koppelverzoeken`, 'people']);
      if (data.teachersUnlinked) pending.push([`${data.teachersUnlinked} docenten zonder schoolaccount`, 'people']);
      if (data.studentsUnlinked) pending.push([`${data.studentsUnlinked} leerlingen zonder schoolaccount`, 'people']);
      if (!pending.length) {
        actions.append(make('p', { className: 'hint', text: 'Geen openstaande accountacties.' }));
      } else {
        for (const [label, target] of pending) {
          const row = make('button', { className: 'admin-modern__action-row', text: label, type: 'button' });
          row.addEventListener('click', () => setActiveView(target));
          actions.append(row);
        }
      }
    } catch (error) {
      metrics.innerHTML = '';
      metrics.append(make('p', { className: 'hint', text: error.message }));
    }
  }

  function moveGooglePanel() {
    const host = document.getElementById('admin-modern-google-host');
    const panel = document.querySelector('#teacher-dashboard .google-manage');
    if (!host || !panel || host.contains(panel)) return;
    panel.classList.add('admin-modern__google-panel');
    host.append(panel);
  }

  function upgradeAdmin() {
    const dashboard = document.querySelector('#admin-dashboard');
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
    const booksView = createSimpleView('books', booksCard);
    const peopleView = createPeopleView(teacherCard, studentCard);
    const classesView = createSimpleView('classes', classesCard);
    const importsView = createSimpleView('imports', importsCard);

    container.append(overviewView, booksView, peopleView, classesView, importsView);
    moveDangerousBookAction(booksView);
    modernizeImports();
    setActiveView('overview');
    setPeopleView('students');

    moveGooglePanel();
    const observer = new MutationObserver(() => {
      hideLegacyPasswordUi();
      moveGooglePanel();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function watchForAdmin() {
    const dashboard = document.querySelector('#admin-dashboard');
    if (!dashboard) return;
    if (!dashboard.classList.contains('hidden')) upgradeAdmin();
    const observer = new MutationObserver(() => {
      if (!dashboard.classList.contains('hidden')) upgradeAdmin();
    });
    observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('DOMContentLoaded', watchForAdmin);
})();
