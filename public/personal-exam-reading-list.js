(function personalExamList() {
  'use strict';

  const root = document.getElementById('student-exam-reading-list');
  if (!root) return;
  const feedback = document.getElementById('student-exam-reading-feedback');
  const summary = document.getElementById('student-exam-reading-summary');
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
    const actualRead = Number(data.statistics?.readBooks || 0);
    summary.textContent = entries.length + ' ' +
      (entries.length === 1 ? 'boek' : 'boeken') + ' op je lijst. ' +
      actualRead + ' verschillende boeken bevestigd uitgelezen bij inleveren.';
    if (!entries.length) {
      root.append(el('p', 'hint', 'Je examenleeslijst is nog leeg. Open een boek in de bibliotheek en kies ‘Op examenleeslijst’.'));
      return;
    }
    for (const item of entries) {
      const row = el('article', 'exam-reading__row');
      const info = el('div', 'exam-reading__info');
      info.append(el('strong', '', item.title));
      const metadata = [item.author, item.isbn ? 'ISBN ' + item.isbn : '',
        item.suitableForExamList ? 'Gemarkeerd als examenmateriaal' : 'Niet als examenmateriaal gemarkeerd']
        .filter(Boolean).join(' · ');
      info.append(el('span', 'hint', metadata));
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
      select.value = item.manualStatus || 'nog_lezen';
      if (item.readFromReturn) {
        select.disabled = true;
        label.title = 'Wijzig een bevestigd leesantwoord bij Mijn leesregistraties.';
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
          message.textContent = error.message;
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
          message.textContent = error.message;
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
    if (!window.localStorage.getItem('boekenbaai_token')) {
      root.replaceChildren();
      summary.textContent = '';
      feedback.textContent = '';
      return;
    }
    if (working) return;
    root.replaceChildren(el('p', 'hint', 'Examenleeslijst laden…'));
    try {
      const result = await api('/api/exam-reading-list');
      if (sequence !== requestSequence) return;
      render(result);
    } catch (error) {
      if (sequence !== requestSequence) return;
      root.replaceChildren(el('p', 'hint', error.message));
      summary.textContent = '';
    }
  }

  async function addBook(bookId) {
    if (working || !bookId) return;
    working = true;
    feedback.textContent = 'Toevoegen…';
    try {
      const result = await api('/api/exam-reading-list', {
        method: 'POST', body: JSON.stringify({ bookId }),
      });
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
    });
  }
  refresh();
})();
