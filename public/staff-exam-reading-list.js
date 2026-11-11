(function staffExamList() {
  'use strict';
  const section = document.getElementById('staff-exam-reading');
  if (!section) return;
  const studentChoice = section.querySelector('#staff-exam-student');
  const studentSearch = section.querySelector('#staff-exam-student-search');
  const bookChoice = section.querySelector('#staff-exam-book');
  const bookSearch = section.querySelector('#staff-exam-book-search');
  const addButton = section.querySelector('#staff-exam-book-add');
  const output = section.querySelector('#staff-exam-entries');
  const feedback = section.querySelector('#staff-exam-message');
  let students = [];
  let books = [];
  let selectedStudent = '';
  let requestId = 0;
  let loading = false;

  const el = (name, text, className = '') => {
    const node = document.createElement(name);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const apiUrl = route => typeof window.BoekenbaaiResolveApiUrl === 'function'
    ? window.BoekenbaaiResolveApiUrl(route)
    : (String(window.BOEKENBAAI_API_BASE || '').replace(/\/$/, '') + route);
  async function api(route, options = {}) {
    const token = localStorage.getItem('boekenbaai_token');
    const response = await fetch(apiUrl(route), {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(token && token !== 'cookie' ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'De examenleeslijst kon niet worden geladen.');
    return data;
  }
  function renderStudents() {
    const previous = selectedStudent;
    studentChoice.replaceChildren(el('option', 'Selecteer een leerling'));
    studentChoice.firstChild.value = '';
    const query = studentSearch.value.trim().toLocaleLowerCase('nl-NL');
    for (const student of students.filter(item =>
      !query || String(item.name || '').toLocaleLowerCase('nl-NL').includes(query))) {
      const opt = el('option', student.name || 'Leerling');
      opt.value = student.id;
      studentChoice.append(opt);
    }
    if (students.some(item => item.id === previous) &&
        [...studentChoice.options].some(item => item.value === previous)) {
      studentChoice.value = previous;
    }
  }
  function renderBooks() {
    const query = bookSearch.value.trim().toLocaleLowerCase('nl-NL');
    const matching = books.filter(item => !query ||
      (item.title + ' ' + (item.author || '')).toLocaleLowerCase('nl-NL').includes(query));
    const unique = new Set();
    bookChoice.replaceChildren(el('option', query ? 'Kies een boek' : 'Zoek op titel of auteur'));
    bookChoice.firstChild.value = '';
    for (const book of matching) {
      const key = String(book.editionIsbn || book.metadataIsbn ||
        book.title + '|' + book.author).toLowerCase();
      if (unique.has(key)) continue;
      unique.add(key);
      const opt = el('option', (book.title || 'Boek') + (book.author ? ' · ' + book.author : ''));
      opt.value = book.id;
      bookChoice.append(opt);
      if (unique.size >= 80) break;
    }
    addButton.disabled = !selectedStudent || !bookChoice.value;
  }
  function renderEntries(entries) {
    output.replaceChildren();
    if (!entries.length) {
      output.append(el('p', 'Nog geen boeken op de examenleeslijst van deze leerling.', 'hint'));
      return;
    }
    for (const entry of entries) {
      const row = el('article', '', 'exam-reading__row');
      const info = el('div', '', 'exam-reading__info');
      info.append(el('strong', entry.title));
      info.append(el('span', [entry.author || '',
        entry.suitableForExamList ? 'Gemarkeerd als examenmateriaal' : 'Niet als examenmateriaal gemarkeerd']
        .filter(Boolean).join(' · '), 'hint'));
      if (entry.readFromReturn) {
        info.append(el('span', 'Gelezen, bevestigd bij inleveren', 'exam-reading__read'));
      }
      const actions = el('div', '', 'exam-reading__actions');
      const label = el('label', 'Voortgang');
      const select = el('select', '');
      for (const [value, title] of [['nog_lezen','Nog lezen'],['aan_het_lezen','Aan het lezen'],
        ['gelezen','Gelezen']]) {
        const option = el('option', title);
        option.value = value;
        select.append(option);
      }
      select.value = entry.manualStatus;
      select.disabled = entry.readFromReturn;
      if (entry.readFromReturn) label.title = 'Wijzig het bevestigde leesantwoord bij Leesregistraties.';
      label.append(select);
      const save = el('button', 'Opslaan', 'btn btn--secondary');
      save.type = 'button'; save.disabled = true;
      select.addEventListener('change', () => {
        save.disabled = select.value === entry.manualStatus;
      });
      const remove = el('button', 'Verwijderen', 'btn btn--ghost');
      remove.type = 'button';
      const msg = el('span', '', 'hint');
      msg.setAttribute('role', 'status');
      async function change(method, payload) {
        save.disabled = true; remove.disabled = true; select.disabled = true;
        msg.textContent = 'Wijziging opslaan…';
        try {
          await api('/api/exam-reading-list/' + encodeURIComponent(entry.id), {
            method, body: JSON.stringify({ revision: entry.revision, ...payload }),
          });
          await refreshList();
        } catch (error) {
          msg.textContent = error.message;
          await refreshList();
        }
      }
      save.addEventListener('click', () => change('PATCH', { status: select.value }));
      remove.addEventListener('click', () => change('DELETE', {}));
      actions.append(label, save, remove, msg);
      row.append(info, actions);
      output.append(row);
    }
  }
  async function refreshList() {
    const id = ++requestId;
    const studentId = selectedStudent;
    output.replaceChildren();
    if (!studentId) {
      output.append(el('p', 'Kies een leerling uit je eigen klassen.', 'hint'));
      return;
    }
    output.append(el('p', 'Leeslijst laden…', 'hint'));
    try {
      const data = await api('/api/exam-reading-list?studentId=' + encodeURIComponent(studentId));
      if (id !== requestId || studentId !== selectedStudent) return;
      renderEntries(data.entries || []);
    } catch (error) {
      if (id !== requestId) return;
      output.replaceChildren(el('p', error.message, 'hint'));
    }
  }
  async function refreshDirectory() {
    if (loading || !localStorage.getItem('boekenbaai_token')) return;
    loading = true;
    try {
      const data = await api('/api/staff/loans');
      students = (data.students || []).slice().sort((a,b) =>
        String(a.name).localeCompare(String(b.name),'nl'));
      books = (data.books || []).slice().sort((a,b) =>
        String(a.title).localeCompare(String(b.title),'nl'));
      if (!students.some(student => student.id === selectedStudent)) selectedStudent = '';
      renderStudents();
      renderBooks();
      await refreshList();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      loading = false;
    }
  }
  studentChoice.addEventListener('change', () => {
    selectedStudent = studentChoice.value;
    renderBooks();
    refreshList();
  });
  studentSearch.addEventListener('input', renderStudents);
  bookSearch.addEventListener('input', renderBooks);
  bookChoice.addEventListener('change', () => {
    addButton.disabled = !selectedStudent || !bookChoice.value;
  });
  addButton.addEventListener('click', async () => {
    if (!selectedStudent || !bookChoice.value) return;
    addButton.disabled = true;
    feedback.textContent = 'Toevoegen…';
    try {
      const result = await api('/api/exam-reading-list', {
        method: 'POST',
        body: JSON.stringify({ studentId: selectedStudent, bookId: bookChoice.value }),
      });
      feedback.textContent = result.created ? 'Boek toegevoegd.' : 'Dit boek staat al op de lijst.';
      await refreshList();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      renderBooks();
    }
  });
  window.addEventListener('boekenbaai:staff-refresh', refreshDirectory);
  window.addEventListener('pageshow', refreshDirectory);
  window.addEventListener('boekenbaai:reading-record-created', refreshList);
  window.addEventListener('boekenbaai:reading-record-updated', refreshList);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    requestId++;
    selectedStudent = ''; students = []; books = [];
    output.replaceChildren();
    feedback.textContent = '';
    renderStudents();
    renderBooks();
  });
  refreshDirectory();
})();
