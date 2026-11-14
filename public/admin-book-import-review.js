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
    ['fixedClass', 'Vast in de klas van'],
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
    header.append(make('h4', '', 'Boeken en administratie synchroniseren'));
    header.append(make('p', 'hint', 'Eén Excelbestand, één controle en één definitieve bevestiging. Kies precies wat je wilt bijwerken.'));
    root.append(header);
    const steps=make('nav','bb-import__steps');
    steps.setAttribute('aria-label','Importstappen');
    const stepNodes=[];
    for(const label of ['1. Bestand en keuzes','2. Verschillen controleren',
      '3. Import afronden']){
      const step=make('span','bb-import__step',label);
      steps.append(step);
      stepNodes.push(step);
    }
    root.append(steps);
    const enrichmentStatus = make('p', 'hint', 'Gratis aanvulling van boekgegevens: status wordt gecontroleerd.');
    enrichmentStatus.setAttribute('role', 'status');
    const enrichmentExtra=make('details','bb-import__extras');
    enrichmentExtra.append(make('summary','',
      'Boekverrijking en aanvullend zoeken (optioneel)'),enrichmentStatus);
    root.append(enrichmentExtra);
    async function refreshEnrichmentStatus() {
      try {
        const data = await request('/api/admin/book-enrichment/status');
        if (!root.isConnected) return;
        enrichmentStatus.textContent = data.enabled
          ? 'Extra gratis boekgegevens worden na de import aangevuld. Gecontroleerd: '
            + data.checkedWorks + ' titels. Nog te controleren: ' + data.pendingWorks + '.'
          : 'Automatische gratis aanvulling na import staat nog uit. Configureer het EasyCB-contactadres op de server.';
      } catch {
        // Logged-out visitors must not see a misleading enabled status.
        enrichmentStatus.textContent = 'Extra boekgegevens kunnen na import worden aangevuld als dit op de server is ingesteld.';
      }
    }
    void refreshEnrichmentStatus();

    // This panel is independent of the staged Excel upload. Approval can be
    // given after leaving the browser, after logging in again, or on another
    // day. The server owns all saved progress and budget checks.
    const bravePanel = make('section', 'bb-review__brave');
    const braveHeading = make('h4', '', 'Aanvullend zoeken op internet');
    const braveNotice = make('p', 'hint', 'De zoekvoortgang wordt geladen.');
    braveNotice.setAttribute('role', 'status');
    const braveItems = make('div', 'bb-review__brave-items');
    bravePanel.append(braveHeading, braveNotice, braveItems);
    enrichmentExtra.append(bravePanel);
    let braveRefreshing = false;
    async function refreshBrave() {
      if (braveRefreshing || !root.isConnected) return;
      braveRefreshing = true;
      try {
        const info = await request('/api/admin/book-enrichment/brave');
        const usage = info.usage || {};
        const remaining = Number(usage.available || 0);
        braveNotice.textContent = info.configured
          ? 'Zoekbudget van Boekenbaai deze maand: ' + remaining
            + ' verzoeken beschikbaar, ' + (usage.reserved || 0)
            + ' gereserveerd (maximum ' + (usage.cap || 900) + ').'
          : 'Brave staat nog uit. Stel BOEKENBAAI_BRAVE_API_KEY in op de server. '
            + 'Openstaande importopdrachten blijven bewaard.';
        braveItems.replaceChildren();
        const jobs = Array.isArray(info.jobs) ? info.jobs : [];
        if (!jobs.length) {
          braveItems.append(make('p', 'hint',
            'Na een boekimport verschijnt hier hoeveel titels nog extra onderzoek nodig hebben.'));
        }
        for (const job of jobs) { // Includes every pending approval, even older imports.
          const item = make('div', 'bb-review__brave-job');
          const name = job.source === 'collection' ? 'Bestaande collectie'
            : (job.fileName || 'Boekimport');
          const title = make('strong', '', name);
          const details = make('p', 'hint');
          if (job.state === 'awaiting_free') {
            details.textContent = 'Gratis bronnen worden onderzocht voor ' + job.waitingFree
              + ' titels. Je hoeft deze pagina niet open te houden.';
          } else if (job.state === 'awaiting_approval') {
            details.textContent = job.needsBrave + ' titels hebben aanvullende informatie nodig. '
              + 'Maximaal ' + job.estimatedMaxRequests + ' zoekopdrachten voor alles. '
              + 'Nu mogelijk: ' + job.possibleWorks + ' titels met maximaal '
              + job.possibleMaxRequests + ' zoekopdrachten.';
          } else if (job.state === 'running') {
            details.textContent = 'Zoeken bezig: ' + job.processedApproved
              + ' van ' + job.approvedWorks + ' goedgekeurde titels. '
              + job.reservedRequests + ' van maximaal ' + job.approvedMaxRequests
              + ' verzoeken gereserveerd. Je kunt deze pagina sluiten.';
          } else if (job.state === 'paused') {
            details.textContent = 'Onderzoek gepauzeerd (' + (job.lastError || 'onbekende reden')
              + '). Voortgang is bewaard. Je kunt later opnieuw toestemming geven '
              + 'nadat het probleem is verholpen.';
          } else {
            details.textContent = 'Zoekronde afgerond: ' + job.completedWorks + ' titels onderzocht. '
              + (job.withoutCover || 0) + ' titels hebben nog geen werkende omslaglink en '
              + (job.limitedDescriptions || 0) + ' een beperkte beschrijving. '
              + 'Deze titels blijven zichtbaar als aandachtspunt.';
          }
          item.append(title, details);
          if (job.incompleteIdentity) item.append(make('p', 'hint',
            job.incompleteIdentity + ' exemplaren hebben geen bruikbare titel en auteur; '
            + 'die kunnen nog niet veilig op internet worden onderzocht.'));
          if (job.canApprove && info.configured) {
            const accept = button('Aanvullend zoeken goedkeuren', 'btn btn--secondary');
            accept.addEventListener('click', async () => {
              const message = 'Brave mag maximaal ' + job.possibleMaxRequests
                + ' zoekopdrachten uitvoeren voor ' + job.possibleWorks + ' boeken. '
                + 'Boekenbaai reserveert deze verzoeken binnen de ingestelde maandgrens. '
                + 'Andere apps die dezelfde Brave-sleutel gebruiken tellen niet mee. '
                + 'Zorg dat betaalde aanvulling in het Brave-account is uitgeschakeld. '
                + 'Je kunt de pagina na goedkeuring sluiten. Doorgaan?';
              if (!window.confirm(message)) return;
              accept.disabled = true;
              try {
                await request('/api/admin/book-enrichment/brave/' + encodeURIComponent(job.id) + '/approve', {
                  confirm: true, maxRequests: job.possibleMaxRequests, month: usage.month,
                });
                setNotice('Brave-onderzoek goedgekeurd en opgeslagen. Je kunt dit scherm sluiten.');
              } catch (error) {
                setNotice(error.message || 'Toestemming opslaan is mislukt.');
              } finally {
                void refreshEnrichmentStatus();
                // Clear the refresh guard before reloading after an approval.
                braveRefreshing = false;
                void refreshBrave();
              }
            });
            item.append(accept);
          }
          braveItems.append(item);
        }
        if (info.configured || info.freeConfigured) {
          const scan = button('Bestaande collectie controleren', 'btn btn--ghost');
          scan.addEventListener('click', async () => {
            if (!window.confirm('De bestaande boeken op ontbrekende gegevens controleren? '
              + 'Gratis bronnen starten automatisch. Brave wordt pas na jouw toestemming gebruikt.')) return;
            scan.disabled = true;
            try {
              await request('/api/admin/book-enrichment/brave/scan', {confirm:true});
              setNotice('Collectiecontrole opgeslagen. Je kunt later toestemming geven voor Brave.');
            } catch (error) {
              setNotice(error.message || 'Collectiecontrole kon niet worden gestart.');
            } finally {
              scan.disabled = false;
              void refreshBrave();
            }
          });
          braveItems.append(scan);
        }
        braveItems.append(make('p', 'hint',
          'Geen toestemming geven mag altijd. De import blijft opgeslagen; je kunt later terugkomen. '
          + 'De maandgrens bewaakt alleen verzoeken vanuit Boekenbaai, niet het Brave-account zelf.'));
      } catch {
        braveNotice.textContent = 'De voortgang van Brave kon niet worden geladen.';
      } finally {
        braveRefreshing = false;
      }
    }
    void refreshBrave();
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
    metadataLabel.append(metadata, document.createTextNode(
      ' Ontbrekende boekgegevens opzoeken tijdens de controle (optioneel).'));
    const importMode = make('select');
    for (const [value,label] of [
      ['unified','Samen synchroniseren (aanbevolen)'],
      ['ordinary','Alleen nieuwe boeken direct toevoegen (oude werkwijze)'],
      ['reconcile','Alleen administratie controleren (oude werkwijze)'],
    ]) {
      const option=make('option','',label);
      option.value=value;
      importMode.append(option);
    }
    importMode.value='unified';
    const advanced = make('details','bb-import__advanced');
    advanced.append(make('summary','','Andere importmethoden (geavanceerd)'));
    const importModeLabel=make('label','bb-review__field');
    importModeLabel.append(make('span','','Importmethode'),importMode);
    const syncLabel = make('label', 'bb-review__check');
    const syncMode = make('input');
    syncMode.type = 'checkbox';
    syncLabel.append(syncMode, document.createTextNode(
      ' Alleen ontbrekende exemplaren toevoegen (oude voorraadvergelijking)'
    ));
    const syncHint=make('p','hint',
      'De oude methoden verwerken de administratie en de voorraad apart.');
    advanced.append(importModeLabel,syncLabel,syncHint);

    const parts = make('section','bb-import__parts');
    const partsHeading = make('div','bb-import__parts-heading');
    partsHeading.append(make('strong','','Wat wil je bijwerken?'));
    const allButton=button('Alles selecteren','btn btn--ghost');
    allButton.type='button';
    const noneButton=button('Selectie wissen','btn btn--ghost');
    noneButton.type='button';
    partsHeading.append(allButton,noneButton);
    parts.append(partsHeading);
    const partChecks=new Map();
    const columns=[
      ['title','Titel'],['author','Auteur'],['description','Beschrijving'],
      ['publisher','Uitgever'],['publishedYear','Verschijningsjaar'],
      ['pageCount','Aantal pagina’s'],['language','Taal'],
      ['coverUrl','Boekomslag'],['easyReading','Makkelijk lezen'],
      ['suitableForExamList','Examenleeslijst'],['tags','Trefwoorden'],
      ['manualThemes','Thema’s'],
    ];
    const checkPart=(key,label,enabled=false)=>{
      const item=make('label','bb-import__option');
      const checkbox=make('input');
      checkbox.type='checkbox';
      checkbox.checked=enabled;
      item.append(checkbox,make('span','',label));
      partChecks.set(key,checkbox);
      return item;
    };
    const card=(heading,subtitle)=>{
      const section=make('section','bb-import__part-card');
      section.append(make('strong','',heading),make('p','hint',subtitle));
      return section;
    };
    const stockCard=card('Boekenvoorraad','Voeg ontbrekende ISBN-edities en exemplaren toe. Niets wordt verwijderd.');
    stockCard.append(checkPart('books','Nieuwe boeken en exemplaren toevoegen',true));
    const adminCard=card('Administratie','Pas alleen de aangevinkte registraties aan.');
    adminCard.append(checkPart('loans','Uitleningen bijwerken',true),
      checkPart('locations','Vaste locaties bijwerken',true));
    parts.append(stockCard,adminCard);
    const metadataDetails=make('details','bb-import__columns');
    metadataDetails.append(make('summary','',
      'Boekgegevens per Excelkolom bijwerken (optioneel)'));
    metadataDetails.append(make('p','hint',
      'Bestaande boekgegevens veranderen uitsluitend voor aangevinkte kolommen '
      + 'met een ingevulde Excelwaarde. Omslagen en andere gegevens blijven anders staan.'));
    const columnGrid=make('div','bb-import__column-grid');
    for(const [key,label] of columns)columnGrid.append(checkPart(key,label));
    metadataDetails.append(columnGrid);
    parts.append(metadataDetails);
    const selectedText=make('p','bb-import__selection hint');
    const updateSelected=()=>{
      const n=[...partChecks.values()].filter(input=>input.checked).length;
      selectedText.textContent=n+' onderdelen geselecteerd · '
        +'Niet-geselecteerde en lege Excelvelden veranderen niets.';
    };
    for(const checkbox of partChecks.values())checkbox.addEventListener('change',updateSelected);
    allButton.addEventListener('click',()=>{
      for(const check of partChecks.values())check.checked=true;
      metadataDetails.open=true;
      updateSelected();
    });
    noneButton.addEventListener('click',()=>{
      for(const check of partChecks.values())check.checked=false;
      updateSelected();
    });
    parts.append(selectedText);
    updateSelected();
    const selectedParts=()=>({
      books:partChecks.get('books').checked,
      loans:partChecks.get('loans').checked,
      locations:partChecks.get('locations').checked,
      fields:Object.fromEntries(columns.map(([key])=>[key,partChecks.get(key).checked])),
    });
    const analyze=button('Excelbestand controleren','btn');
    analyze.type='submit';
    const refreshImportMode=()=>{
      const unified=importMode.value==='unified';
      parts.hidden=!unified;
      syncLabel.hidden=unified||importMode.value==='reconcile';
      syncHint.hidden=unified||importMode.value==='reconcile';
      syncMode.disabled=unified||importMode.value==='reconcile';
      const hasBookData=partChecks.get('books').checked
        ||columns.some(([key])=>partChecks.get(key).checked);
      metadataLabel.hidden=importMode.value==='reconcile'
        ||(unified&&!hasBookData);
      metadata.disabled=metadataLabel.hidden;
    };
    importMode.addEventListener('change',refreshImportMode);
    for(const check of partChecks.values())check.addEventListener('change',refreshImportMode);
    allButton.addEventListener('click',refreshImportMode);
    noneButton.addEventListener('click',refreshImportMode);
    form.append(fileLabel,parts,metadataLabel,advanced,analyze);
    refreshImportMode();
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
    let assignmentResolutions = new Map();
    let metadataResolutions = new Map();
    const skippedEdits = new Map();
    let page = 0;
    let automaticPage = 0;
    let automaticExpanded = false;
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
            .sort((a, b) => a.isbn.localeCompare(b.isbn)))
        || JSON.stringify([...assignmentResolutions.values()]
            .sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})))
          !== JSON.stringify([...(stage.assignmentResolutions || [])]
            .sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})))
        || JSON.stringify([...metadataResolutions.values()].sort((a,b)=>a.id.localeCompare(b.id)))
          !== JSON.stringify([...(stage.metadataResolutions||[])].sort((a,b)=>a.id.localeCompare(b.id)));
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
      assignmentResolutions = new Map((stage.assignmentResolutions || []).map((item) => [item.id, item]));
      metadataResolutions = new Map((stage.metadataResolutions || []).map(item=>[item.id,item]));
      skippedEdits.clear();
      if (!preservePosition || !sameStage) {
        page = 0;
        automaticPage = 0;
        automaticExpanded = false;
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
              assignmentResolutions.clear();
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
      if (['publishedYear','pageCount'].includes(field)
        &&row.provenance?.[field]?.source==='excel'
        &&row.provenance[field].raw!==undefined){
        // Invalid numeric Excel cells normalize to null; show the original
        // entry in the editor so the user knows what needs correcting.
        return String(row.provenance[field].raw??'');
      }
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
      if (field === 'classLoan') return row.context?.studentClassHint?.label
        || row.context?.classLoan?.name || '';
      if (field === 'fixedClass') return row.context?.fixedLocation?.source === 'explicit_fixed_class'
        ? (row.context.fixedLocation.raw ?? row.context.fixedLocation.label ?? '') : '';
      if (field === 'classes') return (row.context?.classContext || []).join('; ');
      if (field === 'libraryPresence') return row.context?.libraryPresence?.value || '';
      return String(book[field] ?? '');
    }

    function updateCorrection(index, field, value) {
      if (field === 'editionIsbn' && ['inventory_sync','unified_sync'].includes(stage?.mode)) {
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

    function editRow(row, host, options = {}) {
      const current = corrections.get(row.index);
      const editor = make('div', 'bb-review__editor');
      editor.append(make('p', 'hint', 'De correcties worden pas verwerkt wanneer je op “Correcties controleren” klikt.'));
      const grid = make('div', 'bb-review__fields');
      for (const [field, labelText] of fieldDefs) {
        if (options.onlyFields && !options.onlyFields.includes(field)) continue;
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
        input.addEventListener('input', () => {
          if (options.metadataIssueId)metadataResolutions.delete(options.metadataIssueId);
          updateCorrection(row.index, field, input.value);
        });
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

    function renderUnifiedSync() {
      const plan=stage.decisions||{};
      const summary=plan.summary||{};
      const stock=plan.inventory||{rows:[],summary:{}};
      const assignment=plan.assignments||{differences:[],summary:{}};
      const metadataPlan=plan.metadata||{updates:[],issues:[],summary:{}};
      const changes=assignment.differences||[];
      const exceptions=changes.filter(item=>!item.automatic&&!item.previouslyImported);
      const automatic=changes.filter(item=>item.automatic);
      const pendingAssignments=exceptions.filter(item=>
        (assignmentResolutions.get(item.id)?.action||item.choice)==='pending');
      const pendingMetadata=metadataPlan.issues.filter(item=>
        !metadataResolutions.has(item.id));
      const blocked=(stock.rows||[]).filter(item=>item.action==='blocked'
        &&item.combinedWith===undefined);
      const heading=make('div','bb-import__review-heading');
      heading.append(make('h4','','2. Bekijk de voorgestelde wijzigingen'));
      heading.append(make('p','hint',
        'De aangevinkte onderdelen worden samen verwerkt na jouw bevestiging. '
        +'Alleen uitzonderingen vragen een afzonderlijke keuze.'));
      results.append(heading);
      const numbers=make('div','bb-import__stat-grid');
      for(const [count,label] of [
        [summary.newCopies||0,'Nieuwe exemplaren'],
        [summary.proposedLoans||0,'Uitleningen bijwerken'],
        [summary.proposedLocations||0,'Vaste locaties'],
        [summary.metadataFields||0,'Boekgegevens wijzigen'],
      ]){
        const stat=make('div','bb-import__stat');
        stat.append(make('strong','',String(count)),make('span','',label));
        numbers.append(stat);
      }
      results.append(numbers);
      const status=make('p','bb-import__review-status');
      const pending=(summary.pending||0);
      status.append(make('strong','',pending
        ?pending+' uitzonderingen vragen aandacht'
        :'Geen openstaande uitzonderingen'));
      status.append(document.createTextNode(' · '
        +(summary.preservedOldCopies||0)+' bestaande exemplaren blijven behouden.'));
      if(summary.previouslyImportedLoans)status.append(make('span','',
        ' · '+summary.previouslyImportedLoans+
        ' eerder verwerkte uitleningen worden niet opnieuw geregistreerd.'));
      results.append(status);

      const selection=make('details','bb-import__selection-details');
      selection.append(make('summary','','Wat wordt bij deze import gesynchroniseerd?'));
      const chosen=plan.parts||stage.syncParts||{};
      const chosenLabels=[];
      if(chosen.books)chosenLabels.push('Nieuwe boeken en exemplaren');
      if(chosen.loans)chosenLabels.push('Uitleningen');
      if(chosen.locations)chosenLabels.push('Vaste locaties');
      const selectedFields=Object.entries(chosen.fields||{})
        .filter(([,value])=>value).map(([field])=>({
          title:'Titel',author:'Auteur',description:'Beschrijving',publisher:'Uitgever',
          publishedYear:'Verschijningsjaar',pageCount:'Aantal pagina’s',
          language:'Taal',coverUrl:'Omslag',easyReading:'Makkelijk lezen',
          suitableForExamList:'Examenleeslijst',tags:'Trefwoorden',
          manualThemes:'Thema’s',
        }[field]||field));
      chosenLabels.push(...selectedFields.map(label=>'Boekgegevens: '+label));
      const selectedList=make('p','bb-import__selection-list',
        chosenLabels.join(' · '));
      selection.append(selectedList,make('p','hint',
        'ISBN wordt alleen gebruikt om boeken te herkennen. '
        +'Alle niet-geselecteerde kolommen en lege Excelvelden blijven ongemoeid.'));
      results.append(selection);

      // Show the actual diagnostic messages before requesting the general
      // warning acknowledgement. A generic "source_needs_review" message
      // does not tell administrators what is wrong with the Excel data.
      const sourceWarnings=(stage.rows||[]).map(row=>({
        row,issues:(row.issues||[]).filter(issue=>
          issue.severity==='warning'||issue.severity==='conflict'),
      })).filter(entry=>entry.issues.length);
      if(sourceWarnings.length){
        const warningCount=sourceWarnings.reduce((total,entry)=>
          total+entry.issues.length,0);
        const notice=make('section','bb-import__source-warnings');
        notice.append(make('h4','','Bronwaarschuwingen uit Excel ('+warningCount+')'));
        notice.append(make('p','hint',
          'Controleer de meldingen per Excelrij voordat je de waarschuwingen '
          +'accepteert. Bij ongeldige gegevens kun je de bron corrigeren '
          +'of de betreffende rij overslaan.'));
        const warningList=make('div','bb-import__warnings-scroll');
        const issueLabels={
          invalid_published_year:'Ongeldig uitgavejaar',
          invalid_page_count:'Ongeldig aantal pagina’s',
          isbn_repaired:'ISBN automatisch hersteld',
          isbn_repair_suggested:'ISBN moet worden gecontroleerd',
          missing_title:'Titel ontbreekt',
          missing_author:'Auteur ontbreekt',
          missing_title_after_metadata:'Titel ontbreekt na aanvullen',
          missing_author_after_metadata:'Auteur ontbreekt na aanvullen',
          invalid_quantity:'Ongeldig aantal exemplaren',
          language_hint_conflict:'Taal wijkt af van de aanwijzing bij examenmateriaal',
          nonstandard_easy_reading_value:'Afwijkende invoer voor Makkelijk lezen',
          invalid_or_unrecognized_isbn:'ISBN niet herkend',
          dangerous_headers_ignored:'Ongeldige kolomkoppen genegeerd',
          conflicting_source_columns:'Meerdere Excelkolommen spreken elkaar tegen',
          duplicate_physical_barcode:'Fysieke barcode komt meerdere keren voor',
          metadata_title_conflict:'Boektitel verschilt van gevonden boekgegevens',
        };
        for(const entry of sourceWarnings){
          const row=entry.row;
          const group=make('div','bb-import__warning-row');
          group.append(make('strong','',
            'Excelrij '+row.sourceRowNumber+' · '+(row.book?.title||'Zonder titel')));
          const items=make('ul','bb-import__warning-items');
          for(const issue of entry.issues){
            const description=issueLabels[issue.code]||
              String(issue.code||'Onbekende melding').replaceAll('_',' ');
            const detailParts=[];
            if(issue.header)detailParts.push('Kolom: '+issue.header);
            else if(issue.field)detailParts.push('Veld: '+issue.field);
            if(issue.raw!==undefined&&issue.raw!==null)
              detailParts.push('In Excel: '+String(issue.raw).slice(0,160));
            if(issue.suggestion?.canonical)
              detailParts.push('Voorstel: '+issue.suggestion.canonical);
            if(issue.repair?.canonical)
              detailParts.push('Gecorrigeerd naar: '+issue.repair.canonical);
            const item=make('li','',description+
              (issue.severity==='conflict'?' (conflict)':' (waarschuwing)')+
              (detailParts.length?' · '+detailParts.join(' · '):''));
            items.append(item);
          }
          group.append(items);
          warningList.append(group);
        }
        notice.append(warningList);
        results.append(notice);
      }

      const controls=make('div','bb-review__controls bb-import__review-controls');
      const acceptLabel=make('label','bb-review__check');
      const accept=make('input');accept.type='checkbox';
      accept.checked=warningsAccepted;
      accept.addEventListener('change',()=>{warningsAccepted=accept.checked;render();});
      acceptLabel.append(accept,document.createTextNode(
        ' Ik heb de eventuele bronwaarschuwingen gecontroleerd.'));
      controls.append(acceptLabel);
      const reviewButton=button('Controle opnieuw berekenen','btn btn--secondary');
      reviewButton.disabled=Boolean(remotePending||busy);
      const reviewChoices=async (assignmentValues,metadataValues)=>{
        const payload=await request(rootPath+'/'+encodeURIComponent(stage.id)+'/review',{
          revision:stage.revision,acceptWarnings:warningsAccepted,
          corrections:[...corrections.values()],
          inventoryResolutions:[...inventoryResolutions.values()],
          assignmentResolutions:assignmentValues,
          metadataResolutions:metadataValues,
        });
        rememberResponse(payload,true);
        setNotice('Alle geselecteerde onderdelen zijn opnieuw gecontroleerd.');
      };
      reviewButton.addEventListener('click',()=>run(async()=>{
        await reviewChoices([...assignmentResolutions.values()],
          [...metadataResolutions.values()]);
      },'De geselecteerde onderdelen worden opnieuw gecontroleerd…'));
      const applyButton=button('Alle geselecteerde wijzigingen bevestigen','btn');
      currentApplyButton=applyButton;
      applyButton.disabled=!summary.readyToApply||hasUnreviewedChanges()
        ||Boolean(remotePending||busy);
      applyButton.addEventListener('click',()=>{
        const description=(summary.newCopies||0)+' nieuwe exemplaren, '
          +(summary.proposedLoans||0)+' uitleningen, '
          +(summary.proposedLocations||0)+' vaste locaties en '
          +(summary.metadataFields||0)+' boekvelden.';
        if(!window.confirm('Je bevestigt in één keer: '+description
          +' Bestaande boeken en lege of niet-geselecteerde kolommen blijven behouden. '
          +'Doorgaan?'))return;
        run(async()=>{
          const payload=await request(rootPath+'/'+encodeURIComponent(stage.id)+'/apply',{
            revision:stage.revision,confirm:true,
          });
          rememberResponse(payload);
          void refreshEnrichmentStatus();
          void refreshBrave();
        },'Boeken en administratie worden samen opgeslagen…');
      });
      const cancel=button('Annuleren','btn btn--ghost');
      cancel.disabled=Boolean(remotePending||busy);
      cancel.addEventListener('click',()=>{
        if(!window.confirm('Deze import annuleren? Er is nog niets opgeslagen.'))return;
        run(async()=>{
          const response=await request(rootPath+'/'+encodeURIComponent(stage.id)+'/cancel',{
            revision:stage.revision,
          });
          rememberResponse(response);
          setNotice('De import is geannuleerd. De bibliotheek is niet aangepast.');
        },'De controle wordt geannuleerd…');
      });
      controls.append(reviewButton,applyButton,cancel);
      const unresolved=[...pendingAssignments,...pendingMetadata];
      if(unresolved.length){
        const bulk=button('Huidige gegevens behouden bij '+unresolved.length
          +' onzekere punten','btn btn--secondary');
        bulk.disabled=Boolean(remotePending||busy);
        bulk.addEventListener('click',()=>{
          if(!window.confirm('Bij '+unresolved.length+' onduidelijke punten blijft '
            +'de bestaande registratie behouden. Duidelijke Excelwijzigingen '
            +'blijven voorgesteld. Doorgaan?'))return;
          run(async()=>{
            const a=new Map(assignmentResolutions),m=new Map(metadataResolutions);
            for(const diff of pendingAssignments)a.set(diff.id,{id:diff.id,action:'keep'});
            for(const issue of pendingMetadata)m.set(issue.id,{id:issue.id,action:'keep'});
            await reviewChoices([...a.values()],[...m.values()]);
          },'De onzekere registraties worden behouden…');
        });
        controls.append(bulk);
      }
      if(!summary.readyToApply)controls.append(make('p','hint',
        pending?'Werk de onderstaande uitzonderingen af en bereken de controle opnieuw.'
          :'Er zijn nog geen wijzigingen om op te slaan, of er staan bronwaarschuwingen open.'));
      results.append(controls);

      const problems=make('section','bb-import__exceptions');
      problems.append(make('h4','','Handmatig controleren ('+
        (exceptions.length+metadataPlan.issues.length+blocked.length)+')'));
      const issueList=make('div','bb-import__exceptions-list');
      const reasonNames={
        ambiguous_physical_copy:'Geen veilig beschikbaar exemplaar vast te stellen.',
        conflicting_excel_borrowers:'Excel noemt zowel een leerling als een klas.',
        physical_barcode_not_found:'Unieke barcode staat niet in de bibliotheek.',
        no_unallocated_copy:'Meer Exceluitleningen dan beschikbare exemplaren.',
        student_loan_records_disagree:'Leerlingregistratie en boekstatus verschillen.',
        source_row_requires_review:'Controleer de gegevens in deze Excelrij.',
        borrower_not_uniquely_matched:'Leerling of klas is niet eenduidig herkend.',
        fixed_location_needs_manual_identification:'Vaste locatie is niet eenduidig.',
        ambiguous_existing_borrower:'Meer exemplaren met dezelfde bestaande lener.',
        student_already_borrowed_edition:'Deze leerling heeft dezelfde ISBN-editie al.',
      };
      for(const diff of exceptions){
        const card=make('article','bb-import__exception');
        card.dataset.reviewRowKey='difference:'+diff.id;
        card.append(make('strong','',diff.title||'Boek onbekend'));
        const meta=['Excelrij '+diff.worksheetRow,diff.editionIsbn,
          diff.kind==='location'?'Vaste locatie':
            diff.kind==='loan'?'Uitlening':'Controlepunt'];
        card.append(make('p','hint',meta.filter(Boolean).join(' · ')));
        const before=diff.kind==='loan'
          ?diff.before?.name||'Niet uitgeleend':diff.before||'Geen vaste locatie';
        const after=diff.kind==='loan'
          ?diff.after?.name||'Geen nieuwe lener':diff.after||'Geen vaste locatie';
        card.append(make('p','bb-review__detail',
          diff.kind==='class_context'
            ?'Excel vermeldt klas '+diff.className+'. Kies of dit een vaste plek of een uitlening is.'
            :diff.kind==='issue'
              ?reasonNames[diff.reason]||diff.reason||'Onzekere koppeling'
              :'Huidig: '+before+' · Excel: '+after));
        const input=make('select');
        const actions=[['pending','Nog beoordelen'],['keep','Huidige gegevens behouden'],
          ['later','Later controleren']];
        if(diff.kind==='class_context'){
          actions.push(['class_fixed','Vast in klas '+diff.className],
            ...(diff.classId&&!diff.hasExplicitLoan
              ?[['class_loan','Uitgeleend aan klas '+diff.className]]:[]),
            ['class_unrelated','Klasvermelding is niet van toepassing']);
        }else if(diff.kind!=='issue'&&!diff.reason){
          actions.push(['apply','Excelgegevens overnemen']);
        }
        for(const [value,label] of actions){
          const option=make('option','',label);option.value=value;input.append(option);
        }
        input.value=assignmentResolutions.get(diff.id)?.action||diff.choice||'pending';
        input.addEventListener('change',()=>{
          if(input.value==='pending')assignmentResolutions.delete(diff.id);
          else assignmentResolutions.set(diff.id,{id:diff.id,action:input.value});
          render();
        });
        card.append(input);issueList.append(card);
      }
      for(const issue of metadataPlan.issues){
        const card=make('article','bb-import__exception');
        card.dataset.reviewRowKey='metadata:'+issue.id;
        card.append(make('strong','',issue.title||issue.isbn));
        card.append(make('p','hint',issue.isbn+' · Boekkolom '+issue.field
          +' · Excelrijen '+issue.worksheetRows.join(', ')));
        card.append(make('p','bb-review__reason',
          issue.reason==='conflicting_excel_values'
            ?'Meerdere verschillende waarden in Excel voor dezelfde ISBN-editie.'
            :'De Excelwaarde is nog niet veilig over te nemen.'));
        const choose=make('select');
        for(const [value,label] of [['pending','Nog beoordelen'],
          ['keep','Huidige boekgegevens behouden']]){
          const option=make('option','',label);option.value=value;choose.append(option);
        }
        choose.value=metadataResolutions.has(issue.id)?'keep':'pending';
        choose.addEventListener('change',()=>{
          if(choose.value==='keep')metadataResolutions.set(issue.id,
            {id:issue.id,action:'keep'});
          else metadataResolutions.delete(issue.id);
          render();
        });
        card.append(choose);
        // Metadata-only imports must be fully correctable without turning
        // stock synchronization on or rebuilding the Excel workbook.
        const editField=issue.field==='manualThemes'?'themes'
          :issue.field==='suitableForExamList'?'examMaterial':issue.field;
        const affected=(stage.rows||[]).filter(row=>
          (issue.worksheetRows||[]).includes(row.sourceRowNumber));
        for(const source of affected){
          const edit=button('Excelrij '+source.sourceRowNumber+' corrigeren',
            'btn btn--secondary');
          edit.disabled=Boolean(remotePending||busy);
          edit.addEventListener('click',()=>{
            openEditor=openEditor===source.index?null:source.index;
            render();
          });
          card.append(edit);
          if(openEditor===source.index){
            editRow(source,card,{
              onlyFields:[editField],metadataIssueId:issue.id,
            });
          }
        }
        if(!affected.length)card.append(make('p','hint',
          'De bronrij is niet beschikbaar voor correctie. Controleer de Excel.'));
        issueList.append(card);
      }
      for(const item of blocked){
        const source=(stage.rows||[]).find(row=>row.index===item.index);
        const card=make('article','bb-import__exception');
        card.dataset.reviewRowKey='stock:'+item.index;
        card.append(make('strong','',source?.book?.title||'Boek'));
        card.append(make('p','hint','Excelrij '+item.worksheetRow+' · '+(item.editionIsbn||'Geen ISBN')));
        card.append(make('p','bb-review__reason','Voorraadcontrole: '+item.reason));
        const edit=button('Gegevens corrigeren','btn btn--secondary');
        edit.addEventListener('click',()=>{
          openEditor=openEditor===item.index?null:item.index;
          render();
        });
        const skip=button('Deze Excelrij overslaan','btn btn--ghost');
        skip.addEventListener('click',()=>{
          if(!window.confirm('Deze volledige Excelrij overslaan bij deze import?'))return;
          toggleSkippedRow(corrections,skippedEdits,item.index,true);
          if(currentApplyButton)currentApplyButton.disabled=true;
          render();
        });
        card.append(edit,skip);
        if(openEditor===item.index&&source)editRow(source,card);
        issueList.append(card);
      }
      if(!issueList.children.length)issueList.append(make('p','hint',
        'Geen afzonderlijke keuzes nodig. De voorgestelde wijzigingen kunnen gezamenlijk worden bevestigd.'));
      problems.append(issueList);
      results.append(problems);

      const suggested=make('details','bb-import__proposals');
      suggested.open=automaticExpanded;
      suggested.addEventListener('toggle',()=>{
        if(suggested.isConnected)automaticExpanded=suggested.open;
      });
      suggested.append(make('summary','',
        'Duidelijke wijzigingen bekijken ('+
        (automatic.length+metadataPlan.updates.length)+')'));
      suggested.append(make('p','hint',
        'Deze wijzigingen zijn voorgesteld en nog niet opgeslagen. '
        +'Je kunt ze afzonderlijk bekijken en behouden in plaats van overnemen.'));
      const tableWrap=make('div','bb-import__proposal-scroll');
      const table=make('table','bb-import__proposal-table');
      const head=make('thead');
      const hr=make('tr');
      for(const label of ['Boek / ISBN','Onderdeel','Voorgestelde wijziging','Keuze'])
        hr.append(make('th','',label));
      head.append(hr);table.append(head);
      const body=make('tbody');
      const addRow=(title,isbn,type,description,control)=>{
        const tr=make('tr');
        for(const value of [title+' · '+isbn,type,description]){
          tr.append(make('td','',value));
        }
        const td=make('td');td.append(control);tr.append(td);
        body.append(tr);
      };
      for(const diff of automatic){
        const control=make('select');
        for(const [value,label] of [['apply','Excel overnemen'],
          ['keep','Bestaande behouden'],['later','Later controleren']]){
          const option=make('option','',label);option.value=value;control.append(option);
        }
        control.value=assignmentResolutions.get(diff.id)?.action||diff.choice||'apply';
        control.addEventListener('change',()=>{
          assignmentResolutions.set(diff.id,{id:diff.id,action:control.value});
          render();
        });
        const description=diff.kind==='loan'
          ?'Naar '+(diff.after?.name||'onbekend')
          :'Naar '+String(diff.after||'');
        addRow(diff.title||'Boek',diff.editionIsbn||'',diff.kind==='loan'?'Uitlening':'Vaste plek',
          description,control);
      }
      for(const update of metadataPlan.updates){
        const control=make('select');
        for(const [value,label] of [['apply','Excel overnemen'],
          ['keep','Bestaande behouden']]){
          const option=make('option','',label);option.value=value;control.append(option);
        }
        control.value=metadataResolutions.has(update.id)?'keep':'apply';
        control.addEventListener('change',()=>{
          if(control.value==='keep')metadataResolutions.set(update.id,
            {id:update.id,action:'keep'});
          else metadataResolutions.delete(update.id);
          render();
        });
        addRow(update.title||'Boek',update.isbn,update.field,
          (update.copies||1)+' bestaand(e) exemplaar/exemplaren',control);
      }
      table.append(body);tableWrap.append(table);suggested.append(tableWrap);
      results.append(suggested);
      if(assignment.notInCollection?.length){
        const missing=make('details','bb-import__missing');
        missing.append(make('summary','',
          assignment.notInCollection.length+' ISBN-groepen niet gekoppeld'));
        missing.append(make('p','hint',
          plan.parts?.books?'Controleer of de voorraadvergelijking deze exemplaren toevoegt.'
            :'Je hebt nieuwe boeken toevoegen niet aangevinkt. Deze exemplaren worden niet toegevoegd.'));
        for(const item of assignment.notInCollection.slice(0,30)){
          missing.append(make('p','bb-review__detail',
            item.title+' · '+item.editionIsbn+' · '+item.copies+' exemplaar/exemplaren'));
        }
        results.append(missing);
      }
    }

    function renderAssignmentReconciliation() {
      const plan = stage.decisions || { differences: [], summary: {} };
      const summary = plan.summary || {};
      const overview = make('div', 'bb-review__totals');
      overview.append(make('h4', '', 'Administratieve koppelingen controleren'));
      overview.append(make('p', '', (summary.automatic || 0)
        + ' wijzigingen uit Excel voorgesteld voor gezamenlijke bevestiging. '
        + (summary.pending || 0) + ' uitzonderingen vragen een keuze. '
        + (summary.notInCollection || 0) + ' ISBN-groepen ('
        + (summary.notInCollectionCopies || 0)
        + ' exemplaren) ontbreken of zijn niet eenduidig te koppelen.'));
      overview.append(make('p', 'hint',
        'Er worden geen boeken toegevoegd, verwijderd of opnieuw verrijkt. '
        + 'Lege Excelvelden laten bestaande uitleningen en vaste locaties ongemoeid. '
        + 'Expliciete gegevens worden voorgesteld wanneer de koppeling veilig is. '
        + 'Je bevestigt alle voorgestelde wijzigingen samen. '
        + 'Dit is geen gewone inlevering en verandert geen leesantwoord.'));
      results.append(overview);
      if ((plan.notInCollection || []).length) {
        const missing = make('details', 'bb-review__omitted');
        missing.append(make('summary', '',
          'Nieuwe of extra exemplaren: verwerk deze via de gewone boekenimport'));
        for (const item of plan.notInCollection.slice(0, 40)) {
          missing.append(make('p', 'bb-review__detail',
            (item.title || '(zonder titel)') + ' · ' + (item.editionIsbn || 'geen ISBN')
            + ' · ' + item.copies + ' exemplaar/exemplaren, Excelrij(en): '
            + (item.rows || []).join(', ')));
        }
        if (plan.notInCollection.length > 40) missing.append(make('p', 'hint',
          'Overige ISBN-groepen worden niet administratief aangepast.'));
        results.append(missing);
      }
      const controls = make('div', 'bb-review__controls');
      const reviewButton = button('Mijn keuzes controleren', 'btn btn--secondary');
      reviewButton.disabled = Boolean(remotePending || busy);
      reviewButton.addEventListener('click', () => run(async () => {
        const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/review', {
          revision: stage.revision, acceptWarnings: true, corrections: [],
          assignmentResolutions: [...assignmentResolutions.values()],
        });
        rememberResponse(payload, true);
        setNotice('Alle administratieve keuzes zijn opnieuw gecontroleerd.');
      }, 'De gekozen correcties worden opnieuw gecontroleerd…'));
      const applyButton = button('Voorgestelde wijzigingen bevestigen', 'btn');
      applyButton.disabled = !summary.readyToApply || hasUnreviewedChanges()
        || Boolean(remotePending || busy);
      applyButton.addEventListener('click', () => {
        if (!window.confirm('Je gaat ' + (summary.apply || 0)
          + ' administratieve correcties uitvoeren. Dit zijn geen echte '
          + 'inleveringen. Er worden geen boeken of verrijkte gegevens verwijderd. '
          + 'Bevestigen?')) return;
        run(async () => {
          const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/apply', {
            revision: stage.revision, confirm: true,
          });
          rememberResponse(payload);
        }, 'Bevestigde administratieve correcties worden opgeslagen…');
      });
      const cancelButton = button('Controle annuleren', 'btn btn--ghost');
      cancelButton.disabled = Boolean(remotePending || busy);
      cancelButton.addEventListener('click', () => {
        if (!window.confirm('Deze administratiecontrole annuleren?')) return;
        run(async () => {
          const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/cancel', {
            revision: stage.revision,
          });
          rememberResponse(payload);
        }, 'De controle wordt geannuleerd…');
      });
      controls.append(reviewButton, applyButton, cancelButton);
      const differences = Array.isArray(plan.differences) ? plan.differences : [];
      const openChoices = differences.filter(diff =>
        (assignmentResolutions.get(diff.id)?.action || diff.choice || 'pending') === 'pending');
      if (openChoices.length) {
        const keepOpen = button('Behoud huidige gegevens bij alle ' + openChoices.length
          + ' openstaande punten', 'btn btn--secondary');
        keepOpen.disabled = Boolean(remotePending || busy);
        keepOpen.addEventListener('click', () => {
          if (!window.confirm('Voor ' + openChoices.length + ' onduidelijke punten '
            + 'blijven de huidige registraties ongewijzigd. '
            + (summary.automatic || 0) + ' duidelijke Excelwijzigingen blijven '
            + 'voorgesteld en worden pas bij de definitieve bevestiging opgeslagen. '
            + 'Wil je deze keuze maken?')) return;
          run(async () => {
            const choices = new Map(assignmentResolutions);
            for (const diff of openChoices) {
              choices.set(diff.id, { id: diff.id, action: 'keep' });
            }
            const payload = await request(rootPath + '/' + encodeURIComponent(stage.id) + '/review', {
              revision: stage.revision, acceptWarnings: true, corrections: [],
              assignmentResolutions: [...choices.values()],
            });
            rememberResponse(payload, true);
            setNotice('Openstaande punten behouden. Controleer het voorstel en bevestig daarna de wijzigingen.');
          }, 'De onzekere registraties blijven behouden en het voorstel wordt gecontroleerd…');
        });
        controls.append(keepOpen);
      }
      if (summary.pending || hasUnreviewedChanges()) controls.append(make('p', 'hint',
        'Alleen echte uitzonderingen vragen een keuze. Je kunt ze afzonderlijk '
        + 'controleren of in één keer de huidige registratie behouden. '
        + 'Uitgestelde keuzes worden beheertaken. '
        + 'Sla je keuzes eerst op via “Mijn keuzes controleren”.'));
      results.append(controls);
      const exceptions = differences.filter(diff => !diff.automatic);
      const proposals = differences.filter(diff => diff.automatic);
      function renderReviewGroup(group, kind) {
        const list = make('div', 'bb-review__rowlist');
        list.dataset.reviewList = kind;
        const currentPage = kind === 'automatic' ? automaticPage : page;
        const maxPage = Math.max(0, Math.ceil(group.length / PAGE_SIZE) - 1);
        const shownPage = Math.min(currentPage, maxPage);
        if (kind === 'automatic') automaticPage = shownPage;
        else page = shownPage;
        for (const diff of group.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE)) {
        const card = make('article', 'bb-review__row');
        card.dataset.reviewRowKey = 'difference:' + diff.id;
        card.append(make('strong', '',
          'Excelrij ' + diff.worksheetRow + ' · ' + (diff.title || 'Onbekend boek')));
        card.append(make('p', 'hint', [
          diff.author || '', diff.editionIsbn || '',
          diff.barcode || 'Geen individuele barcode',
        ].filter(Boolean).join(' · ')));
        if (diff.needsChoice === 'duplicate_excel_student_edition') {
          card.append(make('p', 'bb-review__reason',
            'Deze leerling krijgt in Excel meerdere exemplaren met hetzelfde ISBN. '
            + 'Kies welk exemplaar uitgeleend moet worden en behoud of controleer het andere.'));
        }
        if (diff.kind === 'issue') {
          const reasons = {
            ambiguous_physical_copy: 'Alle exemplaren met dit ISBN zijn al uitgeleend. Zonder bestaande match kan Boekenbaai niet veilig bepalen welke actieve uitlening gewijzigd moet worden.',
            ambiguous_existing_borrower: 'Meerdere exemplaren van deze ISBN-editie staan al bij dezelfde lener. Controleer de dubbele uitleenregistratie.',
            duplicate_physical_barcode: 'Dezelfde unieke exemplaarbarcode staat meerdere keren in het Excelbestand. Controleer of er werkelijk een extra exemplaar is.',
            physical_barcode_not_found: 'Deze individuele exemplaarbarcode ontbreekt in de bibliotheek, hoewel het ISBN al bekend is. Controleer de barcode.',
            conflicting_excel_borrowers: 'Excel vermeldt zowel een leerling als een klas als lener. Controleer welke registratie klopt.',
            multiple_class_contexts: 'Excel noemt meerdere of ongeldige klassen. Controleer de klasvermeldingen voordat je een vaste plek of uitlening kiest.',
            source_row_requires_review: 'Deze Excelrij bevat nog een conflict of onopgelost gegeven. Controleer de brongegevens bij de gewone boekimport.',
            physical_copy_not_found: 'Geen bestaand exemplaar gevonden met dit ISBN of deze exemplaarbarcode. Controleer de ISBN-gegevens; gebruik de gewone import als dit echt een nieuw boek is.',
            missing_valid_isbn: 'Het ISBN ontbreekt of is ongeldig.',
            title_author_mismatch: 'De titel of auteur verschilt van het opgeslagen boek.',
            edition_identity_mismatch: 'De barcode hoort bij een andere ISBN-editie.',
            duplicate_copy_rows: 'Meerdere Excelrijen verwijzen naar hetzelfde exemplaar.',
            copy_requires_single_excel_row: 'Deze Excelrij bevat meer dan één exemplaar.',
            borrower_not_uniquely_matched: 'De leerling of klas is niet eenduidig herkend.',
            fixed_location_needs_manual_identification: 'De vaste klaslocatie kan niet eenduidig worden herkend.',
            student_loan_records_disagree: 'Bestaande leerling- en uitleengegevens spreken elkaar tegen.',
          };
          card.append(make('p', 'bb-review__reason',
            reasons[diff.reason] || 'Handmatige controle vereist: ' + diff.reason));
        } else if (diff.kind === 'class_context') {
          card.append(make('p', 'bb-review__detail',
            'Excel vermeldt bij Klassen: ' + diff.className));
          const currentLoan = diff.beforeLoan?.type === 'none'
            ? 'Niet uitgeleend'
            : (diff.beforeLoan?.type === 'student' ? 'Leerling: ' : 'Klas: ')
              + (diff.beforeLoan?.name || 'Onbekend');
          card.append(make('p', 'bb-review__detail',
            'Huidige locatie: ' + (diff.beforeLocation || 'Niet geregistreerd')
            + ' · Huidige uitlening: ' + currentLoan));
          card.append(make('p', 'hint',
            'De kolom Klassen geeft niet aan of het boek vast in deze klas staat '
            + 'of tijdelijk door de klas wordt geleend. Kies de juiste betekenis. '
            + 'Er wordt niets aangepast voordat je de correctie bevestigt.'));
          if (!diff.classId) card.append(make('p', 'bb-review__reason',
            'Deze klas is niet eenduidig als klasaccount gevonden. Een vaste '
            + 'locatie kun je wel kiezen, maar een klasuitlening vereist eerst '
            + 'een herkenbaar klasaccount.'));
        } else {
          const label = diff.kind === 'loan' ? 'Uitlening' : 'Vaste locatie';
          const show = value => diff.kind === 'loan'
            ? (value.type === 'none' ? 'Geen uitlening geregistreerd'
              : (value.type === 'student' ? 'Leerling: ' : 'Klas: ') + value.name)
            : (value || 'Geen vaste locatie');
          card.append(make('p', 'bb-review__detail', 'Nu: ' + label + ' · ' + show(diff.before)));
          card.append(make('p', 'bb-review__detail', 'Excel: ' + label + ' · '
            + (diff.blankSource ? 'Geen gegevens ingevuld' : show(diff.after))));
          if (diff.description) card.append(make('p', 'hint', diff.description));
          if (diff.reason) card.append(make('p', 'bb-review__reason',
            'Niet veilig automatisch te corrigeren: ' + diff.reason));
        }
        const label = make('label', 'bb-review__field');
        label.append(make('span', '', 'Wat betekent dit verschil?'));
        const choice = make('select');
        const actions = [
          ...(!diff.automatic ? [['pending', 'Kies een beslissing']] : []),
          ['keep', 'Huidige gegevens behouden'],
          ['later', 'Later handmatig controleren'],
        ];
        if (diff.kind === 'class_context') {
          actions.splice(1, 0,
            ['class_fixed', 'Staat vast in ' + diff.className],
            ...(!diff.classId || diff.hasExplicitLoan ? [] :
              [['class_loan', 'Tijdelijk uitgeleend aan ' + diff.className]]),
            ['class_unrelated', 'Deze klasvermelding is niet van toepassing']);
        } else if (diff.kind !== 'issue' && !diff.reason) {
          actions.splice(0, 0, ['apply', diff.kind === 'loan'
            ? 'Uitlening uit Excel overnemen' + (diff.automatic ? ' (voorgesteld)' : '')
            : 'Vaste locatie uit Excel overnemen' + (diff.automatic ? ' (voorgesteld)' : '')]);
        }
        for (const [value, title] of actions) {
          const option = make('option', '', title);
          option.value = value;
          choice.append(option);
        }
        choice.value = assignmentResolutions.get(diff.id)?.action || diff.choice || 'pending';
        choice.addEventListener('change', () => {
          if (choice.value === 'pending') assignmentResolutions.delete(diff.id);
          else assignmentResolutions.set(diff.id, { id: diff.id, action: choice.value });
          render();
        });
        label.append(choice);
        card.append(label);
        list.append(card);
      }
        if (!group.length) list.append(make('p', 'hint',
          'Geen afzonderlijke controles nodig.'));
        const navigation = make('div', 'bb-review__pagination');
        if (group.length > PAGE_SIZE) {
          const prev = button('Vorige', 'btn btn--ghost');
          prev.disabled = shownPage === 0;
          prev.addEventListener('click', () => {
            if (kind === 'automatic') automaticPage--;
            else page--;
            render(true, kind);
          });
          const next = button('Volgende', 'btn btn--ghost');
          next.disabled = shownPage === maxPage;
          next.addEventListener('click', () => {
            if (kind === 'automatic') automaticPage++;
            else page++;
            render(true, kind);
          });
          navigation.append(prev, make('span', '',
            'Pagina ' + (shownPage + 1) + ' van ' + (maxPage + 1)), next);
        }
        return { list, navigation };
      }
      const exceptionsHeader = make('div', 'bb-review__section-heading');
      exceptionsHeader.append(make('h4', '',
        'Handmatig te beoordelen (' + exceptions.length + ')'));
      exceptionsHeader.append(make('p', 'hint',
        exceptions.length
          ? 'Alleen deze punten hebben geen betrouwbaar automatisch antwoord. '
            + 'Kies per punt of behoud de bestaande registratie in één keer.'
          : 'Geen handmatige controles nodig voor de bestaande registraties.'));
      results.append(exceptionsHeader);
      const manual = renderReviewGroup(exceptions, 'manual');
      results.append(manual.list);
      if (exceptions.length > PAGE_SIZE) results.append(manual.navigation);

      if (proposals.length) {
        const suggested = make('details', 'bb-review__suggested');
        suggested.open = automaticExpanded;
        suggested.addEventListener('toggle', () => {
          if (suggested.isConnected) automaticExpanded = suggested.open;
        });
        const loans = proposals.filter(diff => diff.kind === 'loan').length;
        const locations = proposals.filter(diff => diff.kind === 'location').length;
        suggested.append(make('summary', '',
          'Voorgestelde wijzigingen bekijken (' + proposals.length + ')'));
        suggested.append(make('p', 'hint',
          loans + ' uitleningen en ' + locations + ' vaste locaties. '
          + 'Deze voorstellen zijn al geselecteerd, maar worden pas na de '
          + 'definitieve bevestiging verwerkt. Je kunt een voorstel nog aanpassen.'));
        const automatic = renderReviewGroup(proposals, 'automatic');
        suggested.append(automatic.list);
        if (proposals.length > PAGE_SIZE) suggested.append(automatic.navigation);
        results.append(suggested);
      }
    }


    // Rebuilding a long review removes the focused row temporarily. Keep its
    // position in the viewport, rather than letting browser scroll anchoring
    // move the administrator to the top of the import panel.
    function render(resetListScroll = false, targetListKind = null) {
      const scrollY = Number(window.scrollY) || 0;
      // Import review may display both a scrollable exception list and a
      // separately scrollable list of proposals. Restore each independently.
      const originalLists = Array.from(results.querySelectorAll('.bb-review__rowlist'));
      const scrollPositions = new Map(originalLists.map(list =>
        [list.dataset.reviewList || '', list.scrollTop]));
      const focusedRow = document.activeElement?.closest?.('[data-review-row-key]');
      const focusedList = focusedRow?.closest?.('.bb-review__rowlist');
      const focusedListKind = focusedList?.dataset.reviewList || '';
      const rowKey = focusedRow?.dataset.reviewRowKey;
      const rowTop = focusedRow?.getBoundingClientRect().top;
      const rowTopInList = focusedRow && focusedList
        ? rowTop - focusedList.getBoundingClientRect().top : null;
      const focusedControlIndex = focusedRow
        ? Array.from(focusedRow.querySelectorAll('button, input, select, textarea'))
          .indexOf(document.activeElement) : -1;
      renderContents();
      const updatedLists = Array.from(results.querySelectorAll('.bb-review__rowlist'));
      const listFor = kind => updatedLists.find(list => (list.dataset.reviewList || '') === kind);
      for (const list of updatedLists) {
        const kind = list.dataset.reviewList || '';
        list.scrollTop = resetListScroll && (targetListKind === null || kind === targetListKind)
          ? 0 : (scrollPositions.get(kind) || 0);
      }
      if (resetListScroll) {
        const target = listFor(targetListKind || '');
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        return;
      }
      const replacement = rowKey && Array.from(results.querySelectorAll('[data-review-row-key]'))
        .find(row => row.dataset.reviewRowKey === rowKey);
      const list = listFor(focusedListKind);
      if (replacement && list && rowTopInList !== null && list.contains(replacement)) {
        const nextRelativeTop = replacement.getBoundingClientRect().top
          - list.getBoundingClientRect().top;
        list.scrollTop += nextRelativeTop - rowTopInList;
      }
      const newTop = replacement && Number.isFinite(rowTop)
        ? window.scrollY + replacement.getBoundingClientRect().top - rowTop : scrollY;
      window.scrollTo({ top: Math.max(0, newTop), behavior: 'instant' });
      if (replacement && focusedControlIndex >= 0) {
        replacement.querySelectorAll('button, input, select, textarea')[focusedControlIndex]
          ?.focus({ preventScroll: true });
      }
    }

    function renderContents() {
      const activeStep=!stage||['cancelled','failed'].includes(stage.status)
        ?0:stage.status==='completed'?2:1;
      for(let index=0;index<stepNodes.length;index++){
        stepNodes[index].classList.toggle('bb-import__step--active',index===activeStep);
        if(index===activeStep)stepNodes[index].setAttribute('aria-current','step');
        else stepNodes[index].removeAttribute('aria-current');
      }
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
        if (stage.mode === 'unified_sync') {
          const complete=make('section','bb-import__complete');
          complete.append(make('h4','','3. Import afgerond'));
          complete.append(make('p','hint',
            'Alleen de geselecteerde onderdelen zijn bijgewerkt. Niet-geselecteerde '
            +'kolommen, lege Excelvelden en bestaande overige boeken zijn behouden.'));
          const stats=make('div','bb-import__stat-grid');
          for(const [count,label] of [
            [done.created||0,'Nieuwe exemplaren'],
            [done.correctedLoans||0,'Uitleningen aangepast'],
            [done.correctedLocations||0,'Vaste locaties aangepast'],
            [done.metadataUpdated||0,'Boekvelden bijgewerkt'],
          ]){
            const stat=make('div','bb-import__stat');
            stat.append(make('strong','',String(count)),make('span','',label));
            stats.append(stat);
          }
          complete.append(stats);
          if(done.selectedParts){
            const selected=done.selectedParts;
            const labels=[];
            const untouched=[];
            for(const [key,label] of [['books','Nieuwe boeken'],['loans','Uitleningen'],
              ['locations','Vaste locaties']]){
              (selected[key]?labels:untouched).push(label);
            }
            const columnLabels={
              title:'Titels',author:'Auteurs',description:'Beschrijvingen',
              publisher:'Uitgevers',publishedYear:'Verschijningsjaren',
              pageCount:'Pagina-aantallen',language:'Taal',coverUrl:'Omslagen',
              easyReading:'Makkelijk lezen',suitableForExamList:'Examenleeslijst',
              tags:'Trefwoorden',manualThemes:'Thema’s',
            };
            for(const [field,label] of Object.entries(columnLabels)){
              (selected.fields?.[field]?labels:untouched).push(label);
            }
            const details=make('details','bb-import__selection-details');
            details.append(make('summary','','Wat is bij deze import meegenomen?'));
            details.append(make('p','bb-review__detail',
              'Geselecteerd: '+labels.join(', ')+'.'));
            details.append(make('p','hint',
              'Niet geselecteerd en ongewijzigd: '+untouched.join(', ')+'.'));
            complete.append(details);
          }
          if(done.deferred)complete.append(make('p','hint',
            done.deferred+' controletaken blijven voor later bewaard.'));
          complete.append(make('p','hint','Importnummer: '+(done.batchId||'onbekend')));
          if(done.report){
            const reportButton=button('Importverslag (JSON)','btn btn--secondary');
            reportButton.addEventListener('click',()=>{
              const blob=new Blob([JSON.stringify(done.report,null,2)],{type:'application/json'});
              const url=URL.createObjectURL(blob);
              const link=document.createElement('a');
              link.href=url;link.download='boekenbaai-import-'+done.batchId+'.json';link.click();
              setTimeout(()=>URL.revokeObjectURL(url),2000);
            });
            complete.append(reportButton);
          }
          results.append(complete);
          setNotice('De gezamenlijke import is afgerond.');
          return;
        }
        results.append(make('h4', '', stage.mode === 'assignment_reconcile'
          ? 'Administratieve correcties opgeslagen'
          : stage.mode === 'inventory_sync' ? 'Voorraadvergelijking voltooid' : 'Import voltooid'));
        results.append(make('p', '', (stage.mode === 'assignment_reconcile'
          ? (done.corrected || 0) + ' koppelingen gecorrigeerd, waarvan '
            + (done.correctedLoans || 0) + ' uitleningen en '
            + (done.correctedLocations || 0) + ' vaste locaties.'
          : done.created + ' fysieke exemplaren opgeslagen.'
            + (done.restoredLoans ? ' ' + done.restoredLoans + ' bestaande uitleningen overgenomen.' : ''))
          + ' Importverslag: ' + (done.batchId || 'onbekend')));
        if (done.report) {
          if (stage.mode === 'assignment_reconcile') {
            results.append(make('p', 'bb-review__detail',
              'Administratieve correcties opgeslagen zonder inlevering of wijziging van leesantwoorden.'));
            const postponed = Array.isArray(done.report.deferredDifferences)
              ? done.report.deferredDifferences : [];
            if (postponed.length) {
              const outstanding = make('section', 'bb-review__totals');
              outstanding.append(make('h4', '',
                postponed.length + ' controlepunt(en) toegevoegd aan Taken'));
              outstanding.append(make('p', 'hint',
                'De controlepunten blijven onder Taken → Boekimport controleren '
                + 'zichtbaar voor beheerders. Je kunt daar later een keuze maken '
                + 'zonder de Excel opnieuw te uploaden. Het importverslag kan ook '
                + 'als JSON worden gedownload.'));
              for (const item of postponed.slice(0, 25)) {
                outstanding.append(make('p', 'bb-review__detail',
                  'Excelrij ' + item.worksheetRow + ' · ' + item.title
                  + ' · ' + (item.barcode || item.editionIsbn || 'geen code')
                  + (item.reason ? ' · ' + item.reason : '')));
              }
              if (postponed.length > 25) outstanding.append(make('p', 'hint',
                'De overige ' + (postponed.length - 25)
                + ' verschillen staan in het volledige importverslag.'));
              results.append(outstanding);
            }
          } else if (done.report.fullyReviewed === false) {
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
      if(stage.mode==='unified_sync'){
        renderUnifiedSync();
        return;
      }
      if (stage.mode === 'assignment_reconcile') {
        renderAssignmentReconciliation();
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
        // Keep the current page and editor after checking corrected rows.
        rememberResponse(payload, true);
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
          void refreshEnrichmentStatus();
          void refreshBrave();
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
        card.dataset.reviewRowKey = 'book:' + row.index;
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
      prev.addEventListener('click', () => { page -= 1; render(true); });
      const next = button('Volgende', 'btn btn--ghost');
      next.disabled = page === maxPage;
      next.addEventListener('click', () => { page += 1; render(true); });
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
          const unified=importMode.value==='unified';
          const selection=selectedParts();
          if(unified&&!selection.books&&!selection.loans&&!selection.locations
            &&!Object.values(selection.fields).some(Boolean)){
            setNotice('Vink minimaal één onderdeel of boekkolom aan.');
            return;
          }
          payload = await request(rootPath, {
            file: encoded, fileName: selected.name,
            enrichIsbn: importMode.value !== 'reconcile' && metadata.checked
              &&(!unified||selection.books||Object.values(selection.fields).some(Boolean)),
            mode: unified?'unified_sync'
              : importMode.value==='reconcile'?'assignment_reconcile'
              : syncMode.checked?'inventory_sync':'create',
            ...(unified?{syncParts:selection}:{}),
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
    window.addEventListener('focus', refreshEnrichmentStatus);
    window.addEventListener('focus', refreshBrave);
    window.setInterval(refreshBrave, 10000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncStage();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
