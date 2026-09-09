(() => {
  'use strict';

  let payload = null;
  let loading = false;
  let renderQueued = false;
  let retryTimer = null;
  let selectedTeacherId = '';
  let googleManagePayload = null;
  let googleRequestVersion = 0;

  function authHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    const token = window.localStorage.getItem('boekenbaai_token') || '';
    if (token && token !== 'cookie') headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function api(pathname, options = {}) {
    const config = {
      method: 'GET',
      credentials: 'same-origin',
      ...options,
      headers: authHeaders(options.headers || {}),
    };
    if (config.body && typeof config.body !== 'string') {
      config.body = JSON.stringify(config.body);
      if (!config.headers['Content-Type']) config.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(pathname, config);
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

  function classIdsForTeacher(teacherId) {
    const ids = new Set();
    for (const klass of Array.isArray(payload?.classes) ? payload.classes : []) {
      if ((Array.isArray(klass?.teachers) ? klass.teachers : []).some((teacher) => teacher?.id === teacherId)) {
        ids.add(klass.id);
      }
    }
    return ids;
  }

  function teacherButton(teacher) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `student-list__item student-list__item--selectable${teacher.id === selectedTeacherId ? ' student-list__item--active' : ''}`;
    button.dataset.teacherGroupsTeacher = 'true';
    button.dataset.teacherId = teacher.id;
    const name = document.createElement('strong');
    name.textContent = teacher.name || teacher.username || 'Docent';
    button.append(name);
    return button;
  }

  function groupSection(name, teachers, { open = false, emptyText = '' } = {}) {
    const details = document.createElement('details');
    details.className = 'admin-ux__teacher-class';
    details.open = open || teachers.some((teacher) => teacher.id === selectedTeacherId);

    const summary = document.createElement('summary');
    const count = teachers.length;
    summary.textContent = `${name} · ${count} docent${count === 1 ? '' : 'en'}`;
    details.append(summary);

    const rows = document.createElement('div');
    rows.className = 'admin-ux__teacher-class-list';
    if (teachers.length) {
      teachers.forEach((teacher) => rows.append(teacherButton(teacher)));
    } else if (emptyText) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = emptyText;
      rows.append(empty);
    }
    details.append(rows);
    return details;
  }

  function hideLegacyTeacherDetail() {
    const legacy = document.querySelector('#admin-teacher-detail');
    if (!legacy) return;
    if (!legacy.hidden) legacy.hidden = true;
    if (legacy.getAttribute('aria-hidden') !== 'true') legacy.setAttribute('aria-hidden', 'true');
  }

  function ensureEditorContainer() {
    const list = document.querySelector('#admin-teacher-list');
    const layout = list?.closest('.admin-teacher-layout');
    if (!list || !layout) return null;

    hideLegacyTeacherDetail();

    let editor = layout.querySelector('#teacher-groups-live-editor');
    if (editor) return editor;

    editor = document.createElement('aside');
    editor.id = 'teacher-groups-live-editor';
    editor.className = 'admin-teacher-detail teacher-groups-live-editor hidden';
    editor.setAttribute('aria-live', 'polite');
    editor.setAttribute('aria-hidden', 'true');
    layout.append(editor);
    return editor;
  }

  function setEditorVisible(editor, visible) {
    if (!editor) return;
    editor.classList.toggle('hidden', !visible);
    editor.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function addHeading(parent, text, level = 'h5') {
    const heading = document.createElement(level);
    heading.textContent = text;
    parent.append(heading);
    return heading;
  }

  function addStatus(parent) {
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    parent.append(status);
    return status;
  }

  function currentTeacher() {
    if (!selectedTeacherId || !payload) return null;
    return allTeachers().get(selectedTeacherId) || null;
  }

  async function refreshGroupsAndEditor(teacherId = selectedTeacherId) {
    payload = null;
    await loadGroups();
    selectedTeacherId = teacherId && allTeachers().has(teacherId) ? teacherId : '';
    queueRender();
    await renderTeacherEditor();
  }

  function scrollEditorIntoView(editor) {
    if (!editor) return;
    const narrow = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)').matches
      : window.innerWidth <= 900;
    if (!narrow) return;
    window.requestAnimationFrame(() => {
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderNameAndClasses(editor, teacher) {
    const form = document.createElement('form');
    form.id = 'teacher-groups-profile-form';
    form.className = 'admin-teacher-detail__section teacher-groups-profile';
    addHeading(form, 'Docentgegevens');

    const nameField = document.createElement('label');
    nameField.className = 'form-field';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Naam';
    const nameInput = document.createElement('input');
    nameInput.id = 'teacher-groups-profile-name';
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.autocomplete = 'off';
    nameInput.value = teacher.name || '';
    nameField.append(nameLabel, nameInput);
    form.append(nameField);

    addHeading(form, 'Klassen');
    const classList = document.createElement('div');
    classList.className = 'admin-teacher-class-list';
    const selectedClasses = classIdsForTeacher(teacher.id);

    for (const klass of Array.isArray(payload?.classes) ? payload.classes : []) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = klass.id;
      checkbox.checked = selectedClasses.has(klass.id);
      checkbox.dataset.teacherGroupClass = 'true';
      const text = document.createElement('span');
      text.textContent = klass.name || 'Naamloze klas';
      label.append(checkbox, text);
      classList.append(label);
    }
    form.append(classList);

    const actions = document.createElement('div');
    actions.className = 'admin-form__actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn--secondary';
    save.textContent = 'Wijzigingen opslaan';
    actions.append(save);
    form.append(actions);
    const status = addStatus(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        status.textContent = 'Naam mag niet leeg zijn.';
        return;
      }
      const classIds = Array.from(form.querySelectorAll('[data-teacher-group-class="true"]:checked'))
        .map((checkbox) => checkbox.value)
        .filter(Boolean);
      save.disabled = true;
      status.textContent = 'Wijzigingen worden opgeslagen…';
      try {
        await api(`/api/teachers/${encodeURIComponent(teacher.id)}`, {
          method: 'PATCH',
          body: { name, classIds },
        });
        await refreshGroupsAndEditor(teacher.id);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });

    editor.append(form);
  }

  function googleStatusText(entry) {
    if (entry?.googleVerified) return `Google gekoppeld · ${entry.googleEmail || 'schoolmail bekend'}`;
    if (entry?.googleEmail) return `Schoolmail staat klaar voor eerste Google-login · ${entry.googleEmail}`;
    return 'Nog geen Google-schoolaccount gekoppeld.';
  }

  async function renderGoogleSection(editor, teacher) {
    const section = document.createElement('section');
    section.id = 'teacher-groups-google-section';
    section.className = 'admin-teacher-detail__section admin-ux__teacher-google';
    addHeading(section, 'Google-schoolaccount');

    const copy = document.createElement('p');
    copy.className = 'hint';
    copy.textContent = 'Beheer hier de schoolmail die bij de Google-login van deze docent hoort.';
    section.append(copy);

    const form = document.createElement('form');
    form.id = 'teacher-groups-google-form';
    form.className = 'google-manage__form';
    const email = document.createElement('input');
    email.type = 'email';
    email.autocomplete = 'off';
    email.required = true;
    email.placeholder = 'naam@koraaledu.nl';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn--secondary';
    save.textContent = 'Schoolmail opslaan';
    form.append(email, save);
    section.append(form);
    const status = addStatus(section);
    status.textContent = 'Google-status wordt geladen…';
    editor.append(section);

    const version = ++googleRequestVersion;
    try {
      if (!googleManagePayload) googleManagePayload = await api('/api/auth/google/manage');
      if (version !== googleRequestVersion || selectedTeacherId !== teacher.id) return;
      const entry = (Array.isArray(googleManagePayload?.staff) ? googleManagePayload.staff : [])
        .find((staff) => staff?.id === teacher.id && staff?.role !== 'admin');
      email.placeholder = `naam@${googleManagePayload?.domain || 'koraaledu.nl'}`;
      email.value = entry?.googleEmail || '';
      status.textContent = googleStatusText(entry);
    } catch (error) {
      if (version === googleRequestVersion && selectedTeacherId === teacher.id) {
        status.textContent = error.message;
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submittedEmail = email.value.trim();
      save.disabled = true;
      status.textContent = 'Schoolmail wordt opgeslagen…';
      try {
        const result = await api('/api/auth/google/staff-email', {
          method: 'POST',
          body: { staffId: teacher.id, email: submittedEmail },
        });
        googleManagePayload = null;
        if (selectedTeacherId !== teacher.id) return;
        status.textContent = result?.googleVerified
          ? `Google gekoppeld · ${result.googleEmail || submittedEmail}`
          : `Schoolmail opgeslagen · ${result?.googleEmail || submittedEmail}`;
      } catch (error) {
        if (selectedTeacherId === teacher.id) status.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });
  }

  function renderDangerZone(editor, teacher) {
    const section = document.createElement('section');
    section.className = 'admin-teacher-detail__section teacher-groups-danger';
    addHeading(section, 'Account verwijderen');
    const copy = document.createElement('p');
    copy.className = 'hint';
    copy.textContent = 'Verwijder het docentaccount alleen als deze persoon niet meer in Boekenbaai hoort.';
    section.append(copy);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--danger';
    button.textContent = 'Docent verwijderen';
    section.append(button);
    const status = addStatus(section);

    button.addEventListener('click', async () => {
      const confirmed = window.confirm(`Docent ${teacher.name || ''} verwijderen?`);
      if (!confirmed) return;
      button.disabled = true;
      status.textContent = 'Docent wordt verwijderd…';
      try {
        await api(`/api/teachers/${encodeURIComponent(teacher.id)}`, { method: 'DELETE' });
        selectedTeacherId = '';
        googleManagePayload = null;
        await refreshGroupsAndEditor('');
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    editor.append(section);
  }

  async function renderTeacherEditor() {
    const editor = ensureEditorContainer();
    if (!editor) return;
    const teacher = currentTeacher();
    if (!teacher) {
      googleRequestVersion += 1;
      editor.replaceChildren();
      setEditorVisible(editor, false);
      return;
    }

    editor.replaceChildren();
    editor.dataset.teacherId = teacher.id;

    const header = document.createElement('header');
    header.className = 'admin-teacher-detail__header';
    const title = document.createElement('h4');
    title.textContent = teacher.name || 'Docent';
    header.append(title);
    editor.append(header);

    renderNameAndClasses(editor, teacher);
    const googleRender = renderGoogleSection(editor, teacher);
    renderDangerZone(editor, teacher);
    setEditorVisible(editor, true);
    await googleRender;
  }

  async function render() {
    renderQueued = false;
    const view = document.querySelector('[data-admin-people-view="teachers"]');
    const list = document.querySelector('#admin-teacher-list');
    if (!view || view.hidden || !list) return;

    hideLegacyTeacherDetail();

    const search = document.querySelector('#admin-teacher-search');
    const query = (search?.value || '').trim().toLocaleLowerCase('nl-NL');

    if (!payload) await loadGroups();
    if (!payload) return;

    if (selectedTeacherId && !allTeachers().has(selectedTeacherId)) selectedTeacherId = '';

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
        {
          open: Boolean(query),
          emptyText: 'Geen docenten gekoppeld aan deze klas.',
        }
      ));
    }

    const unassigned = (Array.isArray(payload.unassigned) ? payload.unassigned : [])
      .filter((teacher) => teacherMatches(teacher, query));
    if (unassigned.length) {
      wrapper.append(groupSection('Zonder klas', unassigned, { open: Boolean(query) }));
    }

    if (!wrapper.children.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = query ? 'Geen docenten of klassen gevonden.' : 'Er zijn nog geen klassen.';
      wrapper.append(empty);
    }

    list.replaceChildren(wrapper);
    await renderTeacherEditor();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function handleGroupedTeacherClick(event) {
    const button = event.target.closest('[data-teacher-groups-teacher="true"]');
    if (!button || !button.closest('.teacher-groups-live')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const teacherId = button.dataset.teacherId || '';
    if (!teacherId) return;
    selectedTeacherId = teacherId;
    queueRender();
    window.requestAnimationFrame(async () => {
      await renderTeacherEditor();
      scrollEditorIntoView(ensureEditorContainer());
    });
  }

  function install() {
    let changed = false;
    hideLegacyTeacherDetail();

    const search = document.querySelector('#admin-teacher-search');
    if (search && !search.dataset.teacherGroupsLive) {
      search.dataset.teacherGroupsLive = 'true';
      search.addEventListener('input', queueRender);
      changed = true;
    }

    document.querySelectorAll('[data-admin-people-tab="teachers"]').forEach((button) => {
      if (button.dataset.teacherGroupsLive) return;
      button.dataset.teacherGroupsLive = 'true';
      button.addEventListener('click', () => {
        payload = null;
        googleManagePayload = null;
        queueRender();
      });
      changed = true;
    });

    const list = document.querySelector('#admin-teacher-list');
    if (list && !list.dataset.teacherGroupsObserved) {
      list.dataset.teacherGroupsObserved = 'true';
      list.addEventListener('click', handleGroupedTeacherClick, true);
      const observer = new MutationObserver(() => {
        if (!list.querySelector('.teacher-groups-live')) {
          payload = null;
          queueRender();
        }
      });
      observer.observe(list, { childList: true, subtree: false });
      changed = true;
    }

    const hadEditor = Boolean(document.querySelector('#teacher-groups-live-editor'));
    const editor = ensureEditorContainer();
    if (editor && !hadEditor) changed = true;

    if (changed) queueRender();
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