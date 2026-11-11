(function bookChoiceHelper() {
  'use strict';
  const button = document.getElementById('student-help-choose');
  const dialog = document.getElementById('student-choice-dialog');
  if (!button || !dialog) return;
  const closeButton = document.getElementById('student-choice-close');
  const clearButton = document.getElementById('student-choice-clear');
  const searchButton = document.getElementById('student-choice-search');
  const themeArea = document.getElementById('student-choice-themes');
  const lengthInput = document.getElementById('student-choice-pages');
  const easyInput = document.getElementById('student-choice-easy');
  const examInput = document.getElementById('student-choice-exam');
  const availableInput = document.getElementById('student-choice-available');
  const results = document.getElementById('student-choice-results');
  const status = document.getElementById('student-choice-status');
  let editions = [];
  let loadVersion = 0;
  let active = false;
  let previousFocus = null;
  let handoffToDetail = false;

  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  const normalized = text => String(text || '').trim().toLocaleLowerCase('nl-NL');
  function apiUrl(route) {
    if (typeof window.BoekenbaaiResolveApiUrl === 'function') {
      return window.BoekenbaaiResolveApiUrl(route);
    }
    const base = String(window.BOEKENBAAI_API_BASE ||
      document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
    return base ? base.replace(/\/$/, '') + route : route;
  }
  function mergeCopies(books) {
    const map = new Map();
    for (const book of books) {
      if (!book?.id || !book.title) continue;
      const key = JSON.stringify([
        normalized(book.title), normalized(book.author), normalized(book.editionIsbn || book.metadataIsbn),
      ]);
      let item = map.get(key);
      if (!item) {
        item = {
          key, title: book.title, author: book.author || '',
          pages: null, easyReading: false, suitableForExamList: false,
          themeSet: new Set(), copies: [], coverUrl: '', coverCrop: null,
          borrowed: 0, available: 0, popularity: 0,
        };
        map.set(key, item);
      }
      item.copies.push(book);
      item.available += book.status === 'available' ? 1 : 0;
      item.borrowed += book.status === 'borrowed' ? 1 : 0;
      item.popularity += Number(book.borrowCount) || 0;
      item.easyReading ||= book.easyReading === true;
      item.suitableForExamList ||= book.suitableForExamList === true;
      const count = Number(book.pageCount || book.pages);
      if (Number.isFinite(count) && count > 0 && !item.pages) item.pages = count;
      // The API's themes already incorporate manual curator corrections.
      // Raw source tags must never re-add manually cleared themes.
      for (const theme of (Array.isArray(book.themes) ? book.themes : [])) {
        if (typeof theme === 'string' && theme.trim()) item.themeSet.add(theme.trim());
      }
      if (!item.coverUrl && (book.localCoverUrl || book.coverUrl)) {
        item.coverUrl = book.localCoverUrl || book.coverUrl;
        item.coverCrop = book.coverCrop || null;
      }
    }
    return [...map.values()].map(item => ({
      ...item, themes: [...item.themeSet], total: item.copies.length,
    }));
  }
  function availableThemes() {
    const counts = new Map();
    for (const book of editions) {
      for (const theme of book.themes) {
        const key = normalized(theme);
        if (!key || ['examenleeslijst','makkelijk lezen'].includes(key)) continue;
        const item = counts.get(key) || { key, label: theme, count: 0 };
        item.count++;
        counts.set(key, item);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count ||
      a.label.localeCompare(b.label, 'nl')).slice(0, 16);
  }
  function checkedThemes() {
    return [...themeArea.querySelectorAll('input[type="checkbox"]:checked')]
      .map(input => input.value);
  }
  function renderThemes() {
    const selected = new Set(checkedThemes());
    const themes = availableThemes();
    themeArea.replaceChildren();
    if (!themes.length) {
      themeArea.append(make('p', 'hint', 'Er zijn nog geen thema’s bij de boeken opgeslagen.'));
      return;
    }
    for (const theme of themes) {
      const label = make('label', 'bb-choice__theme');
      const input = make('input');
      input.type = 'checkbox';
      input.value = theme.key;
      input.checked = selected.has(theme.key);
      label.append(input, document.createTextNode(theme.label));
      themeArea.append(label);
    }
  }
  async function fetchCurrentBooks() {
    const response = await fetch(apiUrl('/api/books'), {
      credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw Error('De actuele bibliotheek kon niet worden geladen.');
    const body = await response.json();
    if (!Array.isArray(body)) throw Error('De catalogusgegevens zijn niet beschikbaar.');
    // Keep the response local. A stale request from a closed dialog may
    // otherwise overwrite the current session's recommendations.
    return mergeCopies(body);
  }
  function matches(book, selectedThemes, maxPages, onlyEasy, onlyExam, onlyAvailable) {
    if (onlyAvailable && !book.available) return false;
    if (onlyEasy && !book.easyReading) return false;
    if (onlyExam && !book.suitableForExamList) return false;
    if (maxPages && (!book.pages || book.pages > maxPages)) return false;
    if (selectedThemes.length && !selectedThemes.some(theme =>
      book.themes.some(item => normalized(item) === theme))) return false;
    return true;
  }
  function explanation(book, chosen) {
    const reasons = [];
    const matching = book.themes.filter(tag => chosen.themes.includes(normalized(tag)));
    if (matching.length) reasons.push('Thema: ' + matching.slice(0, 2).join(', '));
    if (chosen.maxPages) reasons.push(book.pages + ' pagina’s');
    if (chosen.easy) reasons.push('Makkelijk Lezen');
    if (chosen.exam) reasons.push('Gemarkeerd als examenmateriaal');
    return reasons.join(' · ') || 'Beschikbaar in de bibliotheek';
  }
  function coverUrl(value) {
    const url = String(value || '').trim();
    return /^\\/api\\/covers\\/[a-f0-9]{64}\\.(?:jpg|png|webp|gif)$/i.test(url)
      ? apiUrl(url) : url;
  }
  function renderSuggestions() {
    const chosen = {
      themes: checkedThemes(),
      maxPages: Number(lengthInput.value) || 0,
      easy: easyInput.checked,
      exam: examInput.checked,
      available: availableInput.checked,
    };
    const ranked = editions.filter(book => matches(book, chosen.themes, chosen.maxPages,
      chosen.easy, chosen.exam, chosen.available))
      .map(book => ({
        book,
        score: book.themes.filter(tag => chosen.themes.includes(normalized(tag))).length * 10
          + (book.available ? 2 : 0) + Math.min(book.popularity, 20) * 0.01,
      }))
      .sort((a,b) => b.score - a.score ||
        a.book.title.localeCompare(b.book.title,'nl')).slice(0, 6);

    results.replaceChildren();
    if (!editions.length) {
      status.textContent = 'Er staan nog geen boeken in de bibliotheek.';
    } else if (!ranked.length) {
      status.textContent = 'Geen boeken gevonden die aan al je keuzes voldoen. Pas je voorkeuren aan of kies Alles wissen.';
    } else {
      status.textContent = ranked.length + ' ' + (ranked.length === 1 ? 'voorstel' : 'voorstellen')
        + ' uit de actuele bibliotheek. Je kunt je keuzes hierboven aanpassen.';
    }
    for (const { book } of ranked) {
      const card = make('article', 'bb-choice__result');
      const art = make('div', 'bb-choice__cover');
      const label = make('span', 'bb-choice__cover-fallback', 'Geen omslag');
      art.append(label);
      if (book.coverUrl) {
        const image = make('img');
        image.alt = 'Omslag van ' + book.title;
        image.loading = 'lazy';
        image.onerror = () => { image.remove(); label.hidden = false; };
        image.onload = () => { label.hidden = true; };
        image.src = coverUrl(book.coverUrl);
        art.prepend(image);
      }
      const content = make('div', 'bb-choice__result-content');
      content.append(make('strong', '', book.title));
      content.append(make('span', 'hint', book.author || 'Auteur onbekend'));
      content.append(make('p', 'bb-choice__reason', explanation(book, chosen)));
      content.append(make('span', book.available ? 'bb-choice__available' : 'bb-choice__unavailable',
        book.available ? book.available + ' van ' + book.total + ' beschikbaar'
          : 'Momenteel niet beschikbaar'));
      const open = make('button', 'btn btn--secondary', 'Bekijk boek');
      open.type = 'button';
      open.addEventListener('click', async () => {
        open.disabled = true;
        try {
          // Refresh the entire catalogue, not an old suggestion snapshot,
          // before the existing book-detail view checks physical stock.
          const latest = await fetchCurrentBooks();
          const current = latest.find(item => item.key === book.key);
          if (!current) throw Error('Dit boek staat niet meer in de bibliotheek.');
          if (typeof window.BoekenbaaiOpenBookDetail !== 'function') {
            throw Error('De boekdetails zijn nog niet geladen.');
          }
          const copy = current.copies.find(item => item.status === 'available') ||
            current.copies[0];
          // The catalogue may have loaded before a return. Pass the whole
          // freshly fetched group, so available copies and student actions
          // cannot be replaced by stale groupedBooks from the main catalogue.
          const freshGroup = {
            id: current.key, title: current.title, author: current.author,
            representativeBook: copy, copies: current.copies,
            totalCopies: current.total, availableCopies: current.available,
            borrowedCopies: current.borrowed, themes: current.themes,
            easyReading: current.easyReading,
            suitableForExamList: current.suitableForExamList,
            metadataIsbn: copy.metadataIsbn || null,
            coverUrl: current.coverUrl,
          };
          close(true);
          await window.BoekenbaaiOpenBookDetail(freshGroup);
        } catch (error) {
          status.textContent = error.message;
          open.disabled = false;
          renderThemes();
        }
      });
      content.append(open);
      card.append(art, content);
      results.append(card);
    }
  }
  function clear() {
    themeArea.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.checked = false;
    });
    lengthInput.value = '0';
    easyInput.checked = false;
    examInput.checked = false;
    availableInput.checked = true;
    results.replaceChildren();
    status.textContent = 'Je voorkeuren zijn gewist. Kies opnieuw of bekijk beschikbare boeken.';
  }
  function close(toDetail = false) {
    handoffToDetail = toDetail;
    if (dialog.open) dialog.close();
    active = false;
  }
  async function open() {
    if (active) return;
    active = true;
    previousFocus = document.activeElement;
    dialog.showModal();
    status.textContent = 'Boeken ophalen…';
    results.replaceChildren();
    searchButton.disabled = true;
    const request = ++loadVersion;
    try {
      const current = await fetchCurrentBooks();
      if (request !== loadVersion || !active) return;
      editions = current;
      renderThemes();
      status.textContent = editions.length
        ? 'Kies waar je naar op zoek bent. Meerdere thema’s kunnen samen.'
        : 'Er staan nog geen boeken in de bibliotheek.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      searchButton.disabled = false;
      if (active) themeArea.querySelector('input')?.focus();
    }
  }
  button.disabled = false;
  button.removeAttribute('aria-describedby');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'student-choice-dialog');
  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    active = false;
    if (!handoffToDetail) previousFocus?.focus?.();
    handoffToDetail = false;
  });
  searchButton.addEventListener('click', renderSuggestions);
  clearButton.addEventListener('click', clear);
})();
