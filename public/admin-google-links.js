(() => {
  'use strict';

  let renderBusy = false;
  let renderTimer = null;
  let installed = false;

  function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    if (options.id) element.id = options.id;
    return element;
  }

  async function api(url, options = {}) {
    const config = { method: 'GET', credentials: 'same-origin', ...options };
    config.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && typeof options.body !== 'string') {
      config.body = JSON.stringify(options.body);
      config.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, config);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) throw new Error(payload?.message || `Actie mislukt (${response.status})`);
    return payload;
  }

  function removeStandaloneTeacherLinkPanels() {
    document.querySelectorAll('.admin-modern-google-links').forEach((node) => node.remove());
    document.querySelectorAll('#teacher-dashboard .google-manage').forEach((node) => node.remove());
  }

  function selectedTeacherId() {
    const content = document.querySelector('#admin-teacher-detail-content');
    if (!content || content.classList.contains('hidden')) return '';
    return String(content.dataset.teacherId || '').trim();
  }

  function statusText(entry) {
    if (entry?.googleVerified) return `Google gekoppeld · ${entry.googleEmail || 'schoolmail bekend'}`;
    if (entry?.googleEmail) return `Schoolmail staat klaar voor eerste Google-login · ${entry.googleEmail}`;
    return 'Nog geen Google-schoolaccount gekoppeld.';
  }

  function ensureSection() {
    const detail = document.querySelector('#admin-teacher-detail-content');
    const classForm = document.querySelector('#admin-teacher-classes-form');
    if (!detail || !classForm) return null;

    let section = detail.querySelector('#admin-teacher-google-account');
    if (section) return section;

    section = make('section', {
      className: 'admin-teacher-detail__section admin-ux__teacher-google',
      id: 'admin-teacher-google-account',
    });
    section.innerHTML = `
      <h5>Google-schoolaccount</h5>
      <p class="hint admin-ux__teacher-google-copy">Beheer hier de schoolmail van deze docent. Zonder vooraf gekoppeld adres kan de docent bij de eerste Google-login een goedkeuringsverzoek naar Beheer sturen.</p>
      <form class="google-manage__form" id="admin-teacher-google-form">
        <label class="visually-hidden" for="admin-teacher-google-email">Schoolmail</label>
        <input id="admin-teacher-google-email" type="email" autocomplete="off" required />
        <button class="btn btn--secondary" type="submit">Schoolmail opslaan</button>
      </form>
      <p id="admin-teacher-google-status" class="hint" role="status" aria-live="polite"></p>
    `;
    classForm.insertAdjacentElement('afterend', section);
    return section;
  }

  async function renderSelectedTeacher() {
    const dashboard = document.querySelector('#admin-dashboard');
    const teacherId = selectedTeacherId();
    if (!dashboard || dashboard.classList.contains('hidden') || !teacherId || renderBusy) return;

    const section = ensureSection();
    if (!section) return;
    renderBusy = true;
    try {
      const data = await api('/api/auth/google/manage');
      if (selectedTeacherId() !== teacherId) {
        scheduleRender();
        return;
      }
      if (data.role !== 'admin') return;
      const entry = (data.staff || []).find((staff) => staff?.id === teacherId && staff?.role !== 'admin');
      if (!entry) {
        section.hidden = true;
        return;
      }
      section.hidden = false;
      section.dataset.teacherId = teacherId;

      const email = section.querySelector('#admin-teacher-google-email');
      const status = section.querySelector('#admin-teacher-google-status');
      const form = section.querySelector('#admin-teacher-google-form');
      const save = form?.querySelector('[type="submit"]');
      if (email) {
        email.value = entry.googleEmail || '';
        email.placeholder = `naam@${data.domain || 'koraaledu.nl'}`;
      }
      if (status) status.textContent = statusText(entry);

      if (form && !form.dataset.googleTeacherDetailBound) {
        form.dataset.googleTeacherDetailBound = 'true';
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const currentId = selectedTeacherId();
          if (!currentId) return;
          const submittedEmail = email?.value || '';
          if (save) save.disabled = true;
          if (status) status.textContent = 'Schoolmail wordt opgeslagen…';
          try {
            const result = await api('/api/auth/google/staff-email', {
              method: 'POST',
              body: { staffId: currentId, email: submittedEmail },
            });
            if (selectedTeacherId() !== currentId) {
              scheduleRender();
              return;
            }
            if (status) {
              status.textContent = result.googleVerified
                ? `Google gekoppeld · ${result.googleEmail || submittedEmail}`
                : `Schoolmail opgeslagen · ${result.googleEmail || submittedEmail}`;
            }
          } catch (error) {
            if (selectedTeacherId() === currentId && status) status.textContent = error.message;
          } finally {
            if (save) save.disabled = false;
          }
        });
      }
    } catch (error) {
      if (selectedTeacherId() === teacherId) {
        const status = section.querySelector('#admin-teacher-google-status');
        if (status) status.textContent = error.message;
      }
    } finally {
      renderBusy = false;
    }
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderSelectedTeacher, 80);
  }

  function install() {
    if (installed) return;
    installed = true;
    removeStandaloneTeacherLinkPanels();
    scheduleRender();

    const observer = new MutationObserver(() => {
      removeStandaloneTeacherLinkPanels();
      scheduleRender();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-teacher-id'],
    });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
