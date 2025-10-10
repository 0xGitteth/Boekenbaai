const metaApiBase = document.querySelector('meta[name="boekenbaai-api-base"]');
const apiBase = (
  (typeof window !== 'undefined' && window.BOEKENBAAI_API_BASE) ||
  metaApiBase?.content ||
  ''
).trim();
const pageType = document.body?.dataset.page || 'student';
let authToken = localStorage.getItem('boekenbaai_token') || null;
let authUser = null;
let updateAuthUi = () => {};

function setAuth(token) {
  authToken = token;
  localStorage.setItem('boekenbaai_token', token);
}

function clearAuth({ silent = false } = {}) {
  authToken = null;
  authUser = null;
  localStorage.removeItem('boekenbaai_token');
  if (!silent) {
    updateAuthUi();
  }
}

function isJsonLike(body) {
  return (
    body &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  );
}

function resolveApiUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (!apiBase) {
    return url;
  }
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}

async function fetchJson(url, options = {}) {
  const config = { method: 'GET', ...options };
  config.headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (isJsonLike(config.body)) {
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
    config.body = JSON.stringify(config.body);
  }
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(resolveApiUrl(url), config);
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
    }
    throw new Error(payload.message || 'Er ging iets mis');
  }
  return payload;
}

async function reloadCurrentUser(expectedRoles) {
  if (!authToken) return null;
  const me = await fetchJson('/api/me');
  if (expectedRoles && !expectedRoles.includes(me.role)) {
    clearAuth();
    throw new Error('Geen toegang tot dit onderdeel');
  }
  authUser = me;
  updateAuthUi();
  return me;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nl-NL');
}

function findFolder(folders, id) {
  if (!Array.isArray(folders)) return null;
  return folders.find((folder) => folder.id === id) || null;
}

function createBookCard(template, book, folders) {
  if (!template) return null;
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.book-card');
  if (!card) return null;

  const folderBadge = fragment.querySelector('.book-card__folder');
  const statusBadge = fragment.querySelector('.book-card__status');
  const title = fragment.querySelector('.book-card__title');
  const author = fragment.querySelector('.book-card__author');
  const description = fragment.querySelector('.book-card__description');
  const tagsList = fragment.querySelector('.book-card__tags');

  const folder = findFolder(folders, book.folderId);
  folderBadge.textContent = folder ? folder.name : 'Geen map';
  const folderColor = folder?.color || '#cbd5f5';
  folderBadge.style.background = `${folderColor}20`;
  folderBadge.style.color = '#1b263b';

  statusBadge.textContent = book.status === 'available' ? 'Beschikbaar' : 'Uitgeleend';
  statusBadge.classList.add(
    book.status === 'available' ? 'book-card__status--available' : 'book-card__status--borrowed'
  );

  title.textContent = book.title;
  author.textContent = book.author;
  description.textContent = book.description || 'Nog geen beschrijving beschikbaar.';

  tagsList.innerHTML = '';
  if (book.suitableForExamList) {
    const badge = document.createElement('li');
    badge.textContent = 'Leeslijst';
    badge.style.background = 'rgba(231, 111, 81, 0.18)';
    badge.style.color = '#a53a1d';
    tagsList.append(badge);
  }
  for (const tag of book.tags || []) {
    const li = document.createElement('li');
    li.textContent = tag;
    tagsList.append(li);
  }

  return card;
}

function filterBooks(allBooks, { folder, query }) {
  let list = Array.isArray(allBooks) ? [...allBooks] : [];
  if (folder) {
    list = list.filter((book) => book.folderId === folder);
  }
  if (query) {
    const term = query.toLowerCase();
    list = list.filter((book) => {
      const haystack = [
        book.title,
        book.author,
        book.description,
        book.barcode,
        ...(book.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }
  return list;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1] || result;
        resolve(base64);
        return;
      }
      if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result);
        let binary = '';
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        resolve(btoa(binary));
        return;
      }
      reject(new Error('Kon bestand niet lezen'));
    };
    reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
    reader.readAsDataURL(file);
  });
}

function initStudentPage() {
  const loginPanel = document.querySelector('#student-login-panel');
  const loginForm = document.querySelector('#student-login-form');
  const loginUsername = document.querySelector('#student-login-username');
  const loginPassword = document.querySelector('#student-login-password');
  const loginMessage = document.querySelector('#student-login-message');
  const dashboard = document.querySelector('#student-dashboard');
  const studentName = document.querySelector('#student-name');
  const studentGrade = document.querySelector('#student-grade');
  const borrowedList = document.querySelector('#student-borrowed-list');
  const borrowedEmpty = document.querySelector('#student-borrowed-empty');
  const logoutButton = document.querySelector('#student-logout');
  const folderFilter = document.querySelector('#folder-filter');
  const searchInput = document.querySelector('#search-input');
  const summary = document.querySelector('#summary');
  const bookGrid = document.querySelector('#book-grid');
  const bookCardTemplate = document.querySelector('#book-card-template');
  const barcodeInput = document.querySelector('#barcode-input');
  const lookupButton = document.querySelector('#lookup-button');
  const bookResult = document.querySelector('#book-result');

  let folders = [];
  let allBooks = [];
  let currentBook = null;

  function renderBorrowedBooks() {
    if (!borrowedList || !borrowedEmpty) return;
    borrowedList.innerHTML = '';
    const loggedIn = authUser && authUser.role === 'student';
    if (!loggedIn) {
      borrowedEmpty.classList.remove('hidden');
      borrowedEmpty.textContent = 'Log in om jouw uitleenlijst te bekijken.';
      return;
    }
    const borrowed = authUser.borrowedBooks || [];
    if (!borrowed.length) {
      borrowedEmpty.classList.remove('hidden');
      borrowedEmpty.textContent = 'Je hebt nog geen boeken geleend.';
      return;
    }
    borrowedEmpty.classList.add('hidden');
    for (const item of borrowed) {
      const book = allBooks.find((entry) => entry.id === item.bookId);
      const li = document.createElement('li');
      li.className = 'borrowed-list__item';
      const parts = [
        `<strong>${book ? book.title : 'Onbekend boek'}</strong>`,
        book ? `<span>${book.author}</span>` : '',
        item.borrowedAt ? `<span>Sinds ${formatDate(item.borrowedAt)}</span>` : '',
      ].filter(Boolean);
      li.innerHTML = parts.join(' ');
      borrowedList.append(li);
    }
  }

  function enableScanArea() {
    const loggedIn = authUser && authUser.role === 'student';
    if (barcodeInput) {
      barcodeInput.disabled = !loggedIn;
      if (!loggedIn) {
        barcodeInput.value = '';
      }
    }
    if (lookupButton) {
      lookupButton.disabled = !loggedIn;
    }
  }

  function resetBookResult() {
    if (bookResult) {
      bookResult.innerHTML =
        '<p class="book-result__status">Log in en scan een boek om te starten.</p>';
    }
    currentBook = null;
  }

  function renderAuthState() {
    const loggedIn = authUser && authUser.role === 'student';
    loginPanel?.classList.toggle('hidden', loggedIn);
    dashboard?.classList.toggle('hidden', !loggedIn);
    logoutButton?.classList.toggle('hidden', !loggedIn);
    if (studentName) {
      studentName.textContent = loggedIn ? authUser.name : '';
    }
    if (studentGrade) {
      studentGrade.textContent = loggedIn && authUser.grade ? `Klas: ${authUser.grade}` : '';
    }
    enableScanArea();
    renderBorrowedBooks();
    if (!loggedIn) {
      resetBookResult();
    }
  }

  updateAuthUi = renderAuthState;

  function renderBooks() {
    if (!bookGrid) return;
    const filters = {
      folder: folderFilter?.value || '',
      query: searchInput?.value || '',
    };
    const filtered = filterBooks(allBooks, filters);
    bookGrid.innerHTML = '';
    if (!filtered.length) {
      bookGrid.innerHTML = '<p>Geen boeken gevonden voor deze selectie.</p>';
      return;
    }
    for (const book of filtered) {
      const card = createBookCard(bookCardTemplate, book, folders);
      if (card) {
        bookGrid.append(card);
      }
    }
  }

  async function loadFolders() {
    folders = await fetchJson('/api/folders');
    if (folderFilter) {
      const current = folderFilter.value;
      folderFilter.innerHTML = '<option value="">Alle mappen</option>';
      for (const folder of folders) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        folderFilter.append(option);
      }
      folderFilter.value = current;
    }
  }

  async function loadBooks() {
    allBooks = await fetchJson('/api/books');
    renderBooks();
  }

  async function loadSummary() {
    if (!summary) return;
    const data = await fetchJson('/api/status');
    summary.innerHTML = '';
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'summary__item';
      div.innerHTML = `${item.value}<span>${item.label}</span>`;
      summary.append(div);
    }
  }

  async function handleLookup() {
    if (!authUser || authUser.role !== 'student') {
      resetBookResult();
      return;
    }
    const barcode = barcodeInput?.value.trim();
    if (!barcode) return;
    try {
      currentBook = await fetchJson(`/api/books/barcode/${encodeURIComponent(barcode)}`);
      renderBookPrompt();
    } catch (error) {
      currentBook = null;
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  function renderBookPrompt() {
    if (!bookResult) return;
    if (!currentBook) {
      resetBookResult();
      return;
    }
    const loggedIn = authUser && authUser.role === 'student';
    const folder = findFolder(folders, currentBook.folderId);
    const borrowedByStudent = loggedIn && currentBook.borrowedBy === authUser.id;
    const borrowedByOther = currentBook.status === 'borrowed' && !borrowedByStudent;
    let statusText = 'Boek is beschikbaar';
    if (currentBook.status !== 'available') {
      statusText = borrowedByStudent
        ? 'Je hebt dit boek geleend'
        : 'Dit boek is momenteel uitgeleend';
    }
    const examBadge = currentBook.suitableForExamList
      ? '<p><strong>✔ Op de leeslijst</strong></p>'
      : '';
    bookResult.innerHTML = `
      <h3>${currentBook.title}</h3>
      <p>${currentBook.author}</p>
      <p class="book-result__status">${statusText}</p>
      <p>${currentBook.description || ''}</p>
      <p><strong>Map:</strong> ${folder ? folder.name : 'Geen map'}</p>
      <p><strong>Barcode:</strong> ${currentBook.barcode}</p>
      ${examBadge}
    `;
    const actions = document.createElement('div');
    actions.className = 'book-result__actions';
    if (currentBook.status === 'available' && loggedIn) {
      const borrowBtn = document.createElement('button');
      borrowBtn.type = 'button';
      borrowBtn.className = 'btn';
      borrowBtn.textContent = 'Ik leen dit boek';
      borrowBtn.addEventListener('click', () => handleBorrow(currentBook));
      actions.append(borrowBtn);
    }
    if (borrowedByStudent) {
      const returnBtn = document.createElement('button');
      returnBtn.type = 'button';
      returnBtn.className = 'btn btn--secondary';
      returnBtn.textContent = 'Ik breng het terug';
      returnBtn.addEventListener('click', () => handleReturn(currentBook));
      actions.append(returnBtn);
    }
    if (borrowedByOther) {
      const info = document.createElement('p');
      info.className = 'hint';
      info.textContent =
        'Het boek is nu uitgeleend. Vraag de mediatheek om hulp als je het nodig hebt.';
      actions.append(info);
    }
    bookResult.append(actions);
  }

  async function handleBorrow(book) {
    if (!book) return;
    try {
      const result = await fetchJson(`/api/books/${book.id}/check-out`, {
        method: 'POST',
        body: {},
      });
      currentBook = result.book;
      await refreshData();
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">Veel leesplezier met <strong>${result.book.title}</strong>!</p>`;
      }
    } catch (error) {
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  async function handleReturn(book) {
    if (!book) return;
    try {
      const result = await fetchJson(`/api/books/${book.id}/check-in`, {
        method: 'POST',
        body: {},
      });
      currentBook = result.book;
      await refreshData();
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">Bedankt! <strong>${result.book.title}</strong> is weer beschikbaar.</p>`;
      }
    } catch (error) {
      if (bookResult) {
        bookResult.innerHTML = `<p class="book-result__status">${error.message}</p>`;
      }
    }
  }

  async function refreshData() {
    if (!authUser || authUser.role !== 'student') return;
    await Promise.all([loadFolders(), loadBooks(), loadSummary(), reloadCurrentUser(['student'])]);
    if (currentBook) {
      const updated = allBooks.find((book) => book.id === currentBook.id);
      currentBook = updated || null;
    }
    renderBorrowedBooks();
    renderBookPrompt();
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      loginMessage.textContent = 'Vul je gebruikersnaam en wachtwoord in.';
      return;
    }
    try {
      const result = await fetchJson('/api/login', {
        method: 'POST',
        body: { username, password },
      });
      if (result.user.role !== 'student') {
        clearAuth({ silent: true });
        loginMessage.textContent = 'Gebruik voor medewerkers de docenteninlog.';
        return;
      }
      setAuth(result.token);
      await reloadCurrentUser(['student']);
      loginForm.reset();
      loginMessage.textContent = `Welkom ${authUser.name}!`;
      await refreshData();
      barcodeInput?.focus();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton?.addEventListener('click', async () => {
    if (!authToken) return;
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (error) {
      // server kan al uitgelogd zijn, negeer fout
    }
    clearAuth();
    loginMessage.textContent = 'Je bent uitgelogd.';
    renderBorrowedBooks();
    resetBookResult();
  });

  lookupButton?.addEventListener('click', (event) => {
    event.preventDefault();
    handleLookup();
  });

  barcodeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLookup();
    }
  });

  folderFilter?.addEventListener('change', renderBooks);
  searchInput?.addEventListener('input', renderBooks);

  renderAuthState();
  Promise.all([loadFolders(), loadBooks(), loadSummary()]).catch(() => {});
  if (authToken) {
    reloadCurrentUser(['student'])
      .then(refreshData)
      .catch(() => {
        clearAuth();
      });
  }
}

function initStaffPage() {
  const loginPanel = document.querySelector('#staff-login-panel');
  const loginForm = document.querySelector('#login-form');
  const loginUsername = document.querySelector('#login-username');
  const loginPassword = document.querySelector('#login-password');
  const loginMessage = document.querySelector('#login-message');
  const staffSections = document.querySelectorAll('[data-visible-for]');
  const staffName = document.querySelector('#staff-name');
  const staffRole = document.querySelector('#staff-role');
  const logoutButton = document.querySelector('#logout-button');
  const folderFilter = document.querySelector('#folder-filter');
  const searchInput = document.querySelector('#search-input');
  const summary = document.querySelector('#summary');
  const bookGrid = document.querySelector('#book-grid');
  const bookCardTemplate = document.querySelector('#book-card-template');
  const historyList = document.querySelector('#history-list');
  const classList = document.querySelector('#class-list');
  const classMessage = document.querySelector('#class-message');
  const createClassForm = document.querySelector('#create-class-form');
  const newClassNameInput = document.querySelector('#new-class-name');
  const adminBookForm = document.querySelector('#admin-book-form');
  const adminBookTitle = document.querySelector('#admin-book-title');
  const adminBookAuthor = document.querySelector('#admin-book-author');
  const adminBookBarcode = document.querySelector('#admin-book-barcode');
  const adminFolderSelect = document.querySelector('#admin-folder-select');
  const adminBookExam = document.querySelector('#admin-book-exam');
  const adminBookDescription = document.querySelector('#admin-book-description');
  const adminBookMessage = document.querySelector('#admin-book-message');
  const studentImportForm = document.querySelector('#student-import-form');
  const studentImportFile = document.querySelector('#student-import-file');
  const studentImportMessage = document.querySelector('#student-import-message');
  const studentImportResults = document.querySelector('#student-import-results');

  let folders = [];
  let allBooks = [];
  let classes = [];
  let students = [];
  const filters = { folder: '', query: '' };

  function renderStaffState() {
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    loginPanel?.classList.toggle('hidden', loggedIn);
    staffSections.forEach((section) => {
      const roles = (section.dataset.visibleFor || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
      const show = loggedIn && roles.includes(authUser.role);
      section.classList.toggle('hidden', !show);
    });
    if (staffName) {
      staffName.textContent = loggedIn ? authUser.name : '';
    }
    if (staffRole) {
      staffRole.textContent = loggedIn ? (authUser.role === 'admin' ? 'Beheerder' : 'Docent') : '';
    }
    if (logoutButton) {
      logoutButton.disabled = !loggedIn;
    }
    if (!loggedIn) {
      historyList && (historyList.innerHTML = '');
      classList && (classList.innerHTML = '');
      adminBookMessage && (adminBookMessage.textContent = '');
      studentImportMessage && (studentImportMessage.textContent = '');
      studentImportResults && (studentImportResults.innerHTML = '');
    }
  }

  updateAuthUi = renderStaffState;

  function renderBooks() {
    if (!bookGrid) return;
    const filtered = filterBooks(allBooks, filters);
    bookGrid.innerHTML = '';
    if (!filtered.length) {
      bookGrid.innerHTML = '<p>Geen boeken gevonden voor deze selectie.</p>';
      return;
    }
    for (const book of filtered) {
      const card = createBookCard(bookCardTemplate, book, folders);
      if (card) {
        bookGrid.append(card);
      }
    }
  }

  async function loadFolders() {
    folders = await fetchJson('/api/folders');
    if (folderFilter) {
      const current = folderFilter.value;
      folderFilter.innerHTML = '<option value="">Alle mappen</option>';
      for (const folder of folders) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        folderFilter.append(option);
      }
      folderFilter.value = current;
    }
    if (adminFolderSelect) {
      const current = adminFolderSelect.value;
      adminFolderSelect.innerHTML = '<option value="">Geen map</option>';
      for (const folder of folders) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        adminFolderSelect.append(option);
      }
      adminFolderSelect.value = current;
    }
  }

  async function loadBooks() {
    allBooks = await fetchJson('/api/books');
    renderBooks();
  }

  async function loadSummary() {
    if (!summary) return;
    const data = await fetchJson('/api/status');
    summary.innerHTML = '';
    const items = [
      { label: 'Totaal', value: data.totalBooks },
      { label: 'Beschikbaar', value: data.availableBooks },
      { label: 'Uitgeleend', value: data.borrowedBooks },
      { label: 'Leeslijst', value: data.examListBooks },
    ];
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'summary__item';
      div.innerHTML = `${item.value}<span>${item.label}</span>`;
      summary.append(div);
    }
  }

  async function loadHistory() {
    if (!historyList) return;
    try {
      const entries = await fetchJson('/api/history?limit=10');
      historyList.innerHTML = '';
      for (const entry of entries) {
        const li = document.createElement('li');
        li.className = 'history-item';
        const time = new Date(entry.timestamp).toLocaleString('nl-NL', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
        li.innerHTML = `
          <span class="history-item__time">${time}</span>
          <span>${entry.message}</span>
        `;
        historyList.append(li);
      }
    } catch (error) {
      historyList.innerHTML = `<li class="history-item">${error.message}</li>`;
    }
  }

  async function loadStudents() {
    students = await fetchJson('/api/students');
  }

  function renderClasses() {
    if (!classList) return;
    classList.innerHTML = '';
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    if (!loggedIn) return;
    if (!classes.length) {
      classList.innerHTML = '<p>Je hebt nog geen klassen. Maak er één aan om te starten.</p>';
      return;
    }
    for (const klass of classes) {
      const article = document.createElement('article');
      article.className = 'class-card';

      const header = document.createElement('header');
      header.className = 'class-card__header';
      header.innerHTML = `<h4>${klass.name}</h4><span>${klass.studentIds?.length || 0} leerlingen</span>`;
      article.append(header);

      const memberList = document.createElement('ul');
      memberList.className = 'class-card__students';
      const members = (klass.studentIds || [])
        .map((id) => students.find((student) => student.id === id))
        .filter(Boolean);
      if (!members.length) {
        const li = document.createElement('li');
        li.textContent = 'Nog geen leerlingen gekoppeld.';
        memberList.append(li);
      } else {
        for (const member of members) {
          const li = document.createElement('li');
          li.innerHTML = `
            <div>
              <strong>${member.name}</strong>
              <span>${member.grade || 'klas onbekend'}</span>
              ${member.borrowedBooks?.length ? `<span>${member.borrowedBooks.length} boek(en) mee</span>` : ''}
            </div>
            <button
              class="btn btn--ghost"
              data-remove-student
              data-class-id="${klass.id}"
              data-student-id="${member.id}"
              type="button"
            >Verwijderen</button>
          `;
          memberList.append(li);
        }
      }
      article.append(memberList);

      const form = document.createElement('form');
      form.className = 'class-card__form';
      const availableStudents = students.filter(
        (student) => !(klass.studentIds || []).includes(student.id)
      );
      const options = [
        '<option value="">Kies een leerling…</option>',
        ...availableStudents.map(
          (student) =>
            `<option value="${student.id}">${student.name} (${student.grade || 'leerling'})</option>`
        ),
      ].join('');
      form.innerHTML = `
        <label for="add-${klass.id}">Leerling toevoegen</label>
        <select id="add-${klass.id}" required>${options}</select>
        <button type="submit" class="btn btn--secondary">Toevoegen</button>
      `;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const select = form.querySelector('select');
        if (!select?.value) return;
        try {
          await fetchJson(`/api/classes/${klass.id}/students`, {
            method: 'POST',
            body: { studentId: select.value },
          });
          if (classMessage) {
            classMessage.textContent = 'Leerling gekoppeld aan de klas.';
          }
          await refreshStaffData();
        } catch (error) {
          if (classMessage) {
            classMessage.textContent = error.message;
          }
        }
      });
      article.append(form);

      classList.append(article);
    }
  }

  async function loadClasses() {
    classes = await fetchJson('/api/classes');
    renderClasses();
  }

  async function refreshStaffData() {
    const loggedIn = authUser && (authUser.role === 'teacher' || authUser.role === 'admin');
    if (!loggedIn) return;
    await Promise.all([loadFolders(), loadBooks(), loadSummary()]);
    await loadStudents();
    await loadClasses();
    await loadHistory();
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      loginMessage.textContent = 'Vul je gebruikersnaam en wachtwoord in.';
      return;
    }
    try {
      const result = await fetchJson('/api/login', {
        method: 'POST',
        body: { username, password },
      });
      if (!['teacher', 'admin'].includes(result.user.role)) {
        clearAuth({ silent: true });
        loginMessage.textContent = 'Gebruik de leerlingenpagina om in te loggen.';
        return;
      }
      setAuth(result.token);
      await reloadCurrentUser(['teacher', 'admin']);
      loginForm.reset();
      loginMessage.textContent = `Welkom ${authUser.name}!`;
      await refreshStaffData();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton?.addEventListener('click', async () => {
    if (!authToken) return;
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (error) {
      // negeer
    }
    clearAuth();
    loginMessage.textContent = 'Je bent uitgelogd.';
  });

  folderFilter?.addEventListener('change', () => {
    filters.folder = folderFilter.value;
    renderBooks();
  });
  searchInput?.addEventListener('input', () => {
    filters.query = searchInput.value;
    renderBooks();
  });

  createClassForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser) return;
    const name = newClassNameInput.value.trim();
    if (!name) {
      if (classMessage) {
        classMessage.textContent = 'Geef een naam op voor de klas.';
      }
      return;
    }
    try {
      await fetchJson('/api/classes', {
        method: 'POST',
        body: { name },
      });
      newClassNameInput.value = '';
      if (classMessage) {
        classMessage.textContent = 'Nieuwe klas aangemaakt.';
      }
      await refreshStaffData();
    } catch (error) {
      if (classMessage) {
        classMessage.textContent = error.message;
      }
    }
  });

  classList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-student]');
    if (!button) return;
    const classId = button.dataset.classId;
    const studentId = button.dataset.studentId;
    if (!classId || !studentId) return;
    try {
      await fetchJson(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
      if (classMessage) {
        classMessage.textContent = 'Leerling verwijderd uit de klas.';
      }
      await refreshStaffData();
    } catch (error) {
      if (classMessage) {
        classMessage.textContent = error.message;
      }
    }
  });

  adminBookForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      adminBookMessage.textContent = 'Alleen beheerders kunnen boeken toevoegen.';
      return;
    }
    const payload = {
      title: adminBookTitle.value.trim(),
      author: adminBookAuthor.value.trim(),
      barcode: adminBookBarcode.value.trim(),
      folderId: adminFolderSelect.value || null,
      suitableForExamList: Boolean(adminBookExam.checked),
      description: adminBookDescription.value.trim(),
    };
    if (!payload.title || !payload.author || !payload.barcode) {
      adminBookMessage.textContent = 'Titel, auteur en barcode zijn verplicht.';
      return;
    }
    try {
      await fetchJson('/api/books', {
        method: 'POST',
        body: payload,
      });
      adminBookForm.reset();
      adminBookMessage.textContent = 'Boek opgeslagen in de bibliotheek.';
      await refreshStaffData();
    } catch (error) {
      adminBookMessage.textContent = error.message;
    }
  });

  studentImportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authUser || authUser.role !== 'admin') {
      studentImportMessage.textContent = 'Alleen beheerders kunnen leerlingen importeren.';
      return;
    }
    const file = studentImportFile?.files?.[0];
    if (!file) {
      studentImportMessage.textContent = 'Kies eerst een Excelbestand.';
      return;
    }
    try {
      const base64 = await readFileAsBase64(file);
      const result = await fetchJson('/api/students/import', {
        method: 'POST',
        body: { file: base64 },
      });
      studentImportFile.value = '';
      studentImportMessage.textContent = `Import gereed: ${result.created} toegevoegd, ${result.updated} bijgewerkt.`;
      if (studentImportResults) {
        studentImportResults.innerHTML = '';
        if (result.accounts?.length) {
          const list = document.createElement('ul');
          list.className = 'import-results__list';
          for (const account of result.accounts) {
            const li = document.createElement('li');
            li.innerHTML = `
              <strong>${account.name}</strong> – ${account.username}
              ${account.password ? `<span>Nieuw wachtwoord: ${account.password}</span>` : ''}
            `;
            list.append(li);
          }
          studentImportResults.append(list);
        }
        if (result.skipped?.length) {
          const skippedList = document.createElement('ul');
          skippedList.className = 'import-results__skipped';
          for (const entry of result.skipped) {
            const li = document.createElement('li');
            li.textContent = `${entry.name} (${entry.username}) – ${entry.reason}`;
            skippedList.append(li);
          }
          const skippedTitle = document.createElement('h4');
          skippedTitle.textContent = 'Overgeslagen regels';
          studentImportResults.append(skippedTitle, skippedList);
        }
      }
      await refreshStaffData();
    } catch (error) {
      studentImportMessage.textContent = error.message;
    }
  });

  renderStaffState();
  Promise.all([loadFolders(), loadBooks(), loadSummary()]).catch(() => {});
  if (authToken) {
    reloadCurrentUser(['teacher', 'admin'])
      .then(refreshStaffData)
      .catch(() => {
        clearAuth();
      });
  }
}

if (pageType === 'student') {
  initStudentPage();
} else if (pageType === 'staff') {
  initStaffPage();
}
