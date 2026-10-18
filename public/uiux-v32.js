(() => {
  'use strict';
  // Visual v3.2. Existing role views remain the only source of truth for
  // permissions, forms, catalogue and workflows. This layer reuses their DOM.
  const hero = document.querySelector('body[data-page="staff"] .hero--staff');
  if (!hero) return;
  let teacherPreviewInstalled = false;
  let adminLayoutDone = false;
  let teacherLayoutDone = false;
  const make = (tag, cls, content) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const button = (label, icon, run) => {
    const node = make('button', 'bb-v32-quick-link');
    node.type = 'button';
    const image = make('span', 'bb-v32-quick-icon', icon);
    image.setAttribute('aria-hidden', 'true');
    node.append(image, make('span', '', label), make('span', 'bb-v32-chevron', '›'));
    node.addEventListener('click', run);
    return node;
  };
  function chooseAdmin(view, people) {
    const tab = document.querySelector('#bb-admin-v31-sidebar [data-admin-modern-tab="' + view + '"]');
    tab?.click();
    if (people) {
      document.querySelector('#admin-dashboard [data-admin-people-tab="' + people + '"]')?.click();
    }
  }
  function chooseTeacher(view) {
    document.querySelector('#bb-teacher-v31-sidebar [data-teacher-page="' + view + '"]')?.click();
  }
  function globalSearch(input, owner) {
    const form = make('form', 'bb-v32-site-search');
    form.setAttribute('role', 'search');
    const label = make('label', 'bb-v32-sr-only', 'Zoek in de boekencatalogus');
    const id = 'bb-v32-' + owner + '-search';
    label.htmlFor = id;
    const field = make('input');
    field.type = 'search';
    field.id = id;
    field.placeholder = 'Zoek een boek, auteur of ISBN…';
    field.autocomplete = 'off';
    const go = make('button', '', 'Zoeken');
    go.type = 'submit';
    form.append(label, field, go);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = field.value.trim();
      if (owner === 'admin') chooseAdmin('books');
      else chooseTeacher('catalog');
      const catalog = document.getElementById('search-input');
      if (catalog) {
        catalog.value = query;
        catalog.dispatchEvent(new Event('input', { bubbles: true }));
        catalog.focus({ preventScroll: true });
      }
    });
    return form;
  }
  function installHeader(sidebar, owner) {
    if (!sidebar || sidebar.dataset.v32Header) return;
    sidebar.dataset.v32Header = owner;
    sidebar.classList.add('bb-v32-top-nav');
    const actions = hero.querySelector('.hero__actions');
    if (actions) hero.insertBefore(sidebar, actions);
    else hero.append(sidebar);
    if (owner === 'admin') {
      sidebar.querySelector('.bb-admin-v31-sidebar-label')?.remove();
      sidebar.querySelector('.bb-admin-v31-sidebar-footer')?.remove();
      for (const tab of sidebar.querySelectorAll('[data-admin-modern-tab]')) {
        const label = tab.querySelector('span:last-child');
        if (!label) continue;
        const title = {
          overview:'Overzicht',books:'Boeken',people:'Personen',loans:'Uitlenen',
          tasks:'Taken',imports:'Importeren',settings:'Instellingen',
        }[tab.dataset.adminModernTab];
        if (title) label.textContent = title;
      }
      const tabset = sidebar.querySelector('.admin-modern__tabs');
      const classes = make('button', 'admin-modern__tab bb-v32-added-tab', 'Klassen');
      classes.type = 'button';
      classes.dataset.v32Destination = 'classes';
      classes.addEventListener('click', () => chooseAdmin('people', 'classes'));
      const people = tabset?.querySelector('[data-admin-modern-tab="people"]');
      if (people) people.after(classes);
      const activity = make('button', 'admin-modern__tab bb-v32-added-tab', 'Activiteit');
      activity.type = 'button';
      activity.dataset.v32Destination = 'activity';
      activity.addEventListener('click', () => {
        chooseAdmin('overview');
        document.querySelector('#bb-admin-v31-activity')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      const imports = tabset?.querySelector('[data-admin-modern-tab="imports"]');
      if (imports) imports.after(activity);
      const updateClasses = () => {
        const active = people?.classList.contains('admin-modern__tab--active') &&
          document.querySelector('[data-admin-people-tab="classes"]')?.getAttribute('aria-selected') === 'true';
        classes.classList.toggle('admin-modern__tab--active', Boolean(active));
        if (active) classes.setAttribute('aria-current', 'page');
        else classes.removeAttribute('aria-current');
        // A classes subview is a distinct top-level destination in v3.2;
        // never leave both "Personen" and "Klassen" visually selected.
        if (people?.dataset.adminModernTab === 'people') {
          const persons = people.classList.contains('admin-modern__tab--active') || active;
          people.classList.toggle('admin-modern__tab--active', persons && !active);
          if (persons && !active) people.setAttribute('aria-current', 'page');
          else people.removeAttribute('aria-current');
        }
      };
      if (people) people.addEventListener('click', () => {
        // "Personen" must select people even when Klassen was opened before.
        document.querySelector('#admin-dashboard [data-admin-people-tab="students"]')?.click();
      });
      sidebar.addEventListener('click', () => queueMicrotask(updateClasses));
      const subtabs = document.querySelector('.admin-modern__subtabs');
      if (subtabs) new MutationObserver(updateClasses).observe(subtabs, {
        subtree: true, attributes: true, attributeFilter: ['aria-selected'],
      });
    } else {
      sidebar.querySelector('.bb-teacher-v31-sidebar-label')?.remove();
      sidebar.querySelector('.bb-teacher-v31-sidebar-footer')?.remove();
      const nameMap = {
        start:'Overzicht',classes:'Mijn klassen',catalog:'Boeken',
        lending:'Uitlenen',tasks:'Taken',account:'E-mail',
      };
      for (const tab of sidebar.querySelectorAll('[data-teacher-page]')) {
        const label = [...tab.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
        if (label) label.textContent = nameMap[tab.dataset.teacherPage] || label.textContent;
      }
      const activity = make('button', 'bb-teacher-v31-nav bb-v32-added-tab', 'Activiteit');
      activity.type = 'button';
      activity.addEventListener('click', () => {
        chooseTeacher('start');
        document.getElementById('bb-teacher-v31-activity')?.scrollIntoView({ block:'start', behavior:'smooth' });
      });
      const tasks = sidebar.querySelector('[data-teacher-page="tasks"]');
      if (tasks) tasks.before(activity);
      const students = make('button', 'bb-teacher-v31-nav bb-v32-added-tab', 'Leerlingen');
      students.type = 'button';
      students.addEventListener('click', () => {
        chooseTeacher('classes');
        document.getElementById('student-management-panel')?.scrollIntoView({ block:'start', behavior:'smooth' });
      });
      sidebar.querySelector('[data-teacher-page="catalog"]')?.after(students);
    }
  }

  function enhanceAdminDashboard() {
    if (adminLayoutDone) return;
    const overview = document.querySelector('#admin-dashboard [data-admin-modern-view="overview"]');
    const grid = overview?.querySelector('.bb-admin-v31-grid');
    const activity = grid?.querySelector('.bb-admin-v31-card--activity');
    const tasks = grid?.querySelector('.bb-admin-v31-card--actions');
    const stats = grid?.querySelector('.bb-admin-v31-card--stats');
    if (!overview || !grid || !activity || !tasks || !stats) return;
    adminLayoutDone = true;
    overview.classList.add('bb-v32-dashboard');
    grid.classList.add('bb-v32-admin-grid');
    const headline = overview.querySelector('.bb-admin-v31-heading h2');
    if (headline) headline.textContent = 'Beheer: Overzicht';
    const eyebrow = overview.querySelector('.bb-admin-v31-eyebrow');
    if (eyebrow) eyebrow.textContent = 'Beheer';
    const intro = overview.querySelector('.bb-admin-v31-heading p:not(.bb-admin-v31-eyebrow)');
    if (intro) intro.textContent = 'Welkom terug! Hier vind je de belangrijkste informatie en taken.';
    const header = overview.querySelector('.bb-admin-v31-heading');
    header?.append(globalSearch(null, 'admin'));

    const shortcuts = make('section', 'bb-admin-v31-card bb-v32-quick-panel');
    shortcuts.append(make('h3', '', 'Snel naar'));
    shortcuts.append(
      button('Boek toevoegen', '▤', () => {
        chooseAdmin('books');
        document.getElementById('bb-admin-v31-open-editor')?.click();
      }),
      button('Leerlingen beheren', '♙', () => chooseAdmin('people','students')),
      button('Docenten beheren', '◉', () => chooseAdmin('people','teachers')),
      button('Klassen beheren', '▦', () => chooseAdmin('people','classes')),
      button('Uitlenen registreren', '⇄', () => chooseAdmin('loans'))
    );
    const activityTitle = activity.querySelector('h3');
    if (activityTitle) activityTitle.textContent = 'Laatste activiteit';
    const taskTitle = tasks.querySelector('h3');
    if (taskTitle) taskTitle.textContent = 'Openstaande taken';
    grid.replaceChildren(shortcuts, activity, tasks, stats);

    const metrics = overview.querySelector('#admin-modern-metrics');
    if (metrics) {
      const labels = ['Naar boeken', 'Naar personen', 'Naar docenten', 'Naar klassen'];
      const clickers = [
        () => chooseAdmin('books'), () => chooseAdmin('people','students'),
        () => chooseAdmin('people','teachers'), () => chooseAdmin('people','classes'),
      ];
      const decorate = () => {
        for (const [index, item] of [...metrics.querySelectorAll('.admin-modern__metric')].entries()) {
          if (item.dataset.v32Metric) continue;
          item.dataset.v32Metric = String(index);
          const link = make('button', 'bb-v32-metric-link', labels[index] + ' →');
          link.type = 'button';
          link.addEventListener('click', clickers[index]);
          item.append(link);
        }
      };
      decorate();
      new MutationObserver(decorate).observe(metrics, { childList: true });
    }
  }
  function installTeacherBooks() {
    if (teacherPreviewInstalled) return;
    const grid = document.getElementById('book-grid');
    const preview = document.getElementById('bb-v32-teacher-books');
    if (!grid || !preview) return;
    teacherPreviewInstalled = true;
    const render = () => {
      preview.replaceChildren();
      const bookCards = [...grid.querySelectorAll(':scope > .book-card')].slice(0, 5);
      if (!bookCards.length) {
        preview.append(make('p', 'bb-v32-book-empty', 'Boeken worden geladen of er zijn geen resultaten.'));
        return;
      }
      for (const source of bookCards) {
        const item = make('button', 'bb-v32-book-preview');
        item.type = 'button';
        item.classList.toggle('bb-v32-book-preview--easy', source.classList.contains('book-card--easy-reading'));
        item.classList.toggle('bb-v32-book-preview--reading', source.classList.contains('book-card--exam-list'));
        const frame = make('span', 'bb-v32-book-cover');
        const sourceImage = source.querySelector('.book-card__cover');
        const sourceFallback = source.querySelector('.book-card__cover-fallback');
        if (sourceImage && !sourceImage.hidden && sourceImage.getAttribute('src')) {
          const image = make('img');
          image.src = sourceImage.getAttribute('src');
          image.alt = '';
          image.loading = 'lazy';
          frame.append(image);
        } else {
          frame.append(make('span', 'bb-v32-cover-placeholder', sourceFallback?.textContent?.trim() || '📚'));
        }
        const title = source.querySelector('.book-card__title')?.textContent?.trim() || 'Onbekende titel';
        const author = source.querySelector('.book-card__author')?.textContent?.trim() || '';
        item.append(frame, make('strong', '', title), make('small', '', author));
        item.setAttribute('aria-label', 'Bekijk ' + title + (author ? ' van ' + author : ''));
        item.addEventListener('click', () => {
          chooseTeacher('catalog');
          source.click();
        });
        preview.append(item);
      }
    };
    render();
    // Only listen to changes of the live catalog's card collection.
    new MutationObserver(render).observe(grid, { childList: true });
  }
  function enhanceTeacherDashboard() {
    if (teacherLayoutDone) return;
    const start = document.querySelector('[data-teacher-view="start"]');
    const left = start?.querySelector('.bb-teacher-v31-dashboard-column:first-child');
    const right = start?.querySelector('.bb-teacher-v31-dashboard-column:last-child');
    const task = right?.querySelector('.bb-teacher-v31-card');
    if (!start || !left || !right || !task) return;
    teacherLayoutDone = true;
    start.classList.add('bb-v32-dashboard bb-v32-teacher-dashboard');
    const heading = start.querySelector('.bb-teacher-v31-view-heading h2');
    if (heading) heading.textContent = 'Welkom';
    const subtitle = start.querySelector('.bb-teacher-v31-view-heading .bb-teacher-v31-hint');
    if (subtitle) subtitle.textContent = 'Hier vind je jouw klassen, boeken en recente activiteit.';
    const search = make('section', 'bb-teacher-v31-card bb-v32-teacher-search');
    const headingRow = make('div', 'bb-teacher-v31-card-heading');
    headingRow.append(make('h3', '', 'Zoek een boek'));
    const all = make('button', 'bb-teacher-v31-link', 'Bekijk alle →');
    all.type = 'button';
    all.addEventListener('click', () => chooseTeacher('catalog'));
    headingRow.append(all);
    search.append(headingRow, make('p','bb-teacher-v31-hint','Zoek een boek uit de bibliotheek van de school.'));
    search.append(globalSearch(null, 'teacher'));
    const covers = make('div', 'bb-v32-teacher-books');
    covers.id = 'bb-v32-teacher-books';
    covers.setAttribute('aria-label', 'Boeken uit de catalogus');
    search.append(covers);
    right.prepend(search);
    // Preserve all original task handlers; only change the layout.
    const lower = make('div', 'bb-v32-teacher-lower');
    const loans = make('section', 'bb-teacher-v31-card bb-v32-loan-summary');
    loans.append(make('h3', '', 'Recente uitleningen'));
    loans.append(make('p', 'bb-teacher-v31-hint',
      'Bekijk wie een boek leent of lever een boek in via Uitlenen.'));
    const openLoans = button('Bekijk uitleningen', '▤', () => chooseTeacher('lending'));
    loans.append(openLoans);
    const loanCount = make('p', 'bb-v32-live-loan-count');
    loanCount.setAttribute('aria-live', 'polite');
    loans.insertBefore(loanCount, openLoans);
    const metrics = start.querySelector('#bb-teacher-v31-metrics');
    if (metrics) {
      const updateLoanCount = () => {
        const value = metrics.children[2]?.querySelector('strong')?.textContent?.trim() || '…';
        if (loanCount.textContent !== value + ' lopende uitleningen') {
          loanCount.textContent = value + ' lopende uitleningen';
        }
      };
      updateLoanCount();
      new MutationObserver(updateLoanCount).observe(metrics, {
        childList: true, characterData: true, subtree: true,
      });
    }
    left.querySelector('#bb-teacher-v31-activity')?.classList.add('bb-v32-recent');
    const recent = left.querySelector('#bb-teacher-v31-activity');
    if (recent) lower.append(loans, recent, task);
    else lower.append(loans, task);
    start.append(lower);
    installTeacherBooks();
  }
  function sync() {
    const teacherNav = document.getElementById('bb-teacher-v31-sidebar');
    if (teacherNav && document.body.classList.contains('bb-teacher-v31')
      && window.matchMedia('(min-width:761px)').matches) teacherNav.inert = false;
    if (document.body.classList.contains('bb-admin-v31')) {
      installHeader(document.getElementById('bb-admin-v31-sidebar'), 'admin');
      enhanceAdminDashboard();
    }
    if (document.body.classList.contains('bb-teacher-v31')) {
      installHeader(document.getElementById('bb-teacher-v31-sidebar'), 'teacher');
      enhanceTeacherDashboard();
      installTeacherBooks();
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  observer.observe(hero, { childList: true });
  window.addEventListener('resize', sync);
  sync();
})();