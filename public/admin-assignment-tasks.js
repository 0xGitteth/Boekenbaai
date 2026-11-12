'use strict';

// Admin-only deferred reconciliation queue inside Taken. Unlike a class
// import follow-up this never exposes student borrowers to teachers.
const panel = document.getElementById('book-import-followups-panel');
const host = document.getElementById('book-import-assignment-tasks');
if (panel && host) {
  const configured = (typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      || import.meta.env.VITE_BOEKENBAAI_API_BASE)) || '';
  const base = (window.BOEKENBAAI_API_BASE || configured
    || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim();
  const url = path => base ? base.replace(/\/$/, '') + path : path;
  const root = '/api/admin/book-import-assignment-tasks';
  let tasks = [];
  let serial = 0;
  let busy = false;
  let administrator = false;
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function option(select, value, title) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = title;
    select.append(node);
  }
  async function request(path, method = 'GET', body) {
    const token = localStorage.getItem('boekenbaai_token');
    if (!token) throw Error('Meld je opnieuw aan.');
    const response = await fetch(url(path), {
      method, headers: {
        Authorization: 'Bearer ' + token, Accept:'application/json',
        ...(body === undefined ? {} : {'Content-Type':'application/json'}),
      },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'De administratiecontrole is niet bijgewerkt.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function loanText(value) {
    if (!value || value.type === 'none') return 'Geen uitlening geregistreerd';
    return (value.type === 'student' ? 'Leerling: ' : 'Klas: ')
      + (value.name || 'Onbekend');
  }
  const reasons = {
    ambiguous_physical_copy:'Meerdere fysieke exemplaren hebben hetzelfde ISBN.',
    duplicate_copy_rows:'Meerdere Excelrijen verwijzen naar hetzelfde exemplaar.',
    source_row_requires_review:'Deze Excelrij heeft een ander bronconflict.',
    conflicting_excel_borrowers:'De Excelrij noemt zowel een leerling als een klas.',
    physical_copy_not_found:'Het fysieke exemplaar is niet eenduidig gevonden.',
    title_author_mismatch:'Titel en auteur komen niet overeen.',
    multiple_class_contexts:'De Excelrij bevat meerdere klasvermeldingen.',
    student_loan_records_disagree:'De geregistreerde uitleengegevens spreken elkaar tegen.',
  };
  function details(task) {
    if (task.kind === 'loan') return [
      'Huidige uitlening bij import: ' + loanText(task.before),
      'Excel: ' + (task.after?.type === 'none'
        ? 'Geen uitlening ingevuld. Dit bewijst niet dat het boek is ingeleverd.'
        : loanText(task.after)),
    ];
    if (task.kind === 'location') return [
      'Huidige vaste locatie bij import: ' + (task.before || 'Niet geregistreerd'),
      'Excel: ' + (task.after || 'Geen vaste locatie ingevuld'),
    ];
    if (task.kind === 'class_context') return [
      'Excelkolom Klassen: ' + (task.className || 'Niet ingevuld'),
      'Vaste locatie bij import: ' + (task.beforeLocation || 'Niet geregistreerd'),
      'Uitlening bij import: ' + loanText(task.beforeLoan),
    ];
    return [reasons[task.reason] || 'Handmatige controle vereist: ' + (task.reason || 'Onbekend')];
  }
  function render() {
    host.replaceChildren();
    host.hidden = !administrator;
    panel.dataset.deferredCount = administrator ? String(tasks.length) : '0';
    window.dispatchEvent(new Event('boekenbaai:assignment-tasks-changed'));
    if (!administrator) return;
    host.append(el('h3', 'Uitgestelde administratiecontroles'
      + (tasks.length ? ' (' + tasks.length + ')' : '')));
    host.append(el('p', 'Alleen zichtbaar voor beheerders. Uitgestelde controles '
      + 'blijven opgeslagen, ook nadat oude importverslagen uit het overzicht verdwijnen. '
      + 'Boeken of uitleenregistraties veranderen niet zonder jouw bevestiging.', 'hint'));
    const message = el('p', '', 'hint');
    message.id = 'book-import-assignment-tasks-message';
    message.setAttribute('role', 'status');
    host.append(message);
    if (!tasks.length) {
      host.append(el('p', 'Geen uitgestelde administratieve controles.', 'hint'));
      return;
    }
    for (const task of tasks) {
      const card = el('article', null, 'class-card');
      card.append(el('h4', task.title || 'Onbekend boek'));
      const meta = [
        task.author,
        task.editionIsbn ? 'ISBN: ' + task.editionIsbn : '',
        task.barcode ? 'Barcode: ' + task.barcode : '',
        task.fileName ? 'Import: ' + task.fileName : '',
        'Excelrij: ' + task.worksheetRow,
      ].filter(Boolean).join(' · ');
      card.append(el('p', meta, 'hint'));
      for (const text of details(task)) card.append(el('p', text, 'hint'));
      if (task.missingBook) card.append(el('p',
        'Dit exemplaar is niet meer aanwezig. Er kan geen correctie worden toegepast.', 'hint'));
      if (task.legacy) card.append(el('p',
        'Deze taak komt uit een ouder importverslag. De gegevens zijn niet volledig '
        + 'genoeg om de correctie hier automatisch uit te voeren. Controleer het boek '
        + 'zelf en sluit de taak vervolgens af.', 'hint'));
      const form = el('form', null, 'form-grid form-grid--compact');
      const choice = document.createElement('select');
      choice.required = true;
      option(choice, '', 'Kies een beslissing');
      if (task.canApply && !task.missingBook) {
        if (task.kind === 'loan') option(choice, 'apply',
          'Uitlening administratief corrigeren volgens Excel');
        if (task.kind === 'location') option(choice, 'apply',
          'Vaste locatie administratief corrigeren volgens Excel');
        if (task.kind === 'class_context') {
          option(choice, 'class_fixed', 'Staat vast in ' + task.className);
          if (task.classId) option(choice, 'class_loan',
            'Tijdelijk uitgeleend aan ' + task.className);
          option(choice, 'class_unrelated', 'Klasvermelding is niet van toepassing');
        }
      }
      option(choice, 'keep', 'Bestaande registratie gecontroleerd: behouden');
      option(choice, 'manual_done', 'Handmatig gecontroleerd en afgehandeld');
      const label = el('label', null, 'form-field');
      label.append(el('span', 'Wat is de juiste situatie?'), choice);
      const save = el('button', 'Keuze bevestigen', 'btn btn--secondary');
      save.type = 'submit';
      form.append(label, save);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!choice.value || busy) return;
        const applies = ['apply', 'class_fixed', 'class_loan'].includes(choice.value);
        if (!window.confirm(applies
          ? 'Je bevestigt een administratieve wijziging. Dit is geen fysieke '
            + 'inlevering. Bestaande uitleenregistraties worden opnieuw gecontroleerd. Doorgaan?'
          : 'Deze taak wordt afgesloten zonder automatische boekwijziging. Bevestigen?')) return;
        busy = true;
        save.disabled = true;
        try {
          await request(root + '/' + encodeURIComponent(task.id) + '/resolve',
            'POST', {choice:choice.value,revision:task.revision,
              ...(applies ? {confirm:true} : {})});
          await refresh();
          window.dispatchEvent(new Event('boekenbaai:loans-changed'));
        } catch (error) {
          message.textContent = error.message;
          // Keep the error visible while updating stale task revisions.
          await refresh();
          host.querySelector('#book-import-assignment-tasks-message').textContent = error.message;
        } finally { busy = false; }
      });
      card.append(form);
      if (!task.canApply && !task.missingBook) {
        const books = el('button', 'Boeken openen voor handmatige controle', 'btn btn--ghost');
        books.type = 'button';
        books.addEventListener('click', () => {
          document.querySelector('[data-admin-modern-tab="books"]')?.click();
        });
        card.append(books);
      }
      host.append(card);
    }
  }
  async function refresh() {
    const current = ++serial;
    if (!localStorage.getItem('boekenbaai_token')
      || panel.classList.contains('hidden')) {
      administrator = false; tasks = [];
      render(); return;
    }
    try {
      const result = await request(root);
      if (current !== serial) return;
      tasks = Array.isArray(result.tasks) ? result.tasks : [];
      administrator = true;
    } catch (error) {
      if (current !== serial) return;
      if (error.status === 403) {
        administrator = false; tasks = [];
      } else {
        // Keep last known tasks visible when the network briefly fails.
        if (!administrator) {tasks=[];administrator=false;}
      }
    }
    render();
  }
  window.addEventListener('boekenbaai:staff-refresh', refresh);
  window.addEventListener('boekenbaai:staff-auth-cleared', () => {
    serial++; administrator = false; tasks = []; render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => {
    if (!document.hidden && !panel.classList.contains('hidden')) refresh();
  }, 10000);
  refresh();
}
