(() => {
  'use strict';

  const syncState = {
    student: { fileData: '', manualMatches: {}, legacyResolutions: {},
      legacyDetailsOpen: false, preview: null, revision: 0 },
    teacher: { fileData: '', manualMatches: {}, teacherResolutions: {},
      teacherDetailsOpen: false, preview: null, revision: 0 },
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
        text: kind==='teacher'
          ? 'Bij meerdere docentaccounts met dezelfde naam moet je het juiste '
            +'bestaande account kiezen. Als er geen keuze beschikbaar is, '
            +'controleer de medewerkersexport en de bestaande accounts.'
          : 'Boekenbaai denkt dat deze ParnasSys-leerling mogelijk al handmatig is toegevoegd. Kies alleen een bestaand account als het echt dezelfde leerling is.',
      })
    );
    for (const review of reviews) {
      const row = make('div', { className: 'school-sync__review-row' });
      const info = make('div');
      info.append(
        make('strong', { text: kind==='teacher'
          ? `${review.name} · Excelrij ${review.row||'onbekend'}`
          : `${review.name} · leerlingnummer ${review.studentNumber}` }),
        make('span', { text: (review.classes || []).join(', ') || 'Geen klas' })
      );
      const select = document.createElement('select');
      const key=kind==='teacher'?review.sourceKey:review.studentNumber;
      select.append(new Option('Kies het bestaande account…', ''));
      for (const candidate of review.candidates || []) {
        const classes = (candidate.classNames || []).join(', ');
        select.append(new Option(
          `${candidate.name}${classes ? ` · ${classes}` : ''}${candidate.username
            ? ` · ${candidate.username}` : ''}`, candidate.id));
      }
      if(kind==='student')
        select.append(new Option('Geen match, maak een nieuw leerlingaccount', '__new__'));
      select.value = syncState[kind].manualMatches[key] || '';
      select.addEventListener('change', async () => {
        if (select.value) syncState[kind].manualMatches[key] = select.value;
        else delete syncState[kind].manualMatches[key];
        syncState[kind].preview = null;
        syncState[kind].revision += 1;
        select.disabled = true;
        await rerun();
      });
      if(kind==='teacher'&&!(review.candidates||[]).length){
        row.append(info,make('p',{className:'hint',text:
          'Controleer of corrigeer de export. Deze rij kan nog niet veilig worden gesynchroniseerd.'}));
      } else row.append(info,select);
      box.append(row);
    }
    resultHost.append(box);
  }

  function renderLegacyAccounts(kind, resultHost, payload, rerun) {
    if (kind !== 'student') return;
    const missing = (payload.results || []).filter(row =>
      ['legacy-needs-review', 'legacy-reviewed'].includes(row.status));
    if (!missing.length) return;
    const box = make('section', { className: 'admin-modern__import-warnings school-sync__review' });
    const assumed = missing.filter(student => student.chosen === 'exit').length;
    const kept = missing.filter(student => student.chosen === 'keep').length;
    box.append(
      make('h5', { text: 'Oude leerlingaccounts (' + missing.length + ')' }),
      make('p', { className: 'hint', text:
        'Omdat dit een volledige ParnasSys-export is, worden '
        + assumed + ' oude, niet-gekoppelde accounts standaard als uitgeschreven beschouwd. '
        + 'Bij synchronisatie verdwijnen zij uit de huidige klas. Zonder bibliotheekgegevens '
        + 'worden ze alleen na extra bevestiging verwijderd. Met bewaarde gegevens blijven '
        + 'ze inactief bestaan en krijgen ze een uitschrijftaak. '
        + 'Controleer hieronder alleen de uitzonderingen.' }),
    );
    const list = document.createElement('details');
    list.open = Boolean(syncState[kind].legacyDetailsOpen);
    list.append(make('summary', { text:
      'Bekijk ' + missing.length + ' oude accounts en pas uitzonderingen aan'
      + (kept ? ' (' + kept + ' behouden)' : '') }));
    list.addEventListener('toggle', () => {
      syncState[kind].legacyDetailsOpen = list.open;
    });
    for (const student of missing) {
      const row = make('div', { className: 'school-sync__review-row' });
      const details = make('div');
      details.append(
        make('strong', { text: student.name }),
        make('span', { text: 'Vorige klas: '
          + ((student.classes || []).join(', ') || 'Niet bekend') }),
      );
      const select = document.createElement('select');
      select.append(new Option('Uitgeschreven (standaard)', 'exit'));
      select.append(new Option('Leerling zit nog op school, account behouden', 'keep'));
      select.value = student.chosen || 'exit';
      select.addEventListener('change', async () => {
        if (select.value === 'keep') syncState[kind].legacyResolutions[student.id] = 'keep';
        else delete syncState[kind].legacyResolutions[student.id];
        syncState[kind].preview = null;
        syncState[kind].revision += 1;
        select.disabled = true;
        await rerun();
      });
      row.append(details, select);
      list.append(row);
    }
    box.append(list);
    resultHost.append(box);
  }

  function renderTeacherExits(kind, resultHost, payload, rerun) {
    if(kind!=='teacher')return;
    const accounts=(payload.results||[]).filter(row=>
      row.status==='teacher-legacy-reviewed');
    if(!accounts.length)return;
    const box=make('section',{className:'admin-modern__import-warnings school-sync__review'});
    box.append(make('h5',{text:'Oude docentaccounts ('+accounts.length+')'}),
      make('p',{className:'hint',text:
        'De volledige medewerkerslijst is leidend. Niet-gekoppelde docentaccounts '
        +'staan standaard op uitgeschreven. Ze verliezen hun klasrechten en toegang. '
        +'Accounts zonder te bewaren gegevens kunnen na extra bevestiging worden '
        +'verwijderd; overige blijven inactief bewaard en krijgen een beheerderstaak. '
        +'Controleer alleen eventuele uitzonderingen.'}));
    const details=document.createElement('details');
    details.open=Boolean(syncState.teacher.teacherDetailsOpen);
    details.addEventListener('toggle',()=>{
      syncState.teacher.teacherDetailsOpen=details.open;
    });
    details.append(make('summary',{text:
      'Bekijk '+accounts.length+' oude docenten en pas uitzonderingen aan'}));
    for(const teacher of accounts){
      const row=make('div',{className:'school-sync__review-row'});
      const info=make('div');
      info.append(make('strong',{text:teacher.name}));
      const select=document.createElement('select');
      select.append(new Option('Uitgeschreven (standaard)','exit'));
      select.append(new Option('Docent werkt nog op school, behouden','keep'));
      select.value=teacher.chosen||'exit';
      select.addEventListener('change',async()=>{
        if(select.value==='keep')syncState.teacher.teacherResolutions[teacher.id]='keep';
        else delete syncState.teacher.teacherResolutions[teacher.id];
        syncState.teacher.preview=null;syncState.teacher.revision++;
        select.disabled=true;
        await rerun();
      });
      row.append(info,select);details.append(row);
    }
    box.append(details);resultHost.append(box);
  }

  let teacherTaskRefresh=0;
  async function loadTeacherExitTasks(attempt=0){
    const host=document.getElementById('teacher-exit-tasks-panel');
    if(!host){
      if(attempt<12)window.setTimeout(()=>loadTeacherExitTasks(attempt+1),250);
      return;
    }
    const request=++teacherTaskRefresh;
    try{
      const response=await api('/api/admin/teacher-exits');
      if(request!==teacherTaskRefresh)return;
      const tasks=(response.tasks||[]).filter(task=>task.status!=='cancelled');
      host.replaceChildren();
      if(!tasks.length)return;
      const active=tasks.filter(task=>task.status==='open');
      const section=make('section',{className:'panel school-sync__teacher-exit-tasks'});
      section.append(make('h3',{text:'Uitschrijven oud-docenten ('+active.length+')'}));
      section.append(make('p',{className:'hint',text:
        'Oud-docenten hebben geen toegang meer tot Boekenbaai en zijn '
        +'niet aan actuele klassen gekoppeld. Hun historische gegevens blijven '
        +'bewaard. De beheerder kan de controle afronden.'}));
      for(const task of active){
        const row=make('div',{className:'school-sync__review-row'});
        const info=make('div');
        info.append(make('strong',{text:task.teacherName}));
        info.append(make('span',{text:'Voormalige klas(sen): '
          +((task.lastClasses||[]).map(k=>k.name).join(', ')||'Geen')}));
        const done=make('button',{className:'btn btn--secondary',type:'button',
          text:'Uitschrijfcontrole afronden'});
        done.addEventListener('click',async()=>{
          if(!window.confirm('Uitschrijfcontrole van '+task.teacherName
            +' afronden? De historische gegevens blijven bewaard.'))return;
          done.disabled=true;
          try{
            await api('/api/admin/teacher-exits/'+encodeURIComponent(task.id)
              +'/complete',{method:'POST',body:{revision:task.revision,confirm:true}});
            loadTeacherExitTasks();
          }catch(error){window.alert(error.message);done.disabled=false;}
        });
        row.append(info,done);section.append(row);
      }
      const completed=tasks.filter(task=>task.status==='completed');
      if(completed.length){
        const details=document.createElement('details');
        details.append(make('summary',{text:'Afgeronde controles ('+completed.length+')'}));
        for(const task of completed){
          details.append(make('p',{className:'hint',text:task.teacherName
            +' · '+((task.lastClasses||[]).map(k=>k.name).join(', ')||'Geen klas')}));
        }
        section.append(details);
      }
      host.append(section);
    }catch(error){
      if(request===teacherTaskRefresh)host.replaceChildren(
        make('p',{className:'hint',text:'Uitschrijftaken konden niet geladen worden: '
          +error.message}));
    }
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
      if (summary.legacyAccountsWithoutNumber) {
        grid.append(metric('Oude accounts zonder leerlingnummer',
          summary.legacyAccountsWithoutNumber));
      }
      if (summary.missingFromImport) {
        grid.append(metric('Zonder boekgegevens te verwijderen', summary.deletionEligible));
        grid.append(metric('Uitschrijftaken met historie', summary.exitTasks));
        if (summary.exitTasksWithBooks)
          grid.append(metric('Nog boeken in bezit', summary.exitTasksWithBooks));
      }
    }
    if (kind === 'teacher') {
      grid.append(metric('Zonder gekoppelde groep', summary.teachersWithoutGroups));
      if (fullSchoolSync) {
        grid.append(metric('Niet meer in medewerkerslijst', summary.missingTeachersFromImport));
        grid.append(metric('Accounts zonder historie te verwijderen',
          summary.teacherDeletionEligible));
        grid.append(metric('Uitschrijftaken met historie', summary.teacherExitTasks));
      }
    }
    wrapper.append(grid);

    if (kind === 'student' && fullSchoolSync && summary.missingFromImport) {
      const note = make('div', { className: 'admin-modern__import-warnings' });
      note.append(
        make('h5', { text: `${summary.missingFromImport} leerling${summary.missingFromImport === 1 ? '' : 'en'} niet meer in de export` }),
        make('p', {
          className: 'hint',
          text: 'Accounts zonder historische bibliotheekgegevens worden alleen na extra bevestiging verwijderd. '
            + 'Leerlingen met leesgegevens of uitleningen worden inactief, verdwijnen uit de huidige klas '
            + 'en krijgen een uitschrijftaak voor de voormalige docent en beheerder. '
            + 'Lopende uitleningen blijven geregistreerd en moeten worden ingenomen voordat de taak sluit.',
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
          text: 'Bij synchroniseren verliezen vertrokken docenten hun toegang en klasrechten. '
            + 'Lege accounts kunnen na extra bevestiging worden verwijderd. '
            + 'Accounts met historie blijven inactief bewaard met een taak voor beheer. '
            + 'Docenten die wel in de export staan maar geen groep hebben, blijven actief.',
        })
      );
      wrapper.append(note);
    }

    resultHost.append(wrapper);
    renderReviewRows(kind, resultHost, payload, rerun);
    if (fullSchoolSync) {
      renderLegacyAccounts(kind, resultHost, payload, rerun);
      renderTeacherExits(kind, resultHost, payload, rerun);
    }

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
      syncState[kind].revision += 1;
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
          : 'Upload de volledige onbewerkte medewerkerslijst uit ParnasSys. Boekenbaai gebruikt naam en Gekoppelde groepen. Ook docenten zonder gekoppelde groep blijven actief. Ontbrekende docentaccounts worden standaard uitgeschreven; je kunt uitzonderingen behouden.',
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
      const requestRevision = syncState[kind].revision + 1;
      syncState[kind].revision = requestRevision;
      syncState[kind].preview = null;
      results.replaceChildren();
      const fileData = syncState[kind].fileData;
      const fullSchoolSync = full.checkbox.checked;
      const manualMatches = { ...syncState[kind].manualMatches };
      const legacyResolutions = { ...(syncState[kind].legacyResolutions || {}) };
      const teacherResolutions = { ...(syncState[kind].teacherResolutions || {}) };
      previewButton.disabled = true;
      message.textContent = 'Voorcontrole wordt uitgevoerd…';
      try {
        const payload = await api('/api/admin/school-sync/preview', {
          method: 'POST',
          body: {
            kind,
            file: fileData,
            fullSchoolSync,
            manualMatches,
            legacyResolutions,
            teacherResolutions,
          },
        });
        if (
          requestRevision !== syncState[kind].revision ||
          fileData !== syncState[kind].fileData ||
          fullSchoolSync !== full.checkbox.checked
        ) return;
        syncState[kind].preview = payload;
        message.textContent = 'Voorcontrole gereed.';
        renderPreview(kind, results, payload, fullSchoolSync, runPreview, applySync);
      } catch (error) {
        if (requestRevision === syncState[kind].revision) message.textContent = error.message;
      } finally {
        if (requestRevision === syncState[kind].revision) previewButton.disabled = false;
      }
    }

    async function applySync() {
      const preview = syncState[kind].preview;
      if (!preview) {
        message.textContent = 'Voer eerst een actuele voorcontrole uit.';
        return;
      }
      const summary = preview.summary || {};
      if (summary.needsReview) return;
      message.textContent = 'Synchronisatie wordt uitgevoerd…';
      let confirmLargeRemoval = false;
      let confirmPupilRemoval = false;
      let confirmTeacherRemoval = false;
      if(kind==='teacher'&&full.checkbox.checked&&
        Number(summary.teacherDeletionEligible||0)>0){
        confirmTeacherRemoval=window.confirm('Let op: '
          +summary.teacherDeletionEligible
          +' docentaccount(s) zonder bewaarde gegevens worden definitief '
          +'verwijderd. Docenten met historie blijven inactief bewaard. '
          +'Bevestig je het verwijderen van deze accounts?');
        if(!confirmTeacherRemoval){
          message.textContent='Synchronisatie geannuleerd.';
          return;
        }
      }
      if (kind==='student' && full.checkbox.checked
        && Number(summary.deletionEligible||0)>0) {
        confirmPupilRemoval=window.confirm(
          'Let op: '+summary.deletionEligible
          +' leerlingaccount(s) zonder bibliotheekgegevens worden definitief verwijderd. '
          +'Leerlingen met leesgegevens of uitleningen blijven bewaard als inactief account. '
          +'Wil je de lege accounts verwijderen?');
        if(!confirmPupilRemoval) {
          message.textContent='Synchronisatie geannuleerd.';
          return;
        }
      }
      if (summary.largeRemovalWarning) {
        const count = kind === 'teacher'
          ? Number(summary.missingTeachersFromImport || 0)
          : Number(summary.missingFromImport || 0);
        const warning = kind === 'teacher'
          ? `Let op: ${count} docenten staan niet in deze volledige medewerkerslijst en worden inactief. Weet je zeker dat dit de volledige ParnasSys-medewerkersexport is?`
          : `Let op: ${count} leerlingen staan niet in deze volledige schoollijst. Sommige worden verwijderd en andere krijgen een uitschrijftaak. Weet je zeker dat dit de volledige ParnasSys-export van school is?`;
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
              legacyResolutions: syncState[kind].legacyResolutions || {},
              teacherResolutions: syncState[kind].teacherResolutions || {},
              confirmTeacherRemoval,
              expectedTeacherDeletionCount:Number(summary.teacherDeletionEligible||0),
              expectedTeacherDeletionFingerprint:summary.teacherDeletionCandidateFingerprint||'',
              expectedTeacherExitFingerprint:summary.teacherExitCandidateFingerprint||'',
              confirmLargeRemoval,
              confirmPupilRemoval,
              expectedDeletionCount:Number(summary.deletionEligible||0),
              expectedDeletionFingerprint:summary.deletionCandidateFingerprint||'',
              expectedExitFingerprint:summary.exitCandidateFingerprint||'',
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
              legacyResolutions: syncState[kind].legacyResolutions || {},
              teacherResolutions: syncState[kind].teacherResolutions || {},
              confirmTeacherRemoval,
              expectedTeacherDeletionCount:Number(summary.teacherDeletionEligible||0),
              expectedTeacherDeletionFingerprint:summary.teacherDeletionCandidateFingerprint||'',
              expectedTeacherExitFingerprint:summary.teacherExitCandidateFingerprint||'',
              confirmLargeRemoval: true,
              confirmPupilRemoval,
              expectedDeletionCount:Number(summary.deletionEligible||0),
              expectedDeletionFingerprint:summary.deletionCandidateFingerprint||'',
              expectedExitFingerprint:summary.exitCandidateFingerprint||'',
            },
          });
        }
        const done = payload.summary || {};
        message.textContent = `${done.created || 0} nieuw, ${done.updated || 0} gewijzigd, ${done.unchanged || 0} ongewijzigd${done.deleted ? `, ${done.deleted} lege accounts verwijderd` : ''}${done.deactivated ? `, ${done.deactivated} inactief met uitschrijftaak` : ''}.`;
        if(kind==='teacher')loadTeacherExitTasks();
        results.replaceChildren(make('p', { className: 'admin-modern__import-done', text: 'Schoolgegevens zijn gesynchroniseerd. De pagina wordt bijgewerkt…' }));
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        message.textContent = error.message;
      }
    }

    file.addEventListener('change', async () => {
      syncState[kind].manualMatches = {};
      if (kind === 'student') syncState[kind].legacyResolutions = {};
      if (kind === 'teacher') syncState.teacher.teacherResolutions = {};
      syncState[kind].preview = null;
      syncState[kind].fileData = '';
      syncState[kind].revision += 1;
      const fileRevision = syncState[kind].revision;
      results.replaceChildren();
      const selected = file.files?.[0];
      previewButton.disabled = Boolean(selected);
      if (!selected) {
        message.textContent = '';
        return;
      }
      message.textContent = 'Bestand wordt gelezen…';
      try {
        const fileData = await readFileBase64(selected);
        if (fileRevision !== syncState[kind].revision) return;
        syncState[kind].fileData = fileData;
        previewButton.disabled = false;
        message.textContent = `${selected.name} klaar voor voorcontrole.`;
      } catch (error) {
        if (fileRevision !== syncState[kind].revision) return;
        previewButton.disabled = false;
        message.textContent = error.message;
      }
    });
    previewButton.addEventListener('click', runPreview);
    full.checkbox.addEventListener('change', () => {
      const hadPreview = Boolean(syncState[kind].preview);
      syncState[kind].preview = null;
      syncState[kind].revision += 1;
      results.replaceChildren();
      if (hadPreview && syncState[kind].fileData) runPreview();
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
    window.addEventListener('boekenbaai:staff-refresh',()=>loadTeacherExitTasks());
    window.addEventListener('boekenbaai:mentor-tasks-refresh',
      ()=>loadTeacherExitTasks());
    loadTeacherExitTasks();
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