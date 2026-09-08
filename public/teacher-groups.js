(() => {
  'use strict';

  let payload = null;
  let loading = false;
  let renderQueued = false;
  let retryTimer = null;

  function authHeaders() {
    const headers = { Accept: 'application/json' };
    const token = window.localStorage.getItem('boekenbaai_token') || '';
    if (token && token !== 'cookie') headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function loadGroups() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/admin/teacher-groups', {
        credentials: 'same-origin',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
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

  async function render() {
    renderQueued = false;
    const view = document.querySelector('[data-admin-people-view="teachers"]');
    const list = document.querySelector('#admin-teacher-list');
    if (!view || view.hidden || !list) return;

    const search = document.querySelector('#admin-teacher-search');
    const query = (search?.value || '').trim().toLocaleLowerCase('nl-NL');
    const existing = list.querySelector('.teacher-groups-live');
    if (existing && existing.dataset.query === query) return;

    if (!payload) await loadGroups();
    if (!payload) return;

    const selectedId = document.querySelector('#admin-teacher-detail-content')?.dataset.teacherId || '';
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
      const observer = new MutationObserver(() => {
        if (!list.querySelector('.teacher-groups-live')) queueRender();
      });
      observer.observe(list, { childList: true, subtree: false });
    }

    queueRender();
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
