(function readCompletion() {
  'use strict';

  const dialog = document.getElementById('reading-completion-dialog');
  const heading = document.getElementById('reading-completion-title');
  const description = document.getElementById('reading-completion-description');
  const yes = document.getElementById('reading-completion-yes');
  const no = document.getElementById('reading-completion-no');
  const studentList = document.getElementById('student-reading-records');
  const staffList = document.getElementById('staff-reading-records');
  if (!dialog || !yes || !no) return;

  let pending = null;
  let generation = 0;

  // Escape, clicking the backdrop, and the usual close button are
  // intentionally unavailable. Only an explicit Ja or Nee resolves a return.
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) event.preventDefault();
  });

  function ask(bookTitle) {
    if (pending) return Promise.reject(Error('Beantwoord eerst de openstaande vraag.'));
    heading.textContent = 'Is dit boek uitgelezen?';
    description.textContent = bookTitle ? 'Boek: ' + String(bookTitle) : 'Kies Ja of Nee om het boek terug te brengen.';
    return new Promise(resolve => {
      pending = resolve;
      dialog.showModal();
      yes.focus();
    });
  }

  function choose(answer) {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    dialog.close();
    resolve(answer);
  }
  yes.addEventListener('click', () => choose(true));
  no.addEventListener('click', () => choose(false));

  function authHeaders() {
    const token = window.localStorage.getItem('boekenbaai_token');
    return token && token !== 'cookie' ? { Authorization: 'Bearer ' + token } : {};
  }

  async function api(route, options = {}) {
    const response = await fetch(route, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...authHeaders(),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'Leesregistratie kon niet worden verwerkt.');
    return data;
  }

  function create(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function clearRecords() {
    generation++;
    studentList?.replaceChildren();
    staffList?.replaceChildren();
  }

  function render(records, container) {
    container.replaceChildren();
    if (!records.length) {
      container.append(create('p', 'hint', 'Er zijn nog geen antwoorden bij ingeleverde boeken.'));
      return;
    }
    for (const record of records) {
      const row = create('article', 'reading-record__item');
      const content = create('div', 'reading-record__info');
      content.append(create('strong', '', record.title || 'Onbekend boek'));
      const who = record.subjectName
        ? ' · ' + (record.subjectType === 'class' ? 'Klas ' : '') + record.subjectName
        : '';
      const date = record.reportedAt
        ? new Date(record.reportedAt).toLocaleDateString('nl-NL') : '';
      content.append(create('span', 'hint',
        [record.author || '', date, who.trim()].filter(Boolean).join(' · ')));
      const controls = create('div', 'reading-record__controls');
      const label = create('label', '', 'Uitgelezen?');
      const select = create('select');
      const ja = create('option', '', 'Ja'); ja.value = 'true';
      const nee = create('option', '', 'Nee'); nee.value = 'false';
      select.append(ja, nee);
      select.value = String(record.finished);
      label.append(select);
      const save = create('button', 'btn btn--secondary', 'Wijzig');
      save.type = 'button';
      save.disabled = true;
      select.addEventListener('change', () => {
        save.disabled = select.value === String(record.finished);
      });
      const feedback = create('p', 'hint');
      feedback.setAttribute('role', 'status');
      save.addEventListener('click', async () => {
        save.disabled = true;
        select.disabled = true;
        feedback.textContent = 'Wijziging opslaan…';
        try {
          const result = await api('/api/reading-records/' + encodeURIComponent(record.id), {
            method: 'PATCH',
            body: JSON.stringify({
              finished: select.value === 'true', revision: record.revision,
            }),
          });
          record.finished = result.record.finished;
          record.revision = result.record.revision;
          feedback.textContent = 'Antwoord gewijzigd.';
          window.dispatchEvent(new Event('boekenbaai:reading-record-updated'));
        } catch (error) {
          feedback.textContent = error.message;
          // A stale revision is deliberately not submitted again without
          // reloading: a second editor may have corrected this result.
          await refresh();
        } finally {
          select.disabled = false;
          save.disabled = select.value === String(record.finished);
        }
      });
      controls.append(label, save, feedback);
      row.append(content, controls);
      container.append(row);
    }
  }

  async function refresh() {
    const container = studentList || staffList;
    if (!container) return;
    const serial = ++generation;
    if (!window.localStorage.getItem('boekenbaai_token')) {
      container.replaceChildren();
      return;
    }
    try {
      const result = await api('/api/reading-records');
      if (serial !== generation) return;
      render(Array.isArray(result.records) ? result.records : [], container);
    } catch (error) {
      if (serial !== generation) return;
      container.replaceChildren(create('p', 'hint', error.message));
    }
  }

  window.addEventListener('boekenbaai:staff-auth-cleared', clearRecords);
  window.addEventListener('boekenbaai:student-auth-pending', clearRecords);
  window.addEventListener('boekenbaai:student-auth-validated', refresh);
  window.addEventListener('boekenbaai:staff-refresh', refresh);
  window.addEventListener('boekenbaai:reading-record-created', refresh);
  window.addEventListener('boekenbaai:reading-record-updated', refresh);
  window.addEventListener('pageshow', refresh);

  window.BoekenbaaiReadCompletion = { ask, refresh };
})();
