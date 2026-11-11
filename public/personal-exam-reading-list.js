(function personalExamList() {
  'use strict';

  const root = document.getElementById('student-exam-reading-list');
  if (!root) return;
  const feedback = document.getElementById('student-exam-reading-feedback');
  const summary = document.getElementById('student-exam-reading-summary');
  const section = document.getElementById('student-exam-reading-section');
  const addTrigger = document.getElementById('student-exam-add-trigger');
  const addDialog = document.getElementById('student-exam-add-dialog');
  const addForm = document.getElementById('student-exam-add-form');
  const addFeedback = document.getElementById('student-exam-add-feedback');
  const addSave = document.getElementById('student-exam-add-save');
  let requestSequence = 0;
  let working = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function apiUrl(route) {
    if (typeof window.BoekenbaaiResolveApiUrl === 'function') {
      return window.BoekenbaaiResolveApiUrl(route);
    }
    const base = String(window.BOEKENBAAI_API_BASE ||
      document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
    return base ? base.replace(/\/$/, '') + route : route;
  }

  async function api(path, options = {}) {
    const token = window.localStorage.getItem('boekenbaai_token');
    const response = await fetch(apiUrl(path), {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(token && token !== 'cookie' ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'De leeslijst kon niet worden bijgewerkt.');
    return data;
  }

  function statusText(value) {
    return ({
      nog_lezen: 'Nog lezen',
      aan_het_lezen: 'Aan het lezen',
      gelezen: 'Gelezen',
    })[value] || 'Nog lezen';
  }

  function render(data) {
    root.replaceChildren();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    summary.textContent = '';
    if (section) section.hidden = entries.length === 0;
    if (!entries.length) return;
    for (const item of entries) {
      const row = el('article', 'exam-reading__row');
      const info = el('div', 'exam-reading__info');
      info.append(el('strong', '', item.title));
      const metadata = (item.externalSource
        ? [item.author, item.genre || '', item.isbn ? 'ISBN ' + item.isbn : '']
        : [item.author, item.isbn ? 'ISBN ' + item.isbn : '',
          item.suitableForExamList ? 'Gemarkeerd als examenmateriaal' : 'Niet als examenmateriaal gemarkeerd'])
        .filter(Boolean).join(' · ');
      info.append(el('span', 'hint', metadata));
      if (item.externalSource) info.append(el('span', 'hint', 'Eigen boek, geschiktheid nog niet gecontroleerd'));
      info.append(el('span', 'bb-profile-status' + (item.status === 'gelezen' ? ' bb-profile-status--read' : ''), statusText(item.status)));
      if (item.readFromReturn) {
        info.append(el('span', 'exam-reading__read', 'Gelezen, bevestigd bij inleveren'));
      } else if (item.status === 'gelezen') {
        info.append(el('span', 'exam-reading__read', 'Gelezen, zelf geregistreerd'));
      }
      const actions = el('div', 'exam-reading__actions');
      const label = el('label', '', 'Voortgang');
      const select = el('select');
      for (const value of ['nog_lezen', 'aan_het_lezen', 'gelezen']) {
        const option = el('option', '', statusText(value));
        option.value = value;
        select.append(option);
      }
      select.value = item.readFromReturn ? 'gelezen' : (item.manualStatus || 'nog_lezen');
      if (item.readFromReturn) {
        select.disabled = true;
        label.title = 'Wijzig een bevestigd leesantwoord bij Laatst geleende boeken.';
      }
      label.append(select);
      const save = el('button', 'btn btn--secondary', 'Opslaan');
      save.type = 'button';
      save.disabled = true;
      select.addEventListener('change', () => {
        save.disabled = select.value === item.manualStatus;
      });
      const remove = el('button', 'btn btn--ghost', 'Verwijderen');
      remove.type = 'button';
      const message = el('p', 'hint');
      message.setAttribute('role', 'status');
      save.addEventListener('click', async () => {
        save.disabled = true;
        select.disabled = true;
        message.textContent = 'Opslaan…';
        try {
          await api('/api/exam-reading-list/' + encodeURIComponent(item.id), {
            method: 'PATCH',
            body: JSON.stringify({ status: select.value, revision: item.revision }),
          });
          await refresh();
        } catch (error) {
          feedback.textContent = error.message;
          select.disabled = Boolean(item.readFromReturn);
          await refresh();
        }
      });
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        message.textContent = 'Verwijderen…';
        try {
          await api('/api/exam-reading-list/' + encodeURIComponent(item.id), {
            method: 'DELETE',
            body: JSON.stringify({ revision: item.revision }),
          });
          await refresh();
        } catch (error) {
          feedback.textContent = error.message;
          remove.disabled = false;
        }
      });
      actions.append(label, save, remove, message);
      row.append(info, actions);
      root.append(row);
    }
  }

  async function refresh() {
    const sequence = ++requestSequence;
    const tokenAtStart = window.localStorage.getItem('boekenbaai_token');
    if (!tokenAtStart) {
      root.replaceChildren();
      summary.textContent = '';
      feedback.textContent = '';
      return;
    }
    if (working) return;
    root.replaceChildren(el('p', 'hint', 'Examenleeslijst laden…'));
    try {
      const result = await api('/api/exam-reading-list');
      if (sequence !== requestSequence ||
          tokenAtStart !== window.localStorage.getItem('boekenbaai_token')) return;
      render(result);
    } catch (error) {
      if (sequence !== requestSequence ||
          tokenAtStart !== window.localStorage.getItem('boekenbaai_token')) return;
      root.replaceChildren(el('p', 'hint', error.message));
      summary.textContent = '';
      if (section) section.hidden = true;
    }
  }

  async function addBook(bookId) {
    if (working || !bookId) return;
    working = true;
    const sequence = requestSequence;
    const tokenAtStart = window.localStorage.getItem('boekenbaai_token');
    feedback.textContent = 'Toevoegen…';
    try {
      const result = await api('/api/exam-reading-list', {
        method: 'POST', body: JSON.stringify({ bookId }),
      });
      if (sequence !== requestSequence ||
          tokenAtStart !== window.localStorage.getItem('boekenbaai_token')) return;
      feedback.textContent = result.created
        ? 'Boek toegevoegd aan je examenleeslijst.'
        : 'Dit boek staat al op je examenleeslijst.';
    } catch (error) {
      feedback.textContent = error.message;
      throw error;
    } finally {
      working = false;
      await refresh();
    }
  }

  // Personal books never create school stock or circulation transactions.
  addTrigger?.addEventListener('click', () => {
    addFeedback.textContent = '';
    addDialog.showModal();
    document.getElementById('student-exam-add-title')?.focus();
  });
  document.getElementById('student-exam-add-cancel')?.addEventListener('click', () => addDialog.close());
  addForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (working) return;
    const value = id => document.getElementById('student-exam-add-'+id)?.value || '';
    working = true;
    const sequence = requestSequence;
    const tokenAtStart = window.localStorage.getItem('boekenbaai_token');
    addSave.disabled = true;
    addFeedback.textContent = 'Boek toevoegen…';
    try {
      const result = await api('/api/exam-reading-list', {
        method:'POST',
        body:JSON.stringify({ externalBook:{
          title:value('title'), author:value('author'), isbn:value('isbn'),
          pageCount:value('pages'), genre:value('genre'),
        }}),
      });
      if (sequence !== requestSequence ||
          tokenAtStart !== window.localStorage.getItem('boekenbaai_token')) return;
      addDialog.close();
      addForm.reset();
      working = false;
      feedback.textContent = result.created ? 'Eigen examenboek toegevoegd.' : 'Dit boek staat al op je lijst.';
      await refresh();
    } catch (error) {
      if (sequence === requestSequence &&
          tokenAtStart === window.localStorage.getItem('boekenbaai_token')) addFeedback.textContent = error.message;
    } finally {
      working = false;
      addSave.disabled = false;
    }
  });
  window.BoekenbaaiExamList = { addBook, refresh };
  for (const eventName of [
    'boekenbaai:student-auth-validated',
    'boekenbaai:reading-record-created',
    'boekenbaai:reading-record-updated',
    'pageshow',
  ]) window.addEventListener(eventName, refresh);
  for (const eventName of ['boekenbaai:student-auth-pending',
    'boekenbaai:staff-auth-cleared']) {
    window.addEventListener(eventName, () => {
      requestSequence++;
      root.replaceChildren();
      summary.textContent = '';
      feedback.textContent = '';
      if (section) section.hidden = true;
      if (addDialog?.open) addDialog.close();
      addForm?.reset();
    });
  }
  refresh();
})();
