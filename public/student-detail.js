(() => {
  'use strict';

  const ADMIN_HELP = 'Alleen Beheer kan dit wijzigen. Vraag de beheerder om dit aan te passen.';
  let managementState = null;
  let statePromise = null;
  let enhanceQueued = false;

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
    const token = window.localStorage.getItem('boekenbaai_token') || '';
    if (token && token !== 'cookie') config.headers.Authorization = `Bearer ${token}`;
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

  async function loadState({ force = false } = {}) {
    if (!force && managementState) return managementState;
    if (!force && statePromise) return statePromise;
    statePromise = api('/api/mentor/student-management')
      .then((payload) => {
        managementState = payload;
        return payload;
      })
      .finally(() => {
        statePromise = null;
      });
    return statePromise;
  }

  function ensureStyles() {
    if (document.querySelector('#student-detail-styles')) return;
    const style = document.createElement('style');
    style.id = 'student-detail-styles';
    style.textContent = `
      .student-management__student-row[data-student-detail-ready="true"] {
        cursor: pointer;
        border-radius: 12px;
        transition: background .15s ease, box-shadow .15s ease;
      }
      .student-management__student-row[data-student-detail-ready="true"]:hover,
      .student-management__student-row[data-student-detail-ready="true"]:focus-visible {
        background: rgba(255,255,255,.72);
        box-shadow: inset 0 0 0 1px rgba(65,86,117,.13);
        outline: none;
      }
      .student-management__student-row[data-student-detail-ready="true"] > .student-management__row-actions {
        display: none !important;
      }
      .student-detail__dialog {
        width: min(94vw, 680px);
        max-height: 88vh;
        border: 0;
        border-radius: 20px;
        padding: 0;
        box-shadow: 0 24px 70px rgba(18,34,58,.25);
      }
      .student-detail__dialog::backdrop { background: rgba(20,28,40,.42); }
      .student-detail__form { display: grid; gap: 1rem; padding: 1.35rem; }
      .student-detail__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
      }
      .student-detail__header h3 { margin: 0; }
      .student-detail__section {
        display: grid;
        gap: .8rem;
        padding: 1rem;
        border: 1px solid rgba(65,86,117,.14);
        border-radius: 15px;
        background: rgba(255,255,255,.52);
      }
      .student-detail__section h4 { margin: 0; }
      .student-detail__field { display: grid; gap: .35rem; position: relative; }
      .student-detail__field > span:first-child { font-weight: 600; font-size: .92rem; }
      .student-detail__field input,
      .student-detail__field select {
        width: 100%;
        box-sizing: border-box;
      }
      .student-detail__locked {
        position: relative;
        border-radius: 10px;
      }
      .student-detail__locked input,
      .student-detail__locked select {
        background: #eef0f3 !important;
        color: #6c737c !important;
        cursor: not-allowed;
        opacity: 1;
      }
      .student-detail__locked::after {
        content: attr(data-admin-help);
        display: none;
        position: absolute;
        z-index: 80;
        left: .25rem;
        bottom: calc(100% + .45rem);
        max-width: min(24rem, 80vw);
        padding: .55rem .7rem;
        border-radius: 9px;
        background: #202734;
        color: white;
        font-size: .8rem;
        line-height: 1.35;
        box-shadow: 0 8px 24px rgba(0,0,0,.2);
      }
      .student-detail__locked:hover::after,
      .student-detail__locked:focus::after,
      .student-detail__locked:focus-within::after { display: block; }
      .student-detail__actions {
        display: flex;
        flex-wrap: wrap;
        gap: .6rem;
        align-items: center;
      }
      .student-detail__actions--danger {
        justify-content: space-between;
        padding-top: .3rem;
      }
      .student-detail__message { min-height: 1.2em; margin: 0; }
      .student-detail__danger { color: #9b2c2c; }
      .student-detail__advanced summary { cursor: pointer; font-weight: 600; }
      .student-detail__advanced[open] summary { margin-bottom: .75rem; }
      @media (max-width: 620px) {
        .student-detail__form { padding: 1rem; }
        .student-detail__header { align-items: center; }
      }
    `;
    document.head.append(style);
  }

  function field(label, control, { locked = false, help = ADMIN_HELP } = {}) {
    const wrapper = make('label', { className: 'student-detail__field' });
    wrapper.append(make('span', { text: label }));
    if (!locked) {
      wrapper.append(control);
      return wrapper;
    }
    control.disabled = true;
    const lock = make('div', { className: 'student-detail__locked' });
    lock.tabIndex = 0;
    lock.dataset.adminHelp = help;
    lock.setAttribute('aria-label', `${label}. ${help}`);
    lock.append(control);
    wrapper.append(lock);
    return wrapper;
  }

  function findUnderlyingAction(row, label) {
    return Array.from(row?.querySelectorAll('.student-management__row-actions button') || [])
      .find((button) => button.textContent.trim() === label) || null;
  }

  function createDetailDialog(student, row, state) {
    const isAdmin = state.role === 'admin';
    const dialog = document.createElement('dialog');
    dialog.className = 'student-detail__dialog';
    const form = make('form', { className: 'student-detail__form' });
    form.noValidate = true;

    const header = make('div', { className: 'student-detail__header' });
    const heading = make('div');
    heading.append(
      make('h3', { text: student.name || 'Leerling' }),
      make('p', {
        className: 'hint',
        text: (student.classNames || []).join(', ') || 'Geen klas gekoppeld',
      })
    );
    const close = make('button', { className: 'btn btn--ghost', text: 'Sluiten', type: 'button' });
    close.addEventListener('click', () => dialog.close());
    header.append(heading, close);
    form.append(header);

    const basics = make('section', { className: 'student-detail__section' });
    basics.append(make('h4', { text: 'Leerlinggegevens' }));

    const name = make('input');
    name.value = student.name || '';
    name.autocomplete = 'off';
    basics.append(field('Naam', name, { locked: !isAdmin }));

    let classControl;
    if (isAdmin) {
      classControl = document.createElement('select');
      classControl.append(new Option('Kies klas', ''));
      for (const klass of state.classes || []) classControl.append(new Option(klass.name, klass.id));
      classControl.value = student.classIds?.[0] || '';
      basics.append(field('Klas', classControl));
      if ((student.classIds || []).length > 1) {
        basics.append(make('p', {
          className: 'hint',
          text: `Deze leerling staat nu in meerdere klassen (${(student.classNames || []).join(', ')}). Opslaan maakt de gekozen klas leidend.`,
        }));
      }
    } else {
      classControl = make('input');
      classControl.value = (student.classNames || []).join(', ') || 'Geen klas';
      basics.append(field('Klas', classControl, { locked: true }));
    }

    if (isAdmin) {
      basics.append(make('p', {
        className: 'hint',
        text: 'Naam en klas kunnen bij een volgende ParnasSys-sync opnieuw worden bijgewerkt vanuit de schooladministratie.',
      }));
    }
    form.append(basics);

    const google = make('section', { className: 'student-detail__section' });
    google.append(make('h4', { text: 'Google-schoolaccount' }));
    const googleEmail = make('input');
    googleEmail.type = 'email';
    googleEmail.value = student.googleEmail || '';
    googleEmail.placeholder = 'naam@koraaledu.nl';
    google.append(field('Schoolmail', googleEmail, { locked: !isAdmin }));
    google.append(make('p', {
      className: 'hint',
      text: student.googleLinked
        ? 'Google-account is geverifieerd en gekoppeld.'
        : student.googleEmail
          ? 'Schoolmail staat klaar voor de eerste Google-login.'
          : 'Nog geen schoolmail gekoppeld.',
    }));
    form.append(google);

    const advanced = document.createElement('details');
    advanced.className = 'student-detail__section student-detail__advanced';
    advanced.append(make('summary', { text: 'Geavanceerd' }));
    const number = make('input');
    number.value = student.parnassysStudentNumber || '';
    number.autocomplete = 'off';
    advanced.append(field('ParnasSys-leerlingnummer', number, { locked: !isAdmin }));
    if (isAdmin) {
      advanced.append(make('p', {
        className: 'hint',
        text: 'Dit nummer is de vaste koppelsleutel voor ParnasSys. Wijzig dit alleen als je zeker weet dat de koppeling fout staat.',
      }));
    }
    form.append(advanced);

    const message = make('p', { className: 'student-detail__message hint' });
    form.append(message);

    if (isAdmin) {
      const saveActions = make('div', { className: 'student-detail__actions' });
      const save = make('button', { className: 'btn', text: 'Leerlinggegevens opslaan', type: 'button' });
      save.addEventListener('click', async () => {
        if (!name.value.trim()) {
          message.textContent = 'Naam mag niet leeg zijn.';
          name.focus();
          return;
        }
        if (!classControl.value) {
          message.textContent = 'Kies een klas.';
          classControl.focus();
          return;
        }
        const currentNumber = student.parnassysStudentNumber || '';
        if (number.value.trim() !== currentNumber) {
          const confirmed = window.confirm(
            `ParnasSys-leerlingnummer wijzigen van “${currentNumber || 'geen'}” naar “${number.value.trim() || 'geen'}”?\n\nDit beïnvloedt de koppeling met toekomstige ParnasSys-syncs.`
          );
          if (!confirmed) return;
        }
        save.disabled = true;
        message.textContent = 'Leerlinggegevens worden opgeslagen…';
        try {
          await api(`/api/admin/students/${encodeURIComponent(student.id)}`, {
            method: 'PATCH',
            body: {
              name: name.value,
              classIds: [classControl.value],
              parnassysStudentNumber: number.value,
            },
          });
          message.textContent = 'Leerlinggegevens opgeslagen.';
          window.setTimeout(() => window.location.reload(), 450);
        } catch (error) {
          message.textContent = error.message;
          save.disabled = false;
        }
      });
      saveActions.append(save);
      form.append(saveActions);

      const googleActions = make('div', { className: 'student-detail__actions' });
      const saveGoogle = make('button', { className: 'btn btn--secondary', text: 'Schoolmail opslaan', type: 'button' });
      saveGoogle.addEventListener('click', async () => {
        const email = googleEmail.value.trim();
        if (!email) {
          message.textContent = 'Vul een schoolmail in of gebruik “Koppeling verwijderen”.';
          googleEmail.focus();
          return;
        }
        saveGoogle.disabled = true;
        message.textContent = 'Google-schoolaccount wordt bijgewerkt…';
        try {
          await api('/api/auth/google/student-email', {
            method: 'POST',
            body: { studentId: student.id, email },
          });
          message.textContent = 'Schoolmail opgeslagen.';
          window.setTimeout(() => window.location.reload(), 450);
        } catch (error) {
          message.textContent = error.message;
          saveGoogle.disabled = false;
        }
      });
      googleActions.append(saveGoogle);

      if (student.googleEmail || student.googleLinked) {
        const unlink = make('button', { className: 'btn btn--ghost', text: 'Koppeling verwijderen', type: 'button' });
        unlink.addEventListener('click', async () => {
          if (!window.confirm(`Google-koppeling van ${student.name} verwijderen? De leerling moet daarna opnieuw gekoppeld worden.`)) return;
          unlink.disabled = true;
          message.textContent = 'Google-koppeling wordt verwijderd…';
          try {
            await api('/api/auth/google/student-email?unlink=1', {
              method: 'POST',
              body: { studentId: student.id },
            });
            message.textContent = 'Google-koppeling verwijderd.';
            window.setTimeout(() => window.location.reload(), 450);
          } catch (error) {
            message.textContent = error.message;
            unlink.disabled = false;
          }
        });
        googleActions.append(unlink);
      }
      google.append(googleActions);
    }

    const operational = make('section', { className: 'student-detail__section' });
    operational.append(make('h4', { text: 'Acties' }));
    const actions = make('div', { className: 'student-detail__actions student-detail__actions--danger' });
    const normalActions = make('div', { className: 'student-detail__actions' });
    if (!isAdmin) {
      const move = make('button', { className: 'btn btn--secondary', text: 'Verplaatsen', type: 'button' });
      move.addEventListener('click', () => {
        const underlying = findUnderlyingAction(row, 'Verplaatsen');
        dialog.close();
        underlying?.click();
      });
      normalActions.append(move);
    }
    const leave = make('button', { className: 'btn btn--ghost student-detail__danger', text: 'Van school afmelden', type: 'button' });
    leave.addEventListener('click', () => {
      const underlying = findUnderlyingAction(row, 'Van school');
      dialog.close();
      underlying?.click();
    });
    actions.append(normalActions, leave);
    operational.append(actions);
    form.append(operational);

    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    return dialog;
  }

  async function openDetail(row) {
    const studentId = row?.dataset.studentId || '';
    if (!studentId) return;
    try {
      const state = await loadState({ force: true });
      const student = (state.students || []).find((entry) => entry.id === studentId);
      if (!student) {
        window.alert('Deze leerling is niet meer beschikbaar. Vernieuw de pagina.');
        return;
      }
      const dialog = createDetailDialog(student, row, state);
      dialog.showModal();
    } catch (error) {
      window.alert(error.message || 'Leerlinggegevens konden niet worden geopend.');
    }
  }

  function enhanceRows() {
    enhanceQueued = false;
    ensureStyles();
    const rows = document.querySelectorAll('.student-management__student-row[data-student-id]');
    for (const row of rows) {
      if (row.dataset.studentDetailReady === 'true') continue;
      row.dataset.studentDetailReady = 'true';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const name = row.querySelector('.student-management__student-info strong')?.textContent?.trim() || 'leerling';
      row.setAttribute('aria-label', `Open leerlinggegevens van ${name}`);
      row.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, select, textarea')) return;
        openDetail(row);
      });
      row.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        openDetail(row);
      });
    }
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    window.requestAnimationFrame(enhanceRows);
  }

  function install() {
    ensureStyles();
    queueEnhance();
    const panel = document.querySelector('#student-management-panel');
    const observer = new MutationObserver(queueEnhance);
    observer.observe(panel || document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
