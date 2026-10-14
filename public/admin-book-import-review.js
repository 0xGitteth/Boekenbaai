// Staged import UI: all displayed workbook text uses textContent, never HTML.
(() => {
  'use strict';
  const rootPath = '/api/admin/book-import-stages';
  const statusNames = {
    ready: 'Klaar', warning: 'Waarschuwing', conflict: 'Conflict',
    unresolved: 'Nog niet opgelost', skipped: 'Overgeslagen',
  };
  const reasonNames = {
    existing_edition_requires_review: 'Dit ISBN bestaat al in de collectie. Sla deze rij over of beoordeel dit later bij synchroniseren.',
    existing_physical_barcode_requires_correction: 'Deze fysieke barcode wordt al door een ander boek gebruikt. Corrigeer de barcode of sla deze rij over.',
    workbook_physical_barcode_conflict: 'Meerdere boeken in dit Excelbestand hebben dezelfde scanbarcode. Corrigeer deze rijen of sla ze over.',
    printed_barcode_requires_one_copy: 'Deze rij bevat meerdere exemplaren met één fysieke barcode. Gebruik voor elk exemplaar een afzonderlijke rij of verwijder de barcode om op ISBN te scannen.',
    source_conflict_or_missing_identity: 'Corrigeer de brongegevens of sla deze rij over.',
    warnings_need_confirmation: 'Controleer de waarschuwingen en geef toestemming voordat je importeert.',
    loan_context_requires_followup: 'Deze Excel-uitlening kan niet veilig automatisch worden overgenomen. Controleer de leerling/klas of sla de rij over.',
    conflicting_loan_context: 'Deze rij bevat tegenstrijdige leerling- en klasuitleningen. Corrigeer eerst de bron.',
    loan_requires_single_copy: 'Een bestaande uitlening moet aan precies één fysiek exemplaar zijn gekoppeld. Splits de Excelrij in afzonderlijke exemplaren.',
    loan_borrower_needs_review: 'Leerling of klas kan niet eenduidig aan een bestaand account worden gekoppeld. Corrigeer de naam of sla de rij over.',
    loan_borrower_changed: 'De leerling of klas is sinds de analyse gewijzigd. Controleer de import opnieuw.',
    loan_borrower_inactive: 'Deze leerling is niet actief of bestaat niet meer. Controleer de koppeling.',
    duplicate_student_loan_in_workbook: 'Dezelfde leerling heeft volgens Excel meerdere exemplaren van hetzelfde ISBN. Controleer de dubbele regels.',
    student_already_borrowed_edition: 'Deze leerling heeft al een exemplaar van deze editie in Boekenbaai. Een tweede import zou de uitleenlijst vervuilen.',
    loan_requires_physical_copy_match: 'Er zijn meerdere exemplaren en Excel koppelt de uitlening niet aan één specifiek fysiek boek. Vul een unieke fysieke barcode in of controleer het boek handmatig.',
    loan_copy_borrowed_by_other: 'Dit fysieke exemplaar staat al uitgeleend aan iemand anders of aan een andere klas. Het wordt nooit automatisch omgezet.',
    loan_book_student_records_disagree: 'De bestaande uitlening en de uitleenlijst van de leerling komen niet overeen. Laat dit eerst handmatig corrigeren.',
    location_context_requires_followup: 'Dit boek kan niet veilig aan één fysiek exemplaar of klas worden gekoppeld. Corrigeer de brongegevens of de fysieke barcode.',
    skipped: 'Wordt niet geïmporteerd.',
    missing_valid_isbn: 'Voorraad vergelijken kan alleen met een geldig ISBN. Corrigeer het ISBN of sla deze rij over.',
    missing_title_or_author: 'Titel en auteur zijn verplicht bij het toevoegen van boeken. Corrigeer deze gegevens of sla de rij over.',
    possible_existing_book_without_isbn: 'Er staat al een boek met dezelfde titel en auteur maar zonder herkenbaar ISBN. Voeg eerst het juiste ISBN toe aan het bestaande boek om duplicaten te voorkomen.',
    ambiguous_unlabelled_copy_metadata: 'Er bestaan al exemplaren van dit ISBN, maar verschillende Excelrijen zonder fysieke barcode hebben afwijkende boekgegevens. Corrigeer de gegevens of geef exemplaren individuele barcodes om te voorkomen dat verkeerde metadata wordt gekoppeld.',
    unmatched_physical_copies: 'De extra exemplaren kunnen niet veilig aan de juiste Excelrijen worden gekoppeld. Controleer de aantallen en fysieke barcodes.',
    source_needs_review: 'Controleer de invoer en accepteer eventuele waarschuwingen.',
    edition_identity_mismatch: 'Het ISBN is hetzelfde, maar titel of auteur komt niet overeen. Corrigeer dit eerst.',
    ambiguous_existing_edition_isbn: 'Een bestaand boek heeft tegenstrijdige ISBN-gegevens. Corrigeer de bestaande editie eerst.',
    invalid_quantity: 'Voer een geldig aantal exemplaren in.',
    quantity_limit_exceeded: 'Er zijn te veel exemplaren voor één editie.',
    reduction_requires_manual_review: 'Er zijn meer exemplaren in Boekenbaai dan in Excel. Bestaande boeken worden nooit automatisch verwijderd. Controleer dit verschil eerst.',
    barcodes_exceed_new_copies: 'Excel bevat nieuwe fysieke barcodes terwijl er volgens de aantallen geen extra boeken bijkomen.',
    isbn_barcode_belongs_to_other_edition: 'De ISBN-scanbarcode hoort bij een andere editie.',
    barcode_belongs_to_other_edition: 'Deze fysieke barcode is al in gebruik bij een ander boek.',
    duplicate_printed_barcode: 'Dezelfde fysieke barcode staat twee keer in Excel.',
    workbook_physical_barcode_conflict: 'Nieuwe fysieke scanbarcodes komen met elkaar in conflict.',
    printed_barcode_requires_one_copy: 'Bij een fysieke barcode hoort maar één exemplaar.',
  };
  const syncActions = {
    add_copies: 'Ontbrekende exemplaren toevoegen',
    unchanged: 'Aantal klopt, blijft onveranderd',
    kept_existing: 'Bestaande voorraad blijft bewust behouden; dit Excel-verschil wordt genegeerd',
    combined: 'Meegeteld bij dezelfde ISBN-editie',
    blocked: 'Controle nodig',
    skipped: 'Overgeslagen',
  };
  const issueNames = {
    conflicting_edition_isbns: 'Tegenstrijdige ISBN-waarden',
    conflicting_source_columns: 'Tegenstrijdige bronkolommen',
    edition_identity_conflict: 'Boeken met hetzelfde ISBN hebben verschillende gegevens',
    invalid_physical_barcode: 'Ongeldige barcode',
    duplicate_physical_barcode: 'Barcode is dubbel',
    missing_title_after_metadata: 'Titel ontbreekt',
    missing_author_after_metadata: 'Auteur ontbreekt',
    invalid_or_unrecognized_isbn: 'ISBN niet herkend',
    isbn_repaired: 'ISBN automatisch verbeterd',
    isbn_repair_suggested: 'ISBN-correctie voorgesteld',
    unknown_column: 'Onbekende kolom',
    nonstandard_easy_reading_value: 'Afwijkende Makkelijk Lezen waarde',
    class_context_needs_review: 'Klas moet worden gecontroleerd',
    metadata_differs_from_excel: 'Metadata wijkt af van Excel',
  };
  const fieldDefs = [
    ['title', 'Titel'], ['author', 'Auteur'], ['editionIsbn', 'ISBN'],
    ['barcode', 'Fysieke barcode'], ['quantity', 'Aantal exemplaren'],
    ['publisher', 'Uitgever'], ['publishedYear', 'Uitgavejaar'],
    ['pageCount', 'Pagina’s'], ['language', 'Taal'],
    ['tags', 'Tags'], ['themes', 'Thema’s'], ['coverUrl', 'Cover URL'],
    ['description', 'Beschrijving'], ['easyReading', 'Makkelijk lezen?'],
    ['examMaterial', 'Examenmateriaal'], ['classes', 'Klassen'],
    ['studentLoan', 'Uitgeleend aan leerling'], ['classLoan', 'Uitgeleend aan klas'],
    ['libraryPresence', 'Aanwezig in bibliotheek'],
  ];

  // A temporary skip must not erase edits the administrator already typed.
  // Skipped rows are still sent to the server as skip-only corrections.
  function toggleSkippedRow(corrections, skippedEdits, index, skipped) {
    if (skipped) {
      const existing = corrections.get(index);
      if (existing && !existing.skip && Object.keys(existing.fields || {}).length) {
        skippedEdits.set(index, existing);
      }
      corrections.set(index, { index, skip: true });
    } else {
      const previous = skippedEdits.get(index);
      if (previous) corrections.set(index, previous);
      else corrections.delete(index);
      skippedEdits.delete(index);
    }
  }

  const make = (tag, cls = '', content = '') => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (content !== '') element.textContent = String(content);
    return element;
  };
  const button = (label, cls = 'btn btn--secondary') => {
    const element = make('button', cls, label);
    element.type = 'button';
    return element;
  };

  function apiBase() {
    const base = window.BOEKENBAAI_API_BASE || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '';
    return String(base).replace(/\/$/, '');
  }
  async function request(url, body) {
    const token = localStorage.getItem('boekenbaai_token');
    const headers = { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(apiBase() + url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = typeof payload.error === 'string' ? ' (' + payload.error + ')' : '';
      throw new Error((payload.message || 'Actie mislukt.') + details);
    }
    return payload;
  }
  function encodeFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        resolve(raw.slice(raw.indexOf(',') + 1));
      };
      reader.onerror = () => reject(Error('Bestand lezen is mislukt.'));
      reader.readAsDataURL(file);
    });
  }

  function init() {
    const imports = document.querySelector('.admin-card--imports .admin-card__content');
    if (!imports || document.getElementById('reviewed-import-panel')) return;
    const root = make('section', 'admin-card__section admin-card__section--import bb-review', '');
    root.id = 'reviewed-import-panel';
    const header = make('div', 'bb-review__header');
    header.append(make('h4', '', 'Nieuwe boekimport met controle'));
    header.append(make('p', 'hint', 'Bekijk elk boek, corrigeer fouten en importeer pas na je bevestiging. Bestaande edities worden niet zomaar toegevoegd of overschreven.'));
    root.append(header);
    const form = make('form', 'bb-review__upload');
    const fileLabel = make('label', '', 'Excelbestand (.xlsx of .xls)');
    const file = make('input');
    file.type = 'file';
    file.accept = '.xlsx,.xls';
    file.required = true;
    fileLabel.append(file);
    const metadataLabel = make('label', 'bb-review__check');
    const metadata = make('input');
    metadata.type = 'checkbox';
    metadata.checked = true;
    metadataLabel.append(metadata, document.createTextNode(' Ontbrekende boekinformatie opzoeken via ISBN (kan langer duren)'));
    const syncLabel = make('label', 'bb-review__check');
    const syncMode = make('input');
    syncMode.type = 'checkbox';
    syncLabel.append(syncMode, document.createTextNode(
      ' Voorraad synchroniseren bij herupload: bestaande ISBN-edities vergelijken en alleen ontbrekende exemplaren toevoegen'
    ));
    const syncHint = make('p', 'hint',
      'Er worden nooit automatisch boeken verwijderd of uitleningen gewijzigd. Lagere aantallen en afwijkingen moeten eerst worden opgelost.');
    const analyze = button('Bestand controleren', 'btn');
    analyze.type = 'submit';
    form.append(fileLabel, metadataLabel, syncLabel, syncHint, analyze);
    root.append(form);
    const notice = make('p', 'bb-review__notice hint');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    root.append(notice);
    const liveAlert = make('div', 'bb-review__live-alert');
    liveAlert.setAttribute('role', 'status');
    liveAlert.setAttribute('aria-live', 'polite');
    root.append(liveAlert);
    const results = make('div', 'bb-review__results');
    root.append(results);
    imports.insertBefore(root, imports.firstChild);

    const oldSection = imports.querySelector('#book-import-form')?.closest('.admin-card__section');
    if (oldSection) {
      const details = make('details', 'bb-review__legacy');
      const summary = make('summary', '', 'Oude directe import (zonder deze controle)');
      details.append(summary, oldSection);
      imports.insertBefore(details, root.nextSibling);
    }
    let stage = null;
    let corrections = new Map();
    let inventoryResolutions = new Map();
    const skippedEdits = new Map();
    let page = 0;
    let busy = false;
    let openEditor = null;
    let warningsAccepted = false;
    let mustRecheckWarnings = false;
    let currentApplyButton = null;
    let remotePending = null;
    let syncing = false;
    const PAGE_SIZE = 15;
    const hasUnreviewedChanges = () => {
      if (!stage) return true;
      const byIndex = (left, right) => left.index - right.index;
      return warningsAccepted !== stage.acceptWarnings
        || JSON.stringify(Array.from(corrections.values()).sort(byIndex))
          !== JSON.stringify([...(stage.corrections || [])].sort(byIndex))
        || JSON.stringify([...inventoryResolutions.values()].sort((a, b) => a.isbn.localeCompare(b.isbn)))
          !== JSON.stringify([...(stage.inventoryResolutions || [])]
            .sort((a, b) => a.isbn.localeCompare(b.isbn)));
    };
    const setNotice = (text) => { notice.textContent = text; };
    const frozenControls = new Map();
    function setBusy(value) {
      busy = value;
      root.setAttribute('aria-busy', String(value));
      if (value) {
        // The in-flight review is for the exact corrections on submission.
        // Freeze ALL editor and warning inputs so a response cannot silently
        // replace newer keystrokes or a newer warning decision.
        frozenControls.clear();
        for (const el of root.querySelectorAll('input, button, textarea, select')) {
          frozenControls.set(el, el.disabled);
          el.disabled = true;
        }
      } else {
        for (const [el, wasDisabled] of frozenControls) {
          if (el.isConnected) el.disabled = wasDisabled;
        }
        frozenControls.clear();
      }
    }

    async function run(work, label) {
      if (busy) return;
      setBusy(true);
      setNotice(label);
      try { await work(); } catch (error) { setNotice(error.message); }
      finally { setBusy(false); render(); }
    }

    function rememberResponse(payload, preservePosition = false) {
      const sameStage = stage?.id === payload.id;
      stage = payload;
      remotePending = null;
      liveAlert.replaceChildren();
      warningsAccepted = stage.acceptWarnings === true;
      mustRecheckWarnings = false;
      corrections = new Map((stage.corrections || []).map((change) => [change.index, change]));
      inventoryResolutions = new Map((stage.inventoryResolutions || []).map((item) => [item.isbn, item]));
      skippedEdits.clear();
      if (!preservePosition || !sameStage) {
        page = 0;
        openEditor = null;
      }
      render();
    }

    function showRemoteUpdate(payload) {
      remotePending = payload;
      liveAlert.replaceChildren();
      liveAlert.append(make('p', '', 'Een andere sessie heeft deze import bijgewerkt. Je niet-opgeslagen wijzigingen blijven hier staan, maar kunnen niet worden toegepast voordat je de nieuwste versie hebt geladen.'));
      const refresh = button('Nieuwste versie laden', 'btn btn--secondary');
      refresh.addEventListener('click', () => {
        if (hasUnreviewedChanges()
          && !window.confirm('Je hebt nog niet-opgeslagen wijzigingen. Deze verdwijnen bij het laden van de nieuwste versie. Doorgaan?')) return;
        rememberResponse(remotePending, true);
        setNotice('De meest recente importgegevens zijn geladen.');
      });
      liveAlert.append(refresh);
      for (const element of results.querySelectorAll('input, button, textarea, select')) element.disabled = true;
    }

    function acceptRemote(payload) {
      if (busy) return;
      if (stage && hasUnreviewedChanges()) {
        showRemoteUpdate(payload);
        return;
      }
      const wasNew = !stage || stage.id !== payload.id;
      rememberResponse(payload, true);
      if (payload.status === 'preparing') setNotice('Er wordt een boekimport voorbereid op een andere sessie…');
      else if (payload.status === 'completed') setNotice('De import is in een andere sessie afgerond.');
      else if (payload.status === 'cancelled') setNotice('De import is in een andere sessie geannuleerd.');
      else if (wasNew) setNotice('Er staat een boekimport open. Je ziet hier dezelfde gegevens als in de andere sessie.');
      else setNotice('De gedeelde import is bijgewerkt.');
    }

    async function syncStage() {
      if (busy || syncing || document.hidden || !localStorage.getItem('boekenbaai_token')) return;
      // Poll only while the import panel is on screen. Returning to it
      // automatically catches up on every change made elsewhere.
      if (!imports.getClientRects().length) return;
      syncing = true;
      try {
        const current = (await request(rootPath + '/active')).stage;
        if (busy) return;
        if (current) {
          // While unsaved changes are waiting for confirmation, compare the
          // remote revision with the cached full response, not the older local
          // stage. Otherwise a 1,500-row workbook is fetched every 1.5 sec.
          const known = remotePending?.id === current.id ? remotePending : stage;
          if (!known || known.id !== current.id || known.revision !== current.revision
            || known.status !== current.status) {
            const full = await request(rootPath + '/' + encodeURIComponent(current.id));
            if (!busy && (!remotePending || remotePending.id !== full.id
              || remotePending.revision !== full.revision || remotePending.status !== full.status)) {
              acceptRemote(full);
            }
          }
        } else if (stage && ['open', 'reviewing', 'applying', 'preparing'].includes(stage.status)) {
          try {
            const finalState = await request(rootPath + '/' + encodeURIComponent(stage.id));
            if (!busy && (finalState.status !== stage.status || finalState.revision !== stage.revision)) {
              acceptRemote(finalState);
            }
          } catch {
            if (!busy) {
              // The inactivity lease expired or the server restarted.
              // Draft data was never applied to the collection.
              stage = null;
              remotePending = null;
              corrections.clear();
              inventoryResolutions.clear();
              skippedEdits.clear();
              liveAlert.replaceChildren();
              render();
              setNotice('Deze import is verlopen of de server is herstart. Je kunt opnieuw uploaden.');
            }
          }
        }
      } catch {
        // Transient connection failure: keep all local edits intact.
      } finally {
        syncing = false;
      }
    }

    function fieldValue(row, field) {
      const book = row.book || {};
      if (field === 'quantity') return String(book.quantity?.value || 1);
      if (field === 'editionIsbn') return book.editionIsbn
        || row.identifierAnalysis?.explicit?.raw
        || row.identifierAnalysis?.legacy?.raw
        || row.identifierAnalysis?.ambiguous?.raw || '';
      if (field === 'tags') return (book.tags || []).join('; ');
      if (field === 'themes') return (
        Array.isArray(book.manualThemes) && book.manualThemes.length
          ? book.manualThemes : book.themes || []
      ).join('; ');
      if (field === 'easyReading') {
        const source = row.provenance?.easyReading;
        return source?.source === 'excel' ? String(source.raw ?? '') : (book.easyReading ? 'ja' : '');
      }
      if (field === 'examMaterial') {
        const source = row.provenance?.suitableForExamList;
        return source?.source === 'excel' ? String(source.raw ?? '') : (book.suitableForExamList ? 'Ja' : '');
      }
      if (field === 'studentLoan') return row.context?.studentLoan?.name || '';
      if (field === 'classLoan') return row.context?.classLoan?.name || '';
      if (field === 'classes') return (row.context?.classContext || []).join('; ');
      if (field === 'libraryPresence') return row.context?.libraryPresence?.value || '';
      return String(book[field] ?? '');
    }

    function updateCorrection(index, field, value) {
      if (field === 'editionIsbn' && stage?.mode === 'inventory_sync') {
        // ISBN-based choices must not silently carry over after changing the
        // edition identity. The old choice would be stale and uneditable.
        const oldIsbn = stage.rows?.find((item) => item.index === index)?.book?.editionIsbn;
        if (oldIsbn) inventoryResolutions.delete(oldIsbn);
      }
      const existing = corrections.get(index);
      const next = existing && !existing.skip
        ? { ...existing, fields: { ...existing.fields } }
        : { index, fields: {} };
      next.fields[field] = value;
      corrections.set(index, next);
      // New or changed diagnostics require a NEW explicit acknowledgment.
      warningsAccepted = false;
      mustRecheckWarnings = true;
      const warningInput = results.querySelector('.bb-review__controls input[type="checkbox"]');
      if (warningInput) {
        warningInput.checked = false;
        warningInput.disabled = true;
        warningInput.title = 'Controleer eerst de aangepaste gegevens opnieuw.';
      }
      // Prevent applying the PREVIOUS server review while the editor contains
      // changes that have not yet been checked and saved.
      if (currentApplyButton) currentApplyButton.disabled = true;
    }

    function updateInventoryResolution(isbn, keep) {
      if (keep) inventoryResolutions.set(isbn, { isbn, action: 'keep_existing' });
      else inventoryResolutions.delete(isbn);
      // Selecting a stock decision changes no Excel fields or diagnostics.
      // Preserve an already explicit warning acknowledgement; resetting it
      // makes a valid retain-existing decision impossible to submit.
      // The unapplied resolution itself still disables Apply via
      // hasUnreviewedChanges(), until a fresh server review is completed.
      if (currentApplyButton) currentApplyButton.disabled = true;
    }

    function editRow(row, host) {
      const current = corrections.get(row.index);
      const editor = make('div', 'bb-review__editor');
      editor.append(make('p', 'hint', 'De correcties worden pas verwerkt wanneer je op “Correcties controleren” klikt.'));
      const grid = make('div', 'bb-review__fields');
      for (const [field, labelText] of fieldDefs) {
        const fieldWrap = make('label', 'bb-review__field');
        fieldWrap.append(make('span', '', labelText));
        const input = field === 'description' ? make('textarea') : make('input');
        if (field === 'description') input.rows = 2;
        else input.type = 'text';
        input.value = current?.fields?.[field] ?? fieldValue(row, field);
        const source = row.provenance?.[field];
        if (source?.source) {
          input.title = 'Bron: ' + source.source + (source.header ? ', kolom ' + source.header : '');
        }
        input.addEventListener('input', () => updateCorrection(row.index, field, input.value));
        fieldWrap.append(input);
        if (field === 'easyReading') {
          fieldWrap.append(make('span', 'hint',
            'In deze Excelkolom betekent iedere ingevulde waarde Makkelijk lezen, ook “nee”. Maak de cel leeg voor nee.'));
        }
        grid.append(fieldWrap);
      }
      editor.append(grid);
      host.append(editor);
    }

    function render() {
      results.replaceChildren();
      form.hidden = Boolean(stage && ['preparing', 'open', 'reviewing', 'applying'].includes(stage.status));
      if (!stage) return;
      if (stage.status === 'preparing' || stage.status === 'reviewing' || stage.status === 'applying') {
        const messages = {
          preparing: 'Een boekimport wordt voorbereid. Dit scherm wordt automatisch bijgewerkt zodra de preview klaar is.',
          reviewing: 'De correcties worden opnieuw gecontroleerd. Beide sessies zien straks het resultaat.',
          applying: 'De gecontroleerde boeken worden opgeslagen. Start geen tweede import.',
        };
        results.append(make('p', '', messages[stage.status]));
        return;
      }
      if (stage.status === 'cancelled' || stage.status === 'failed') {
        results.append(make('p', '', stage.status === 'cancelled'
          ? 'Deze import is geannuleerd. Je kunt een nieuw Excelbestand kiezen.'
          : 'De import is beëindigd vanwege een fout. Je kunt opnieuw beginnen.'));
        return;
      }
      if (stage.status === 'completed') {
        const done = stage.result || {};
        results.append(make('h4', '', stage.mode === 'inventory_sync'
          ? 'Voorraadvergelijking voltooid' : 'Import voltooid'));
        results.append(make('p', '', done.created + ' fysieke exemplaren opgeslagen.'
          + (done.restoredLoans ? ' ' + done.restoredLoans + ' bestaande uitleningen overgenomen.' : '')
          + ' Importverslag: ' + (done.batchId || 'onbekend')));
        if (done.report) {
          if (done.report.fullyReviewed === false) {
            results.append(make('p', 'bb-review__detail',
              'De boekimport is opgeslagen, maar is nog niet volledig gecontroleerd.'
              + ' Er staan klassentaken open in het docentenportaal.'
              + (done.report.followupTasksCreated ? ' Nieuw: '
                + done.report.followupTasksCreated + ' taak/taken.' : '')));
          } else {
            results.append(make('p', 'bb-review__detail',
              'De import is volledig gecontroleerd; er zijn geen openstaande klassentaken.'));
          }
          const download = button('Download importverslag (JSON)', 'btn btn--secondary');
          download.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(done.report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'boekenbaai-import-' + done.batchId + '.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
          });
          results.append(download);
        }
        setNotice(done.report?.fullyReviewed === false
          ? 'De boeken zijn opgeslagen. De klascontext wordt door docenten of beheer gecontroleerd.'
          : 'De gecontroleerde import is afgerond.');
        return;
      }
      const summary = stage.summary || {};
      const decisions = stage.decisions || { rows: [], summary: {} };
      const inventorySync = stage.mode === 'inventory_sync';
      const heading = make('div', 'bb-review__totals');
      heading.append(make('h4', '', inventorySync ? 'Voorraadvergelijking' : 'Controleoverzicht'));
      if (inventorySync) {
        heading.append(make('p', '', [
          (decisions.summary.addCopies || 0) + ' nieuwe exemplaren',
          (decisions.summary.unchangedEditions || 0) + ' edities ongewijzigd',
          (decisions.summary.blockedEditions || 0) + ' edities met controle nodig',
          (decisions.summary.omittedExistingCopies || 0) + ' bestaande exemplaren ontbreken in dit Excelbestand, blijven behouden',
          (decisions.summary.restoreLoans || 0) + ' gecontroleerde bestaande uitleningen overnemen',
          (decisions.summary.alreadyRecordedLoans || 0) + ' uitleningen al correct geregistreerd',
          (decisions.summary.previouslyImportedLoans || 0) + ' eerder overgenomen uitleningen inmiddels ingeleverd',
          (decisions.summary.classFollowups || 0) + ' Excelrijen krijgen een klascontroletaak',
          (decisions.summary.classContextsAlreadyReviewed || 0)
            + ' eerder gecontroleerde klascontexten blijven ongewijzigd',
        ].join(' · ')));
        heading.append(make('p', 'hint',
          'Excel-aantallen gelden als gewenste totaalvoorraad per ISBN. Er worden geen boeken verwijderd en geen bestaande uitleningen overschreven. Alleen expliciet getoonde, gecontroleerde ontbrekende uitleningen worden toegevoegd.'));
        if (decisions.summary.acknowledgedEditions) {
          heading.append(make('p', 'hint', decisions.summary.acknowledgedEditions
            + ' bestaande edities blijven na jouw expliciete keuze ongewijzigd.'));
        }
        if ((decisions.summary.omittedExistingCopies || 0) > 0) {
          const missing = make('details', 'bb-review__omitted');
          missing.append(make('summary', '', 'Bestaande boeken die ontbreken in dit Excelbestand (blijven behouden)'));
          for (const item of decisions.omittedEditions || []) {
            missing.append(make('p', 'bb-review__detail',
              item.title + ' · ' + (item.editionIsbn || 'ISBN onbekend') + ' · ' + item.copies
              + ' exemplaren, waarvan ' + item.borrowedCopies + ' uitgeleend'));
          }
          if ((decisions.omittedEditions || []).length >= 50) {
            missing.append(make('p', 'hint', 'De lijst toont maximaal 50 edities. De overige exemplaren blijven eveneens behouden.'));
          }
          heading.append(missing);
        }
      } else heading.append(make('p', '', [
        (summary.ready || 0) + ' klaar',
        (summary.warning || 0) + ' waarschuwing',
        (summary.conflict || 0) + ' conflict',
        (summary.unresolved || 0) + ' onopgelost',
        (summary.skipped || 0) + ' overgeslagen',
        (summary.physicalCopies || 0) + ' exemplaren',
      ].join(' · ')));
      const importedLoanCount = (decisions.rows || []).filter((row) =>
        row.canCreate && row.loanBorrower).length;
      const classTaskCount = (decisions.rows || []).filter((item) =>
        item.needsClassFollowup).length;
      if (!inventorySync && classTaskCount) {
        heading.append(make('p', 'bb-review__detail',
          classTaskCount + ' Excelrij(en) kunnen veilig worden geïmporteerd.'
          + ' De onduidelijke klascontext krijgt na het opslaan een aparte controletaak.'));
      }
      if (!inventorySync && importedLoanCount) {
        heading.append(make('p', 'bb-review__detail',
          importedLoanCount + ' bestaand(e) Excel-uitleenrecord(s) worden als uitgeleend aangemaakt. '
          + 'De oorspronkelijke uitleendatum is onbekend en wordt niet verzonnen.'));
      }
      if (stage.fileName) heading.append(make('p', 'hint', stage.fileName));
      results.append(heading);
      const controlBar = make('div', 'bb-review__controls');
      const warnLabel = make('label', 'bb-review__check');
      const warnCheck = make('input');
      warnCheck.type = 'checkbox';
      warnCheck.checked = warningsAccepted;
      warnCheck.disabled = mustRecheckWarnings;
      if (mustRecheckWarnings) warnCheck.title = 'Controleer eerst de aangepaste gegevens opnieuw.';
      warnCheck.addEventListener('change', () => { warningsAccepted = warnCheck.checked; render(); });
      warnLabel.append(warnCheck, document.createTextNode(' Ik heb alle waarschuwingen gecontroleerd en accepteer deze.'));
      const checkButton = button('Correcties controleren', 'btn btn--secondary');
      checkButton.disabled = Boolean(remotePending || busy);
      checkButton.addEventListener('click', () => run(async () => {
        const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/review', {
          revision: stage.revision, acceptWarnings: mustRecheckWarnings ? false : warningsAccepted,
          corrections: Array.from(corrections.values()),
          ...(inventorySync ? { inventoryResolutions: [...inventoryResolutions.values()] } : {}),
        });
        rememberResponse(payload);
        setNotice('Correcties en waarschuwingen zijn opnieuw gecontroleerd.');
      }, 'Wijzigingen worden opnieuw geanalyseerd…'));
      const applyButton = button(inventorySync ? 'Synchronisatie bevestigen' : 'Definitief importeren', 'btn');
      currentApplyButton = applyButton;
      applyButton.disabled = !decisions.summary.readyToApply || hasUnreviewedChanges()
        || Boolean(remotePending) || busy;
      applyButton.addEventListener('click', () => {
        const count = inventorySync ? decisions.summary.addCopies || 0 : summary.physicalCopies || 0;
        const message = inventorySync
          ? 'Je voegt ' + count + ' ontbrekende exemplaren toe en registreert '
            + (decisions.summary.restoreLoans || 0) + ' bestaande, gecontroleerde uitleningen. '
            + 'De leenstatus van de geselecteerde fysieke boeken kan veranderen. '
            + 'Bestaande leningen worden niet overschreven en boeken worden niet verwijderd. Bevestigen?'
          : 'Je staat op het punt om ' + count + ' exemplaren toe te voegen, waarvan '
            + importedLoanCount + ' als al uitgeleend worden geregistreerd. '
            + 'Controleer de leerling/klas en het juiste exemplaar zorgvuldig. Bevestigen?';
        if (!window.confirm(message)) return;
        run(async () => {
          const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/apply', {
            revision: stage.revision, confirm: true,
          });
          rememberResponse(payload);
        }, 'Bevestigde boeken worden opgeslagen…');
      });
      const cancelButton = button('Import annuleren', 'btn btn--ghost');
      cancelButton.disabled = Boolean(remotePending || busy);
      cancelButton.addEventListener('click', () => {
        if (!window.confirm('Deze boekimport annuleren? Niet-opgeslagen correcties gaan verloren.')) return;
        run(async () => {
          const response = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/cancel', {
            revision: stage.revision,
          });
          rememberResponse(response);
          setNotice('De import is geannuleerd. In een andere sessie wordt dit automatisch zichtbaar.');
        }, 'Import wordt geannuleerd…');
      });
      controlBar.append(warnLabel, checkButton, applyButton, cancelButton);
      if (!decisions.summary.readyToApply) {
        controlBar.append(make('p', 'hint', 'Importeren wordt pas mogelijk als alle conflicten zijn gecorrigeerd of overgeslagen en waarschuwingen zijn bevestigd.'));
      }
      results.append(controlBar);
      const rows = stage.rows || [];
      const maxPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
      page = Math.min(page, maxPage);
      const list = make('div', 'bb-review__rowlist');
      for (const row of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
        const dec = decisions.rows.find((item) => item.index === row.index) || {};
        const card = make('article', 'bb-review__row bb-review__row--' + (row.status || 'unknown'));
        const first = make('div', 'bb-review__row-header');
        first.append(make('strong', '', 'Rij ' + row.sourceRowNumber + ' · ' + (row.book?.title || '(geen titel)')));
        first.append(make('span', 'bb-review__state', statusNames[row.status] || row.status));
        card.append(first);
        const originalIdentifier = row.book?.editionIsbn
          || row.identifierAnalysis?.explicit?.raw
          || row.identifierAnalysis?.legacy?.raw
          || row.identifierAnalysis?.ambiguous?.raw;
        card.append(make('p', 'bb-review__detail', [
          row.book?.author || '(geen auteur)',
          row.book?.editionIsbn || (originalIdentifier
            ? 'Ongeldig ISBN: ' + originalIdentifier : '(geen geldig ISBN)'),
          String(row.book?.quantity?.value || 1) + ' exemplaar/exemplaren',
        ].join(' · ')));
        const visibleThemes = Array.isArray(row.book?.manualThemes) && row.book.manualThemes.length
          ? row.book.manualThemes : row.book?.themes || [];
        if (visibleThemes.length) card.append(make('p', 'bb-review__detail',
          'Thema’s: ' + visibleThemes.join(', ')));
        const easyReadingSource = row.provenance?.easyReading;
        if (easyReadingSource?.source === 'excel') {
          // The agreed Excel rule is deliberately based on whether a cell is
          // filled, even when its literal content is 'nee' or 'false'.
          card.append(make('p', 'bb-review__detail',
            'Makkelijk lezen: ' + (row.book?.easyReading ? 'ja' : 'nee')
            + ' (Excel: ' + String(easyReadingSource.raw ?? '') + ')'));
        }
        if (inventorySync && dec.action) {
          const count = dec.action === 'add_copies'
            ? ' · +' + dec.addCopies + ' exemplaren totaal voor dit ISBN'
            : dec.action === 'combined' && dec.rowAddCopies
              ? ' · +' + dec.rowAddCopies + ' exemplaren vanuit deze rij'
              : dec.action === 'unchanged' ? ' · ' + dec.existingCopies + ' aanwezig'
                : '';
          card.append(make('p', 'bb-review__detail', (syncActions[dec.action] || dec.action) + count));
        }
        if (dec.previousClassFollowup) {
          card.append(make('p', 'bb-review__detail',
            'Deze klascontext is al door een medewerker gecontroleerd.'
            + ' De bestaande uitlening en eventuele inname blijven ongewijzigd.'));
        }
        if (dec.needsClassFollowup) {
          card.append(make('p', 'bb-review__detail',
            'Klasinformatie nog onduidelijk. Er wordt na bevestiging een gedeelde '
            + 'controletaak voor de betreffende klas of beheer aangemaakt.'
            + ' De uitleenstatus wordt niet automatisch gewijzigd.'));
        }
        if (dec.loanBorrower && (dec.canCreate || (inventorySync && dec.loanState))) {
          const already = dec.loanState === 'already_recorded';
          const returned = dec.loanState === 'previously_imported';
          card.append(make('p', 'bb-review__detail',
            (returned ? 'Deze oude Excel-uitlening is eerder verwerkt en inmiddels ingeleverd. Het boek blijft beschikbaar.'
              : already ? 'Uitlening staat al correct geregistreerd'
              : dec.loanState === 'existing' ? 'Dit bestaande fysieke exemplaar wordt als uitgeleend geregistreerd'
                : 'Dit nieuwe fysieke exemplaar wordt als uitgeleend geregistreerd')
            + ' · ' + (dec.loanBorrower.type === 'student' ? 'Leerling: ' : 'Klas: ')
            + dec.loanBorrower.name
            + (returned ? '' : ' · Oorspronkelijke uitleendatum onbekend')));
        }
        if (dec.reason && dec.reason !== 'skipped') {
          card.append(make('p', 'bb-review__reason', reasonNames[dec.reason] || dec.reason));
        }
        const issues = (row.issues || []).filter((issue) => issue.severity !== 'info');
        if (issues.length) {
          card.append(make('p', 'bb-review__issues', issues.map((issue) => issueNames[issue.code] || issue.code).join(' · ')));
        }
        const origin = ['title', 'author', 'editionIsbn'].map((field) => {
          const p = row.provenance?.[field];
          return p?.source ? field + ': ' + (p.header || p.source) : '';
        }).filter(Boolean);
        if (origin.length) card.append(make('p', 'hint', 'Bron: ' + origin.join(' · ')));
        const actions = make('div', 'bb-review__row-actions');
        if (inventorySync && dec.editionIsbn && dec.canKeepExisting === true
          && dec.action !== 'combined' && dec.action !== 'skipped') {
          const actionLabel = make('label', 'bb-review__field');
          actionLabel.append(make('span', '', 'Keuze voor deze bestaande ISBN-editie'));
          const choice = make('select');
          const defaultChoice = make('option', '', 'Excel volgen of verschillen eerst corrigeren');
          defaultChoice.value = '';
          const keepChoice = make('option', '', 'Huidige boeken behouden; Excel-verschil voor deze editie negeren');
          keepChoice.value = 'keep_existing';
          choice.append(defaultChoice, keepChoice);
          choice.value = inventoryResolutions.has(dec.editionIsbn) ? 'keep_existing' : '';
          choice.addEventListener('change', () => {
            updateInventoryResolution(dec.editionIsbn, choice.value === 'keep_existing');
            render();
          });
          actionLabel.append(choice);
          actions.append(actionLabel);
          if (dec.reason === 'reduction_requires_manual_review') {
            actions.append(make('p', 'hint',
              'Wil je echt exemplaren verwijderen? Doe dit bewust via het bestaande boekbeheer, met controle van eerdere uitleningen.'));
          }
        }
        const editButton = button(openEditor === row.index ? 'Invoer sluiten' : 'Rij corrigeren', 'btn btn--ghost');
        editButton.addEventListener('click', () => {
          openEditor = openEditor === row.index ? null : row.index;
          render();
        });
        if (row.issues?.some((issue) => issue.code === 'metadata_title_conflict') && row.book?.title) {
          const retainTitle = button('Excel-titel behouden', 'btn btn--secondary');
          retainTitle.addEventListener('click', () => {
            updateCorrection(row.index, 'title', row.book.title);
            render();
          });
          actions.append(retainTitle);
        }
        const skipLabel = make('label', 'bb-review__check');
        const skip = make('input');
        skip.type = 'checkbox';
        skip.checked = corrections.get(row.index)?.skip === true;
        skip.addEventListener('change', () => {
          toggleSkippedRow(corrections, skippedEdits, row.index, skip.checked);
          // Skipping the selected edition should not leave a hidden choice
          // that prevents the next server-side review from completing.
          if (inventorySync && skip.checked && row.book?.editionIsbn) {
            inventoryResolutions.delete(row.book.editionIsbn);
          }
          warningsAccepted = false;
          mustRecheckWarnings = true;
          if (openEditor === row.index && skip.checked) openEditor = null;
          render();
        });
        skipLabel.append(skip, document.createTextNode(' Deze rij overslaan'));
        actions.append(editButton, skipLabel);
        card.append(actions);
        if (openEditor === row.index && !skip.checked) editRow(row, card);
        list.append(card);
      }
      results.append(list);
      const navigation = make('div', 'bb-review__pagination');
      const prev = button('Vorige', 'btn btn--ghost');
      prev.disabled = page === 0;
      prev.addEventListener('click', () => { page -= 1; render(); });
      const next = button('Volgende', 'btn btn--ghost');
      next.disabled = page === maxPage;
      next.addEventListener('click', () => { page += 1; render(); });
      navigation.append(prev, make('span', '', 'Pagina ' + (page + 1) + ' van ' + (maxPage + 1)), next);
      results.append(navigation);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const selected = file.files?.[0];
      if (!selected) return setNotice('Kies eerst een Excelbestand.');
      if (selected.size > 25 * 1024 * 1024) return setNotice('Het Excelbestand is te groot (maximaal 25 MB).');
      run(async () => {
        const encoded = await encodeFile(selected);
        let payload;
        try {
          payload = await request(rootPath, {
            file: encoded, fileName: selected.name, enrichIsbn: metadata.checked,
            mode: syncMode.checked ? 'inventory_sync' : 'create',
          });
        } catch (error) {
          await syncStage();
          throw error;
        }
        rememberResponse(payload);
        setNotice('Preview gereed. De bibliotheek is nog niet gewijzigd.');
      }, 'Het Excelbestand wordt gecontroleerd…');
    });
    syncStage();
    window.setInterval(syncStage, 1500);
    window.addEventListener('focus', syncStage);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncStage();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
