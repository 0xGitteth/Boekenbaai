(() => {
  'use strict';

  let payload = null;
  let loading = false;
  let renderQueued = false;
  let retryTimer = null;

  function authHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    const token = window.localStorage.getItem('boekenbaai_token') || '';
    if (token && token !== 'cookie') headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function api(pathname, options = {}) {
    const response = await fetch(pathname, {
      credentials: 'same-origin',
      ...options,
      headers: authHeaders(options.headers || {}),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok) throw new Error(body?.message || `Actie mislukt (${response.status})`);
    return body;
  }

  async function loadGroups() {
    if (loading) return;
    loading = true;
    try {
      payload = await api('/api/admin/teacher-groups');
    } catch (error) {
      payload = null;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(queueRender, 1000);
    } finally {
      loading = false;
    }
  }

  function teacherMatches(teacher, query) {
    if (!query) return true;
    return `${teacher?.name || ''} ${teacher?.username || ''}`
      .toLocaleLowerCase('nl-NL')
      .includes(query);
  }

  function allTeachers() {
    const byId = new Map();
    for (const klass of Array.isArray(payload?.classes) ? payload.classes : []) {
      for (const teacher of Array.isArray(klass?.teachers) ? klass.teachers : []) {
        if (teacher?.id) byId.set(teacher.id, teacher);
      }
    }
    for (const teacher of Array.isArray(payload?.unassigned) ? payload.unassigned : []) {
      if (teacher?.id) byId.set(teacher.id, teacher);
    }
    return byId;
  }

  function teacherButton(teacher, selectedId) {
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

  function groupSection(name, teachers, selectedId, { open = false, emptyText = '' } = {}) {
    const details = document.createElement('details');
    details.className = 'admin-ux__teacher-class';
    details.open = open;

    const summary = document.createElement('summary');
    const count = teachers.length;
    summary.textContent = `${name} · ${count} docent${count === 1 ? '' : 'en'}`;
    details.append(summary);

    const rows = document.createElement('div');
    rows.className = 'admin-ux__teacher-class-list';
    if (teachers.length) {
      teachers.forEach((teacher) => rows.append(teacherButton(teacher, selectedId)));
    } else if (emptyText) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = emptyText;
      rows.append(empty);
    }
    details.append(rows);
    return details;
  }

  function selectedTeacherId() {
    return document.querySelector('#admin-teacher-detail-content')?.dataset.teacherId || '';
  }

  function scrollTeacherDetailIntoView() {
    const detail = document.querySelector('#admin-teacher-detail-content');
    if (!detail || detail.classList.contains('hidden')) return;
    const narrow = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)').matches
      : window.innerWidth <= 900;
    if (!narrow) return;
    window.requestAnimationFrame(() => {
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function prepareGroupedTeacherActivation(event) {
    const button = event.target.closest('[data-select-teacher="true"]');
    if (!button || !button.closest('.teacher-groups-live')) return;

    const search = document.querySelector('#admin-teacher-search');
    if (!search || search.value.trim()) return;

    // app.js wist een geselecteerde docent wanneer zijn oude renderer met een leeg
    // zoekveld opnieuw draait. Geef die renderer voor deze ene klik tijdelijk een
    // geldige zoekterm, zodat de bestaande detailhandler de selectie kan behouden.
    const temporaryQuery = button.querySelector('strong')?.textContent?.trim() || '';
    if (!temporaryQuery) return;
    search.value = temporaryQuery;

    window.setTimeout(() => {
      if (search.value === temporaryQuery) search.value = '';
      queueRender();
      ensureTeacherEditor();
      scrollTeacherDetailIntoView();
    }, 0);
  }

  function ensureTeacherEditor() {
    const detail = document.querySelector('#admin-teacher-detail-content');
    if (!detail || detail.classList.contains('hidden')) return;
    const teacherId = detail.dataset.teacherId || '';
    if (!teacherId || !payload) return;

    const teacher = allTeachers().get(teacherId);
    if (!teacher) return;

    const passwordForm = document.querySelector('#admin-teacher-password-form');
    if (passwordForm) {
      passwordForm.hidden = true;
      passwordForm.setAttribute('aria-hidden', 'true');
    }

    const classesForm = document.querySelector('#admin-teacher-classes-form');
    const classesHeading = classesForm?.querySelector('h5');
    if (classesHeading && classesHeading.textContent !== 'Klassen') classesHeading.textContent = 'Klassen';

    const title = document.querySelector('#admin-teacher-detail-name');
    if (title && title.textContent !== teacher.name) title.textContent = teacher.name;

    let form = detail.querySelector('#teacher-groups-edit-form');
    if (form && form.dataset.teacherId !== teacherId) {
      form.remove();
      form = null;
    }
    if (form) {
      const nameInput = form.querySelector('#teacher-groups-edit-name');
      if (nameInput && document.activeElement !== nameInput && nameInput.value !== teacher.name) {
        nameInput.value = teacher.name;
      }
      return;
    }

    form = document.createElement('form');
    form.id = 'teacher-groups-edit-form';
    form.className = 'admin-teacher-detail__section teacher-groups-edit';
    form.dataset.teacherId = teacherId;

    const heading = document.createElement('h5');
    heading.textContent = 'Docentgegevens';

    const field = document.createElement('label');
    field.className = 'form-field';
    const label = document.createElement('span');
    label.textContent = 'Naam';
    const input = document.createElement('input');
    input.id = 'teacher-groups-edit-name';
    input.type = 'text';
    input.required = true;
    input.autocomplete = 'off';
    input.value = teacher.name || '';
    field.append(label, input);

    const message = document.createElement('p');
    message.className = 'hint';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn--secondary';
    save.textContent = 'Naam opslaan';

    form.append(heading, field, save, message);
    const header = detail.querySelector('.admin-teacher-detail__header');
    if (classesForm) detail.insertBefore(form, classesForm);
    else if (header?.nextSibling) detail.insertBefore(form, header.nextSibling);
    else detail.append(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        message.textContent = 'Naam mag niet leeg zijn.';
        return;
      }
      save.disabled = true;
      message.textContent = 'Wijziging wordt opgeslagen…';
      try {
        await api(`/api/teachers/${encodeURIComponent(teacherId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        payload = null;
        await loadGroups();
        message.textContent = 'Naam opgeslagen.';
        const refreshed = allTeachers().get(teacherId);
        if (title && refreshed) title.textContent = refreshed.name;
        queueRender();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });
  }

  async function render() {
    renderQueued = false;
    const view = document.querySelector('[data-admin-people-view="teachers"]');
    const list = document.querySelector('#admin-teacher-list');
    if (!view || view.hidden || !list) return;

    const search = document.querySelector('#admin-teacher-search');
    const query = (search?.value || '').trim().toLocaleLowerCase('nl-NL');
    const existing = list.querySelector('.teacher-groups-live');
    if (existing && existing.dataset.query === query) {
      ensureTeacherEditor();
      return;
    }

    if (!payload) await loadGroups();
    if (!payload) return;

    const selectedId = selectedTeacherId();
    const wrapper = document.createElement('div');
    wrapper.className = 'admin-ux__teacher-groups teacher-groups-live';
    wrapper.dataset.query = query;

    for (const klass of Array.isArray(payload.classes) ? payload.classes : []) {
      const classMatches = String(klass?.name || '').toLocaleLowerCase('nl-NL').includes(query);
      const teachers = (Array.isArray(klass?.teachers) ? klass.teachers : [])
        .filter((teacher) => !query || classMatches || teacherMatches(teacher, query));
      if (query && !classMatches && !teachers.length) continue;
      wrapper.append(groupSection(
        klass.name || 'Naamloze klas',
        teachers,
        selectedId,
        {
          open: Boolean(query),
          emptyText: 'Geen docenten gekoppeld aan deze klas.',
        }
      ));
    }

    const unassigned = (Array.isArray(payload.unassigned) ? payload.unassigned : [])
      .filter((teacher) => teacherMatches(teacher, query));
    if (unassigned.length) {
      wrapper.append(groupSection('Zonder klas', unassigned, selectedId, { open: Boolean(query) }));
    }

    if (!wrapper.children.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = query ? 'Geen docenten of klassen gevonden.' : 'Er zijn nog geen klassen.';
      wrapper.append(empty);
    }

    list.replaceChildren(wrapper);
    ensureTeacherEditor();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function install() {
    const search = document.querySelector('#admin-teacher-search');
    if (search && !search.dataset.teacherGroupsLive) {
      search.dataset.teacherGroupsLive = 'true';
      search.addEventListener('input', queueRender);
    }

    document.querySelectorAll('[data-admin-people-tab="teachers"]').forEach((button) => {
      if (button.dataset.teacherGroupsLive) return;
      button.dataset.teacherGroupsLive = 'true';
      button.addEventListener('click', () => {
        payload = null;
        queueRender();
      });
    });

    const list = document.querySelector('#admin-teacher-list');
    if (list && !list.dataset.teacherGroupsObserved) {
      list.dataset.teacherGroupsObserved = 'true';
      list.addEventListener('click', prepareGroupedTeacherActivation, true);
      list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-select-teacher="true"]');
        if (!button) return;
        window.setTimeout(() => {
          ensureTeacherEditor();
          scrollTeacherDetailIntoView();
        }, 0);
      });
      const observer = new MutationObserver(() => {
        if (!list.querySelector('.teacher-groups-live')) {
          payload = null;
          queueRender();
        }
      });
      observer.observe(list, { childList: true, subtree: false });
    }

    const detail = document.querySelector('#admin-teacher-detail-content');
    if (detail && !detail.dataset.teacherGroupsObserved) {
      detail.dataset.teacherGroupsObserved = 'true';
      const observer = new MutationObserver(ensureTeacherEditor);
      observer.observe(detail, {
        attributes: true,
        attributeFilter: ['class', 'data-teacher-id'],
        childList: true,
      });
    }

    const classesForm = document.querySelector('#admin-teacher-classes-form');
    if (classesForm && !classesForm.dataset.teacherGroupsRefresh) {
      classesForm.dataset.teacherGroupsRefresh = 'true';
      classesForm.addEventListener('submit', () => {
        window.setTimeout(() => {
          payload = null;
          queueRender();
        }, 400);
      });
    }

    queueRender();
    ensureTeacherEditor();
  }

  function boot() {
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
