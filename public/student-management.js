(() => {
  'use strict';

  const SESSION_CLASS_KEY = 'boekenbaai_active_mentor_class';
  let state = null;
  let installed = false;
  let activeClassId = '';

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
    if (!response.ok) {
      const err = new Error(payload?.message || `Actie mislukt (${response.status})`);
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  function ownClasses() {
    return (state?.classes || []).filter((entry) => entry.isOwn);
  }

  function readStoredClassId() {
    try {
      return window.sessionStorage.getItem(SESSION_CLASS_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function storeClassId(classId) {
    try {
      window.sessionStorage.setItem(SESSION_CLASS_KEY, classId);
    } catch (error) {
      // De klaskeuze hoeft alleen voor deze sessie onthouden te worden.
    }
  }

  function activeClass() {
    if (state?.role === 'admin') return null;
    const classes = ownClasses();
    if (!classes.length) {
      activeClassId = '';
      return null;
    }
    let selected = classes.find((entry) => entry.id === activeClassId);
    if (!selected) {
      const stored = readStoredClassId();
      selected = classes.find((entry) => entry.id === stored) || classes[0];
      activeClassId = selected.id;
      storeClassId(activeClassId);
    }
    return selected;
  }

  function setActiveClass(classId) {
    const selected = ownClasses().find((entry) => entry.id === classId);
    if (!selected) return;
    activeClassId = selected.id;
    storeClassId(activeClassId);
    render();
  }

  function studentsForClass(classId) {
    return (state?.students || []).filter((student) => (student.classIds || []).includes(classId));
  }

  function googleRequestsForClass(klass) {
    const all = state?.googleRequests || [];
    if (state?.role === 'admin' || !klass) return all;
    return all.filter((request) => (request.classNames || []).includes(klass.name));
  }

  function incomingForClass(klass) {
    const all = state?.incoming || [];
    if (state?.role === 'admin' || !klass) return all;
    return all.filter((transfer) => transfer.toClassId === klass.id);
  }

  function outgoingForClass(klass) {
    const all = (state?.outgoing || []).filter((entry) => ['pending', 'rejected'].includes(entry.status));
    if (state?.role === 'admin' || !klass) return all;
    return all.filter((transfer) => transfer.fromClassId === klass.id);
  }

  function actionCountForClass(klass) {
    return googleRequestsForClass(klass).length + incomingForClass(klass).length;
  }

  function targetClasses(student) {
    const current = new Set(student?.classIds || []);
    return (state?.classes || []).filter((entry) => !current.has(entry.id));
  }

  function sourceClassId(student) {
    const selected = activeClass();
    if (selected && (student?.classIds || []).includes(selected.id)) return selected.id;
    const own = new Set(ownClasses().map((entry) => entry.id));
    return (student?.classIds || []).find((id) => own.has(id)) || student?.classIds?.[0] || '';
  }

  function createDialog(title) {
    const dialog = document.createElement('dialog');
    dialog.className = 'student-management__dialog';
    const form = make('form', { className: 'student-management__dialog-form' });
    form.method = 'dialog';
    const header = make('div', { className: 'student-management__dialog-header' });
    header.append(make('h3', { text: title }));
    const close = make('button', { className: 'btn btn--ghost', text: 'Sluiten', type: 'button' });
    close.addEventListener('click', () => dialog.close());
    header.append(close);
    form.append(header);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    return { dialog, form };
  }

  function field(labelText, input) {
    const wrapper = make('label', { className: 'student-management__field' });
    wrapper.append(make('span', { text: labelText }), input);
    return wrapper;
  }

  function openAddStudent() {
    const teacherClass = activeClass();
    if (state.role !== 'admin' && !teacherClass) {
      window.alert('Je bent nog niet aan een klas gekoppeld.');
      return;
    }

    const { dialog, form } = createDialog('Leerling toevoegen');
    form.append(make('p', {
      className: 'hint',
      text: state.role === 'admin'
        ? 'Vul de naam in en kies de klas. Het ParnasSys-leerlingnummer is alleen nodig als je het al weet.'
        : `Deze leerling wordt automatisch toegevoegd aan ${teacherClass.name}. Alleen de naam is nodig.`,
    }));

    const name = make('input');
    name.required = true;
    name.autocomplete = 'off';
    name.placeholder = 'Roepnaam en achternaam';

    let classSelect = null;
    let number = null;
    if (state.role === 'admin') {
      classSelect = document.createElement('select');
      classSelect.required = true;
      classSelect.append(new Option('Kies klas', ''));
      for (const klass of state.classes || []) classSelect.append(new Option(klass.name, klass.id));
      number = make('input');
      number.autocomplete = 'off';
      number.placeholder = 'optioneel';
    }

    const message = make('p', { className: 'student-management__message hint' });
    const actions = make('div', { className: 'student-management__dialog-actions' });
    const submit = make('button', { className: 'btn', text: 'Leerling toevoegen', type: 'submit' });
    actions.append(submit);
    form.append(field('Naam leerling', name));
    if (classSelect) form.append(field('Klas', classSelect));
    if (number) form.append(field('ParnasSys-leerlingnummer (optioneel)', number));
    form.append(message, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const classId = state.role === 'admin' ? classSelect.value : activeClass()?.id || '';
      if (!classId) {
        message.textContent = 'Kies eerst een klas.';
        return;
      }
      submit.disabled = true;
      message.textContent = 'Leerling wordt toegevoegd…';
      try {
        await api('/api/mentor/students', {
          method: 'POST',
          body: {
            name: name.value,
            classId,
            parnassysStudentNumber: number?.value || '',
          },
        });
        dialog.close();
        await refresh();
      } catch (error) {
        message.textContent = error.message;
        submit.disabled = false;
      }
    });

    dialog.showModal();
    name.focus();
  }

  function openTransfer(student) {
    const targets = targetClasses(student);
    if (!targets.length) {
      window.alert('Er is geen andere klas beschikbaar.');
      return;
    }
    const { dialog, form } = createDialog(`${student.name} verplaatsen`);
    const current = (student.classNames || []).join(', ') || 'huidige klas';
    form.append(make('p', {
      className: 'hint',
      text: `De leerling blijft in ${current} totdat de nieuwe mentor het verzoek accepteert.`,
    }));

    const select = document.createElement('select');
    select.required = true;
    select.append(new Option('Kies nieuwe klas', ''));
    for (const klass of targets) select.append(new Option(klass.name, klass.id));
    const message = make('p', { className: 'student-management__message hint' });
    const submit = make('button', { className: 'btn', text: 'Verplaatsing aanvragen', type: 'submit' });
    form.append(field('Nieuwe klas', select), message, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.textContent = 'Verzoek wordt verstuurd…';
      try {
        await api(`/api/mentor/students/${encodeURIComponent(student.id)}/transfer`, {
          method: 'POST',
          body: { toClassId: select.value, fromClassId: sourceClassId(student) },
        });
        dialog.close();
        await refresh();
      } catch (error) {
        message.textContent = error.message;
        submit.disabled = false;
      }
    });
    dialog.showModal();
  }

  async function deactivate(student) {
    const confirmed = window.confirm(
      `${student.name} van school afmelden? De leerling verdwijnt uit de klas en kan daarna niet meer inloggen. Uitleenhistorie blijft bewaard.`
    );
    if (!confirmed) return;
    try {
      await api(`/api/mentor/students/${encodeURIComponent(student.id)}/deactivate`, { method: 'POST' });
      await refresh();
    } catch (error) {
      if (error.payload?.borrowedBooks?.length) {
        const titles = error.payload.borrowedBooks.map((entry) => entry.title).join('\n• ');
        window.alert(`${error.message}\n\n• ${titles}`);
      } else {
        window.alert(error.message);
      }
    }
  }

  async function reviewTransfer(id, action) {
    try {
      await api(`/api/mentor/student-transfers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function resolveEscalation(id, action) {
    try {
      await api(`/api/admin/student-transfers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function reviewGoogle(id, action) {
    try {
      await api(`/api/auth/google/link-requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function approveSafeGoogleRequests(button, requests) {
    const safe = requests.filter((entry) => entry.nameMatch === 'match');
    if (!safe.length) return;
    button.disabled = true;
    try {
      for (const request of safe) {
        await api(`/api/auth/google/link-requests/${encodeURIComponent(request.id)}/approve`, { method: 'POST' });
      }
      await refresh();
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
    }
  }

  function requestCard(request) {
    const row = make('div', {
      className: `student-management__request ${request.nameMatch === 'warning' ? 'student-management__request--warning' : ''}`,
    });
    const info = make('div', { className: 'student-management__request-info' });
    info.append(
      make('strong', { text: request.studentName }),
      make('span', { text: (request.classNames || []).join(', ') || 'Geen klas' }),
      make('span', { text: `Google: ${request.googleName || 'naam onbekend'} · ${request.email || ''}` })
    );
    if (request.nameMatch === 'match') {
      info.append(make('span', { className: 'student-management__match student-management__match--ok', text: '✓ Google-naam lijkt overeen te komen' }));
    } else if (request.nameMatch === 'warning') {
      info.append(make('span', { className: 'student-management__match student-management__match--warning', text: '⚠ Google-naam wijkt af van de gekozen leerling' }));
    } else {
      info.append(make('span', { className: 'student-management__match', text: 'Google-profielnaam kon niet worden vergeleken' }));
    }
    const actions = make('div', { className: 'student-management__row-actions' });
    const approve = make('button', { className: 'btn btn--secondary', text: 'Goedkeuren', type: 'button' });
    const deny = make('button', { className: 'btn btn--ghost', text: 'Weigeren', type: 'button' });
    approve.addEventListener('click', () => reviewGoogle(request.id, 'approve'));
    deny.addEventListener('click', () => reviewGoogle(request.id, 'deny'));
    actions.append(approve, deny);
    row.append(info, actions);
    return row;
  }

  function transferCard(transfer, kind) {
    const row = make('div', { className: 'student-management__request' });
    const info = make('div', { className: 'student-management__request-info' });
    info.append(
      make('strong', { text: transfer.studentName }),
      make('span', { text: `${transfer.fromClassName} → ${transfer.toClassName}` })
    );
    if (transfer.status === 'rejected') {
      info.append(make('span', { className: 'student-management__match student-management__match--warning', text: 'Geweigerd door nieuwe klas, doorgestuurd naar beheer' }));
    }
    const actions = make('div', { className: 'student-management__row-actions' });
    if (kind === 'incoming') {
      const accept = make('button', { className: 'btn btn--secondary', text: 'Toevoegen aan mijn klas', type: 'button' });
      const reject = make('button', { className: 'btn btn--ghost', text: 'Weigeren', type: 'button' });
      accept.addEventListener('click', () => reviewTransfer(transfer.id, 'accept'));
      reject.addEventListener('click', () => reviewTransfer(transfer.id, 'reject'));
      actions.append(accept, reject);
    } else if (kind === 'admin') {
      const accept = make('button', { className: 'btn btn--secondary', text: 'Toch verplaatsen', type: 'button' });
      const cancel = make('button', { className: 'btn btn--ghost', text: 'Annuleren', type: 'button' });
      accept.addEventListener('click', () => resolveEscalation(transfer.id, 'accept'));
      cancel.addEventListener('click', () => resolveEscalation(transfer.id, 'cancel'));
      actions.append(accept, cancel);
    }
    row.append(info, actions);
    return row;
  }

  function renderClassContext(panel) {
    if (state.role === 'admin') return;
    const classes = ownClasses();
    const section = make('section', { className: 'student-management__class-context' });
    if (!classes.length) {
      section.append(
        make('strong', { text: 'Geen klas gekoppeld' }),
        make('span', { text: 'Beheer moet je eerst aan minimaal één klas koppelen.' })
      );
      panel.append(section);
      return;
    }

    if (classes.length === 1) {
      const klass = activeClass();
      section.append(
        make('span', { className: 'student-management__class-label', text: 'Mijn klas' }),
        make('strong', { text: klass.name })
      );
      panel.append(section);
      return;
    }

    const wrapper = make('label', { className: 'student-management__class-picker' });
    wrapper.append(make('span', { className: 'student-management__class-label', text: 'Mijn klassen' }));
    const select = document.createElement('select');
    for (const klass of classes) {
      const count = studentsForClass(klass.id).length;
      const actions = actionCountForClass(klass);
      const label = `${klass.name} · ${count} leerling${count === 1 ? '' : 'en'}${actions ? ` · ${actions} actie${actions === 1 ? '' : 's'}` : ''}`;
      select.append(new Option(label, klass.id));
    }
    select.value = activeClass()?.id || classes[0].id;
    select.addEventListener('change', () => setActiveClass(select.value));
    wrapper.append(select);
    section.append(wrapper);
    panel.append(section);
  }

  function renderRequests(panel) {
    const klass = activeClass();
    const google = googleRequestsForClass(klass);
    const incoming = incomingForClass(klass);
    const escalated = state.role === 'admin' ? state.escalated || [] : [];
    if (!google.length && !incoming.length && !escalated.length) return;

    const section = make('section', { className: 'student-management__section student-management__attention' });
    section.append(make('h4', { text: 'Acties voor jou' }));

    if (google.length) {
      const head = make('div', { className: 'student-management__section-head' });
      head.append(make('h5', { text: `Google-koppelingen (${google.length})` }));
      const safeCount = google.filter((entry) => entry.nameMatch === 'match').length;
      if (safeCount > 1) {
        const bulk = make('button', { className: 'btn btn--ghost', text: `${safeCount} zonder waarschuwing goedkeuren`, type: 'button' });
        bulk.addEventListener('click', () => approveSafeGoogleRequests(bulk, google));
        head.append(bulk);
      }
      section.append(head);
      google.forEach((request) => section.append(requestCard(request)));
    }

    if (incoming.length) {
      section.append(make('h5', { text: `Nieuwe leerlingen voor deze klas (${incoming.length})` }));
      incoming.forEach((transfer) => section.append(transferCard(transfer, 'incoming')));
    }

    if (escalated.length) {
      section.append(make('h5', { text: `Naar beheer doorgestuurd (${escalated.length})` }));
      escalated.forEach((transfer) => section.append(transferCard(transfer, 'admin')));
    }
    panel.append(section);
  }

  function studentRow(student) {
    const row = make('div', { className: 'student-management__student-row' });
    const info = make('div', { className: 'student-management__student-info' });
    info.append(make('strong', { text: student.name }));
    const meta = [];
    if (state.role === 'admin' && student.parnassysStudentNumber) meta.push(`ParnasSys ${student.parnassysStudentNumber}`);
    meta.push(student.googleLinked ? 'Google gekoppeld' : 'Google nog niet gekoppeld');
    if (student.borrowedCount) meta.push(`${student.borrowedCount} boek${student.borrowedCount === 1 ? '' : 'en'} in bezit`);
    info.append(make('span', { text: meta.join(' · ') }));
    const actions = make('div', { className: 'student-management__row-actions' });
    const move = make('button', { className: 'btn btn--ghost', text: 'Verplaatsen', type: 'button' });
    const leave = make('button', { className: 'btn btn--ghost student-management__danger-button', text: 'Van school', type: 'button' });
    move.addEventListener('click', () => openTransfer(student));
    leave.addEventListener('click', () => deactivate(student));
    actions.append(move, leave);
    row.append(info, actions);
    return row;
  }

  function renderStudents(panel) {
    const section = make('section', { className: 'student-management__section' });
    const header = make('div', { className: 'student-management__section-head' });
    const heading = make('div');
    const klass = activeClass();
    heading.append(
      make('h4', {
        text: state.role === 'admin'
          ? 'Leerlingen per klas'
          : klass
            ? `Leerlingen in ${klass.name}`
            : 'Mijn leerlingen',
      }),
      make('p', { className: 'hint', text: 'Tussentijdse instroom, klaswissels en uitstroom kun je hier direct regelen.' })
    );
    header.append(heading);
    const add = make('button', { className: 'btn', text: '+ Leerling toevoegen', type: 'button' });
    add.disabled = state.role !== 'admin' && !klass;
    add.addEventListener('click', openAddStudent);
    header.append(add);
    section.append(header);

    if (state.role !== 'admin') {
      if (!klass) {
        section.append(make('p', { className: 'hint', text: 'Je hebt nog geen klas om leerlingen voor te beheren.' }));
      } else {
        const students = studentsForClass(klass.id);
        section.append(make('p', {
          className: 'student-management__class-count',
          text: `${students.length} leerling${students.length === 1 ? '' : 'en'}`,
        }));
        if (!students.length) section.append(make('p', { className: 'hint', text: 'Nog geen leerlingen in deze klas.' }));
        students.forEach((student) => section.append(studentRow(student)));
      }
      panel.append(section);
      return;
    }

    for (const adminClass of state.classes || []) {
      const students = studentsForClass(adminClass.id);
      const details = document.createElement('details');
      details.className = 'student-management__class';
      if ((state.classes || []).length <= 3) details.open = true;
      details.append(make('summary', { text: `${adminClass.name} · ${students.length} leerling${students.length === 1 ? '' : 'en'}` }));
      if (!students.length) details.append(make('p', { className: 'hint', text: 'Nog geen leerlingen in deze klas.' }));
      students.forEach((student) => details.append(studentRow(student)));
      section.append(details);
    }
    panel.append(section);
  }

  function renderOutgoing(panel) {
    const outgoing = outgoingForClass(activeClass());
    if (!outgoing.length) return;
    const details = document.createElement('details');
    details.className = 'student-management__section';
    const summary = make('summary', { text: `Aangevraagde klaswissels (${outgoing.length})` });
    details.append(summary);
    outgoing.forEach((transfer) => details.append(transferCard(transfer, 'outgoing')));
    panel.append(details);
  }

  function render() {
    const host = document.querySelector('#teacher-dashboard');
    if (!host || host.classList.contains('hidden') || !state) return;
    let panel = document.querySelector('#student-management-panel');
    if (panel) panel.remove();
    panel = make('section', { className: 'panel student-management', id: 'student-management-panel' });
    const header = make('div', { className: 'panel__header student-management__header' });
    const text = make('div');
    text.append(
      make('h3', { text: 'Leerlingbeheer' }),
      make('p', { className: 'panel__subtitle', text: 'Snel leerlingen toevoegen, verplaatsen, afmelden en eerste Google-logins controleren.' })
    );
    header.append(text);
    panel.append(header);
    renderClassContext(panel);
    renderRequests(panel);
    renderStudents(panel);
    renderOutgoing(panel);
    host.append(panel);
  }

  async function refresh() {
    try {
      state = await api('/api/mentor/student-management');
      activeClass();
      render();
    } catch (error) {
      // Niet ingelogd als medewerker of pagina nog niet klaar.
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    refresh();
    const observer = new MutationObserver(() => {
      const host = document.querySelector('#teacher-dashboard');
      if (host && !host.classList.contains('hidden') && !document.querySelector('#student-management-panel')) refresh();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
