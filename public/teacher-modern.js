(() => {
  'use strict';
  const dashboard = document.getElementById('teacher-dashboard');
  const admin = document.getElementById('admin-dashboard');
  const root = document.querySelector('body[data-page="staff"] > main');
  if (!dashboard || !admin || !root) return;

  const navItems = [
    ['start', '▦', 'Start'],
    ['classes', '♙', 'Mijn klassen'],
    ['catalog', '▤', 'Catalogus'],
    ['lending', '⇄', 'Uitlenen en innemen'],
    ['tasks', '☑', 'Taken'],
    ['account', '⚙', 'Mijn account'],
  ];
  const panels = {};
  const placements = [];
  let ready = false;
  let active = false;
  let page = 'start';
  let requestId = 0;
  let importTaskCount = null;
  let mentorTaskCount = null;
  let nav, scrim, menu;
  const taskSummary = { classes: [], status: 'loading' };
  // Mirror staff-loans.js: all staff endpoints may live on a separate API host.
  const configuredBase = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const apiBase = (window.BOEKENBAAI_API_BASE || configuredBase
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const apiAddress = route => apiBase ? apiBase.replace(/\/$/, '') + route : route;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function place(node, destination) {
    if (!node || !destination) return;
    let entry = placements.find(row => row.node === node);
    if (!entry) {
      const marker = document.createComment('Docentenportaal v3.1 oorspronkelijke plek');
      node.before(marker);
      entry = { node, marker, destination };
      placements.push(entry);
    }
    destination.append(node);
  }
  function restore() {
    for (const { node, marker } of placements) {
      // Beheer may already have mounted a shared node during the same role
      // transition. Never pull its active panels back out of the admin UI.
      if (admin.contains(node)) continue;
      if (marker.isConnected) marker.after(node);
    }
  }
  function remount() {
    for (const { node, destination } of placements) {
      if (destination.isConnected && node.parentElement !== destination) destination.append(node);
    }
  }
  function teacherVisible() {
    return !dashboard.classList.contains('hidden')
      && admin.classList.contains('hidden')
      && document.getElementById('staff-login-panel')?.classList.contains('hidden');
  }
  function closeMenu() {
    document.body.classList.remove('bb-teacher-v31--open');
    if (menu) menu.setAttribute('aria-expanded', 'false');
    if (scrim) scrim.hidden = true;
    if (nav) nav.inert = matchMedia('(max-width:760px)').matches;
  }
  function openMenu() {
    document.body.classList.add('bb-teacher-v31--open');
    menu.setAttribute('aria-expanded', 'true');
    scrim.hidden = false;
    nav.inert = false;
    nav.querySelector('button')?.focus();
  }
  function setPage(next, focus = true) {
    if (!active || !panels[next]) return;
    page = next;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== next;
    nav.querySelectorAll('[data-teacher-page]').forEach(button => {
      const selected = button.dataset.teacherPage === next;
      button.classList.toggle('bb-teacher-v31-nav--active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    closeMenu();
    if (focus) {
      panels[next].querySelector('h2')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (next === 'start') void updateStart();
    // Newly arriving transfers and Google-link requests must be discoverable
    // whenever the task hub is reopened, not only after login.
    if (next === 'tasks') {
      taskSummary.status = 'loading';
      renderMentorTasks();
      window.dispatchEvent(new Event('boekenbaai:mentor-tasks-refresh'));
    }
    if (next === 'catalog') {
      // The old layout defaults to a folded overview on login. In the
      // dedicated Catalogus page that would leave an empty white card.
      const content = document.getElementById('staff-book-overview-content');
      const toggle = document.getElementById('staff-book-overview-toggle');
      if (content) content.hidden = false;
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
    if (next === 'lending') window.dispatchEvent(new Event('boekenbaai:staff-refresh'));
  }
  function card(title, destination, description) {
    const box = el('section', 'bb-teacher-v31-card');
    const heading = el('div', 'bb-teacher-v31-card-heading');
    heading.append(el('h3', '', title));
    if (destination) {
      const button = el('button', 'bb-teacher-v31-link', 'Bekijk →');
      button.type = 'button';
      button.addEventListener('click', () => setPage(destination));
      heading.append(button);
    }
    box.append(heading);
    if (description) box.append(el('p', 'bb-teacher-v31-hint', description));
    return box;
  }
  function makeView(name, title, subtitle) {
    const view = el('section', 'bb-teacher-v31-view');
    view.dataset.teacherView = name;
    const heading = el('div', 'bb-teacher-v31-view-heading');
    heading.append(el('p', 'bb-teacher-v31-eyebrow', 'DOCENTENPORTAAL'));
    const h = el('h2', '', title);
    h.tabIndex = -1;
    heading.append(h, el('p', 'bb-teacher-v31-hint', subtitle));
    view.append(heading);
    panels[name] = view;
    return view;
  }
  function addAction(cardNode, title, subtitle, destination) {
    const button = el('button', 'bb-teacher-v31-row');
    button.type = 'button';
    const copy = el('span', 'bb-teacher-v31-row-copy');
    copy.append(el('strong', '', title), el('small', '', subtitle));
    button.append(copy, el('span', 'bb-teacher-v31-row-open', 'Open'));
    button.addEventListener('click', () => setPage(destination));
    cardNode.append(button);
  }
  function build() {
    if (ready) return;
    ready = true;
    nav = el('aside', 'bb-teacher-v31-sidebar');
    nav.id = 'bb-teacher-v31-sidebar';
    nav.setAttribute('aria-label', 'Docentennavigatie');
    nav.append(el('p', 'bb-teacher-v31-sidebar-label', 'DOCENTEN'));
    for (const [id, symbol, label] of navItems) {
      const button = el('button', 'bb-teacher-v31-nav');
      button.type = 'button';
      button.dataset.teacherPage = id;
      const icon = el('span', 'bb-teacher-v31-icon', symbol);
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, document.createTextNode(label));
      button.addEventListener('click', () => setPage(id));
      nav.append(button);
    }
    nav.append(el('p', 'bb-teacher-v31-sidebar-footer', 'Boekenbaai · VSO Het Dok'));
    nav.hidden = true;
    root.prepend(nav);
    scrim = el('button', 'bb-teacher-v31-scrim');
    scrim.id = 'bb-teacher-v31-scrim';
    scrim.type = 'button';
    scrim.hidden = true;
    scrim.setAttribute('aria-label', 'Navigatie sluiten');
    scrim.addEventListener('click', closeMenu);
    root.append(scrim);
    menu = el('button', 'bb-teacher-v31-menu', '☰');
    menu.type = 'button';
    menu.hidden = true;
    menu.setAttribute('aria-controls', nav.id);
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Docentenmenu openen');
    menu.addEventListener('click', () => {
      if (document.body.classList.contains('bb-teacher-v31--open')) closeMenu();
      else openMenu();
    });
    document.querySelector('.hero--staff .hero__content')?.before(menu);

    dashboard.removeAttribute('aria-labelledby');
    dashboard.setAttribute('aria-label', 'Docentenportaal');
    const container = el('div', 'bb-teacher-v31-shell');
    container.id = 'bb-teacher-v31-shell';
    container.hidden = true;
    const start = makeView('start', 'Start', 'Je klassen, taken en boeken op één overzichtelijke werkplek.');
    const metrics = el('div', 'bb-teacher-v31-metrics');
    metrics.id = 'bb-teacher-v31-metrics';
    start.append(metrics);
    const grid = el('div', 'bb-teacher-v31-grid');
    const leftColumn = el('div', 'bb-teacher-v31-dashboard-column');
    const rightColumn = el('div', 'bb-teacher-v31-dashboard-column');
    const classesCard = card('Mijn klassen', 'classes');
    classesCard.id = 'bb-teacher-v31-classes-summary';
    const taskCard = card('Taken voor mij', 'tasks');
    addAction(taskCard, 'Klaswissels en koppelingen', 'Bekijk openstaande verzoeken per klas', 'tasks');
    addAction(taskCard, 'Boekimportcontroles', 'Gedeelde controletaken per klas', 'tasks');
    const recent = card('Recente activiteit');
    recent.id = 'bb-teacher-v31-activity';
    leftColumn.append(classesCard, recent);
    rightColumn.append(taskCard);
    grid.append(leftColumn, rightColumn);
    start.append(grid);
    const classes = makeView('classes', 'Mijn klassen', 'Bekijk leerlingen, klaswissels en de klassen waarvoor je bevoegd bent.');
    const catalog = makeView('catalog', 'Catalogus', 'Zoek, filter en bekijk de beschikbaarheid van de schoolbibliotheek.');
    const lending = makeView('lending', 'Uitlenen en innemen', 'Kies het juiste exemplaar en registreer uitleningen en innames.');
    const tasks = makeView('tasks', 'Taken', 'Bekijk boekimportcontroles, klaswissels en Google-koppelverzoeken.');
    const account = makeView('account', 'Mijn account', 'Beheer jouw e-mailherinneringen en gekoppelde schoolgegevens.');
    container.append(start, classes, catalog, lending, tasks, account);
    dashboard.append(container);
    // Move the EXISTING nodes, not clones. All original listeners remain bound.
    place(dashboard.querySelector('.teacher-layout__classes'), classes);
    place(dashboard.querySelector('.panel__header--staff'), catalog);
    place(dashboard.querySelector('.teacher-layout'), catalog);
    const toggle = document.getElementById('staff-book-overview-toggle');
    if (toggle) {
      toggle.dataset.teacherOldHidden = String(toggle.hidden);
      toggle.hidden = true;
    }
    place(document.getElementById('staff-loan-panel'), lending);
    const transferPanel = el('section', 'bb-teacher-v31-task-summary');
    transferPanel.id = 'bb-teacher-v31-mentor-tasks';
    transferPanel.setAttribute('aria-label', 'Klaswissels en Google-koppelingen');
    tasks.append(transferPanel);
    place(document.getElementById('book-import-followups-panel'), tasks);
    renderMentorTasks();
    installLoanDuePreview();
    place(document.getElementById('book-import-mail-preferences-panel'), account);
    place(document.getElementById('history-panel'), recent);
  }
  function setIdentity(teacher) {
    const title = document.querySelector('.hero--staff h1');
    const intro = document.querySelector('.hero--staff .hero__content p');
    const logo = document.querySelector('.hero--staff .hero__logo');
    if (teacher) {
      if (title) title.textContent = 'Boekenbaai';
      if (intro) intro.textContent = '';
      if (logo) {
        logo.dataset.v31TeacherOriginal ||= logo.getAttribute('src') || '';
        logo.src = 'logo/het-dok-header-v31.svg';
        logo.alt = 'Het Dok';
      }
    } else {
      if (title) title.textContent = 'Docentenportaal Boekenbaai';
      if (intro) intro.textContent = 'Houd zicht op de voortgang van jouw leerlingen en beheer je klassen.';
      if (logo?.dataset.v31TeacherOriginal) {
        logo.setAttribute('src', logo.dataset.v31TeacherOriginal);
        logo.alt = '';
      }
    }
  }
  function refreshTaskMetric() {
    const node = document.querySelector('#bb-teacher-v31-metrics > :nth-child(4) strong');
    if (!node) return;
    node.textContent = importTaskCount === null || mentorTaskCount === null
      ? '—' : String(importTaskCount + mentorTaskCount);
  }
  function renderMentorTasks() {
    const host = document.getElementById('bb-teacher-v31-mentor-tasks');
    if (!host) return;
    host.replaceChildren();
    host.append(el('h3', '', 'Klaswissels en Google-koppelingen'));
    if (taskSummary.status === 'loading') {
      host.append(el('p', 'bb-teacher-v31-hint', 'Taken laden…'));
      return;
    }
    if (taskSummary.status === 'error') {
      host.append(el('p', 'bb-teacher-v31-hint', 'Klasverzoeken zijn tijdelijk niet beschikbaar.'));
      return;
    }
    const entries = taskSummary.classes.flatMap(klass => [
      { title: 'Binnenkomende klaswissels', count: klass.incoming, classId: klass.id, className: klass.name },
      { title: 'Google-koppelverzoeken', count: klass.google, classId: klass.id, className: klass.name },
      { title: 'Uitgaande klaswissels opvolgen', count: klass.outgoing, classId: klass.id, className: klass.name },
    ]).filter(entry => entry.count > 0);
    if (!entries.length) {
      host.append(el('p', 'bb-teacher-v31-hint', 'Geen openstaande klaswissels of Google-koppelverzoeken.'));
      return;
    }
    for (const entry of entries) {
      const button = el('button', 'bb-teacher-v31-row bb-teacher-v31-task-row');
      button.type = 'button';
      const details = el('span', 'bb-teacher-v31-row-copy');
      details.append(el('strong', '', entry.title),
        el('small', '', entry.className + ' · ' + entry.count +
          (entry.count === 1 ? ' verzoek' : ' verzoeken')));
      button.append(details, el('span', 'bb-teacher-v31-row-open', 'Behandelen'));
      button.addEventListener('click', () => {
        setPage('classes');
        window.dispatchEvent(new CustomEvent('boekenbaai:mentor-select-class',
          { detail: { classId: entry.classId } }));
      });
      host.append(button);
    }
  }
  function installLoanDuePreview() {
    const due = document.getElementById('staff-loan-due');
    if (!due || due.dataset.teacherPreviewInstalled) return;
    due.dataset.teacherPreviewInstalled = 'true';
    const container = el('span', 'bb-teacher-v31-date-wrap');
    const preview = el('span', 'bb-teacher-v31-date-preview');
    preview.setAttribute('aria-hidden', 'true');
    due.before(container);
    container.append(due, preview);
    // Firefox does not support Chromium's date edit pseudo-element. Only show
    // the overlay when the native date text can be hidden reliably.
    const canHideNativeText = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('selector(input::-webkit-datetime-edit)');
    container.classList.toggle('bb-teacher-v31-date-wrap--overlay', canHideNativeText);
    preview.hidden = !canHideNativeText;
    const update = () => {
      const match = due.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      preview.textContent = match
        ? match[3] + '-' + match[2] + '-' + match[1] : 'dd-mm-jjjj';
      preview.classList.toggle('bb-teacher-v31-date-preview--empty', !match);
    };
    due.addEventListener('input', update);
    due.addEventListener('change', update);
    update();
  }
  function clearClassSummary() {
    const card = document.getElementById('bb-teacher-v31-classes-summary');
    if (!card) return;
    card.querySelectorAll('.bb-teacher-v31-row, .bb-teacher-v31-classes-state, .bb-teacher-v31-all-classes')
      .forEach(node => node.remove());
  }
  async function updateStart() {
    const current = ++requestId;
    const metrics = document.getElementById('bb-teacher-v31-metrics');
    const classesCard = document.getElementById('bb-teacher-v31-classes-summary');
    if (!active || !metrics || !classesCard) return;
    // Drop previous account-specific class names before starting any requests.
    // In particular, an API error must never leave an earlier teacher's data.
    clearClassSummary();
    importTaskCount = null;
    refreshTaskMetric();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond';
    // Keep the full identity in the header, but greet the teacher by first name.
    const teacherName = document.getElementById('staff-name')?.textContent?.trim().split(/\s+/)[0];
    const title = panels.start?.querySelector('h2');
    if (title) title.textContent = teacherName ? greeting + ', ' + teacherName : 'Welkom terug';
    metrics.replaceChildren();
    for (const [value, label] of [['…','Mijn klassen'],['…','Leerlingen'],
      ['…','Lopende leningen'],['…','Openstaande taken']]) {
      const box = el('div', 'bb-teacher-v31-metric');
      box.append(el('strong', '', value), el('small', '', label));
      metrics.append(box);
    }
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) return;
    try {
      const response = await fetch(apiAddress('/api/staff/loans'), {
        headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'},
      });
      if (!response.ok) throw Error('Gegevens tijdelijk niet beschikbaar.');
      const data = await response.json();
      if (current !== requestId || !active) return;
      const ownClasses = Array.isArray(data.classes) ? data.classes : [];
      const uniqueStudents = new Set((Array.isArray(data.students)?data.students:[])
        .filter(student => student.active !== false).map(student=>student.id));
      const activeLoans = Array.isArray(data.loans) ? data.loans.length : 0;
      for (const [node, value] of [...metrics.children].slice(0,3).map((n,i)=>
        [n,[ownClasses.length,uniqueStudents.size,activeLoans][i]])) {
        const valueEl = node.querySelector('strong');
        if (valueEl) valueEl.textContent = String(value);
      }
      // The task count is independently scoped by the backend to the
      // teacher's current class assignments. Never invent task totals.
      try {
        const taskResponse = await fetch(apiAddress('/api/staff/book-import-followups'), {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        });
        if (!taskResponse.ok) throw Error('Taken niet beschikbaar');
        const taskData = await taskResponse.json();
        if (current !== requestId || !active) return;
        importTaskCount = Number.isSafeInteger(taskData.summary?.open)
          ? taskData.summary.open : null;
        refreshTaskMetric();
      } catch {
        if (current === requestId && active) {
          importTaskCount = null;
          refreshTaskMetric();
        }
      }
      // A rejected follow-up request may complete after logout or after
      // another teacher refresh has started. Never render stale class data.
      if (current !== requestId || !active) return;
      clearClassSummary();
      if (!ownClasses.length) classesCard.append(el('p', 'bb-teacher-v31-hint bb-teacher-v31-classes-state', 'Er zijn geen klassen aan jou gekoppeld.'));
      else for (const klass of ownClasses.slice(0,5)) {
        const count = (Array.isArray(data.students) ? data.students : [])
          .filter(student => student.active !== false &&
            (student.classIds || []).includes(klass.id)).length;
        addAction(classesCard, klass.name, count + ' leerlingen', 'classes');
      }
      if (ownClasses.length > 5) {
        const more = el('button', 'bb-teacher-v31-link bb-teacher-v31-all-classes',
          'Bekijk alle ' + ownClasses.length + ' klassen →');
        more.type = 'button';
        more.addEventListener('click', () => setPage('classes'));
        classesCard.append(more);
      }
    } catch (error) {
      if (current === requestId && active) {
        metrics.replaceChildren(el('p','bb-teacher-v31-hint',error.message));
        clearClassSummary();
        classesCard.append(el('p', 'bb-teacher-v31-hint bb-teacher-v31-classes-state',
          'Klassengegevens zijn tijdelijk niet beschikbaar.'));
      }
    }
  }
  function sync() {
    const shouldActivate = teacherVisible();
    if (shouldActivate && !ready) build();
    if (shouldActivate === active) return;
    active = shouldActivate;
    document.body.classList.toggle('bb-teacher-v31', active);
    if (!ready) return;
    nav.hidden = !active;
    menu.hidden = !active;
    document.getElementById('bb-teacher-v31-shell').hidden = !active;
    if (active) {
      remount();
      // Reuse the class-management refresh lifecycle so the unified task
      // summary is populated even if student-management initialized before
      // the role-specific dashboard appeared.
      window.dispatchEvent(new Event('boekenbaai:mentor-tasks-refresh'));
      const toggle = document.getElementById('staff-book-overview-toggle');
      if (toggle) toggle.hidden = true;
      dashboard.removeAttribute('aria-labelledby');
      dashboard.setAttribute('aria-label', 'Docentenportaal');
      // Pages outside teacher-dashboard still receive original visibility
      // from app.js: never bypass the role-restricted .hidden state.
      setIdentity(true);
      setPage(page, false);
    } else {
      mentorTaskCount = null;
      importTaskCount = null;
      taskSummary.classes = [];
      taskSummary.status = 'loading';
      renderMentorTasks();
      const toggle = document.getElementById('staff-book-overview-toggle');
      if (toggle && toggle.dataset.teacherOldHidden !== undefined) {
        toggle.hidden = toggle.dataset.teacherOldHidden === 'true';
        delete toggle.dataset.teacherOldHidden;
      }
      ++requestId;
      clearClassSummary();
      closeMenu();
      restore();
      dashboard.removeAttribute('aria-label');
      dashboard.setAttribute('aria-labelledby', 'teacher-panel-title');
      // Do not overwrite the administrator's branding during role switches.
      if (admin.classList.contains('hidden')) setIdentity(false);
    }
  }
  const watcher = new MutationObserver(sync);
  watcher.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  watcher.observe(admin, { attributes: true, attributeFilter: ['class'] });
  const login = document.getElementById('staff-login-panel');
  if (login) watcher.observe(login, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('boekenbaai:mentor-tasks-updated', event => {
    if (!active) return;
    const detail = event.detail || {};
    taskSummary.status = detail.status === 'ready' ? 'ready' : 'error';
    taskSummary.classes = taskSummary.status === 'ready' && Array.isArray(detail.classes)
      ? detail.classes : [];
    mentorTaskCount = taskSummary.status === 'ready'
      ? taskSummary.classes.reduce((sum, row) =>
        sum + (row.incoming || 0) + (row.google || 0) + (row.outgoing || 0), 0)
      : null;
    renderMentorTasks();
    refreshTaskMetric();
  });
  document.getElementById('book-import-followups-refresh')?.addEventListener('click', () => {
    if (active && page === 'tasks') {
      taskSummary.status = 'loading';
      renderMentorTasks();
      window.dispatchEvent(new Event('boekenbaai:mentor-tasks-refresh'));
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active && (page === 'tasks' || page === 'start')) {
      window.dispatchEvent(new Event('boekenbaai:mentor-tasks-refresh'));
    }
  });
  window.addEventListener('boekenbaai:staff-refresh', () => {
    if (active && page === 'start') void updateStart();
  });
  window.addEventListener('resize', () => { if(active) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape' && document.body.classList.contains('bb-teacher-v31--open')) {
      closeMenu();
      menu.focus();
    }
  });
  sync();
})();