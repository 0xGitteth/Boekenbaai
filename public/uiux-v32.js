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
  // The same stroke icons and optical size serve quick actions and metrics.
  // Shapes are fixed UI assets, never injected from catalogue or user data.
  const iconPaths = {
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5Zm0 12A2.5 2.5 0 0 1 6.5 15H20"/>',
    student: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    teacher: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-2a7 7 0 0 1 12-4.9M16 8h6m-3-3v6m-4 10v-5h7v5"/>',
    classes: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M13 15h4"/>',
    lending: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    return: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
    activity: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  function makeIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = iconPaths[name] || iconPaths.book;
    return svg;
  }
  const button = (label, icon, run) => {
    const node = make('button', 'bb-v32-quick-link');
    node.type = 'button';
    const image = make('span', 'bb-v32-quick-icon');
    image.append(makeIcon(icon));
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
    // Extra body scope makes v3.2 layout rules outrank the admin stylesheet,
    // which the production server appends after the original HTML CSS links.
    document.body.classList.add('bb-v32-active');
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
          overview:'Overzicht',books:'Boeken',people:'Personen',classes:'Klassen',loans:'Uitlenen',
          tasks:'Taken',imports:'Importeren',settings:'Instellingen',
        }[tab.dataset.adminModernTab];
        if (title) label.textContent = title;
      }
      // Klassen is a real admin-modern view, not a Personen subtab.
      const people = sidebar.querySelector('[data-admin-modern-tab="people"]');
      people?.addEventListener('click', () => {
        document.querySelector('#admin-dashboard [data-admin-people-tab="students"]')?.click();
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
      // Mijn klassen contains the real student actions; there is no second
      // top-level Leerlingen page or separate teacher activity destination.
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
      button('Boek toevoegen', 'book', () => {
        chooseAdmin('books');
        document.getElementById('bb-admin-v31-open-editor')?.click();
      }),
      button('Leerlingen beheren', 'student', () => chooseAdmin('people','students')),
      button('Docenten beheren', 'teacher', () => chooseAdmin('people','teachers')),
      button('Klassen beheren', 'classes', () => chooseAdmin('classes')),
      button('Uitlenen registreren', 'lending', () => chooseAdmin('loans'))
    );
    const activityTitle = activity.querySelector('h3');
    if (activityTitle) activityTitle.textContent = 'Laatste activiteit';
    const taskTitle = tasks.querySelector('h3');
    if (taskTitle) taskTitle.textContent = 'Openstaande taken';
    grid.replaceChildren(shortcuts, activity, tasks);
    // Rebuild the visual container, not the live statistics control. The
    // original v3.1 card inherits grid sizing that stretches on narrower
    // layouts, even when later CSS asks for content height.
    const statsToolbar = make('section', 'bb-v35-stats-toolbar');
    statsToolbar.setAttribute('aria-label', 'Schoolstatistieken');
    const statsCopy = make('div', 'bb-v35-stats-copy');
    const statsTitle = stats.querySelector('h3');
    const statsDescription = stats.querySelector('p');
    const statsControls = stats.querySelector('#bb-admin-v31-stats');
    if (statsTitle) statsCopy.append(statsTitle);
    if (statsDescription) statsCopy.append(statsDescription);
    statsToolbar.append(statsCopy);
    if (statsControls) statsToolbar.append(statsControls);
    grid.after(statsToolbar);
    stats.remove();

    const metrics = overview.querySelector('#admin-modern-metrics');
    if (metrics) {
      const labels = ['Naar boeken', 'Naar personen', 'Naar docenten', 'Naar klassen'];
      const clickers = [
        () => chooseAdmin('books'), () => chooseAdmin('people','students'),
        () => chooseAdmin('people','teachers'), () => chooseAdmin('classes'),
      ];
      const decorate = () => {
        for (const [index, item] of [...metrics.querySelectorAll('.admin-modern__metric')].entries()) {
          if (item.dataset.v32Metric) continue;
          item.dataset.v32Metric = String(index);
          const metricIcon = item.querySelector('.bb-admin-v31-metric-icon');
          if (metricIcon) metricIcon.replaceChildren(makeIcon(['book','student','teacher','classes'][index]));
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
        const title = source.querySelector('.book-card__title')?.textContent?.trim() || 'Onbekende titel';
        const author = source.querySelector('.book-card__author')?.textContent?.trim() || '';
        // Explicitly represent unavailable artwork; never show empty white
        // covers or pretend a generated placeholder is the original cover.
        const appendFallback = () => {
          if (frame.querySelector('.bb-v32-cover-placeholder')) return;
          const fallback = make('span','bb-v32-cover-placeholder');
          fallback.append(
            make('small','bb-v32-cover-note','OMSLAG NIET BESCHIKBAAR'),
            make('strong','bb-v32-cover-title',title),
            make('small','bb-v32-cover-author',author)
          );
          frame.append(fallback);
        };
        if (sourceImage && !sourceImage.hidden && sourceImage.getAttribute('src')) {
          const image = make('img');
          image.src = sourceImage.getAttribute('src');
          image.alt = '';
          image.loading = 'lazy';
          image.addEventListener('error', () => {
            // The actual source card retries external covers as needed. This
            // miniature must not keep displaying a broken or blank bitmap.
            image.hidden = true;
            appendFallback();
          });
          image.addEventListener('load', () => {
            if (image.naturalWidth < 8 || image.naturalHeight < 8) {
              image.hidden = true;
              appendFallback();
            }
          });
          frame.append(image);
        } else {
          appendFallback();
        }
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
    // The live catalog performs cover recovery asynchronously: local URL ->
    // external URL -> fallback. Observe those exact source-image mutations as
    // well as book-card replacement; the preview is outside the observed grid.
    new MutationObserver(render).observe(grid, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'hidden'],
    });
  }
  // The existing class rows keep their own event handlers and role-scoped data.
  function installTeacherClassIcons() {
    const card = document.getElementById('bb-teacher-v31-classes-summary');
    if (!card || card.dataset.v34ClassIcons) return;
    card.dataset.v34ClassIcons = 'true';
    const decorate = () => {
      for (const row of card.querySelectorAll('.bb-teacher-v31-row')) {
        if (row.querySelector('.bb-v34-class-icon')) continue;
        const icon = make('span', 'bb-v34-class-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.append(makeIcon('classes'));
        row.prepend(icon);
      }
    };
    decorate();
    // Direct child changes only, decorating inside a row cannot loop.
    new MutationObserver(decorate).observe(card, { childList: true });
  }

  // History exposes localized messages but no machine-readable action type.
  // Recognize known phrases, use a neutral clock for unknown actions.
  function classifyHistoryAction(message) {
    const value = String(message || '').toLocaleLowerCase('nl-NL');
    if (/ingeleverd|teruggebracht|teruggegeven|inname|ingenomen/.test(value)) return 'return';
    if (/uitgeleend|uitlening|geleend|leent|lening/.test(value)) return 'lending';
    if (/import|excel|parnassys/.test(value)) return 'import';
    if (/docent|leerkracht|mentor/.test(value)) return 'teacher';
    if (/klas|leerling|student|account|koppel|overgezet/.test(value)) return 'student';
    if (/boek|bibliotheek|isbn|titel|exemplaar/.test(value)) return 'book';
    return 'activity';
  }
  function installActivityIcons() {
    const list = document.getElementById('history-list');
    if (!list || list.dataset.v34ActivityIcons) return;
    list.dataset.v34ActivityIcons = 'true';
    const decorate = () => {
      for (const entry of list.querySelectorAll(':scope > .history-item')) {
        if (entry.querySelector('.bb-v34-activity-icon')) continue;
        const time = entry.querySelector('.history-item__time');
        if (!time) continue; // No icon on empty state, loading, or error.
        const kind = classifyHistoryAction(time.nextElementSibling?.textContent || '');
        const icon = make('span', 'bb-v34-activity-icon');
        icon.dataset.kind = kind;
        icon.setAttribute('aria-hidden', 'true');
        icon.append(makeIcon(kind));
        entry.classList.add('bb-v34-history-entry');
        entry.prepend(icon);
      }
    };
    decorate();
    new MutationObserver(decorate).observe(list, { childList: true });
  }
  function enhanceTeacherDashboard() {
    if (teacherLayoutDone) return;
    const start = document.querySelector('[data-teacher-view="start"]');
    const left = start?.querySelector('.bb-teacher-v31-dashboard-column:first-child');
    const right = start?.querySelector('.bb-teacher-v31-dashboard-column:last-child');
    const task = right?.querySelector('.bb-teacher-v31-card');
    if (!start || !left || !right || !task) return;
    teacherLayoutDone = true;
    start.classList.add('bb-v32-dashboard', 'bb-v32-teacher-dashboard');
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
    installTeacherClassIcons();
  }
  function sync() {
    const teacherNav = document.getElementById('bb-teacher-v31-sidebar');
    if (teacherNav && document.body.classList.contains('bb-teacher-v31')
      && window.matchMedia('(min-width:761px)').matches) teacherNav.inert = false;
    if (document.body.classList.contains('bb-admin-v31')) {
      installHeader(document.getElementById('bb-admin-v31-sidebar'), 'admin');
      enhanceAdminDashboard();
      installActivityIcons();
    }
    if (document.body.classList.contains('bb-teacher-v31')) {
      installHeader(document.getElementById('bb-teacher-v31-sidebar'), 'teacher');
      enhanceTeacherDashboard();
      installTeacherBooks();
      installTeacherClassIcons();
      installActivityIcons();
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  observer.observe(hero, { childList: true });
  window.addEventListener('resize', sync);
  sync();
})();