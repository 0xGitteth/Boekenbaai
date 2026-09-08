(() => {
  'use strict';

  let queued = false;
  let teacherGroupsBusy = false;
  let teacherGroupsTimer = null;
  let bookImportResetTimer = null;

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setHidden(element, hidden) {
    if (element && element.hidden !== hidden) element.hidden = hidden;
  }

  function removePassiveAccountActions() {
    document.querySelectorAll('#admin-modern-actions .admin-modern__action-row').forEach((row) => {
      if (/\b(leerlingen|docenten) zonder schoolaccount\b/i.test(row.textContent || '')) row.remove();
    });
    const host = document.querySelector('#admin-modern-actions');
    if (host && !host.children.length) {
      const message = document.createElement('p');
      message.className = 'hint';
      message.textContent = 'Geen openstaande accountacties.';
      host.append(message);
    }
  }

  function ensureUxStyles() {
    if (document.querySelector('#admin-ux-polish-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-ux-polish-styles';
    style.textContent = `
      [data-admin-people-view="students"] .admin-card--students {
        display: none !important;
      }
      [data-admin-people-view="teachers"] .admin-card--teachers {
        border: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 0 !important;
      }
      [data-admin-people-view="teachers"] .admin-card--teachers > .admin-card__header {
        display: none !important;
      }
      .admin-ux__teacher-toolbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: .25rem 0 1rem;
        border-bottom: 1px solid var(--accent-border, #d9dee7);
        margin-bottom: 1rem;
      }
      .admin-ux__teacher-toolbar h4 { margin: 0 0 .2rem; }
      .admin-ux__teacher-toolbar .hint { margin: 0; }
      .admin-card--teachers .admin-teacher-add {
        margin: 0 0 1.25rem;
        padding: 1rem;
        border: 1px solid var(--accent-border, #d9dee7);
        border-radius: 16px;
        background: rgba(255,255,255,.62);
      }
      .admin-card--teachers .admin-teacher-edit-title { display: none !important; }
      .admin-ux__teacher-groups {
        display: grid;
        gap: .25rem;
        margin-top: .65rem;
      }
      .admin-ux__teacher-class {
        border-top: 1px solid var(--accent-border, #d9dee7);
        padding: .25rem 0;
      }
      .admin-ux__teacher-class:first-child { border-top: 0; }
      .admin-ux__teacher-class > summary {
        cursor: pointer;
        font-weight: 600;
        padding: .7rem .2rem;
      }
      .admin-ux__teacher-class-list {
        display: grid;
        gap: .35rem;
        padding: .15rem 0 .65rem 1rem;
      }
      .admin-ux__teacher-class-list .student-list__item {
        width: 100%;
        text-align: left;
      }
      #admin-class-form .teacher-picker { position: relative; }
      #admin-class-form .teacher-picker__results {
        display: none;
        position: absolute;
        z-index: 40;
        left: 0;
        right: 0;
        top: calc(100% + .35rem);
        max-height: 15rem;
        overflow: auto;
        padding: .45rem;
        border: 1px solid var(--accent-border, #d9dee7);
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 12px 28px rgba(20, 35, 60, .14);
      }
      #admin-class-form .teacher-picker:focus-within .teacher-picker__results:not(:empty) {
        display: grid;
      }
      #admin-class-form .teacher-picker__selected:empty { display: none; }
      #admin-modern-google-host:empty { display: none; }
      @media (max-width: 720px) {
        .admin-ux__teacher-toolbar { flex-direction: column; }
      }
    `;
    document.head.append(style);
  }

  function putAdminBeforeBookOverview() {
    const adminDashboard = document.querySelector('#admin-dashboard');
    const teacherDashboard = document.querySelector('#teacher-dashboard');
    if (!adminDashboard || !teacherDashboard || adminDashboard.classList.contains('hidden')) return;
    const parent = adminDashboard.parentElement;
    if (parent && teacherDashboard.parentElement === parent && adminDashboard.nextElementSibling !== teacherDashboard) {
      parent.insertBefore(adminDashboard, teacherDashboard);
    }
  }

  function collapseBookOverviewOnLogin() {
    const dashboard = document.querySelector('#teacher-dashboard');
    const content = document.querySelector('#staff-book-overview-content');
    const toggle = document.querySelector('#staff-book-overview-toggle');
    if (!dashboard || !content || !toggle) return;

    if (dashboard.classList.contains('hidden')) {
      delete dashboard.dataset.defaultBookCollapsed;
      return;
    }
    if (dashboard.dataset.defaultBookCollapsed === 'true') return;

    content.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    setTextIfChanged(toggle, 'Uitklappen');
    dashboard.dataset.defaultBookCollapsed = 'true';
  }

  function keepImportLabelSimple() {
    document.querySelectorAll('[data-admin-modern-tab="imports"]').forEach((button) => {
      setTextIfChanged(button, 'Importeren');
    });
  }

  function moveGoogleHostIntoTeachers() {
    const teacherView = document.querySelector('[data-admin-people-view="teachers"]');
    const host = document.querySelector('#admin-modern-google-host');
    if (!teacherView || !host || host.parentElement === teacherView) return;
    teacherView.prepend(host);
  }

  function polishTeacherManagement() {
    const teacherView = document.querySelector('[data-admin-people-view="teachers"]');
    const card = document.querySelector('.admin-card--teachers');
    const content = card?.querySelector('.admin-card__content');
    const addSection = card?.querySelector('.admin-teacher-add');
    if (!teacherView || !card || !content || !addSection) return;

    card.classList.add('admin-card--embedded');
    setHidden(card.querySelector(':scope > .admin-card__header'), true);

    let toolbar = content.querySelector('.admin-ux__teacher-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'admin-ux__teacher-toolbar';
      const copy = document.createElement('div');
      const title = document.createElement('h4');
      title.textContent = 'Docentenbeheer';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Docenten staan per klas gegroepeerd. Een docent kan in meerdere klassen staan; elke vermelding opent hetzelfde account.';
      copy.append(title, hint);
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn';
      addButton.textContent = '+ Docent toevoegen';
      addButton.addEventListener('click', () => {
        const willOpen = addSection.hidden;
        addSection.hidden = !willOpen;
        addButton.textContent = willOpen ? 'Toevoegen sluiten' : '+ Docent toevoegen';
        if (willOpen) card.querySelector('#admin-teacher-add-name')?.focus();
      });
      toolbar.append(copy, addButton);
      content.prepend(toolbar);
    }

    if (!addSection.dataset.adminUxPrepared) {
      addSection.dataset.adminUxPrepared = 'true';
      addSection.hidden = true;
    }
    setTextIfChanged(addSection.querySelector('h4'), 'Docent toevoegen');
    setTextIfChanged(card.querySelector('#admin-teacher-add-submit'), 'Docent toevoegen');
    setHidden(card.querySelector('.admin-teacher-edit-title'), true);

    const search = card.querySelector('#admin-teacher-search');
    if (search && search.placeholder !== 'Zoek docent of klas') search.placeholder = 'Zoek docent of klas';
  }

  function authHeaders() {
    const headers = { Accept: 'application/json' };
    const token = window.localStorage.getItem('boekenbaai_token') || '';
    if (token && token !== 'cookie') headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function fetchAdminJson(pathname) {
    const response = await fetch(pathname, {
      method: 'GET',
      credentials: 'same-origin',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`Ophalen mislukt (${response.status})`);
    return response.json();
  }

  function teacherMatches(teacher, query) {
    if (!query) return true;
    const haystack = `${teacher?.name || ''} ${teacher?.username || ''}`.toLocaleLowerCase('nl-NL');
    return haystack.includes(query);
  }

  function teacherIdsForClass(klass, teachers) {
    const explicit = new Set(Array.isArray(klass?.teacherIds) ? klass.teacherIds : []);
    for (const teacher of teachers) {
      if ((teacher?.classIds || []).includes(klass.id)) explicit.add(teacher.id);
    }
    return explicit;
  }

  function createTeacherButton(teacher, selectedId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `student-list__item student-list__item--selectable${teacher.id === selectedId ? ' student-list__item--active' : ''}`;
    button.dataset.selectTeacher = 'true';
    button.dataset.teacherId = teacher.id;
    const name = document.createElement('strong');
    name.textContent = teacher.name || teacher.username || 'Docent';
    button.append(name);
    return button;
  }

  async function renderGroupedTeachers() {
    const teacherView = document.querySelector('[data-admin-people-view="teachers"]');
    const list = document.querySelector('#admin-teacher-list');
    const search = document.querySelector('#admin-teacher-search');
    const detail = document.querySelector('#admin-teacher-detail-content');
    if (!teacherView || teacherView.hidden || !list || teacherGroupsBusy) return;

    const query = (search?.value || '').trim().toLocaleLowerCase('nl-NL');
    const existing = list.querySelector('.admin-ux__teacher-groups');
    if (existing && existing.dataset.query === query) return;

    teacherGroupsBusy = true;
    try {
      const [teacherPayload, classPayload] = await Promise.all([
        fetchAdminJson('/api/teachers'),
        fetchAdminJson('/api/classes'),
      ]);
      const teachers = (Array.isArray(teacherPayload) ? teacherPayload : [])
        .filter((entry) => entry && entry.role !== 'admin' && entry.active !== false);
      const classes = (Array.isArray(classPayload) ? classPayload : [])
        .filter(Boolean)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl'));
      const selectedId = detail?.dataset.teacherId || '';
      const assigned = new Set();
      const wrapper = document.createElement('div');
      wrapper.className = 'admin-ux__teacher-groups';
      wrapper.dataset.query = query;

      for (const klass of classes) {
        const classMatchesQuery = String(klass.name || '').toLocaleLowerCase('nl-NL').includes(query);
        const ids = teacherIdsForClass(klass, teachers);
        const entries = teachers
          .filter((teacher) => ids.has(teacher.id))
          .filter((teacher) => !query || classMatchesQuery || teacherMatches(teacher, query))
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl'));
        ids.forEach((id) => assigned.add(id));
        if (!entries.length) continue;

        const details = document.createElement('details');
        details.className = 'admin-ux__teacher-class';
        details.open = Boolean(query);
        const summary = document.createElement('summary');
        summary.textContent = `${klass.name || 'Naamloze klas'} · ${entries.length} docent${entries.length === 1 ? '' : 'en'}`;
        const rows = document.createElement('div');
        rows.className = 'admin-ux__teacher-class-list';
        entries.forEach((teacher) => rows.append(createTeacherButton(teacher, selectedId)));
        details.append(summary, rows);
        wrapper.append(details);
      }

      const withoutClass = teachers
        .filter((teacher) => !assigned.has(teacher.id))
        .filter((teacher) => teacherMatches(teacher, query))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl'));
      if (withoutClass.length) {
        const details = document.createElement('details');
        details.className = 'admin-ux__teacher-class';
        details.open = Boolean(query);
        const summary = document.createElement('summary');
        summary.textContent = `Zonder klas · ${withoutClass.length} docent${withoutClass.length === 1 ? '' : 'en'}`;
        const rows = document.createElement('div');
        rows.className = 'admin-ux__teacher-class-list';
        withoutClass.forEach((teacher) => rows.append(createTeacherButton(teacher, selectedId)));
        details.append(summary, rows);
        wrapper.append(details);
      }

      if (!wrapper.children.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = query ? 'Geen docenten of klassen gevonden.' : 'Er zijn nog geen docentenaccounts.';
        wrapper.append(empty);
      }

      list.replaceChildren(wrapper);
    } catch (error) {
      // De bestaande docentbeheer-UI blijft beschikbaar als deze aanvullende groepering niet kan laden.
    } finally {
      teacherGroupsBusy = false;
    }
  }

  function scheduleGroupedTeachers() {
    window.clearTimeout(teacherGroupsTimer);
    teacherGroupsTimer = window.setTimeout(renderGroupedTeachers, 80);
  }

  function installTeacherGroupingListeners() {
    const search = document.querySelector('#admin-teacher-search');
    if (search && !search.dataset.adminGroupedListeners) {
      search.dataset.adminGroupedListeners = 'true';
      search.addEventListener('input', scheduleGroupedTeachers);
    }
    scheduleGroupedTeachers();
  }

  function polishClassTeacherPicker() {
    const picker = document.querySelector('#admin-class-form .teacher-picker');
    const search = document.querySelector('#admin-class-teacher-search');
    if (!picker || !search) return;
    if (search.placeholder !== 'Kies docent(en)…') search.placeholder = 'Kies docent(en)…';
    const hint = picker.parentElement?.querySelector('.hint');
    setTextIfChanged(hint, 'Klik in het veld en kies één of meerdere docenten.');
    if (!search.dataset.adminUxDropdown) {
      search.dataset.adminUxDropdown = 'true';
      search.addEventListener('focus', () => {
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }

  function clearStoredBookImportJobs() {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith('boekenbaai_last_books_import_job')) {
        window.localStorage.removeItem(key);
      }
    }
  }

  function resetBookImportUi() {
    const form = document.querySelector('#book-import-form');
    const file = document.querySelector('#book-import-file');
    const message = document.querySelector('#book-import-message');
    const results = document.querySelector('#book-import-results');
    const cancel = document.querySelector('#book-import-cancel');
    if (form) form.reset();
    if (file) file.value = '';
    if (message) message.textContent = '';
    if (results) results.replaceChildren();
    if (cancel) {
      cancel.hidden = true;
      cancel.disabled = true;
    }
  }

  function maintainBookImportReset() {
    const message = document.querySelector('#book-import-message');
    if (!message || message.dataset.adminImportResetWatch) return;
    message.dataset.adminImportResetWatch = 'true';

    const react = () => {
      const text = (message.textContent || '').trim();
      const terminal = text === 'Import gereed.' || text === 'Import geannuleerd.';
      if (!terminal) return;
      clearStoredBookImportJobs();
      window.clearTimeout(bookImportResetTimer);
      bookImportResetTimer = window.setTimeout(resetBookImportUi, 1200);
    };
    const observer = new MutationObserver(react);
    observer.observe(message, { childList: true, characterData: true, subtree: true });
    react();
  }

  function apply() {
    queued = false;
    ensureUxStyles();
    removePassiveAccountActions();
    putAdminBeforeBookOverview();
    collapseBookOverviewOnLogin();
    keepImportLabelSimple();
    moveGoogleHostIntoTeachers();
    polishTeacherManagement();
    installTeacherGroupingListeners();
    polishClassTeacherPicker();
    maintainBookImportReset();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(apply);
  }

  function install() {
    apply();
    const observer = new MutationObserver(() => {
      const list = document.querySelector('#admin-teacher-list');
      if (list && !list.querySelector('.admin-ux__teacher-groups')) scheduleGroupedTeachers();
      queueApply();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-teacher-id'],
    });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
