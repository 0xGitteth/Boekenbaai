'use strict';

// Dedicated PR5 panel. Never cache staff borrower data in localStorage.
// The server always scopes this endpoint to currently assigned teacher classes.
const panel = document.getElementById('staff-loan-panel');
if (panel) {
  const form = document.getElementById('staff-loan-form');
  const type = document.getElementById('staff-loan-type');
  const borrower = document.getElementById('staff-loan-borrower');
  const book = document.getElementById('staff-loan-book');
  const due = document.getElementById('staff-loan-due');
  const filter = document.getElementById('staff-loan-filter');
  const output = document.getElementById('staff-loan-current');
  const message = document.getElementById('staff-loan-message');
  const submit = document.getElementById('staff-loan-submit');
  let state = { classes: [], students: [], books: [], loans: [] };
  let busy = false;
  let generation = 0;
  const apiBase = (window.BOEKENBAAI_API_BASE
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const address = (route) => apiBase ? apiBase.replace(/\/$/, '') + route : route;
  function option(select, value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    select.append(element);
  }
  async function request(route, method = 'GET', body) {
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) throw new Error('Log eerst in als docent of beheerder.');
    const response = await fetch(address(route), {
      method, headers: { Authorization: 'Bearer ' + token,
        Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'De uitleenactie is mislukt.');
    return data;
  }
  function showBorrowers() {
    const current = borrower.value;
    borrower.replaceChildren();
    option(borrower, '', type.value === 'class' ? 'Kies een klas' : 'Kies een leerling');
    const entries = type.value === 'class' ? state.classes : state.students.filter((s) => s.active);
    for (const entry of entries) {
      option(borrower, entry.id, entry.name);
    }
    if (entries.some((entry) => entry.id === current)) borrower.value = current;
  }
  function showBooks() {
    const selected = book.value;
    book.replaceChildren();
    option(book, '', 'Kies een beschikbaar exemplaar');
    for (const copy of state.books.filter((item) => item.status !== 'borrowed')) {
      option(book, copy.id, [copy.title || '(geen titel)', copy.author || '',
        copy.barcode || '', copy.fixedLocation ? 'vaste locatie: ' + copy.fixedLocation : '']
        .filter(Boolean).join(' · '));
    }
    if (state.books.some((item) => item.id === selected && item.status !== 'borrowed')) {
      book.value = selected;
    }
  }
  function showFilters() {
    const old = filter.value;
    filter.replaceChildren();
    option(filter, '', 'Alle toegestane klassen');
    for (const klass of state.classes) option(filter, klass.id, klass.name);
    filter.value = state.classes.some((klass) => klass.id === old) ? old : '';
  }
  function showLoans() {
    output.replaceChildren();
    const visible = state.loans.filter((loan) => {
      if (!filter.value) return true;
      if (loan.borrowerType === 'class') return loan.borrowerId === filter.value;
      return state.students.some((student) => student.id === loan.borrowerId
        && student.classIds.includes(filter.value));
    });
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Geen lopende uitleningen voor deze selectie.';
      output.append(empty);
      return;
    }
    for (const loan of visible) {
      const entry = document.createElement('article');
      entry.className = 'class-card';
      const name = document.createElement('strong');
      name.textContent = loan.title || '(geen titel)';
      entry.append(name);
      const info = document.createElement('p');
      info.className = 'hint';
      info.textContent = [loan.borrowerType === 'class' ? 'Voor klas' : 'Aan leerling',
        loan.borrowerName, loan.barcode || '',
        loan.dueDate ? 'Inleveren: ' + loan.dueDate : '',
        loan.fixedLocation ? 'Vaste locatie: ' + loan.fixedLocation : '']
        .filter(Boolean).join(' · ');
      entry.append(info);
      const returnButton = document.createElement('button');
      returnButton.type = 'button';
      returnButton.className = 'btn btn--secondary';
      returnButton.textContent = 'Innemen';
      returnButton.disabled = busy;
      returnButton.addEventListener('click', async () => {
        if (busy || !window.confirm('Dit exemplaar als ingeleverd registreren?')) return;
        busy = true;
        returnButton.disabled = true;
        try {
          await request('/api/books/' + encodeURIComponent(loan.bookId) + '/check-in',
            'POST', loan.borrowerType === 'class'
              ? { classId: loan.borrowerId } : { studentId: loan.borrowerId });
          message.textContent = 'Boek is ingenomen.';
          await refresh();
          window.dispatchEvent(new Event('boekenbaai:loans-changed'));
        } catch (error) {
          message.textContent = error.message;
        } finally {
          busy = false;
          returnButton.disabled = false;
        }
      });
      entry.append(returnButton);
      output.append(entry);
    }
  }
  async function refresh() {
    const callId = ++generation;
    if (!localStorage.getItem('boekenbaai_token') || panel.classList.contains('hidden')) {
      state = { classes: [], students: [], books: [], loans: [] };
      output.replaceChildren();
      return;
    }
    try {
      const data = await request('/api/staff/loans');
      if (callId !== generation) return;
      state = data;
      showBorrowers();
      showBooks();
      showFilters();
      showLoans();
    } catch (error) {
      if (callId !== generation) return;
      message.textContent = error.message;
      state = { classes: [], students: [], books: [], loans: [] };
      showBorrowers();
      showBooks();
      showLoans();
    }
  }
  type.addEventListener('change', showBorrowers);
  filter.addEventListener('change', showLoans);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !book.value || !borrower.value) return;
    busy = true;
    submit.disabled = true;
    try {
      const payload = type.value === 'class' ? { classId: borrower.value }
        : { studentId: borrower.value };
      if (due.value) payload.dueDate = due.value;
      await request('/api/books/' + encodeURIComponent(book.value) + '/check-out', 'POST', payload);
      message.textContent = 'Boek is uitgeleend.';
      await refresh();
      window.dispatchEvent(new Event('boekenbaai:loans-changed'));
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  window.addEventListener('boekenbaai:staff-refresh', refresh);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    generation += 1;
    state = { classes: [], students: [], books: [], loans: [] };
    output.replaceChildren();
    borrower.replaceChildren();
    book.replaceChildren();
    filter.replaceChildren();
    message.textContent = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  refresh();
}
