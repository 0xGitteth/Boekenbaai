(() => {
  'use strict';

  let installed = false;
  let refreshing = false;
  let lastData = null;

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
      const failure = new Error(payload?.message || `Actie mislukt (${response.status})`);
      failure.code = payload?.code || '';
      failure.payload = payload;
      throw failure;
    }
    return payload;
  }

  function setMessage(element, text, kind = '') {
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('student-roster__message--error', kind === 'error');
    element.classList.toggle('student-roster__message--success', kind === 'success');
  }

  function option(select, label, value, selected = false) {
    const item = new Option(label, value, selected, selected);
    select.append(item);
    return item;
  }

  function sortedMyClasses(data) {
    return (data.classes || []).filter((entry) => data.role === 'admin' || entry.mine);
  }

  function studentLabel(student) {
    const classes = Array.isArray(student.classNames) && student.classNames.length
      ? ` · ${student.classNames.join(', ')}`
      : '';
    return `${student.name || 'Onbekende leerling'}${classes}`;
  }

  function suppressLegacyTeacherStudentUi(data) {
    if (data.role !== 'teacher') return;
    const legacy = document.querySelector('.teacher-students');
    if (legacy) legacy.hidden = true;
    const dashboard = document.querySelector('#teacher-dashboard');
    dashboard?.querySelectorAll('.google-manage').forEach((node) => node.remove());
  }

  function suppressLegacyStudentEmailForms() {
    document.querySelectorAll('.google-manage__section').forEach((section) => {
      const heading = section.querySelector('h4')?.textContent?.toLocaleLowerCase('nl-NL') || '';
      if (heading.includes('leerling koppelen') || heading.includes('schoolmailadres van een leerling')) {
        section.hidden = true;
      }
    });
  }

  function nameMatchInfo(request) {
    if (request.nameMatch === 'match') {
      return { text: '✓ Google-naam komt overeen met de gekozen leerling.', className: 'student-roster__identity--ok' };
    }
    if (request.nameMatch === 'likely-match') {
      return { text: '✓ Google-naam lijkt overeen te komen met de gekozen leerling.', className: 'student-roster__identity--ok' };
    }
    if (request.nameMatch === 'mismatch') {
      return { text: '⚠ Google-naam wijkt af van de gekozen leerling. Controleer dit verzoek handmatig.', className: 'student-roster__identity--warning' };
    }
    return { text: 'Controleer het Google-account handmatig; er is geen bruikbare profielnaam.', className: 'student-roster__identity--neutral' };
  }

  async function actOnGoogleRequest(id, action) {
    await api(`/api/auth/google/link-requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    await refresh();
  }

  function renderGoogleRequests(host, data) {
    const requests = data.googleRequests || [];
    const section = make('section', { className: 'student-roster__section' });
    const header = make('div', { className: 'student-roster__section-header' });
    const title = make('div');
    title.append(
      make('h4', { text: `Eerste Google-inlog${requests.length ? ` (${requests.length})` : ''}` }),
      make('p', {
        className: 'hint',
        text: 'Een leerling kiest eerst de eigen naam en klas. De eerste Google-koppeling wordt pas definitief nadat een mentor of beheer deze controleert.',
      })
    );
    header.append(title);

    const safe = requests.filter((entry) => ['match', 'likely-match'].includes(entry.nameMatch));
    if (safe.length > 1) {
      const bulk = make('button', {
        type: 'button',
        className: 'btn btn--secondary',
        text: `Alles zonder waarschuwing goedkeuren (${safe.length})`,
      });
      bulk.addEventListener('click', async () => {
        if (!window.confirm(`Wil je ${safe.length} koppelverzoeken waarvan de namen overeenkomen goedkeuren?`)) return;
        bulk.disabled = true;
        try {
          for (const request of safe) {
            await api(`/api/auth/google/link-requests/${encodeURIComponent(request.id)}/approve`, { method: 'POST' });
          }
          await refresh();
        } catch (error) {
          window.alert(error.message);
          bulk.disabled = false;
        }
      });
      header.append(bulk);
    }
    section.append(header);

    if (!requests.length) {
      section.append(make('p', { className: 'hint', text: 'Geen openstaande Google-koppelverzoeken.' }));
      host.append(section);
      return;
    }

    const list = make('div', { className: 'student-roster__request-list' });
    for (const request of requests) {
      const card = make('article', { className: 'student-roster__request' });
      const info = make('div', { className: 'student-roster__request-info' });
      info.append(
        make('strong', { text: request.studentName || 'Onbekende leerling' }),
        make('span', {
          text: (request.classNames || []).join(', ') || 'Geen klas',
        }),
        make('span', { text: `Google: ${request.googleName || 'geen profielnaam'}${request.email ? ` · ${request.email}` : ''}` })
      );
      const match = nameMatchInfo(request);
      info.append(make('span', { className: `student-roster__identity ${match.className}`, text: match.text }));

      const actions = make('div', { className: 'student-roster__request-actions' });
      const approve = make('button', { type: 'button', className: 'btn btn--secondary', text: 'Goedkeuren' });
      const deny = make('button', { type: 'button', className: 'btn btn--ghost', text: 'Weigeren' });
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        deny.disabled = true;
        try {
          await actOnGoogleRequest(request.id, 'approve');
        } catch (error) {
          window.alert(error.message);
          approve.disabled = false;
          deny.disabled = false;
        }
      });
      deny.addEventListener('click', async () => {
        approve.disabled = true;
        deny.disabled = true;
        try {
          await actOnGoogleRequest(request.id, 'deny');
        } catch (error) {
          window.alert(error.message);
          approve.disabled = false;
          deny.disabled = false;
        }
      });
      actions.append(approve, deny);
      card.append(info, actions);
      list.append(card);
    }
    section.append(list);
    host.append(section);
  }

  function renderTransferRequests(host, data) {
    const transfers = data.transfers || [];
    const section = make('section', { className: 'student-roster__section' });
    section.append(
      make('h4', { text: `Klaswissels${transfers.length ? ` (${transfers.length})` : ''}` }),
      make('p', {
        className: 'hint',
        text: data.role === 'admin'
          ? 'Beheer ziet openstaande en doorgestuurde klaswissels en kan bij twijfel beslissen.'
          : 'De huidige mentor vraagt een verplaatsing aan. De nieuwe mentor accepteert of stuurt het verzoek bij weigering door naar beheer.',
      })
    );

    if (!transfers.length) {
      section.append(make('p', { className: 'hint', text: 'Geen openstaande klaswissels.' }));
      host.append(section);
      return;
    }

    const list = make('div', { className: 'student-roster__request-list' });
    transfers.forEach((request) => {
      const card = make('article', { className: 'student-roster__request' });
      const info = make('div', { className: 'student-roster__request-info' });
      info.append(
        make('strong', { text: request.studentName }),
        make('span', { text: `${request.sourceClassName} → ${request.targetClassName}` }),
        make('span', {
          className: request.status === 'escalated' ? 'student-roster__identity--warning' : 'hint',
          text: request.status === 'escalated'
            ? 'Doorgestuurd naar beheer.'
            : 'Wacht op reactie van de nieuwe mentor.',
        })
      );
      const actions = make('div', { className: 'student-roster__request-actions' });
      const run = async (action) => {
        actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
        try {
          await api(`/api/roster/transfers/${encodeURIComponent(request.id)}/${action}`, { method: 'POST' });
          await refresh();
        } catch (error) {
          window.alert(error.message);
          actions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
        }
      };
      if (request.canApprove) {
        const approve = make('button', { type: 'button', className: 'btn btn--secondary', text: 'Accepteren' });
        approve.addEventListener('click', () => run('approve'));
        actions.append(approve);
      }
      if (request.canReject) {
        const reject = make('button', {
          type: 'button',
          className: 'btn btn--ghost',
          text: data.role === 'admin' ? 'Sluiten' : 'Weigeren → beheer',
        });
        reject.addEventListener('click', () => run('reject'));
        actions.append(reject);
      }
      if (request.canCancel && request.status === 'pending') {
        const cancel = make('button', { type: 'button', className: 'btn btn--ghost', text: 'Intrekken' });
        cancel.addEventListener('click', () => run('cancel'));
        actions.append(cancel);
      }
      card.append(info, actions);
      list.append(card);
    });
    section.append(list);
    host.append(section);
  }

  function createAddStudentForm(data) {
    const block = make('div', { className: 'student-roster__action-card' });
    block.append(
      make('h5', { text: 'Nieuwe leerling tussentijds toevoegen' }),
      make('p', {
        className: 'hint',
        text: 'Alleen naam en klas zijn nodig. Een e-mailadres is niet nodig; Google wordt bij de eerste login gekoppeld.',
      })
    );
    const form = make('form', { className: 'student-roster__form' });
    const name = make('input');
    name.type = 'text';
    name.required = true;
    name.placeholder = 'Voor- en achternaam';
    name.autocomplete = 'off';
    const classSelect = document.createElement('select');
    classSelect.required = true;
    option(classSelect, 'Kies klas', '');
    sortedMyClasses(data).forEach((entry) => option(classSelect, entry.name, entry.id));

    const details = make('details', { className: 'student-roster__optional' });
    const summary = make('summary', { text: 'Optioneel: ParnasSys-leerlingnummer' });
    const number = make('input');
    number.type = 'text';
    number.placeholder = 'Leerlingnummer';
    number.inputMode = 'numeric';
    details.append(summary, number);

    const submit = make('button', { type: 'submit', className: 'btn btn--secondary', text: 'Leerling toevoegen' });
    const message = make('p', { className: 'hint student-roster__message' });
    form.append(name, classSelect, details, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      setMessage(message, 'Leerling wordt toegevoegd…');
      try {
        const result = await api('/api/roster/students', {
          method: 'POST',
          body: { name: name.value, classId: classSelect.value, studentNumber: number.value },
        });
        setMessage(message, `${result.name} is toegevoegd aan ${result.className}.`, 'success');
        name.value = '';
        number.value = '';
        await refresh();
      } catch (error) {
        setMessage(message, error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
    block.append(form, message);
    return block;
  }

  function createTransferForm(data) {
    const block = make('div', { className: 'student-roster__action-card' });
    block.append(
      make('h5', { text: 'Leerling naar een andere klas' }),
      make('p', { className: 'hint', text: 'De leerling verhuist pas nadat de nieuwe mentor het verzoek accepteert.' })
    );
    const form = make('form', { className: 'student-roster__form' });
    const student = document.createElement('select');
    student.required = true;
    option(student, 'Kies leerling', '');
    (data.students || []).forEach((entry) => {
      const item = option(student, studentLabel(entry), entry.id);
      const source = (entry.classIds || []).find((id) => data.role === 'admin' || (data.myClassIds || []).includes(id));
      item.dataset.sourceClassId = source || '';
    });
    const target = document.createElement('select');
    target.required = true;
    option(target, 'Kies nieuwe klas', '');
    (data.classes || []).forEach((entry) => option(target, `${entry.name}${entry.hasMentor ? '' : ' · geen mentor gekoppeld'}`, entry.id));
    const submit = make('button', { type: 'submit', className: 'btn btn--secondary', text: 'Verplaatsing aanvragen' });
    const message = make('p', { className: 'hint student-roster__message' });
    form.append(student, target, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const selected = student.selectedOptions[0];
      submit.disabled = true;
      setMessage(message, 'Verzoek wordt verstuurd…');
      try {
        const result = await api('/api/roster/transfers', {
          method: 'POST',
          body: {
            studentId: student.value,
            sourceClassId: selected?.dataset.sourceClassId || '',
            targetClassId: target.value,
          },
        });
        setMessage(
          message,
          result.status === 'escalated'
            ? 'Deze klas heeft geen gekoppelde mentor. Het verzoek staat daarom direct bij beheer.'
            : 'Verzoek verstuurd naar de nieuwe mentor.',
          'success'
        );
        await refresh();
      } catch (error) {
        setMessage(message, error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
    block.append(form, message);
    return block;
  }

  function createDeactivateForm(data) {
    const block = make('div', { className: 'student-roster__action-card student-roster__action-card--danger' });
    block.append(
      make('h5', { text: 'Leerling gaat van school' }),
      make('p', {
        className: 'hint',
        text: 'De leerling verdwijnt uit actieve klassen en uit de inloglijst. Uitleenhistorie blijft bewaard.',
      })
    );
    const form = make('form', { className: 'student-roster__form' });
    const student = document.createElement('select');
    student.required = true;
    option(student, 'Kies leerling', '');
    (data.students || []).forEach((entry) => option(student, studentLabel(entry), entry.id));
    const submit = make('button', { type: 'submit', className: 'btn btn--ghost', text: 'Van school afmelden' });
    const message = make('p', { className: 'hint student-roster__message' });
    form.append(student, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const selectedName = student.selectedOptions[0]?.textContent || 'deze leerling';
      if (!window.confirm(`Wil je ${selectedName} van school afmelden? De leerling kan daarna niet meer inloggen.`)) return;
      submit.disabled = true;
      setMessage(message, 'Leerling wordt afgemeld…');
      try {
        const result = await api(`/api/roster/students/${encodeURIComponent(student.value)}/deactivate`, { method: 'POST' });
        setMessage(message, `${result.name} is van school afgemeld.`, 'success');
        await refresh();
      } catch (error) {
        setMessage(message, error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
    block.append(form, message);
    return block;
  }

  function renderDailyActions(host, data) {
    const section = make('section', { className: 'student-roster__section' });
    section.append(
      make('h4', { text: 'Dagelijks leerlingbeheer' }),
      make('p', {
        className: 'hint',
        text: 'Voor tussentijdse instroom, klaswissels en uitstroom hoef je niet opnieuw een schoolbestand te importeren.',
      })
    );
    const grid = make('div', { className: 'student-roster__actions-grid' });
    grid.append(createAddStudentForm(data), createTransferForm(data), createDeactivateForm(data));
    section.append(grid);
    host.append(section);
  }

  function render(data) {
    lastData = data;
    suppressLegacyTeacherStudentUi(data);
    suppressLegacyStudentEmailForms();

    const existing = document.querySelector('#student-roster-workflow');
    if (existing) existing.remove();
    const panel = make('section', { className: 'student-roster panel', id: 'student-roster-workflow' });
    const header = make('div', { className: 'student-roster__header' });
    header.append(
      make('h3', { text: data.role === 'admin' ? 'Leerlingstromen' : 'Mijn leerlingen' }),
      make('p', {
        className: 'hint',
        text: data.role === 'admin'
          ? 'Los uitzonderingen op en houd tussentijdse leerlingwijzigingen bij.'
          : 'Voeg nieuwe leerlingen toe, regel klaswissels en controleer de eerste Google-inlog.',
      })
    );
    panel.append(header);
    renderGoogleRequests(panel, data);
    renderTransferRequests(panel, data);
    renderDailyActions(panel, data);

    let host;
    if (data.role === 'teacher') {
      host = document.querySelector('.teacher-layout__classes') || document.querySelector('#teacher-dashboard');
    } else {
      host = document.querySelector('#admin-modern-google-host') || document.querySelector('#admin-dashboard');
    }
    host?.append(panel);
    suppressLegacyStudentEmailForms();
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const data = await api('/api/roster/manage');
      render(data);
    } catch (error) {
      if (error.message && !/Log opnieuw in/i.test(error.message)) {
        console.warn('[Leerlingbeheer]', error.message);
      }
    } finally {
      refreshing = false;
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    window.setTimeout(refresh, 250);
    const observer = new MutationObserver(() => {
      if (lastData) {
        suppressLegacyTeacherStudentUi(lastData);
        suppressLegacyStudentEmailForms();
      }
      const panel = document.querySelector('#student-roster-workflow');
      const dashboardVisible =
        !document.querySelector('#teacher-dashboard')?.classList.contains('hidden') ||
        !document.querySelector('#admin-dashboard')?.classList.contains('hidden');
      if (dashboardVisible && !panel) window.setTimeout(refresh, 50);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  }

  document.addEventListener('DOMContentLoaded', install);
})();
