(() => {
  'use strict';

  const syncState = {
    student: { fileData: '', manualMatches: {}, preview: null },
    teacher: { fileData: '', manualMatches: {}, preview: null },
  };

  function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
  }

  async function api(url, options = {}) {
    const config = { method: 'GET', credentials: 'same-origin', ...options };
    config.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (config.body && typeof config.body !== 'string') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Actie mislukt (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Kon het Excelbestand niet lezen.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',').pop() : value);
      };
      reader.readAsDataURL(file);
    });
  }

  function metric(label, value) {
    const card = make('div', { className: 'admin-modern__metric' });
    card.append(make('strong', { text: String(value || 0) }), make('span', { text: label }));
    return card;
  }

  function fullSyncLabel(kind) {
    const label = make('label', { className: 'school-sync__full-list' });
    const checkbox = make('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    label.append(
      checkbox,
      document.createTextNode(
        kind === 'student'
          ? ' Dit is de volledige schoolbrede leerlingenlijst'
          : ' Dit is de volledige medewerkerslijst'
      )
    );
    return { label, checkbox };
  }

  function renderReviewRows(kind, resultHost, payload, rerun) {
    const reviews = (payload.results || []).filter((entry) => entry.status === 'needs-review');
    if (!reviews.length) return;
    const box = make('section', { className: 'admin-modern__import-warnings school-sync__review' });
    box.append(
      make('h5', { text: `Even controleren (${reviews.length})` }),
      make('p', {
        className: 'hint',
        text: 'Boekenbaai denkt dat deze ParnasSys-leerling mogelijk al handmatig is toegevoegd. Kies alleen een bestaand account als het echt dezelfde leerling is.',
      })
    );
    for (const review of reviews) {
      const row = make('div', { className: 'school-sync__review-row' });
      const info = make('div');
      info.append(
        make('strong', { text: `${review.name} · leerlingnummer ${review.studentNumber}` }),
        make('span', { text: (review.classes || []).join(', ') || 'Geen klas' })
      );
      const select = document.createElement('select');
      select.append(new Option('Kies het bestaande account…', ''));
      for (const candidate of review.candidates || []) {
        const classes = (candidate.classNames || []).join(', ');
        select.append(new Option(`${candidate.name}${classes ? ` · ${classes}` : ''}`, candidate.id));
      }
      select.append(new Option('Geen match, maak een nieuw leerlingaccount', '__new__'));
      select.value = syncState[kind].manualMatches[review.studentNumber] || '';
      select.addEventListener('change', async () => {
        if (select.value) syncState[kind].manualMatches[review.studentNumber] = select.value;
        else delete syncState[kind].manualMatches[review.studentNumber];
        select.disabled = true;
        await rerun();
      });
      row.append(info, select);
      box.append(row);
    }
    resultHost.append(box);
  }

  function renderPreview(kind, resultHost, payload, fullSchoolSync, rerun, apply) {
    resultHost.replaceChildren();
    const summary = payload.summary || {};
    const wrapper = make('div', { className: 'admin-modern__import-preview school-sync__preview' });
    const grid = make('div', { className: 'admin-modern__preview-grid' });
    grid.append(
      metric('Nieuw', summary.created),
      metric('Gewijzigd', summary.updated),
      metric('Ongewijzigd', summary.unchanged),
      metric('Controleren', summary.needsReview)
    );
    if (kind === 'student' && fullSchoolSync) {
      grid.append(metric('Niet meer in schoollijst', summary.missingFromImport));
    }
    if (kind === 'teacher') {
      grid.append(metric('Zonder gekoppelde groep', summary.teachersWithoutGroups));
      if (fullSchoolSync) grid.append(metric('Niet meer in medewerkerslijst', summary.missingTeachersFromImport));
    }
    wrapper.append(grid);

    if (kind === 'student' && fullSchoolSync && summary.missingFromImport) {
      const note = make('div', { className: 'admin-modern__import-warnings' });
      note.append(
        make('h5', { text: `${summary.missingFromImport} leerling${summary.missingFromImport === 1 ? '' : 'en'} niet meer in de export` }),
        make('p', {
          className: 'hint',
          text: 'Bij synchroniseren worden deze leerlingen inactief en verdwijnen ze uit de loginlijst. Hun uitleenhistorie blijft bewaard. Leerlingen met nog uitgeleende boeken worden niet automatisch afgemeld.',
        })
      );
      wrapper.append(note);
    }

    if (kind === 'teacher' && fullSchoolSync && summary.missingTeachersFromImport) {
      const note = make('div', { className: 'admin-modern__import-warnings' });
      note.append(
        make('h5', { text: `${summary.missingTeachersFromImport} docent${summary.missingTeachersFromImport === 1 ? '' : 'en'} niet meer in de export` }),
        make('p', {
          className: 'hint',
          text: 'Bij synchroniseren worden deze docenten inactief en verliezen zij hun klasrechten. Bij een opvallend grote afname vraagt Boekenbaai extra bevestiging om een per ongeluk gefilterde of partiële export op te vangen.',
        })
      );
      wrapper.append(note);
    }

    resultHost.append(wrapper);
    renderReviewRows(kind, resultHost, payload, rerun);

    const actions = make('div', { className: 'admin-modern__preview-actions school-sync__actions' });
    const sync = make('button', { className: 'btn', text: 'Synchroniseren', type: 'button' });
    const cancel = make('button', { className: 'btn btn--ghost', text: 'Voorcontrole wissen', type: 'button' });
    sync.disabled = Boolean(summary.needsReview);
    if (summary.needsReview) {
      const hint = make('p', {
        className: 'hint',
        text: 'Koppel eerst de twijfelgevallen hierboven. Daarna wordt de voorcontrole automatisch opnieuw berekend.',
      });
      resultHost.append(hint);
    }
    sync.addEventListener('click', apply);
    cancel.addEventListener('click', () => {
      syncState[kind].preview = null;
      resultHost.replaceChildren();
    });
    actions.append(sync, cancel);
    resultHost.append(actions);
  }

  function createSyncBlock(kind) {
    const isStudent = kind === 'student';
    const block = make('section', { className: 'admin-card__section admin-card__section--import school-sync__block' });
    block.append(
      make('h4', { text: isStudent ? 'ParnasSys leerlingen synchroniseren' : 'ParnasSys medewerkers synchroniseren' }),
      make('p', {
        className: 'hint',
        text: isStudent
          ? 'Exporteer de hele leerlingenlijst uit ParnasSys en upload die hier direct. Je hoeft geen kolommen te verwijderen of te hernoemen. Boekenbaai gebruikt Leerlingnummer, Huidige groep, Roepnaam, Voorvoegsel en Achternaam; extra kolommen zoals Huidige status worden genegeerd.'
          : 'Upload de onbewerkte medewerkerslijst uit ParnasSys. Boekenbaai gebruikt de naam en Gekoppelde groepen. Alleen medewerkers met minimaal één gekoppelde groep krijgen een actief docentaccount; één docent mag meerdere groepen hebben.',
      })
    );

    const fileLabel = make('label', { text: 'Excelbestand kiezen' });
    const file = make('input');
    file.type = 'file';
    file.accept = '.xlsx,.xls';
    fileLabel.append(file);
    const full = fullSyncLabel(kind);
    const previewButton = make('button', { className: 'btn btn--secondary', text: 'Voorcontrole', type: 'button' });
    const message = make('p', { className: 'hint', text: '' });
    message.setAttribute('role', 'status');
    const results = make('div', { className: 'import-results school-sync__results' });
    const controls = make('div', { className: 'school-sync__controls' });
    controls.append(fileLabel, full.label, previewButton);
    block.append(controls, message, results);

    async function runPreview() {
      if (!syncState[kind].fileData) {
        message.textContent = 'Kies eerst een Excelbestand.';
        return;
      }
      previewButton.disabled = true;
      message.textContent = 'Voorcontrole wordt uitgevoerd…';
      try {
        const payload = await api('/api/admin/school-sync/preview', {
          method: 'POST',
          body: {
            kind,
            file: syncState[kind].fileData,
            fullSchoolSync: full.checkbox.checked,
            manualMatches: syncState[kind].manualMatches,
          },
        });
        syncState[kind].preview = payload;
        message.textContent = 'Voorcontrole gereed.';
        renderPreview(kind, results, payload, full.checkbox.checked, runPreview, applySync);
      } catch (error) {
        message.textContent = error.message;
      } finally {
        previewButton.disabled = false;
      }
    }

    async function applySync() {
      const summary = syncState[kind].preview?.summary || {};
      if (summary.needsReview) return;
      message.textContent = 'Synchronisatie wordt uitgevoerd…';
      let confirmLargeRemoval = false;
      if (summary.largeRemovalWarning) {
        const count = kind === 'teacher'
          ? Number(summary.missingTeachersFromImport || 0)
          : Number(summary.missingFromImport || 0);
        const warning = kind === 'teacher'
          ? `Let op: ${count} docenten staan niet in deze volledige medewerkerslijst en worden inactief. Weet je zeker dat dit de volledige ParnasSys-medewerkersexport is?`
          : `Let op: ${count} leerlingen staan niet in deze volledige schoollijst en worden inactief. Weet je zeker dat dit de volledige ParnasSys-export van school is?`;
        confirmLargeRemoval = window.confirm(warning);
        if (!confirmLargeRemoval) {
          message.textContent = 'Synchronisatie geannuleerd.';
          return;
        }
      }
      try {
        let payload;
        try {
          payload = await api('/api/admin/school-sync/apply', {
            method: 'POST',
            body: {
              kind,
              file: syncState[kind].fileData,
              fullSchoolSync: full.checkbox.checked,
              manualMatches: syncState[kind].manualMatches,
              confirmLargeRemoval,
            },
          });
        } catch (error) {
          if (error.payload?.code !== 'large-removal-confirmation') throw error;
          const confirmed = window.confirm(`${error.message}\n\nDoorgaan?`);
          if (!confirmed) throw new Error('Synchronisatie geannuleerd.');
          payload = await api('/api/admin/school-sync/apply', {
            method: 'POST',
            body: {
              kind,
              file: syncState[kind].fileData,
              fullSchoolSync: full.checkbox.checked,
              manualMatches: syncState[kind].manualMatches,
              confirmLargeRemoval: true,
            },
          });
        }
        const done = payload.summary || {};
        message.textContent = `${done.created || 0} nieuw, ${done.updated || 0} gewijzigd, ${done.unchanged || 0} ongewijzigd${done.deactivated ? `, ${done.deactivated} inactief gemaakt` : ''}.`;
        results.replaceChildren(make('p', { className: 'admin-modern__import-done', text: 'Schoolgegevens zijn gesynchroniseerd. De pagina wordt bijgewerkt…' }));
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        message.textContent = error.message;
      }
    }

    file.addEventListener('change', async () => {
      syncState[kind].manualMatches = {};
      syncState[kind].preview = null;
      results.replaceChildren();
      const selected = file.files?.[0];
      if (!selected) {
        syncState[kind].fileData = '';
        message.textContent = '';
        return;
      }
      message.textContent = 'Bestand wordt gelezen…';
      try {
        syncState[kind].fileData = await readFileBase64(selected);
        message.textContent = `${selected.name} klaar voor voorcontrole.`;
      } catch (error) {
        syncState[kind].fileData = '';
        message.textContent = error.message;
      }
    });
    previewButton.addEventListener('click', runPreview);
    full.checkbox.addEventListener('change', () => {
      if (syncState[kind].preview) runPreview();
    });
    return block;
  }

  function install(attempt = 0) {
    const importsCard = document.querySelector('.admin-card--imports');
    const content = importsCard?.querySelector('.admin-card__content');
    const studentForm = document.querySelector('#student-import-form');
    const teacherForm = document.querySelector('#teacher-import-form');
    if (!importsCard || !content || !studentForm || !teacherForm) {
      if (attempt < 120) window.setTimeout(() => install(attempt + 1), 100);
      return;
    }
    if (content.querySelector('.school-sync__container')) return;

    const studentLegacy = studentForm.closest('.admin-card__section--import');
    const teacherLegacy = teacherForm.closest('.admin-card__section--import');
    if (studentLegacy) studentLegacy.hidden = true;
    if (teacherLegacy) teacherLegacy.hidden = true;

    const container = make('div', { className: 'school-sync__container' });
    container.append(createSyncBlock('student'), createSyncBlock('teacher'));
    const bookSection = document.querySelector('#book-import-form')?.closest('.admin-card__section--import');
    if (bookSection?.nextSibling) content.insertBefore(container, bookSection.nextSibling);
    else content.prepend(container);

    const style = document.createElement('style');
    style.textContent = `
      .school-sync__container { display:grid; gap:1rem; }
      .school-sync__block { border-top:1px solid var(--accent-border); padding-top:1rem; }
      .school-sync__controls { display:grid; grid-template-columns:minmax(220px,1fr) auto auto; gap:.75rem; align-items:end; }
      .school-sync__controls label { display:grid; gap:.35rem; }
      .school-sync__full-list { display:flex !important; align-items:center; gap:.35rem; padding:.7rem 0; }
      .school-sync__review-row { display:grid; grid-template-columns:minmax(220px,1fr) minmax(220px,1fr); gap:.75rem; align-items:center; padding:.65rem 0; border-top:1px solid var(--accent-border); }
      .school-sync__review-row > div { display:grid; gap:.15rem; }
      .school-sync__actions { margin-top:.75rem; }
      @media (max-width:760px) { .school-sync__controls, .school-sync__review-row { grid-template-columns:1fr; } }
    `;
    document.head.append(style);
  }

  document.addEventListener('DOMContentLoaded', () => install());
})();
