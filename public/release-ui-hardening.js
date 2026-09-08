(() => {
  'use strict';

  let queued = false;

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setHidden(element, hidden) {
    if (element && element.hidden !== hidden) element.hidden = hidden;
  }

  function removePassiveAccountActions() {
    document.querySelectorAll('#admin-modern-actions .admin-modern__action-row').forEach((row) => {
      if (/\b(leerlingen|docenten) zonder schoolaccount\b/i.test(row.textContent || '')) row.remove();
    });
    const host = document.querySelector('#admin-modern-actions');
    if (host && !host.children.length) {
      const message = document.createElement('p');
      message.className = 'hint';
      message.textContent = 'Geen openstaande accountacties.';
      host.append(message);
    }
  }

  function ensureUxStyles() {
    if (document.querySelector('#admin-ux-polish-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-ux-polish-styles';
    style.textContent = `
      [data-admin-people-view="teachers"] .admin-card--teachers {
        border: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 0 !important;
      }
      [data-admin-people-view="teachers"] .admin-card--teachers > .admin-card__header {
        display: none !important;
      }
      .admin-ux__teacher-toolbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: .25rem 0 1rem;
        border-bottom: 1px solid var(--accent-border, #d9dee7);
        margin-bottom: 1rem;
      }
      .admin-ux__teacher-toolbar h4 { margin: 0 0 .2rem; }
      .admin-ux__teacher-toolbar .hint { margin: 0; }
      .admin-card--teachers .admin-teacher-add {
        margin: 0 0 1.25rem;
        padding: 1rem;
        border: 1px solid var(--accent-border, #d9dee7);
        border-radius: 16px;
        background: rgba(255,255,255,.62);
      }
      .admin-card--teachers .admin-teacher-edit-title { display: none !important; }
      #admin-class-form .teacher-picker { position: relative; }
      #admin-class-form .teacher-picker__results {
        display: none;
        position: absolute;
        z-index: 40;
        left: 0;
        right: 0;
        top: calc(100% + .35rem);
        max-height: 15rem;
        overflow: auto;
        padding: .45rem;
        border: 1px solid var(--accent-border, #d9dee7);
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 12px 28px rgba(20, 35, 60, .14);
      }
      #admin-class-form .teacher-picker:focus-within .teacher-picker__results:not(:empty) {
        display: grid;
      }
      #admin-class-form .teacher-picker__selected:empty { display: none; }
      #admin-modern-google-host:empty { display: none; }
      @media (max-width: 720px) {
        .admin-ux__teacher-toolbar { flex-direction: column; }
      }
    `;
    document.head.append(style);
  }

  function putAdminBeforeBookOverview() {
    const adminDashboard = document.querySelector('#admin-dashboard');
    const teacherDashboard = document.querySelector('#teacher-dashboard');
    if (!adminDashboard || !teacherDashboard || adminDashboard.classList.contains('hidden')) return;
    const parent = adminDashboard.parentElement;
    if (parent && teacherDashboard.parentElement === parent && adminDashboard.nextElementSibling !== teacherDashboard) {
      parent.insertBefore(adminDashboard, teacherDashboard);
    }
  }

  function collapseBookOverviewOnLogin() {
    const dashboard = document.querySelector('#teacher-dashboard');
    const content = document.querySelector('#staff-book-overview-content');
    const toggle = document.querySelector('#staff-book-overview-toggle');
    if (!dashboard || !content || !toggle) return;

    if (dashboard.classList.contains('hidden')) {
      delete dashboard.dataset.defaultBookCollapsed;
      return;
    }
    if (dashboard.dataset.defaultBookCollapsed === 'true') return;

    content.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    setTextIfChanged(toggle, 'Uitklappen');
    dashboard.dataset.defaultBookCollapsed = 'true';
  }

  function keepImportLabelSimple() {
    document.querySelectorAll('[data-admin-modern-tab="imports"]').forEach((button) => {
      setTextIfChanged(button, 'Importeren');
    });
  }

  function moveGoogleHostIntoTeachers() {
    const teacherView = document.querySelector('[data-admin-people-view="teachers"]');
    const host = document.querySelector('#admin-modern-google-host');
    if (!teacherView || !host || host.parentElement === teacherView) return;
    teacherView.prepend(host);
  }

  function polishTeacherManagement() {
    const teacherView = document.querySelector('[data-admin-people-view="teachers"]');
    const card = document.querySelector('.admin-card--teachers');
    const content = card?.querySelector('.admin-card__content');
    const addSection = card?.querySelector('.admin-teacher-add');
    if (!teacherView || !card || !content || !addSection) return;

    card.classList.add('admin-card--embedded');
    setHidden(card.querySelector(':scope > .admin-card__header'), true);

    let toolbar = content.querySelector('.admin-ux__teacher-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'admin-ux__teacher-toolbar';
      const copy = document.createElement('div');
      const title = document.createElement('h4');
      title.textContent = 'Docentenbeheer';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Selecteer een docent om klassen en het Google-schoolaccount op één plek te beheren.';
      copy.append(title, hint);
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn';
      addButton.textContent = '+ Docent toevoegen';
      addButton.addEventListener('click', () => {
        const willOpen = addSection.hidden;
        addSection.hidden = !willOpen;
        addButton.textContent = willOpen ? 'Toevoegen sluiten' : '+ Docent toevoegen';
        if (willOpen) card.querySelector('#admin-teacher-add-name')?.focus();
      });
      toolbar.append(copy, addButton);
      content.prepend(toolbar);
    }

    if (!addSection.dataset.adminUxPrepared) {
      addSection.dataset.adminUxPrepared = 'true';
      addSection.hidden = true;
    }
    setTextIfChanged(addSection.querySelector('h4'), 'Docent toevoegen');
    setTextIfChanged(card.querySelector('#admin-teacher-add-submit'), 'Docent toevoegen');
    setHidden(card.querySelector('.admin-teacher-edit-title'), true);

    const search = card.querySelector('#admin-teacher-search');
    if (search && search.placeholder !== 'Zoek docent op naam') search.placeholder = 'Zoek docent op naam';
  }

  function polishClassTeacherPicker() {
    const picker = document.querySelector('#admin-class-form .teacher-picker');
    const search = document.querySelector('#admin-class-teacher-search');
    if (!picker || !search) return;
    if (search.placeholder !== 'Kies docent(en)…') search.placeholder = 'Kies docent(en)…';
    const hint = picker.parentElement?.querySelector('.hint');
    setTextIfChanged(hint, 'Klik in het veld en kies één of meerdere docenten.');
    if (!search.dataset.adminUxDropdown) {
      search.dataset.adminUxDropdown = 'true';
      search.addEventListener('focus', () => {
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }

  function apply() {
    queued = false;
    ensureUxStyles();
    removePassiveAccountActions();
    putAdminBeforeBookOverview();
    collapseBookOverviewOnLogin();
    keepImportLabelSimple();
    moveGoogleHostIntoTeachers();
    polishTeacherManagement();
    polishClassTeacherPicker();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(apply);
  }

  function install() {
    apply();
    const observer = new MutationObserver(queueApply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-teacher-id'],
    });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
