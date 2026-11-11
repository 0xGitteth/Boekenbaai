(function studentReadingProfile() {
  'use strict';
  const recentRoot = document.getElementById('student-recent-books');
  const historyOpen = document.getElementById('student-history-open');
  const historyDialog = document.getElementById('student-reading-history-dialog');
  const historyClose = document.getElementById('student-history-close');
  const historyRoot = document.getElementById('student-history-entries');
  const historyMore = document.getElementById('student-history-more');
  const historyTab = document.getElementById('student-history-tab');
  const statsTab = document.getElementById('student-statistics-tab');
  const historyPanel = document.getElementById('student-history-panel');
  const statsPanel = document.getElementById('student-statistics-panel');
  const statsRoot = document.getElementById('student-reading-statistics');
  const editDialog = document.getElementById('student-reading-edit-dialog');
  const editForm = document.getElementById('student-reading-edit-form');
  const editTitle = document.getElementById('student-reading-edit-title');
  const editStatus = document.getElementById('student-reading-edit-status');
  const editSave = document.getElementById('student-reading-edit-save');
  const editFeedback = document.getElementById('student-reading-edit-feedback');
  if (!recentRoot || !historyDialog || !editDialog) return;

  let studentId = '';
  let generation = 0;
  let data = null;
  let history = [];
  let nextPage = null;
  let pending = false;
  let editing = null;

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  function route(path) {
    return typeof window.BoekenbaaiResolveApiUrl === 'function'
      ? window.BoekenbaaiResolveApiUrl(path)
      : String(window.BOEKENBAAI_API_BASE || '').replace(/\/$/, '') + path;
  }
  async function get(path, options = {}) {
    const token = window.localStorage.getItem('boekenbaai_token');
    const response = await fetch(route(path), {
      credentials:'same-origin', ...options,
      headers: {
        Accept:'application/json',
        ...(token && token !== 'cookie' ? { Authorization:'Bearer '+token } : {}),
        ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {}),
      },
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(content.message || 'Leesgegevens konden niet worden geladen.');
    return content;
  }
  function fmt(date) {
    if (!date) return '';
    const d = new Date(date);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString('nl-NL') : '';
  }
  function status(entry) {
    if (entry.kind === 'current') return ['Nog geleend', ''];
    if (entry.kind === 'legacy') return ['Niet geregistreerd', ''];
    return entry.finished ? ['Uitgelezen', 'read'] : ['Niet uitgelezen', 'unread'];
  }
  function renderBook(entry) {
    const editable = Boolean(entry.recordId);
    const row = make(editable ? 'button' : 'div', 'bb-profile-book-card');
    if (editable) {
      row.type = 'button';
      row.setAttribute('aria-label', entry.title + ', ' + status(entry)[0] + '. Leesstatus aanpassen');
      row.addEventListener('click', () => edit(entry));
    }
    const cover = entry.coverUrl
      ? make('img', 'bb-profile-book-cover')
      : make('div', 'bb-profile-book-cover bb-profile-book-cover--fallback', 'BOEK');
    if (entry.coverUrl) {
      cover.src = entry.coverUrl; cover.alt = ''; cover.loading = 'lazy';
      cover.addEventListener('error', () => {
        cover.replaceWith(make('div', 'bb-profile-book-cover bb-profile-book-cover--fallback', 'BOEK'));
      }, { once: true });
    }
    const copy = make('span', 'bb-profile-book-copy');
    copy.append(make('strong', '', entry.title || 'Onbekend boek'));
    const detail = [entry.author || '', fmt(entry.borrowedAt || entry.returnedAt)].filter(Boolean).join(' · ');
    if (detail) copy.append(make('small', '', detail));
    const [label, tone] = status(entry);
    copy.append(make('span', 'bb-profile-status' + (tone ? ' bb-profile-status--'+tone : ''), label));
    if (entry.edited) copy.append(make('small', '', 'Leesstatus achteraf aangepast'));
    row.append(cover, copy);
    return row;
  }
  function showTab(type) {
    const stats = type === 'stats';
    historyTab.setAttribute('aria-selected', String(!stats));
    statsTab.setAttribute('aria-selected', String(stats));
    historyPanel.hidden = stats;
    statsPanel.hidden = !stats;
  }
  function renderStats() {
    statsRoot.replaceChildren();
    if (!data) return;
    const s = data.statistics || {};
    const grid = make('div', 'bb-profile-stat-grid');
    const metric = (value, label) => {
      const box = make('div', 'bb-profile-stat');
      box.append(make('strong', '', value), make('span', '', label));
      grid.append(box);
    };
    metric(s.registeredLoanPeriods ?? 0, 'Geregistreerde leenperiodes');
    metric(s.readTitles ?? 0, 'Verschillende boeken uitgelezen');
    metric(s.readPagesKnown ?? 0, 'Bekende gelezen pagina’s');
    metric(s.weekdaysWithLoans ?? 0, 'Weekdagen met een geleend boek');
    statsRoot.append(grid);
    if (s.topGenres?.length) {
      statsRoot.append(make('h3', '', 'Meest gelezen genres'));
      const list = make('ol', 'bb-profile-stat-genres');
      for (const genre of s.topGenres) {
        const li = make('li');
        li.append(make('span', '', genre.name), make('strong', '', genre.count + '×'));
        list.append(li);
      }
      statsRoot.append(list);
    } else {
      statsRoot.append(make('p', 'hint', 'Nog onvoldoende genregegevens beschikbaar.'));
    }
    const missing = Number(s.booksMissingPageCount || 0);
    statsRoot.append(make('p', 'bb-profile-stat-note',
      (missing ? 'Van ' + missing + ' uitgelezen boek(en) is het aantal pagina’s onbekend. ' : '') +
      (s.selfReportedExternalReadTitles ? s.selfReportedExternalReadTitles + ' zelf als uitgelezen geregistreerde eigen examenboek(en) zijn meegeteld. ' : '') +
      'Weekdagen zijn maandag tot en met vrijdag; vakanties en feestdagen worden niet apart afgetrokken. ' +
      'De geschiedenis bevat de gegevens die Boekenbaai heeft opgeslagen. Oudere uitleningen van vóór de registratie kunnen ontbreken.'));
  }
  function renderHistory() {
    historyRoot.replaceChildren();
    if (!history.length) historyRoot.append(make('p','hint','Er zijn nog geen geregistreerde uitleningen.'));
    else for (const entry of history) historyRoot.append(renderBook(entry));
    historyMore.hidden = nextPage === null;
  }
  function renderRecent() {
    recentRoot.replaceChildren();
    const recent = Array.isArray(data?.recent) ? data.recent : [];
    if (!recent.length) recentRoot.append(make('p', 'hint', 'Je hebt nog geen boeken geleend.'));
    else for (const entry of recent) recentRoot.append(renderBook(entry));
    historyOpen.hidden = !recent.length;
    renderStats();
    renderHistory();
  }
  async function refresh() {
    if (!studentId) return;
    const serial = ++generation;
    const owner = studentId;
    try {
      const result = await get('/api/me/reading-profile');
      if (serial !== generation || studentId !== owner) return;
      data = result;
      history = result.history || [];
      nextPage = result.nextPage;
      renderRecent();
    } catch (error) {
      if (serial !== generation || studentId !== owner) return;
      recentRoot.replaceChildren(make('p', 'hint', error.message));
      historyOpen.hidden = true;
    }
  }
  async function more() {
    if (pending || nextPage === null || !studentId) return;
    const serial = generation;
    const owner = studentId;
    pending = true;
    historyMore.disabled = true;
    try {
      const result = await get('/api/me/reading-profile?page=' + nextPage);
      if (serial !== generation || owner !== studentId) return;
      history.push(...(result.history || []));
      nextPage = result.nextPage;
      renderHistory();
    } catch (error) {
      if (serial === generation) historyRoot.append(make('p', 'hint', error.message));
    } finally {
      pending = false;
      historyMore.disabled = false;
    }
  }
  function edit(entry) {
    if (!entry.recordId || !studentId) return;
    editing = entry;
    editTitle.textContent = entry.title || 'Onbekend boek';
    editStatus.value = String(Boolean(entry.finished));
    editFeedback.textContent = entry.edited
      ? 'Dit antwoord is eerder aangepast. De wijzigingsgeschiedenis blijft bewaard.' : '';
    editSave.disabled = false;
    editDialog.showModal();
    editStatus.focus();
  }
  editForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editing || !studentId || editSave.disabled) return;
    editSave.disabled = true;
    const entry = editing;
    const owner = studentId;
    editFeedback.textContent = 'Wijziging opslaan…';
    try {
      const result = await get('/api/reading-records/' + encodeURIComponent(entry.recordId), {
        method:'PATCH', body: JSON.stringify({
          revision: entry.revision, finished: editStatus.value === 'true',
        }),
      });
      if (owner !== studentId) return;
      editDialog.close();
      editing = null;
      window.dispatchEvent(new CustomEvent('boekenbaai:reading-record-updated', {
        detail:{ source:'profile-reading', recordId:result.record?.id },
      }));
      await refresh();
    } catch (error) {
      if (owner === studentId) editFeedback.textContent = error.message;
    } finally {
      editSave.disabled = false;
    }
  });
  document.getElementById('student-reading-edit-cancel').addEventListener('click', () => editDialog.close());
  editDialog.addEventListener('close', () => { editing = null; editFeedback.textContent = ''; });
  historyOpen.addEventListener('click', () => {
    if (!studentId) return;
    showTab('history');
    historyDialog.showModal();
  });
  historyClose.addEventListener('click', () => historyDialog.close());
  historyTab.addEventListener('click', () => showTab('history'));
  statsTab.addEventListener('click', () => showTab('stats'));
  historyMore.addEventListener('click', more);
  function clear() {
    generation++; studentId = ''; data = null; history = []; nextPage = null; editing = null;
    recentRoot.replaceChildren();
    historyRoot.replaceChildren();
    statsRoot.replaceChildren();
    historyOpen.hidden = true; historyMore.hidden = true;
    if (editDialog.open) editDialog.close();
    if (historyDialog.open) historyDialog.close();
  }
  window.addEventListener('boekenbaai:student-auth-validated', event => {
    const nextId = String(event.detail?.studentId || '');
    if (!nextId) return;
    if (nextId !== studentId) clear();
    studentId = nextId;
    refresh();
  });
  window.addEventListener('boekenbaai:student-auth-pending', clear);
  window.addEventListener('boekenbaai:staff-auth-cleared', clear);
  window.addEventListener('boekenbaai:reading-record-created', refresh);
  window.addEventListener('boekenbaai:reading-record-updated', refresh);
  window.addEventListener('pageshow', refresh);
})();
