'use strict';

// PR6: shared class follow-up queue. Authentication lives in the existing
// staff session; no borrower information is kept in localStorage.
const panel = document.getElementById('book-import-followups-panel');
if (panel) {
  const list = document.getElementById('book-import-followups-list');
  const badge = document.getElementById('book-import-followups-badge');
  const info = document.getElementById('book-import-followups-message');
  const settingsSection = document.getElementById('book-import-followups-settings');
  const settingsForm = document.getElementById('book-import-followups-settings-form');
  const refreshButton = document.getElementById('book-import-followups-refresh');
  let state = { tasks: [], classes: [], students: [], summary: {} };
  let busy = false;
  let serial = 0;
  const configuredBase = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const base = (window.BOEKENBAAI_API_BASE || configuredBase
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const address = (route) => base ? base.replace(/\/$/, '') + route : route;
  async function request(route, method = 'GET', body) {
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) throw new Error('Log opnieuw in als medewerker.');
    const response = await fetch(address(route), {
      method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Deze taak kon niet worden bijgewerkt.');
    return data;
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function field(label, input) {
    const wrap = el('label', null, 'form-field');
    wrap.append(el('span', label), input);
    return wrap;
  }
  function option(select, value, label) {
    const item = document.createElement('option');
    item.value = value; item.textContent = label; select.append(item);
  }
  function roleIsAdmin() {
    return Boolean(state.settings);
  }
  function render() {
    list.replaceChildren();
    const count = state.summary.open || 0;
    badge.hidden = count === 0;
    badge.textContent = String(count);
    const visible = state.tasks.filter((task) =>
      ['open', 'reminder', 'admin_review'].includes(task.status));
    if (!visible.length) list.append(el('p', 'Geen openstaande importtaken.', 'hint'));
    for (const task of visible) {
      const klass = state.classes.find((entry) => entry.id === task.classId);
      const article = el('article', null, 'class-card');
      article.append(el('h4', task.title || '(onbekende titel)'));
      const details = [
        klass ? 'Klas: ' + klass.name : 'Klas nog onbekend',
        task.sourceClassNames?.length ? 'Excel: ' + task.sourceClassNames.join(', ') : '',
        task.sourceLibraryPresence ? 'Bibliotheekgegevens: ' + task.sourceLibraryPresence : '',
        task.requestedFixedLocation ? 'Mogelijk vast in de klas' : '',
        task.barcode ? 'Barcode: ' + task.barcode : '',
        'Exemplaar-ID: ' + task.bookId,
        task.worksheetRow ? 'Excelrij: ' + task.worksheetRow : '',
      ].filter(Boolean).join(' · ');
      article.append(el('p', details, 'hint'));
      const status = task.status === 'admin_review' ? 'Beheer moet deze taak controleren'
        : task.status === 'reminder' ? 'Herinnering: controle nog niet afgerond'
          : 'Nog te controleren';
      article.append(el('p', status, 'hint'));
      if (task.status === 'admin_review') {
        if (roleIsAdmin()) {
          const form = document.createElement('form');
          const select = document.createElement('select');
          select.required = true;
          option(select, '', 'Wijs een klas toe');
          for (const c of state.classes) option(select, c.id, c.name);
          const submit = el('button', 'Toewijzen', 'btn btn--secondary');
          submit.type = 'submit'; form.append(field('Klas voor deze taak', select), submit);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await perform('/api/admin/book-import-followups/' + encodeURIComponent(task.id)
              + '/assign', { classId: select.value, revision: task.revision });
          });
          article.append(form);
        }
        list.append(article);
        continue;
      }
      const form = document.createElement('form');
      form.className = 'form-grid form-grid--compact';
      const select = document.createElement('select');
      select.required = true;
      option(select, '', 'Kies hoe dit boek gebruikt wordt');
      option(select, 'class_loan', 'Voor de klas geleend');
      option(select, 'student_loan', 'Uitgeleend aan een leerling');
      option(select, 'fixed_location', 'Staat vast in onze klas');
      option(select, 'not_our_class', 'Hoort niet bij onze klas');
      const student = document.createElement('select');
      student.hidden = true; student.disabled = true;
      option(student, '', 'Kies een leerling');
      for (const entry of state.students.filter((pupil) => pupil.active
        && pupil.classIds.includes(task.classId))) {
        option(student, entry.id, entry.name);
      }
      select.addEventListener('change', () => {
        student.hidden = select.value !== 'student_loan';
        student.disabled = student.hidden;
        student.required = !student.hidden;
      });
      const submit = el('button', 'Keuze opslaan', 'btn');
      submit.type = 'submit';
      form.append(field('Wat is de juiste situatie?', select),
        field('Leerling (alleen bij een leerlinglening)', student), submit);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await perform('/api/staff/book-import-followups/' + encodeURIComponent(task.id)
          + '/decision', { choice: select.value, studentId: student.value,
          revision: task.revision });
      });
      article.append(form);
      list.append(article);
    }
    settingsSection.hidden = !roleIsAdmin();
    if (roleIsAdmin()) {
      settingsForm.elements.reminderDays.value = state.settings.reminderDays;
      settingsForm.elements.escalationDays.value = state.settings.escalationDays;
    }
  }
  async function perform(route, payload, method = 'POST') {
    if (busy) return;
    busy = true;
    info.textContent = '';
    try {
      await request(route, method, payload);
      info.textContent = 'De wijziging is opgeslagen.';
      await refresh();
      window.dispatchEvent(new Event('boekenbaai:loans-changed'));
    } catch (error) {
      info.textContent = error.message;
      await refresh();
    } finally { busy = false; }
  }
  async function refresh() {
    const call = ++serial;
    if (!localStorage.getItem('boekenbaai_token') || panel.classList.contains('hidden')) {
      state = { tasks: [], classes: [], students: [], summary: {} };
      list.replaceChildren(); badge.hidden = true;
      return;
    }
    try {
      const current = await request('/api/staff/book-import-followups');
      if (serial !== call) return;
      state = current;
      render();
    } catch (error) {
      if (serial !== call) return;
      info.textContent = error.message;
      state = { tasks: [], classes: [], students: [], summary: {} };
      render();
    }
  }
  refreshButton.addEventListener('click', refresh);
  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await perform('/api/admin/book-import-followups/settings', {
      reminderDays: Number(settingsForm.elements.reminderDays.value),
      escalationDays: Number(settingsForm.elements.escalationDays.value),
    }, 'PUT');
  });
  window.addEventListener('boekenbaai:staff-refresh', refresh);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    serial++;
    state = { tasks: [], classes: [], students: [], summary: {} };
    list.replaceChildren(); badge.hidden = true; info.textContent = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  // A visible task list updates when another teacher acts on the same class.
  setInterval(() => { if (!document.hidden && !panel.classList.contains('hidden')) refresh(); }, 10000);
  refresh();
}
