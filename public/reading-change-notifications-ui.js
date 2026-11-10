'use strict';

// Informational teacher inbox, not a review/approval queue.
const panel = document.getElementById('staff-reading-change-notifications');
if (panel) {
  const list = document.getElementById('staff-reading-alerts-list');
  const message = document.getElementById('staff-reading-alerts-message');
  const badge = document.getElementById('staff-reading-alerts-count');
  const refreshButton = document.getElementById('staff-reading-alerts-refresh');
  const moreButton = document.getElementById('staff-reading-alerts-more');
  const configuredBase = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const apiBase = (window.BOEKENBAAI_API_BASE || configuredBase
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const apiUrl = route => apiBase ? apiBase.replace(/\/$/, '') + route : route;
  let serial = 0;
  let loaded = [];
  let nextPage = null;
  let loading = false;
  const pageSize = 50;

  function teacherActive() {
    return !document.getElementById('teacher-dashboard')?.classList.contains('hidden')
      && document.getElementById('admin-dashboard')?.classList.contains('hidden');
  }

  async function request(route, method = 'GET') {
    const token = window.localStorage.getItem('boekenbaai_token');
    const response = await fetch(apiUrl(route), {
      method, credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(token && token !== 'cookie' ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.message || 'Meldingen konden niet worden geladen.');
    return payload;
  }

  function make(tag, text, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear() {
    ++serial;
    loaded = [];
    nextPage = null;
    loading = false;
    list.replaceChildren();
    badge.hidden = true;
    badge.textContent = '';
    moreButton.hidden = true;
    message.textContent = '';
  }

  function render(unreadCount) {
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;
    list.replaceChildren();
    if (!loaded.length) {
      list.append(make('p', 'Er zijn geen wijzigingen gemeld.', 'hint'));
    }
    for (const notice of loaded) {
      const row = make('article', undefined, 'bb-reading-alerts__item');
      if (!notice.readAt) row.classList.add('bb-reading-alerts__item--unread');
      const content = make('div', undefined, 'bb-reading-alerts__text');
      const before = notice.previous ? 'Ja' : 'Nee';
      const after = notice.updated ? 'Ja' : 'Nee';
      content.append(make('strong', notice.studentName + ' heeft een leesantwoord gewijzigd'));
      content.append(make('p',
        'Boek: ' + notice.title + '. Van ' + before + ' naar ' + after + '.',
        'bb-reading-alerts__detail'));
      if (notice.changedAt) {
        const date = new Date(notice.changedAt);
        if (Number.isFinite(date.getTime())) {
          content.append(make('span',
            date.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }), 'hint'));
        }
      }
      const status = make('div', undefined, 'bb-reading-alerts__status');
      if (notice.readAt) {
        status.append(make('span', 'Gelezen', 'bb-reading-alerts__read'));
      } else {
        const read = make('button', 'Markeer als gelezen', 'btn btn--secondary');
        read.type = 'button';
        read.addEventListener('click', async () => {
          read.disabled = true;
          message.textContent = '';
          try {
            await request('/api/staff/reading-change-notifications/' +
              encodeURIComponent(notice.id) + '/read', 'POST');
            // The server stores one read receipt per teacher. There is
            // no approval/rejection operation and no outstanding task.
            await refresh();
          } catch (error) {
            message.textContent = error.message;
            read.disabled = false;
          }
        });
        status.append(read);
      }
      row.append(content, status);
      list.append(row);
    }
    moreButton.hidden = nextPage === null;
  }

  async function loadPage(page, generation) {
    // A fresh page-0 refresh must be allowed to supersede an in-flight
    // earlier response (e.g. after logging into another teacher account).
    if (page > 0 && loading) return;
    loading = true;
    refreshButton.disabled = true;
    moreButton.disabled = true;
    try {
      const payload = await request('/api/staff/reading-change-notifications?page=' + page);
      if (generation !== serial || !teacherActive()) return;
      loaded = page === 0 ? payload.notifications : loaded.concat(payload.notifications);
      nextPage = Number.isInteger(payload.nextPage) ? payload.nextPage : null;
      render(payload.unreadCount || 0);
      message.textContent = '';
    } catch (error) {
      if (generation !== serial || !teacherActive()) return;
      if (page === 0) list.replaceChildren();
      message.textContent = error.message;
    } finally {
      if (generation === serial) {
        loading = false;
        refreshButton.disabled = false;
        moreButton.disabled = false;
      }
    }
  }

  async function refresh() {
    if (!teacherActive()) return;
    const generation = ++serial;
    loaded = [];
    nextPage = null;
    await loadPage(0, generation);
  }

  refreshButton.addEventListener('click', refresh);
  moreButton.addEventListener('click', () => {
    if (nextPage !== null) void loadPage(nextPage, serial);
  });
  window.addEventListener('boekenbaai:staff-auth-cleared', clear);
  window.addEventListener('boekenbaai:staff-refresh', refresh);
  window.addEventListener('boekenbaai:reading-alerts-refresh', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  // On an already-restored staff session the initial refresh event may have
  // occurred before this module executed.
  if (window.localStorage.getItem('boekenbaai_token')) void refresh();
}
