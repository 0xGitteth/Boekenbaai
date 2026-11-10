(function quickLoanController() {
  'use strict';

  const dialog = document.getElementById('student-quick-loan-dialog');
  const form = document.getElementById('student-quick-loan-form');
  const name = document.getElementById('student-quick-loan-name');
  const results = document.getElementById('student-quick-loan-results');
  const selected = document.getElementById('student-quick-loan-selected');
  const pin = document.getElementById('student-quick-loan-pin');
  const book = document.getElementById('student-quick-loan-book');
  const message = document.getElementById('student-quick-loan-message');
  const submit = document.getElementById('student-quick-loan-submit');
  const google = document.getElementById('student-quick-loan-google');
  const close = document.getElementById('student-quick-loan-close');
  if (![dialog, form, name, results, selected, pin, book,
    message, submit, google, close].every(Boolean)) return;

  let bookId = '';
  let bookTitle = '';
  let selectedStudentId = '';
  let searchTimer = null;
  let searchAbort = null;
  let requestSerial = 0;
  let busy = false;
  let flowEpoch = 0;

  async function api(url, method = 'GET', body, signal) {
    const response = await fetch(url, {
      method, credentials: 'same-origin', signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.message || 'De uitleenactie is niet gelukt.');
    return payload;
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
    searchAbort = null;
    requestSerial++;
    results.replaceChildren();
    name.setAttribute('aria-expanded', 'false');
  }

  function reset() {
    // Invalidate any previous async PIN/checkout response, including a
    // canceled dialog reopened for the same physical book.
    flowEpoch += 1;
    clearSearch();
    form.reset();
    selectedStudentId = '';
    selected.textContent = '';
    message.textContent = '';
    bookId = '';
    bookTitle = '';
    busy = false;
    submit.disabled = false;
    google.disabled = false;
    name.disabled = false;
    pin.disabled = false;
  }

  function showBook(input) {
    if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id)
      || input.status === 'borrowed' || busy) return;
    reset();
    bookId = input.id;
    bookTitle = String(input.title || 'Dit boek');
    book.textContent = 'Boek: ' + bookTitle;
    dialog.showModal();
    name.focus();
  }

  function displayChoices(matches) {
    results.replaceChildren();
    for (const student of matches.slice(0, 10)) {
      if (!student || !student.id || !student.displayName && !student.name) continue;
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bb-quick-loan__choice';
      button.textContent = student.displayName || student.name;
      button.addEventListener('click', () => {
        selectedStudentId = student.id;
        name.value = student.displayName || student.name;
        selected.textContent = 'Gekozen: ' + name.value;
        clearSearch();
        pin.focus();
      });
      li.append(button);
      results.append(li);
    }
    name.setAttribute('aria-expanded', results.children.length ? 'true' : 'false');
    if (!results.children.length) {
      selected.textContent = 'Geen leerling gevonden. Controleer je naam.';
    }
  }

  name.addEventListener('input', () => {
    selectedStudentId = '';
    selected.textContent = '';
    clearSearch();
    const query = name.value.trim();
    if (query.length < 3) return;
    const serial = requestSerial;
    searchTimer = setTimeout(async () => {
      const controller = new AbortController();
      searchAbort = controller;
      try {
        const payload = await api('/api/login-search?type=student&q=' +
          encodeURIComponent(query), 'GET', undefined, controller.signal);
        if (serial !== requestSerial || !dialog.open) return;
        displayChoices(Array.isArray(payload.matches) ? payload.matches : []);
      } catch (error) {
        if (serial === requestSerial && error.name !== 'AbortError') {
          selected.textContent = error.message;
        }
      }
    }, 200);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (!bookId || !selectedStudentId) {
      message.textContent = 'Kies eerst jouw naam uit de resultaten.';
      name.focus();
      return;
    }
    if (!/^[0-9]{6}$/.test(pin.value)) {
      message.textContent = 'Vul je PIN van zes cijfers in.';
      pin.focus();
      return;
    }
    const attemptedStudent = selectedStudentId;
    const attemptedBook = bookId;
    const attemptedEpoch = flowEpoch;
    const code = pin.value;
    busy = true;
    submit.disabled = true;
    google.disabled = true;
    name.disabled = true;
    pin.disabled = true;
    message.textContent = 'PIN controleren en boek lenen…';
    pin.value = '';
    try {
      const approval = await api('/api/auth/student-pin/verify', 'POST',
        { studentId: attemptedStudent, bookId: attemptedBook, pin: code });
      if (!dialog.open || flowEpoch !== attemptedEpoch || bookId !== attemptedBook) return;
      const loan = await api('/api/books/' + encodeURIComponent(attemptedBook) + '/check-out',
        'POST', { pinCheckoutGrant: approval.grant });
      if (!dialog.open || flowEpoch !== attemptedEpoch || bookId !== attemptedBook) return;
      const label = loan?.book?.title || bookTitle;
      dialog.close();
      const action = document.getElementById('student-action-message');
      if (action) action.textContent = label + ' is uitgeleend. Veel leesplezier!';
      window.dispatchEvent(new CustomEvent('boekenbaai:quick-loan-completed', {
        detail: { bookId: attemptedBook, title: label },
      }));
    } catch (error) {
      if (dialog.open && flowEpoch === attemptedEpoch && bookId === attemptedBook) {
        message.textContent = error.message + ' Controleer je gegevens of gebruik Google.';
        pin.focus();
      }
    } finally {
      if (flowEpoch === attemptedEpoch) {
        busy = false;
        submit.disabled = false;
        google.disabled = false;
        name.disabled = false;
        pin.disabled = false;
      }
    }
  });

  google.addEventListener('click', () => {
    dialog.close();
    const profile = document.getElementById('student-nav-profile');
    profile?.click();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', reset);

  // There is intentionally no login token, storage, or broader student
  // session in this controller. The PIN is sent only for the chosen book.
  window.BoekenbaaiQuickLoan = { open: showBook };
})();
