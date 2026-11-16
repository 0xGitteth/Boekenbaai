// Staged import UI: all displayed workbook text uses textContent, never HTML.
(() => {
  'use strict';
  const rootPath = '/api/admin/book-import-stages';
  const importErrorText=window.BOEKENBAAI_IMPORT_DIAGNOSTICS||{};
  const statusNames = {
    ready: 'Klaar', warning: 'Waarschuwing', conflict: 'Conflict',
    unresolved: 'Nog niet opgelost', skipped: 'Overgeslagen',
  };
  const reasonNames = {
    ...importErrorText,
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
    ...importErrorText,
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
    metadata_author_conflict: 'Twee onafhankelijke ISBN-bronnen bevestigen een andere auteur',
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
      const details = typeof payload.error === 'string'
        ? ' ('+(importErrorText[payload.error]||'Foutcode '+payload.error)+')' : '';
      throw new Error((payload.message || 'Actie mislukt.') + details);
    }
    return payload;
  }
  function encodeFile(file,onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        resolve(raw.slice(raw.indexOf(',') + 1));
      };
      reader.onprogress = event => {
        if(event.lengthComputable&&typeof onProgress==='function')
          onProgress(event.loaded,event.total);
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
    for(const [index,label] of ['1. Instellen','2. Analyseren',
      '3. Controleren','4. Afronden'].entries()){
      const step=button(label,'bb-import__step');
      step.dataset.step=String(index);
      step.addEventListener('click',()=>{
        if(stage?.status!=='open'||stage.mode!=='unified_sync'
          ||index===0||index===3&&guidedStep===1)return;
        setGuidedStep(index);
      });
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
    // A huge workbook must not silently launch hundreds of blocking
    // third-party requests. Remember the administrator's previous opt-in so
    // future imports need no additional clicks once enabled.
    metadata.checked = false;
    try {
      metadata.checked=localStorage.getItem('boekenbaai_import_enrich_isbn')==='yes';
    }catch{}
    metadata.addEventListener('change',()=>{
      try {
        localStorage.setItem('boekenbaai_import_enrich_isbn',
          metadata.checked?'yes':'no');
      }catch{}
    });
    metadataLabel.append(metadata, document.createTextNode(
      ' ISBN-bronnen vergelijken en lege boekgegevens aanvullen (aanbevolen, kan langer duren).'));
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
      'Bestaande ingevulde gegevens wijzigen alleen bij aangevinkte Excelkolommen. '
      + 'Als ISBN-verrijking aanstaat, worden lege velden waar mogelijk '
      + 'automatisch uit passende online bronnen aangevuld.'));
    const columnGrid=make('div','bb-import__column-grid');
    for(const [key,label] of columns)columnGrid.append(checkPart(key,label));
    metadataDetails.append(columnGrid);
    parts.append(metadataDetails);
    const selectedText=make('p','bb-import__selection hint');
    const updateSelected=()=>{
      const n=[...partChecks.values()].filter(input=>input.checked).length;
      selectedText.textContent=n+' onderdelen geselecteerd · '
        +'Niet-geselecteerde Excelkolommen overschrijven niets. '
        +'Lege boekvelden kunnen via ISBN worden aangevuld.';
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
    // Do not invent progress for the server-side ISBN lookups. Report
    // exact bytes while reading and an indeterminate bar during analysis.
    const setupProgress=make('section','bb-import__setup-progress');
    setupProgress.hidden=true;
    setupProgress.setAttribute('aria-label','Voortgang Excelcontrole');
    const setupProgressLabel=make('p','bb-import__setup-progress-label');
    const setupProgressBar=make('progress','bb-import__setup-progress-meter');
    setupProgressBar.max=100;
    setupProgress.append(setupProgressLabel,setupProgressBar);
    root.append(setupProgress);
    const updateSetupProgress=(phase,loaded=0,total=0)=>{
      setupProgress.hidden=!phase;
      if(!phase)return;
      if(phase==='reading'&&total>0){
        const percent=Math.min(100,Math.round(loaded/total*100));
        setupProgressBar.value=percent;
        setupProgressLabel.textContent='Excelbestand lezen: '+percent
          +'% ('+loaded.toLocaleString('nl-NL')+' van '
          +total.toLocaleString('nl-NL')+' bytes)';
      }else{
        setupProgressBar.removeAttribute('value');
        setupProgressLabel.textContent='Boeken en ISBN-bronnen analyseren. '
          +'De server geeft nog geen voortgang per boek door; '
          +'daarom wordt geen onbetrouwbaar percentage getoond.';
      }
    };
    const liveAlert = make('div', 'bb-review__live-alert');
    liveAlert.setAttribute('role', 'status');
    liveAlert.setAttribute('aria-live', 'polite');
    root.append(liveAlert);
    const results = make('div', 'bb-review__results');
    root.append(results);
    const deferredPanel=make('details','bb-guide__details bb-guide__deferred');
    const deferredSummary=make('summary','','Uitgestelde boekcontroles laden…');
    const deferredList=make('div','bb-guide__deferred-list');
    deferredPanel.append(deferredSummary,deferredList);
    root.append(deferredPanel);
    async function refreshDeferred(){
      try{
        const data=await request(rootPath+'/deferred');
        const items=Array.isArray(data.items)?data.items:[];
        deferredSummary.textContent='Eerder uitgestelde boeken ('+items.length+')';
        deferredList.replaceChildren();
        if(!items.length){
          deferredList.append(make('p','hint',
            'Er zijn nog geen boeken uitgesteld.'));
          return;
        }
        deferredList.append(make('p','hint',
          'Deze boeken zijn niet geïmporteerd. De oorspronkelijke Excel blijft '
          +'nodig om ze later met een gecontroleerd ISBN toe te voegen.'));
        for(const item of items.slice(0,40)){
          const line=make('div','bb-guide__deferred-entry');
          line.append(make('strong','',item.title||'Onbekend boek'),
            make('span','',item.author||'Auteur onbekend'),
            make('small','',
              'Excelrij '+item.worksheetRow+' · Code '
              +(item.excelIdentifier||'ontbreekt')
              +' · Bestand '+(item.fileName||'onbekend')));
          deferredList.append(line);
        }
        if(items.length>40)deferredList.append(make('p','hint',
          'Getoond: 40 van '+items.length+' uitgestelde boeken.'));
      }catch{
        deferredSummary.textContent='Eerder uitgestelde boeken';
        deferredList.replaceChildren(make('p','hint',
          'Het overzicht kon niet worden geladen.'));
      }
    }
    imports.insertBefore(root, imports.firstChild);

    const oldSection = imports.querySelector('#book-import-form')?.closest('.admin-card__section');
    if (oldSection) {
      const details = make('details', 'bb-review__legacy');
      const summary = make('summary', '',
        'Technische directe import (zonder controles)');
      details.append(summary, oldSection);
      // Existing technical fallback remains available only at an explicit
      // diagnostic URL. The everyday teacher workflow has one import path.
      details.hidden=!new URLSearchParams(window.location.search)
        .has('legacyBookImport');
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
    let automaticReceiptLimit=20;
    let automaticReceiptOpen=false;
    let unifiedLimits={assignments:15,metadata:15,stock:15};
    let visibleMatchCards=5;
    let guidedStep=1; // 0 upload, 1 analysis overview, 2 review, 3 final
    let guidedIndex=0;
    function selectGuidedSourceRow(group,selectedIndex){
      if(!group)return null;
      const groupRows=[...group.rows.values()]
        .sort((a,b)=>a.sourceRowNumber-b.sourceRowNumber);
      return groupRows.find(row=>row.index===selectedIndex)
        ||groupRows.find(row=>Array.isArray(row.matchSuggestions)
          &&row.matchSuggestions.length)
        ||groupRows[0]||null;
    }
    // Remember the physical worksheet row, not only a changing queue index.
    // A review may remove or reorder cards while the import is being checked.
    let guidedRecheckFocus=null;
    function resolveGuidedReviewIndex(queue,focus,index){
      if(!queue.length)return 0;
      if(focus){
        const byRow=queue.findIndex(group=>group.rows.has(focus.rowIndex));
        if(byRow>=0)return byRow;
        // The previous book was resolved: stay at its old position so
        // the next outstanding book appears, rather than jumping to book 1.
        return Math.max(0,Math.min(focus.index,queue.length-1));
      }
      return Math.max(0,Math.min(index,queue.length-1));
    }
    let guidedAlternativeRow=null;
    const candidateChangeHistory=new Map();
    const guidedSelectedRow=new Map();
    let guidedShowDetails=false;
    let guidedAuditEditor=null;
    let guidedMissingAcknowledged=false;
    const wizardPositionKey='boekenbaai.import.wizard.position.v1';
    function storeGuidedPosition(){
      if(!stage?.id)return;
      try{localStorage.setItem(wizardPositionKey,
        JSON.stringify({id:stage.id,step:guidedStep,index:guidedIndex}));}catch{}
    }
    function setGuidedStep(next,index=guidedIndex){
      guidedStep=Math.max(1,Math.min(3,next));
      guidedIndex=Math.max(0,index);
      storeGuidedPosition();
      render();
    }
    const unifiedOpenGroups=new Set();
    let busy = false;
    let openEditor = null;
    const expandedMatchAlternatives=new Set();
    let warningsAccepted = false;
    let mustRecheckWarnings = false;
    let currentApplyButton = null;
    let remotePending = null;
    let syncing = false;
    let draftSaveTimer = null;
    let draftSaveInFlight = false;
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
    let draftSavePending=false;
    let draftChangeGeneration=0;
    function scheduleGuidedDraftSave(){
      if(stage?.mode!=='unified_sync'||stage.status!=='open'
        ||remotePending||busy)return;
      // Reverted choices must CLEAR an earlier server draft. A local "no
      // changes" check alone would leave /apply blocked by that hidden draft.
      if(!hasUnreviewedChanges()&&!stage.draft&&!draftSaveInFlight)return;
      draftChangeGeneration++;
      if(draftSaveTimer)clearTimeout(draftSaveTimer);
      if(draftSaveInFlight){
        draftSavePending=true;
        draftSaveTimer=null;
        return;
      }
      draftSaveTimer=setTimeout(()=>{
        draftSaveTimer=null;
        void flushGuidedDraft();
      },950);
    }
    async function flushGuidedDraft(){
      if(!stage||busy||remotePending||stage.status!=='open')return;
      if(draftSaveInFlight){draftSavePending=true;return;}
      const changes=hasUnreviewedChanges();
      if(!changes&&!stage.draft&&!draftSavePending)return;
      const currentStage=stage.id,revision=stage.revision;
      const generation=draftChangeGeneration;
      const snapshot={
        revision,acceptWarnings:warningsAccepted,
        corrections:[...corrections.values()],
        inventoryResolutions:[...inventoryResolutions.values()],
        assignmentResolutions:[...assignmentResolutions.values()],
        metadataResolutions:[...metadataResolutions.values()],
      };
      const data=changes?snapshot:{revision,clear:true};
      draftSavePending=false;
      draftSaveInFlight=true;
      let cleared=false;
      try{
        const result=await request(rootPath+'/'+encodeURIComponent(currentStage)
          +'/draft',data);
        if(stage?.id===currentStage&&stage.revision===revision){
          if(!result.persisted)
            setNotice('Concept opslaan mislukt. Controleer je keuzes '
              +'voordat je de pagina verlaat.');
          else {
            stage.draft=result.cleared?null:snapshot;
            stage.draftSavedAt=result.savedAt;
            cleared=result.cleared===true;
          }
        }
      }catch(error){
        if(stage?.id===currentStage&&stage.revision===revision)
          setNotice('Concept opslaan mislukt. Klik op controleren '
            +'voordat je de pagina verlaat.');
      }finally{
        draftSaveInFlight=false;
        if(draftSavePending||draftChangeGeneration!==generation){
          draftSavePending=false;
          scheduleGuidedDraftSave();
        }else if(cleared){
          // Rebuild the final action: confirmation is safe again once the
          // reverted draft has actually been removed on the server.
          render();
        }
      }
    }
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
      const previousRevision=stage?.revision;
      stage = payload;
      if(!sameStage||previousRevision!==stage.revision)
        guidedMissingAcknowledged=false;
      remotePending = null;
      liveAlert.replaceChildren();
      const savedDraft=stage.draft||{};
      warningsAccepted = savedDraft.acceptWarnings ?? (stage.acceptWarnings === true);
      mustRecheckWarnings = false;
      corrections = new Map((savedDraft.corrections||stage.corrections||[])
        .map(change=>[change.index,change]));
      inventoryResolutions = new Map((savedDraft.inventoryResolutions
        ||stage.inventoryResolutions||[]).map(item=>[item.isbn,item]));
      assignmentResolutions = new Map((savedDraft.assignmentResolutions
        ||stage.assignmentResolutions||[]).map(item=>[item.id,item]));
      metadataResolutions = new Map((savedDraft.metadataResolutions
        ||stage.metadataResolutions||[]).map(item=>[item.id,item]));
      skippedEdits.clear();
      // A fresh server reanalysis becomes the new correction baseline.
      candidateChangeHistory.clear();
      if (!preservePosition || !sameStage) {
        const previous=(()=>{try{return JSON.parse(
          localStorage.getItem(wizardPositionKey)||'null');}catch{return null;}})();
        guidedStep=previous?.id===payload.id
          ?Math.max(1,Math.min(3,Number(previous.step)||1)):1;
        guidedIndex=previous?.id===payload.id
          ?Math.max(0,Number(previous.index)||0):0;
        guidedAlternativeRow=null;
        guidedSelectedRow.clear();
        guidedShowDetails=false;
        guidedAuditEditor=null;
        page = 0;
        automaticPage = 0;
        automaticExpanded = false;
        visibleMatchCards = 5;
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
      scheduleGuidedDraftSave();
    }

    function selectCandidateForRow(row,candidate){
      if(!row||!candidate?.editionIsbn)return false;
      if(candidate.identityWarning
        &&!window.confirm('De gevonden titel of auteur wijkt af van Excel. '
          +'Controleer op het fysieke boek of het echt deze editie is. '
          +'Wil je deze titel, auteur en ISBN overnemen?'))return false;
      const fields=corrections.get(row.index)?.fields||{};
      const previous=candidateChangeHistory.get(row.index);
      const original=previous?.original||{
        title:fields.title===undefined?row.book?.title:fields.title,
        author:fields.author===undefined?row.book?.author:fields.author,
      };
      const nextApplied={};
      updateCorrection(row.index,'editionIsbn',candidate.editionIsbn);
      for(const field of ['title','author']){
        const current=(corrections.get(row.index)?.fields||{})[field];
        const changedByUser=previous?.lastApplied?.[field]!==undefined
          &&current!==previous.lastApplied[field];
        if(candidate.unverifiedTitle){
          // Search-only ISBN hints contain no verified title/author. Keep
          // any manual edit untouched; undo earlier candidate metadata only
          // when it has not been edited since that earlier candidate.
          if(previous?.lastApplied?.[field]!==undefined&&!changedByUser)
            updateCorrection(row.index,field,original[field]||row.book?.[field]||'');
        }else if(!changedByUser){
          const value=candidate[field]||row.book?.[field]||'';
          updateCorrection(row.index,field,value);
          nextApplied[field]=value;
        }
      }
      candidateChangeHistory.set(row.index,{original,lastApplied:nextApplied});
      return true;
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

    // Export the current *unconfirmed* analysis, not the entire school
    // database. No learner or staff IDs, names, PINs or loan history leave
    // the browser. This permits debugging without applying a risky import.
    function diagnosticSnapshot(){
      const plan=stage?.decisions||{};
      const stock=new Map((plan.inventory?.rows||[]).map(item=>[item.index,item]));
      const safeFields=new Set(['title','author','isbn','metadataIsbn',
        'editionIsbn','barcode','ambiguousIdentifier','quantity','pageCount',
        'publishedYear','publisher','language','coverUrl']);
      return {
        version:2,exportedAt:new Date().toISOString(),fileName:stage?.fileName||'',
        status:stage?.status,revision:stage?.revision,
        selectedParts:stage?.syncParts||null,summary:plan.summary||{},
        inventorySummary:plan.inventory?.summary||{},
        rows:(stage?.rows||[]).map(row=>{
          const decision=stock.get(row.index);
          return {
            worksheetRow:row.sourceRowNumber,
            title:row.book?.title||'',author:row.book?.author||'',
            editionIsbn:row.book?.editionIsbn||'',
            rawIsbn:row.identifierAnalysis?.explicit?.raw
              ||row.identifierAnalysis?.legacy?.raw
              ||row.identifierAnalysis?.ambiguous?.raw||'',
            status:row.status,
            issues:(row.issues||[]).map(issue=>({
              code:issue.code,severity:issue.severity,
              reviewLevel:issue.reviewLevel||null,field:issue.field||null,
              ...(safeFields.has(issue.field)?{
                raw:issue.raw??null,excelValue:issue.excelValue??null,
                metadataValue:issue.metadataValue??null,
              }:{}),
              suggestion:issue.suggestion?.canonical||null,
              repair:issue.repair?.canonical||null,
              confirmedTitle:issue.confirmedTitle||null,
              sources:issue.sources||[],
              editionIsbns:issue.editionIsbns||[],
            })),
            sourceEvidence:(row.sourceEvidence||[]).map(source=>({
              source:source.source,editionIsbn:source.editionIsbn,
              title:source.title,author:source.author,
            })),
            inventory:decision?{
              action:decision.action,reason:decision.reason||null,
              blockers:decision.blockers||[],
              existingCopies:decision.existingCopies,
              borrowedCopies:decision.borrowedCopies,
              targetCopies:decision.targetCopies,
              addCopies:decision.addCopies,
              existingIdentitySamples:decision.existingIdentitySamples||[],
              legacyIdentitySamples:decision.legacyIdentitySamples||[],
              legacyCandidateCopies:decision.legacyCandidateCopies||0,
            }:null,
          };
        }),
        metadataIssues:(plan.metadata?.issues||[]).map(item=>({
          isbn:item.isbn,field:item.field,reason:item.reason,
          worksheetRows:item.worksheetRows||[],
        })),
      };
    }

    function downloadCurrentDiagnosis(){
      const snapshot=diagnosticSnapshot();
      const file=new Blob([JSON.stringify(snapshot,null,2)],
        {type:'application/json'});
      const url=URL.createObjectURL(file);
      const link=document.createElement('a');
      link.href=url;link.download='boekenbaai-import-diagnose.json';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
    }


    // Four-step guided import. All choices use the existing, validated
    // correction/assignment/metadata endpoints. One book appears only once,
    // irrespective of how many distinct diagnostics refer to it.
    function renderGuidedUnifiedSync(){
      const plan=stage.decisions||{};
      const summary=plan.summary||{};
      const inventory=plan.inventory||{};
      const metadata=plan.metadata||{};
      const assignments=plan.assignments||{};
      const rows=stage.rows||[];
      const rowByNumber=new Map(rows.map(row=>[row.sourceRowNumber,row]));
      const rowByIndex=new Map(rows.map(row=>[row.index,row]));
      const blocked=(inventory.rows||[]).filter(item=>
        item.action==='blocked'&&item.combinedWith===undefined);
      const manualAssignments=(assignments.differences||[]).filter(item=>
        !item.automatic&&!item.previouslyImported);
      const manualMetadata=metadata.issues||[];
      const actionable=plan.actionableSourceIssues||[];
      const books=new Map();
      const groupFor=(isbn,row)=>{
        const key=isbn||('row:'+row?.index);
        if(!books.has(key))books.set(key,{
          key,isbn:isbn||'',rows:new Map(),stock:[],
          assignments:[],missingAssignments:[],metadata:[],warnings:[],
        });
        const group=books.get(key);
        if(row)group.rows.set(row.index,row);
        return group;
      };
      for(const entry of blocked){
        const row=rowByIndex.get(entry.index);
        const group=groupFor(entry.editionIsbn||'',row);
        group.stock.push(entry);
      }
      // Stock planner reports the ISBN group once; rows combined into
      // that group still require individual candidate selection when they
      // disagree. Include every source row in the ONE combined book card.
      for(const row of rows){
        const isbn=row.book?.editionIsbn;
        const group=isbn?books.get(isbn):null;
        if(group?.stock?.length&&row.status!=='skipped')
          group.rows.set(row.index,row);
      }
      for(const diff of manualAssignments){
        const row=rowByNumber.get(diff.worksheetRow);
        groupFor(diff.editionIsbn||row?.book?.editionIsbn||'',row)
          .assignments.push(diff);
      }
      // An absent physical edition cannot receive an imported loan or
      // location. This is not a pending assignment decision, but the
      // omission must still be visible before a teacher confirms.
      for(const missing of assignments.notInCollection||[]){
        const source=rowByNumber.get(missing.rows?.[0]);
        const group=groupFor(missing.editionIsbn
          ||source?.book?.editionIsbn||'',source);
        group.missingAssignments.push(missing);
        for(const number of missing.rows||[]){
          const row=rowByNumber.get(number);
          if(row)group.rows.set(row.index,row);
        }
      }
      for(const issue of manualMetadata){
        const row=rowByNumber.get(issue.worksheetRows?.[0]);
        const group=groupFor(issue.isbn||'',row);
        group.metadata.push(issue);
        for(const number of issue.worksheetRows||[]){
          const source=rowByNumber.get(number);
          if(source)group.rows.set(source.index,source);
        }
      }
      for(const item of actionable){
        const row=rowByIndex.get(item.index);
        if(!row)continue;
        // Informative source messages do not create new review cards.
        const exceptions=(item.issues||[]).filter(issue=>
          issue.severity==='conflict'
          ||issue.reviewLevel!=='informational'
            &&issue.severity==='warning');
        if(!exceptions.length)continue;
        const group=groupFor(row.book?.editionIsbn||'',row);
        group.warnings.push(...exceptions);
      }
      const priority=group=>group.stock.length?0
        :group.missingAssignments.length?1
          :group.assignments.length?2:group.metadata.length?3:4;
      const queue=[...books.values()].sort((a,b)=>priority(a)-priority(b)
        ||Math.min(...[...a.rows.values()].map(row=>row.sourceRowNumber))
          -Math.min(...[...b.rows.values()].map(row=>row.sourceRowNumber)));
      if(guidedRecheckFocus){
        guidedIndex=resolveGuidedReviewIndex(queue,guidedRecheckFocus,guidedIndex);
        guidedRecheckFocus=null;
        storeGuidedPosition();
      }
      const safeText=value=>value===undefined||value===null||value===''
        ?'Niet ingevuld':String(value);
      const valueText=value=>value&&typeof value==='object'
        ?String(value.name||value.value||JSON.stringify(value)):safeText(value);
      const countSkipped=rows.filter(row=>
        corrections.get(row.index)?.skip).length;
      const hasChanges=hasUnreviewedChanges()||Boolean(stage.draft)
        ||draftSaveInFlight||draftSavePending||Boolean(draftSaveTimer);
      const panel=make('section','bb-guide');
      const top=make('header','bb-guide__top');
      top.append(make('h4','',guidedStep===1?'Analyse afgerond'
        :guidedStep===2?'Boeken controleren':'Import afronden'));
      panel.append(top);
      if(stage.draftPersisted){
        const saved=make('p','bb-guide__saved hint',
          'Concept veilig opgeslagen · maximaal 24 uur beschikbaar');
        panel.append(saved);
      }
      if(guidedStep!==1){
        panel.append(make('p','bb-guide__intro',
          guidedStep===2
            ?'Controleer de voorgestelde gegevens op het fysieke boek en kies per verschil.'
            :'Controleer het overzicht. Er wordt pas iets opgeslagen na je bevestiging.'));
      }
      const stats=make('div','bb-guide__stats');
      for(const [number,label] of [
        [queue.length,'Boeken met aandacht'],
        [summary.newCopies||0,'Nieuwe exemplaren'],
        [summary.proposedLoans||0,'Uitleningen'],
        [summary.metadataFields||0,'Boekvelden'],
      ]){
        const stat=make('div','bb-guide__stat');
        stat.append(make('strong','',String(number)),
          make('span','',label));
        stats.append(stat);
      }
      if(guidedStep===1)panel.append(stats);
      const footer=make('nav','bb-guide__footer');
      footer.setAttribute('aria-label','Navigatie importassistent');
      const addAction=(host,label,handler,primary=false)=>{
        const action=button(label,primary?'btn':'btn btn--secondary');
        action.disabled=Boolean(remotePending||busy);
        action.addEventListener('click',handler);
        host.append(action);
        return action;
      };
      const makeDetail=(label,content)=>{
        const detail=make('details','bb-guide__details');
        detail.append(make('summary','',label),content);
        return detail;
      };
      const recheck=async()=>{
        if(draftSaveTimer){clearTimeout(draftSaveTimer);draftSaveTimer=null;}
        // Capture the card BEFORE the server rebuilds its queue. An ISBN
        // correction may change the group key, so the row index is stable.
        const reviewingBook=guidedStep===2?queue[guidedIndex]:null;
        const currentSource=selectGuidedSourceRow(reviewingBook,
          reviewingBook?guidedSelectedRow.get(reviewingBook.key):null);
        const focus=currentSource
          ?{rowIndex:currentSource.index,index:guidedIndex}:null;
        await run(async()=>{
          const response=await request(rootPath+'/'+encodeURIComponent(stage.id)+'/review',{
            revision:stage.revision,acceptWarnings:warningsAccepted,
            corrections:[...corrections.values()],
            inventoryResolutions:[...inventoryResolutions.values()],
            assignmentResolutions:[...assignmentResolutions.values()],
            metadataResolutions:[...metadataResolutions.values()],
          });
          // Apply the focus only after a successful server review. Failed
          // requests leave the existing stage, draft, and place untouched.
          guidedRecheckFocus=focus;
          rememberResponse(response,true);
          const current=response.decisions?.summary||{};
          if(current.readyToApply){
            guidedStep=3;
            guidedRecheckFocus=null;
          }else{
            guidedStep=2;
          }
          storeGuidedPosition();
          setNotice(current.readyToApply
            ?'Alle controles zijn afgerond. Bekijk de eindcontrole.'
            :'De keuzes zijn opgeslagen en opnieuw gecontroleerd. '
              +'Je kunt verdergaan bij het boek waar je gebleven was.');
        },'De keuzes worden opgeslagen en veilig opnieuw berekend…');
      };
      const explain=(host,code)=>{
        const text=reasonNames[code]||importErrorText[code]
          ||issueNames[code]||String(code||'Controle nodig');
        host.append(make('p','bb-guide__reason',text));
      };
      const makeLabeled=(label,value)=>{
        const part=make('div','bb-guide__value');
        part.append(make('span','bb-guide__eyebrow',label),
          make('strong','',valueText(value)));
        return part;
      };
      const finish=()=>{
        if(summary.missingStockGroups&&!guidedMissingAcknowledged){
          setNotice('Bekijk eerst welke boeken niet zijn meegenomen.');
          return;
        }
        if(!summary.readyToApply||hasUnreviewedChanges()){
          setNotice('Controleer eerst de openstaande keuzes opnieuw.');
          return;
        }
        const desc=(summary.newCopies||0)+' nieuwe exemplaren, '
          +(summary.proposedLoans||0)+' uitleningen, '
          +(summary.proposedLocations||0)+' vaste locaties en '
          +(summary.metadataFields||0)+' boekvelden.';
        if(!window.confirm('De definitieve import verwerkt '+desc
          +' Overgeslagen Excelrijen worden niet geïmporteerd. Doorgaan?'))return;
        run(async()=>{
          const response=await request(rootPath+'/'+encodeURIComponent(stage.id)+'/apply',{
            revision:stage.revision,confirm:true,
          });
          rememberResponse(response);
          void refreshEnrichmentStatus();void refreshBrave();
          void refreshDeferred();
        },'De definitieve wijzigingen worden opgeslagen…');
      };

      if(guidedStep===1){
        const auto=(metadata.automaticDecisions||[]).length
          +(assignments.differences||[]).filter(item=>item.automatic).length;
        const autoNote=make('p','bb-guide__auto-note',
          auto+' besluiten automatisch beoordeeld. '
          +'Bestaande exemplaren en uitleningen blijven beschermd.');
        panel.append(autoNote);
        if(summary.missingStockGroups){
          const omitted=make('div','bb-guide__attention');
          omitted.append(make('strong','',
            (summary.missingStockGroups||0)
            +' boeken ontbreken in de collectie voor uitleen- of locatiegegevens'));
          omitted.append(make('p','',
            'Deze registraties zijn niet opgenomen in de voorgestelde '
            +'wijzigingen. Je ziet ze bij het controleren en in het '
            +'eindoverzicht.'));
          panel.append(omitted);
        }
        if(queue.length){
          panel.append(make('p','bb-guide__compact-note',
            (summary.pending||0)+' open controlepunten, samengevoegd per boek. '
            +'Je krijgt alleen vragen die Boekenbaai niet veilig zelf kan afhandelen.'));
        }else panel.append(make('p','bb-guide__success',
          'Er zijn geen verplichte boekcontroles.'));
        addAction(footer,'Diagnoseverslag downloaden',downloadCurrentDiagnosis);
        addAction(footer,queue.length?'Begin met controleren':'Bekijk eindcontrole',
          ()=>setGuidedStep(queue.length?2:3,0),true);
      }else if(guidedStep===2){
        if(!queue.length){
          panel.append(make('p','bb-guide__success',
            'Er zijn geen openstaande controles.'));
          addAction(footer,'Naar eindcontrole',()=>setGuidedStep(3,0),true);
        }else{
          guidedIndex=resolveGuidedReviewIndex(queue,null,guidedIndex);
          const group=queue[guidedIndex];
          const groupRows=[...group.rows.values()]
            .sort((a,b)=>a.sourceRowNumber-b.sourceRowNumber);
          const source=selectGuidedSourceRow(group,
            guidedSelectedRow.get(group.key));
          const book=source?.book||{};
          const progressBar=make('div','bb-guide__meter');
          progressBar.setAttribute('role','progressbar');
          progressBar.setAttribute('aria-valuemin','0');
          progressBar.setAttribute('aria-valuemax',String(queue.length));
          progressBar.setAttribute('aria-valuenow',String(guidedIndex+1));
          const progressFill=make('div','bb-guide__meter-fill');
          progressFill.style.width=((guidedIndex+1)/queue.length*100)+'%';
          progressBar.append(progressFill);panel.append(progressBar);
          panel.append(make('p','bb-guide__counter',
            'Boek '+(guidedIndex+1)+' van '+queue.length
            +' · Excelrij '+safeText(source?.sourceRowNumber)));
          const card=make('article','bb-guide__book');
          card.dataset.reviewRowKey='wizard:'+group.key;
          const bookhead=make('div','bb-guide__bookhead');
          const cover=make('div','bb-guide__cover');
          const candidate=source?.matchSuggestions?.[0];
          const coverUrl=book.coverUrl||candidate?.coverUrl||'';
          if(typeof coverUrl==='string'
            &&/^https:\/\/[^\s"'<>]+$/i.test(coverUrl)){
            const img=make('img');img.src=coverUrl;
            img.alt='Omslag van '+safeText(book.title);
            img.referrerPolicy='no-referrer';img.loading='lazy';
            img.addEventListener('error',()=>{
              img.remove();
              cover.append(make('span','hint','Omslag niet beschikbaar'));
            },{once:true});
            cover.append(img);
          }else cover.append(make('span','','B'));
          const identity=make('div','bb-guide__bookinfo');
          identity.append(make('span','bb-guide__eyebrow','TE CONTROLEREN'),
            make('h5','',safeText(book.title)),
            make('p','',safeText(book.author)),
            make('span','bb-guide__isbn',
              book.editionIsbn?'ISBN '+book.editionIsbn:
                'ISBN ontbreekt of is ongeldig'));
          bookhead.append(cover,identity);card.append(bookhead);
          // Material ISBN disagreements are shown next to the book, not
          // buried in a long list of technical source warnings.
          const visibleIdentityChecks=new Set();
          for(const relatedRow of groupRows){
            for(const issue of relatedRow.issues||[]){
              if(!['metadata_author_conflict','metadata_title_conflict']
                .includes(issue.code))continue;
              const field=issue.code==='metadata_author_conflict'
                ?'auteur':'titel';
              const confirmed=issue.confirmedAuthor||issue.confirmedTitle||'';
              const key=field+':'+confirmed;
              if(visibleIdentityChecks.has(key))continue;
              visibleIdentityChecks.add(key);
              const alert=make('div','bb-guide__identity-conflict');
              alert.append(make('strong','',
                'Controleer de '+field+' bij dit ISBN'));
              alert.append(make('p','',
                'In Excel: '+safeText(field==='auteur'
                  ?relatedRow.book?.author:relatedRow.book?.title)));
              if(confirmed)
                alert.append(make('p','',
                  'Onafhankelijke ISBN-bronnen: '+confirmed));
              if(issue.sources?.length)
                alert.append(make('small','',
                  'Bronnen: '+issue.sources.join(', ')));
              alert.append(make('p','',
                'Controleer welke titel of auteur op het fysieke boek staat. '
                +'De keuze geldt voor de bijbehorende boekgegevens; '
                +'bestaande exemplaren en uitleningen worden niet gewijzigd.'));
              // A verified title conflict must offer the actual suggested
              // title. A generic stock approval is not a title correction.
              if(field==='titel'&&confirmed&&relatedRow.index!==undefined){
                const actions=make('div','bb-guide__actions');
                addAction(actions,'Mijn boek heet: '+confirmed,()=>{
                  updateCorrection(relatedRow.index,'title',confirmed);
                  void recheck();
                },true);
                addAction(actions,'Mijn boek heeft de Excel-titel',()=>{
                  updateCorrection(relatedRow.index,'title',
                    relatedRow.book?.title||'');
                  void recheck();
                });
                alert.append(actions);
              }
              card.append(alert);
            }
          }

          if(group.stock.length){
            const check=make('section','bb-guide__check');
            check.append(make('h5','','1. Boek en voorraad'));
            const first=group.stock[0];
            explain(check,first.reason);
            if(groupRows.length>1){
              const rowChoices=make('div','bb-guide__row-choices');
              rowChoices.append(make('span','bb-guide__eyebrow',
                'Excelrijen bij dit ISBN: kies welke je controleert'));
              const buttons=make('div','bb-guide__actions');
              for(const row of groupRows){
                const change=button('Rij '+row.sourceRowNumber
                  +' · '+safeText(row.book?.title).slice(0,55),
                  'btn btn--secondary');
                change.setAttribute('aria-pressed',String(source?.index===row.index));
                change.addEventListener('click',()=>{
                  guidedSelectedRow.set(group.key,row.index);
                  openEditor=null;render();
                });
                buttons.append(change);
              }
              rowChoices.append(buttons);check.append(rowChoices);
            }
            // A record without an ISBN may be a possible match, but it
            // is not a selectable edition. Do not display it as another
            // edition in the comparison.
            const allSuggestions=source?.matchSuggestions||[];
            const suggestedRepair=source?.issues?.find(issue=>
              issue.code==='isbn_repair_suggested'
              &&issue.suggestion?.canonical)?.suggestion?.canonical;
            if(suggestedRepair&&!source.book?.editionIsbn){
              const proposal=make('div','bb-guide__identity-conflict');
              proposal.append(make('strong','',
                'Dit ISBN uit Excel is ongeldig. Mogelijke correctie: '
                +suggestedRepair));
              proposal.append(make('p','',
                'Dit nummer is een voorstel op basis van het ingevoerde nummer, '
                +'geen bevestigde editie. Vergelijk het eerst met het ISBN '
                +'op het fysieke boek.'));
              const apply=addAction(proposal,'ISBN op mijn boek is '
                +suggestedRepair,()=>{
                  updateCorrection(source.index,'editionIsbn',suggestedRepair);
                  void recheck();
                });
              apply.classList.add('bb-guide__correct-isbn');
              check.append(proposal);
            }
            const suggestions=allSuggestions.filter(option=>
              typeof option.editionIsbn==='string'
              &&/^97[89][0-9]{10}$/.test(option.editionIsbn));
            if(suggestions.length){
              const compare=make('div','bb-guide__compare');
              const raw=source.identifierAnalysis?.explicit?.raw
                ||source.identifierAnalysis?.legacy?.raw
                ||source.identifierAnalysis?.ambiguous?.raw
                ||source.book?.editionIsbn||'';
              compare.append(makeLabeled('In Excel',
                (book.title||'')+' · '+(raw||'Geen geldig ISBN')));
              const proposed=suggestions[0];
              compare.append(makeLabeled(proposed.origin==='existing'
                ?'Gevonden in Boekenbaai':'Online gevonden',
                proposed.title+' · Auteur: '+safeText(proposed.author)
                  +' · ISBN '+(proposed.editionIsbn||'ontbreekt')));
              check.append(compare);
              if(proposed.sources?.length)
                check.append(make('p','bb-guide__candidate-sources',
                  'Gevonden via '+proposed.sources.join(' en ')));
              if(proposed.identityWarning)
                check.append(make('p','bb-guide__attention',
                  'Let op: deze kandidaat heeft een afwijkende titel of '
                  +'auteur. Controleer beide op het fysieke boek voordat '
                  +'je deze editie kiest.'));
              if(proposed.unverifiedTitle)
                check.append(make('p','bb-guide__reason',
                  'Bij deze online kandidaat is de titel nog niet '
                  +'onafhankelijk per ISBN bevestigd.'));
              const notice=make('p','hint',
                'Controleer of de voorgestelde editie daadwerkelijk overeenkomt '
                +'met het boek dat op school staat.');
              check.append(notice);
              const choose=(candidate)=>{
                if(!candidate.editionIsbn)return;
                if(selectCandidateForRow(source,candidate))void recheck();
              };
              const alternatives=suggestions.slice(1).filter(option=>
                option.editionIsbn!==proposed.editionIsbn);
              const editionCard=(option,selected=false)=>{
                const alt=make('article','bb-guide__alternative');
                const cover=make('div','bb-guide__edition-cover');
                if(option.coverUrl&&/^https:\/\/[^\s"'<>]+$/i.test(option.coverUrl)){
                  const img=make('img');
                  img.src=option.coverUrl;
                  img.alt='Omslag van ISBN '+option.editionIsbn;
                  img.loading='lazy';img.referrerPolicy='no-referrer';
                  img.addEventListener('error',()=>{
                    img.remove();
                    cover.append(make('span','hint',
                      'Geen betrouwbare omslag beschikbaar'));
                  },{once:true});
                  cover.append(img);
                }else cover.append(make('span','hint','Geen betrouwbare omslag'));
                alt.append(cover,make('strong','',safeText(option.title)));
                for(const [label,value] of [
                  ['Auteur',option.author],['ISBN',option.editionIsbn],
                  ['Uitgever',option.publisher],['Jaar',option.publishedYear],
                  ['Uitvoering',option.format],['Pagina’s',option.pageCount]]){
                  if(!value)continue;
                  const line=make('p','bb-guide__edition-fact');
                  line.append(make('strong','',label+': '),
                    make('span','',String(value)));alt.append(line);
                }
                if(option.sources?.length)
                  alt.append(make('small','hint',
                    'Bronnen: '+option.sources.join(', ')));
                if(option.unverifiedTitle)
                  alt.append(make('p','bb-guide__attention',
                    'De titel is niet onafhankelijk voor dit ISBN bevestigd.'));
                if(option.editionIsbn)
                  addAction(alt,selected?'Ja, dit is mijn boek'
                    :'Deze editie kiezen',()=>choose(option),selected);
                return alt;
              };
              if(alternatives.length){
                check.append(make('h5','','Vergelijk de edities'));
                {
                  const list=make('div','bb-guide__alternatives bb-guide__edition-grid');
                  list.append(editionCard(proposed,true));
                  for(const option of alternatives)list.append(editionCard(option));
                  check.append(list);
                }
              }else{
                addAction(check,'Dit is het juiste boek',()=>choose(proposed),true);
                const facts=[['Uitgever',proposed.publisher],
                  ['Jaar',proposed.publishedYear],
                  ['Uitvoering',proposed.format],
                  ['Pagina’s',proposed.pageCount]].filter(([,value])=>value);
                if(facts.length)check.append(make('p','hint',
                  facts.map(([name,value])=>name+': '+value).join(' · ')));
              }
            }else if(allSuggestions.length){
              check.append(make('p','bb-guide__attention',
                'Er is een mogelijke bestaande match zonder geldig ISBN. '
                +'Deze kan niet veilig als editie worden gekozen. '
                +'Controleer het ISBN op het fysieke boek of corrigeer '
                +'de bestaande registratie voordat je deze importeert.'));
            }
            for(const entry of group.stock){
              if(entry.existingCopies||entry.targetCopies)
                check.append(make('p','bb-guide__count-note',
                  'Bestaand: '+(entry.existingCopies||0)
                  +' · Volgens Excel: '+(entry.targetCopies||0)
                  +' · Uitgeleend: '+(entry.borrowedCopies||0)));
              for(const existing of (entry.existingIdentitySamples||[])
                .concat(entry.legacyIdentitySamples||[]).slice(0,3))
                check.append(make('p','hint','Bestaand boek: '
                  +existing.title+' · '+existing.author));
            }
            const actions=make('div','bb-guide__actions');
            addAction(actions,openEditor===source?.index
              ?'Correctie sluiten':'Zelf corrigeren',()=>{
                openEditor=openEditor===source?.index?null:source?.index;
                render();
              });
            const skipped=group.rows.size>0&&[...group.rows.keys()].every(index=>
              corrections.get(index)?.skip);
            addAction(actions,skipped?'Overslaan ongedaan maken'
              :'Dit boek later controleren',()=>{
                const next=!skipped;
                if(next&&!window.confirm('Dit boek wordt voorlopig NIET '
                  +'geïmporteerd. Bestaande boeken en uitleningen blijven '
                  +'ongewijzigd. Het blijft wel in je Excel staan. Doorgaan?'))return;
                for(const index of group.rows.keys())
                  toggleSkippedRow(corrections,skippedEdits,index,next);
                warningsAccepted=false;
                if(currentApplyButton)currentApplyButton.disabled=true;
                render();
              });
            check.append(actions);
            if(openEditor===source?.index&&source)
              editRow(source,check,{onlyFields:[
                'title','author','editionIsbn','barcode','quantity',
              ]});
            if(skipped)check.append(make('p','bb-guide__selected',
              'Dit boek wordt bij deze import overgeslagen. '
              +'De oorspronkelijke Excelgegevens blijven beschikbaar.'));
            card.append(check);
          }

          if(group.missingAssignments.length){
            const missingSection=make('section','bb-guide__check');
            missingSection.append(make('h5','',
              'Niet overgenomen: uitlening of vaste locatie'));
            missingSection.append(make('p','bb-guide__attention',
              'Boekenbaai kan deze registratie niet uitvoeren omdat '
              +'het bijbehorende fysieke boek nog niet in de '
              +'geselecteerde collectie voorkomt. Er wordt niets '
              +'uitgeleend of verplaatst. Voeg het juiste boek eerst '
              +'toe en synchroniseer de administratie daarna opnieuw.'));
            for(const missing of group.missingAssignments)
              missingSection.append(make('p','bb-guide__count-note',
                safeText(missing.title)+' · ISBN '
                +safeText(missing.editionIsbn)
                +' · '+(missing.copies||0)+' exemplaar/exemplaren'
                +' · Excelrij(en) '+(missing.rows||[]).join(', ')));
            card.append(missingSection);
          }
          if(group.assignments.length){
            const section=make('section','bb-guide__check');
            section.append(make('h5','','2. Uitleningen en vaste locaties'));
            for(const diff of group.assignments){
              const entry=make('div','bb-guide__choice');
              entry.append(make('strong','',diff.kind==='loan'?'Uitlening'
                :diff.kind==='location'?'Vaste locatie'
                :diff.kind==='class_context'?'Klasvermelding'
                :'Administratieve koppeling'));
              if(diff.reason)explain(entry,diff.reason);
              const compare=make('div','bb-guide__compare');
              const before=diff.kind==='loan'
                ?diff.before?.name||'Niet uitgeleend'
                :diff.before||'Geen vaste locatie';
              const after=diff.kind==='loan'
                ?diff.after?.name||'Geen nieuwe uitlening'
                :diff.kind==='class_context'?'Klas '+safeText(diff.className)
                  :diff.after||'Geen vaste locatie';
              compare.append(makeLabeled('Boekenbaai',before),
                makeLabeled('Excel',after));
              entry.append(compare);
              const options=make('div','bb-guide__actions');
              const selected=assignmentResolutions.get(diff.id)?.action
                ||diff.choice||'pending';
              const action=(label,value,primary=false)=>{
                const control=addAction(options,
                  selected===value?'✓ '+label:label,()=>{
                    if(value==='pending')assignmentResolutions.delete(diff.id);
                    else assignmentResolutions.set(diff.id,{
                      id:diff.id,action:value});
                    render();
                  },primary);
                control.setAttribute('aria-pressed',String(selected===value));
              };
              if(diff.kind==='class_context'){
                action('Vaste plek in klas','class_fixed');
                if(diff.classId&&!diff.hasExplicitLoan)
                  action('Uitgeleend aan klas','class_loan');
                action('Niet van toepassing','keep');
              }else if(diff.kind!=='issue'&&!diff.reason){
                action('Excel overnemen','apply',true);
                action('Bestaande behouden','keep');
              }else action('Bestaande behouden','keep');
              action('Later controleren','later');
              entry.append(options);section.append(entry);
            }
            card.append(section);
          }
          if(group.metadata.length){
            const section=make('section','bb-guide__check');
            section.append(make('h5','','3. Boekgegevens'));
            for(const issue of group.metadata){
              const label=fieldDefs.find(([name])=>name===issue.field)?.[1]
                ||issue.field;
              const entry=make('div','bb-guide__choice');
              entry.append(make('strong','',label));
              if(issue.reason==='source_row_requires_review')
                entry.append(make('p','bb-guide__reason',
                  'Dit boek heeft nog een niet-opgelost verschil in '+label
                  +'. Als je hierboven de juiste titel of auteur kiest, '
                  +'wordt dit punt opnieuw beoordeeld.'));
              else explain(entry,issue.reason);
              const compare=make('div','bb-guide__compare');
              compare.append(makeLabeled('Excel',source
                ?fieldValue(source,issue.field==='manualThemes'?'themes'
                  :issue.field==='suitableForExamList'?'examMaterial'
                    :issue.field):''),
                makeLabeled('Huidige gegevens',
                  'Bestaande waarde veilig behouden'));
              entry.append(compare);
              const options=make('div','bb-guide__actions');
              const keep=metadataResolutions.get(issue.id)?.action==='keep';
              const retain=addAction(options,keep?'✓ Huidige waarde behouden'
                :'Huidige waarde behouden',()=>{
                  metadataResolutions.set(issue.id,{
                    id:issue.id,action:'keep'});render();
                });
              retain.setAttribute('aria-pressed',String(keep));
              entry.append(options);
              const editField=issue.field==='manualThemes'?'themes'
                :issue.field==='suitableForExamList'?'examMaterial'
                :issue.field;
              const editors=make('div','bb-guide__row-choices');
              const affected=issue.worksheetRows||[];
              for(const worksheetRow of affected){
                const sourceRow=rowByNumber.get(worksheetRow);
                if(!sourceRow)continue;
                const edit=button('Excelrij '+worksheetRow
                  +(openEditor===sourceRow.index?' sluiten':' corrigeren'),
                  'btn btn--secondary');
                edit.disabled=Boolean(remotePending||busy);
                edit.addEventListener('click',()=>{
                  openEditor=openEditor===sourceRow.index?null:sourceRow.index;
                  render();
                });
                editors.append(edit);
                if(openEditor===sourceRow.index)
                  editRow(sourceRow,editors,{
                    onlyFields:[editField],metadataIssueId:issue.id,
                  });
              }
              entry.append(editors);
              section.append(entry);
            }
            card.append(section);
          }
          if(group.warnings.length){
            const detailContent=make('div','bb-guide__warnings');
            for(const issue of group.warnings)
              explain(detailContent,issue.code);
            card.append(makeDetail(group.warnings.length
              +' bronmelding(en) bij dit boek',detailContent));
            if(group.warnings.some(issue=>issue.severity==='warning')){
              const consent=make('label','bb-guide__accept');
              const checkbox=make('input');checkbox.type='checkbox';
              checkbox.checked=warningsAccepted;
              checkbox.addEventListener('change',()=>{
                warningsAccepted=checkbox.checked;render();
              });
              consent.append(checkbox,make('span','',
                'Ik heb de bronwaarschuwingen gelezen.'));
              card.append(consent);
            }
          }
          if([...group.rows.keys()].some(index=>
            corrections.has(index))
            ||group.assignments.some(diff=>
              assignmentResolutions.has(diff.id))
            ||group.metadata.some(issue=>
              metadataResolutions.has(issue.id)))
            card.append(make('p','bb-guide__selected',
              'Je keuze is klaar voor hercontrole. Er is nog niets '
              +'definitief gewijzigd.'));
          panel.append(card);
          const nav=make('div','bb-guide__navigation');
          const previous=addAction(nav,'Vorig boek',()=>{
            setGuidedStep(2,guidedIndex-1);
          });
          previous.disabled=guidedIndex===0||Boolean(remotePending||busy);
          if(guidedIndex+1<queue.length)
            addAction(nav,'Volgend boek',()=>{
              setGuidedStep(2,guidedIndex+1);
            },true);
          else addAction(nav,'Keuzes opslaan en opnieuw controleren',
            recheck,true);
          panel.append(nav);
          addAction(footer,'Keuzes nu controleren',recheck);
          addAction(footer,'Naar eindoverzicht',()=>setGuidedStep(3));
        }
      }else{
        const pending=summary.pending||0;
        const note=make('div','bb-guide__summary-card');
        note.append(make('strong','',pending
          ?pending+' onopgeloste punten':'De gecontroleerde import staat klaar'));
        note.append(make('p','',pending
          ?'Werk de resterende boeken af of behoud bestaande gegevens. '
            +'Boeken met een onzekere identiteit kun je voorlopig overslaan.'
          :'Deze aantallen zijn opnieuw door de server berekend. '
            +'Bij het bevestigen worden bestaande gegevens beschermd.'));
        panel.append(note);
        const details=make('div','bb-guide__overview');
        for(const [label,count] of [
          ['Nieuwe exemplaren',summary.newCopies||0],
          ['Uitleningen aanpassen',summary.proposedLoans||0],
          ['Vaste locaties',summary.proposedLocations||0],
          ['Boekvelden',summary.metadataFields||0],
          ['Overgeslagen Excelrijen',countSkipped],
          ['Openstaande controlepunten',pending],
          ['Niet overgenomen boeken',summary.missingStockGroups||0],
          ['Niet overgenomen exemplaren',summary.missingStockCopies||0],
        ]){
          const line=make('div','bb-guide__overview-line');
          line.append(make('span','',label),make('strong','',String(count)));
          details.append(line);
        }
        panel.append(details);
        if(summary.missingStockGroups){
          const omitted=make('div','bb-guide__attention');
          omitted.append(make('strong','',
            (summary.missingStockGroups||0)
              +' ontbrekende boeken worden niet bijgewerkt.'));
          omitted.append(make('p','',
            'De bijbehorende Exceluitleningen en vaste locaties zijn '
            +'overgeslagen omdat de fysieke exemplaren ontbreken. '
            +'Je kunt deze later opnieuw synchroniseren.'));
          const acknowledgement=make('label','bb-guide__accept');
          const control=make('input');control.type='checkbox';
          control.checked=guidedMissingAcknowledged;
          control.addEventListener('change',()=>{
            guidedMissingAcknowledged=control.checked;render();
          });
          acknowledgement.append(control,make('span','',
            'Ik heb gezien welke ontbrekende boeken niet worden meegenomen.'));
          omitted.append(acknowledgement);
          panel.append(omitted);
        }
        if(pending||hasChanges)
          panel.append(make('p','bb-guide__attention',
            'Er staan nog controles open of er zijn keuzes die eerst '
            +'opnieuw moeten worden berekend.'));
        const sourceWarnings=actionable.reduce((total,item)=>
          total+(item.issues||[]).filter(issue=>
            issue.severity==='warning'||issue.severity==='conflict').length,0);
        if(sourceWarnings){
          const accept=make('label','bb-guide__accept');
          const checkbox=make('input');checkbox.type='checkbox';
          checkbox.checked=warningsAccepted;
          checkbox.addEventListener('change',()=>{
            warningsAccepted=checkbox.checked;
            render();
          });
          accept.append(checkbox,make('span','',
            'Ik heb de '+sourceWarnings
            +' relevante bronmeldingen gecontroleerd.'));
          panel.append(accept);
        }
        const auditing=make('div','bb-guide__audit');
        const auto=(metadata.automaticDecisions||[]);
        const auditList=make('div','bb-guide__audit-list');
        for(const item of auto.slice(0,guidedShowDetails?auto.length:12)){
          const line=make('div','bb-guide__audit-row');
          line.append(make('strong','',item.title||item.isbn),
            make('span','',item.field+' · '
              +(item.action==='keep'?'Bestaande behouden':'Wijziging voorgesteld')));
          const choices=make('div','bb-guide__audit-actions');
          const selected=metadataResolutions.get(item.id)?.action;
          const keep=addAction(choices,selected==='keep'
            ?'✓ Behouden':'Behouden',()=>{
              if(selected==='keep')metadataResolutions.delete(item.id);
              else metadataResolutions.set(item.id,{
                id:item.id,action:'keep'});
              render();
            });
          keep.setAttribute('aria-pressed',String(selected==='keep'));
          if(item.canUseExcel&&item.excel!==null)
            addAction(choices,'Excel gebruiken',()=>{
              metadataResolutions.set(item.id,{
                id:item.id,action:'excel'});render();
            });
          line.append(choices);
          // A safely preserved invalid Excel field (for example a text
          // instead of a page count) remains editable. The old review UI
          // permitted that even if the planner deliberately emitted no
          // actionable metadata issue for the field.
          const worksheetRows=Array.isArray(item.worksheetRows)
            ?item.worksheetRows:[];
          const editableField=item.field==='manualThemes'?'themes'
            :item.field==='suitableForExamList'?'examMaterial'
              :item.field;
          // Enrichment-only fields are not part of the selected Excel
          // synchronization. Converting their provenance to manual would
          // remove the enrichment while never applying the edit.
          if(worksheetRows.length&&!item.enrichmentOnly){
            const editHost=make('div','bb-guide__row-choices');
            for(const worksheetRow of worksheetRows){
              const sourceRow=rowByNumber.get(worksheetRow);
              if(!sourceRow)continue;
              const editorKey=item.id+':'+sourceRow.index;
              const open=guidedAuditEditor===editorKey;
              const edit=button('Excelrij '+worksheetRow
                +(open?' sluiten':' corrigeren'),'btn btn--secondary');
              edit.addEventListener('click',()=>{
                guidedAuditEditor=open?null:editorKey;render();
              });
              editHost.append(edit);
              if(open)editRow(sourceRow,editHost,{
                onlyFields:[editableField],
                // Manual corrections must supersede an earlier "Behouden"
                // decision for the same ISBN/field.
                metadataIssueId:item.id,
              });
            }
            line.append(editHost);
          }
          auditList.append(line);
        }
        auditing.append(auditList);
        if(auto.length>12){
          const show=button(guidedShowDetails?'Minder tonen':
            'Alle '+auto.length+' besluiten bekijken',
            'btn btn--secondary');
          show.addEventListener('click',()=>{
            guidedShowDetails=!guidedShowDetails;render();
          });
          auditing.append(show);
        }
        if(auto.length)panel.append(makeDetail('Automatische keuzes bekijken '
          +'en aanpassen ('+auto.length+')',auditing));
        const automaticAssignments=(assignments.differences||[])
          .filter(diff=>diff.automatic&&!diff.previouslyImported);
        if(automaticAssignments.length){
          const list=make('div','bb-guide__audit-list');
          for(const diff of automaticAssignments){
            const line=make('div','bb-guide__audit-row');
            line.append(make('strong','',diff.title||diff.editionIsbn||'Boek'),
              make('span','',diff.kind==='loan'?'Uitlening'
                :diff.kind==='location'?'Vaste locatie'
                :'Klasvermelding'));
            const actions=make('div','bb-guide__audit-actions');
            const selected=assignmentResolutions.get(diff.id)?.action
              ||diff.choice||'keep';
            const choose=(label,action)=>{
              const control=addAction(actions,
                selected===action?'✓ '+label:label,()=>{
                  assignmentResolutions.set(diff.id,{id:diff.id,action});
                  render();
                });
              control.setAttribute('aria-pressed',String(selected===action));
            };
            if(diff.kind==='class_context'){
              choose('Behouden','keep');
              choose('Vaste plek','class_fixed');
              if(diff.classId&&!diff.hasExplicitLoan)
                choose('Uitlening aan klas','class_loan');
            }else{
              choose('Excel overnemen','apply');
              choose('Bestaande behouden','keep');
              choose('Later controleren','later');
            }
            line.append(actions);list.append(line);
          }
          panel.append(makeDetail('Automatische uitleningen en klaskeuzes '
            +'aanpassen ('+automaticAssignments.length+')',list));
        }
        addAction(footer,'Diagnoseverslag downloaden',downloadCurrentDiagnosis);
        addAction(footer,'Terug naar boeken',()=>setGuidedStep(2,guidedIndex));
        if(hasChanges||!summary.readyToApply){
          const check=addAction(footer,'Keuzes opnieuw controleren',recheck,true);
          check.disabled=Boolean(remotePending||busy);
        }else{
          const apply=addAction(footer,'Definitieve import bevestigen',finish,true);
          apply.disabled=Boolean(remotePending||busy
            ||!summary.readyToApply||hasChanges
            ||(summary.missingStockGroups&&!guidedMissingAcknowledged));
        }
      }
      const cancel=addAction(footer,'Import annuleren',()=>{
        if(!window.confirm('Deze import annuleren? Er wordt niets '
          +'aan de bibliotheek gewijzigd.'))return;
        run(async()=>{
          const response=await request(rootPath+'/'+encodeURIComponent(stage.id)
            +'/cancel',{revision:stage.revision});
          rememberResponse(response);
          try{localStorage.removeItem(wizardPositionKey);}catch{}
          setNotice('De import is geannuleerd. Je kunt een nieuw bestand kiezen.');
        },'De import wordt geannuleerd…');
      });
      cancel.classList.add('bb-guide__cancel');
      panel.append(footer);
      results.append(panel);
    }

    function renderUnifiedSync() {
      // The guided flow replaces the old multi-list review. The classic
      // renderer remains reachable for emergency administrative fallback.
      if(!new URLSearchParams(window.location.search).has('classicImportReview'))
        return renderGuidedUnifiedSync();
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
      const manualGroups=new Set();
      for(const diff of exceptions)
        manualGroups.add(diff.editionIsbn||('assignment:'+diff.worksheetRow));
      for(const issue of metadataPlan.issues)
        manualGroups.add(issue.isbn||('metadata:'+issue.id));
      for(const item of blocked)
        manualGroups.add(item.editionIsbn||('row:'+item.worksheetRow));
      const heading=make('div','bb-import__review-heading');
      heading.append(make('h4','','2. Bekijk de voorgestelde wijzigingen'));
      heading.append(make('p','hint',
        'De aangevinkte onderdelen worden samen verwerkt na jouw bevestiging. '
        +'Alleen uitzonderingen vragen een afzonderlijke keuze.'));
      results.append(heading);
      const diagnosticButton=button('Download diagnoseverslag (JSON)','btn btn--secondary');
      diagnosticButton.addEventListener('click',downloadCurrentDiagnosis);
      results.append(diagnosticButton);
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
      const confidence=make('div','bb-import__confidence');
      confidence.append(make('strong','',
        (summary.confidentMetadata||0)+' bronbevestigde keuzes'));
      confidence.append(make('span','',
        (summary.consideredMetadata||0)+' automatisch beoordeeld, '
        +(summary.preservedMetadata||0)+' waarden behouden'));
      confidence.append(make('span','hint',
        'Alle automatische keuzes kun je hieronder controleren. '
        +'Alleen echte conflicten vragen verplicht om een beslissing.'));
      results.append(confidence);
      const informative=(stage.rows||[]).reduce((sum,row)=>
        sum+(row.issues||[]).filter(issue=>
          issue.reviewLevel==='informational'
          ||['metadata_lookup_failed','isbn_repaired','metadata_not_usable']
            .includes(issue.code)).length,0);
      const safelyKept=(metadataPlan.automaticDecisions||[])
        .filter(item=>item.action==='keep').length
        +automatic.filter(item=>item.autoKept).length
        +(stock.summary?.acknowledgedEditions||0);
      const autoChanges=(metadataPlan.automaticDecisions||[])
        .filter(item=>item.action==='apply').length
        +automatic.filter(item=>item.choice==='apply').length;
      const autonomous=make('p','bb-import__autonomy-summary hint',
        'Zelfstandig voorgesteld: '+autoChanges+' wijzigingen of aanvullingen. '
        +'Veilig behouden: '+safelyKept+' keuzes. '
        +'Informatieve bronmeldingen: '+informative+'. '
        +'Unieke boeken of Excelrijen die aandacht vragen: '+manualGroups.size+'.');
      results.append(autonomous);
      const status=make('p','bb-import__review-status');
      const pending=(summary.pending||0);
      status.append(make('strong','',pending
        ?manualGroups.size+' boeken of Excelrijen hebben controlepunten'
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
        +'Niet-geselecteerde Excelkolommen overschrijven geen bestaande gegevens. '
        +'Lege velden kunnen via ISBN-bronnen worden aangevuld.'));
      results.append(selection);

      // Show the actual diagnostic messages before requesting the general
      // warning acknowledgement. A generic "source_needs_review" message
      // does not tell administrators what is wrong with the Excel data.
      const sourceWarnings=(stage.rows||[]).map(row=>({
        row,issues:(row.issues||[]).filter(issue=>
          issue.severity==='warning'||issue.severity==='conflict'),
      })).filter(entry=>entry.issues.length);
      // Book databases frequently spell author names and titles differently
      // from an explicit Excel value. That comparison is informative, not a
      // reason to stop every stock, loan and metadata change in that row.
      const advisoryCount=sourceWarnings.reduce((count,entry)=>
        count+entry.issues.filter(issue=>
          issue.code==='metadata_differs_from_excel'&&issue.severity==='warning'
          &&issue.sourceInvalid!==true).length,0);
      // The planner evaluates each source code against the components
      // actually selected. A corrected ISBN or failed optional lookup is
      // informative, not a checkbox the administrator must acknowledge.
      const activeIssueRows=Array.isArray(plan.actionableSourceIssues)
        ?new Map(plan.actionableSourceIssues.map(entry=>
          [entry.index,entry.issues||[]])):null;
      const actionableWarnings=sourceWarnings.map(entry=>({
        row:entry.row,issues:activeIssueRows
          ?(activeIssueRows.get(entry.row.index)||[])
          :entry.issues.filter(issue=>
            !(issue.code==='metadata_differs_from_excel'
              &&issue.severity==='warning'&&issue.sourceInvalid!==true)),
      })).filter(entry=>entry.issues.length);
      const warningCount=actionableWarnings.reduce((count,entry)=>
        count+entry.issues.length,0);
      const issueLabels={
        ...importErrorText,
        invalid_published_year:'Ongeldig uitgavejaar',
        invalid_page_count:'Ongeldig aantal pagina’s',
        isbn_repaired:'ISBN automatisch hersteld',
        isbn_repair_suggested:'ISBN moet worden gecontroleerd',
        missing_title:'Titel ontbreekt',
        missing_author:'Auteur ontbreekt',
        missing_title_after_metadata:'Titel ontbreekt na aanvullen',
        missing_author_after_metadata:'Auteur ontbreekt na aanvullen',
        invalid_quantity:'Ongeldig aantal exemplaren',
        language_hint_conflict:'Taal wijkt af van het examenmateriaal',
        nonstandard_easy_reading_value:'Afwijkende invoer voor Makkelijk lezen',
        invalid_or_unrecognized_isbn:'ISBN niet herkend',
        conflicting_source_columns:'Excelkolommen spreken elkaar tegen',
        duplicate_physical_barcode:'Fysieke barcode komt meerdere keren voor',
        metadata_title_conflict:'Twee onafhankelijke ISBN-bronnen bevestigen een andere titel',
        edition_identity_conflict:'Verschillende boeken hebben hetzelfde ISBN',
        metadata_isbn_differs:'ISBN komt niet overeen met de gevonden editie',
        own_book_context_conflict:'Eigen boek is ook als schoolboek vermeld',
      };
      if(warningCount){
        const notice=make('details','bb-import__source-warnings');
        notice.open=actionableWarnings.length<=5;
        notice.append(make('summary','',
          'Brongegevens die aandacht vragen ('+warningCount+')'));
        notice.append(make('p','hint',
          'Dit zijn bronwaarschuwingen. Bekijk vooral de echte conflicten '
          +'in de groepen onder Handmatig controleren.'));
        const warningList=make('div','bb-import__warnings-scroll');
        for(const entry of actionableWarnings){
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
            if(issue.confirmedTitle)
              detailParts.push('Online bevestigde titel: '+String(issue.confirmedTitle).slice(0,160));
            if(issue.sources?.length)
              detailParts.push('Onafhankelijke bronnen: '+issue.sources.join(', '));
            const item=make('li','',description+
              (issue.severity==='conflict'?' (conflict)':' (waarschuwing)')+
              (detailParts.length?' · '+detailParts.join(' · '):''));
            items.append(item);
          }
          group.append(items);
          if(entry.issues.some(issue=>issue.code==='metadata_title_conflict'
            &&issue.confirmedTitle)&&row.book?.title){
            // Explicitly retain a verified Excel title without forcing the
            // administrator to type the exact same title into a text field.
            const confirmTitle=button('Titel uit Excel bevestigen','btn btn--secondary');
            confirmTitle.disabled=Boolean(remotePending||busy);
            confirmTitle.addEventListener('click',()=>{
              updateCorrection(row.index,'title',row.book.title);
              render();
            });
            group.append(confirmTitle);
          }
          warningList.append(group);
        }
        notice.append(warningList);results.append(notice);
      }
      if(advisoryCount){
        const info=make('details','bb-import__source-advisories');
        info.append(make('summary','',
          'Online boekinformatie wijkt af ('+advisoryCount+' informatieve vergelijkingen)'));
        const byField=new Map();
        for(const entry of sourceWarnings){
          for(const issue of entry.issues){
            if(issue.code!=='metadata_differs_from_excel'
              ||issue.severity!=='warning'||issue.sourceInvalid===true)continue;
            const key=issue.field||'overig';
            byField.set(key,(byField.get(key)||0)+1);
          }
        }
        const labels={title:'titels',author:'auteurs',description:'beschrijvingen',
          publishedYear:'verschijningsjaren',pageCount:'pagina-aantallen',
          coverUrl:'omslagen',publisher:'uitgevers',language:'talen',
          tags:'trefwoorden',manualThemes:'thema’s'};
        info.append(make('p','hint',
          'Deze meldingen komen van online boekdatabanken. Ze maken '
          +'de ingevulde Excelgegevens niet automatisch ongeldig en vragen '
          +'geen afzonderlijke bevestiging.'));
        info.append(make('p','bb-import__advisory-stats',
          [...byField].map(([field,count])=>
            count+' '+(labels[field]||field)).join(' · ')));
        results.append(info);
      }

      const controls=make('div','bb-review__controls bb-import__review-controls');
      const acceptLabel=make('label','bb-review__check');
      const accept=make('input');accept.type='checkbox';
      accept.checked=warningsAccepted;
      accept.addEventListener('change',()=>{warningsAccepted=accept.checked;render();});
      acceptLabel.append(accept,document.createTextNode(
        ' Ik heb de eventuele bronwaarschuwingen gecontroleerd.'));
      // No warning consent is needed for differences against external
      // metadata alone. Do not demand a checkbox that has nothing to approve.
      if(warningCount)controls.append(acceptLabel);
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
        manualGroups.size+' boeken of Excelrijen)'));
      if(manualGroups.size)
        problems.append(make('p','hint',
          'Eén boek kan bij meerdere onderdelen voorkomen. '
          +'De aantallen hieronder zijn per onderdeel.'));
      // The primary identity workflow is one book card per worksheet row,
      // not a dropdown per metadata field. Server-side options are only
      // suggestions: each click writes an ordinary editable correction, and
      // the full import is revalidated before any real database mutation.
      const reviewRows=new Set(blocked.map(item=>item.index));
      for(const issue of metadataPlan.issues||[]){
        for(const worksheetRow of issue.worksheetRows||[]){
          const match=(stage.rows||[]).find(row=>
            row.sourceRowNumber===worksheetRow);
          if(match)reviewRows.add(match.index);
        }
      }
      const recommended=(stage.rows||[]).filter(row=>
        reviewRows.has(row.index)&&Array.isArray(row.matchSuggestions)
        &&row.matchSuggestions.length);
      if(recommended.length){
        const matchSection=make('section','bb-match-review');
        const matchHeading=make('div','bb-match-review__heading');
        matchHeading.append(make('h4','',
          'Controleer de voorgestelde boeken ('+recommended.length+')'),
          make('p','hint',
            'Vergelijk bij een onzeker ISBN de gegevens met het fysieke boek. '
            +'Kies een voorgestelde editie of pas de gegevens zelf aan. '
            +'Pas na ‘Controle opnieuw berekenen’ worden je keuzes gecontroleerd.'));
        matchSection.append(matchHeading);

        const matchList=make('div','bb-match-review__list');
        const rawIsbn=row=>row.identifierAnalysis?.explicit?.raw
          ||row.identifierAnalysis?.legacy?.raw
          ||row.identifierAnalysis?.ambiguous?.raw
          ||row.book?.editionIsbn||'';
        const isSelected=(row,candidate)=>{
          const values=corrections.get(row.index)?.fields||{};
          return values.editionIsbn===candidate.editionIsbn
            &&(values.title===undefined||values.title===candidate.title)
            &&(values.author===undefined||values.author===candidate.author);
        };
        const candidateView=(row,candidate,secondary=false)=>{
          const info=make('div','bb-match-review__candidate'
            +(secondary?' bb-match-review__candidate--secondary':''));
          const cover=make('div','bb-match-review__cover');
          const imageUrl=typeof candidate.coverUrl==='string'
            &&/^https:\/\/[^\s"'<>]+$/i.test(candidate.coverUrl)
            ?candidate.coverUrl:'';
          if(imageUrl){
            const image=make('img');
            image.src=imageUrl;image.alt='Omslag van '+candidate.title;
            image.loading='lazy';
            image.referrerPolicy='no-referrer';
            cover.append(image);
          }else cover.append(make('span','bb-match-review__cover-mark','B'));
          const details=make('div','bb-match-review__candidate-body');
          details.append(make('span','bb-match-review__eyebrow',
            candidate.origin==='existing'?'Al in Boekenbaai'
              :'Online gevonden · controleer editie'));
          details.append(make('strong','bb-match-review__candidate-title',
            candidate.title||'Boek'));
          details.append(make('span','',candidate.author||'Auteur onbekend'));
          if(candidate.editionIsbn)
            details.append(make('code','bb-match-review__isbn',candidate.editionIsbn));
          else details.append(make('span','hint',
            'Nog geen ISBN in de bestaande registratie'));
          const hints=[];
          if(candidate.origin==='existing'&&candidate.copies)
            hints.push(candidate.copies+' bestaand'+(candidate.copies===1?' exemplaar':'e exemplaren'));
          if(candidate.publisher)hints.push(candidate.publisher);
          if(candidate.language)hints.push('Taal: '+candidate.language);
          if(candidate.sources?.length)hints.push('Bron: '+candidate.sources.join(', '));
          if(candidate.identityWarning)
            hints.push('Titel of auteur wijkt af: controleer op het fysieke boek');
          if(candidate.unverifiedTitle)hints.push('Titel nog niet per editie bevestigd');
          if(hints.length)
            details.append(make('small','bb-match-review__source',hints.join(' · ')));
          const actions=make('div','bb-match-review__candidate-actions');
          if(candidate.editionIsbn){
            const chosen=isSelected(row,candidate);
            const accept=button(chosen?'Geselecteerd':'Dit is het juiste boek',
              chosen?'btn btn--secondary':'btn');
            accept.disabled=Boolean(remotePending||busy||chosen);
            accept.addEventListener('click',()=>{
              // Never store a malformed Excel number as a scan barcode.
              // Keep untouched fields unless the catalogue actually names
              // the edition; unverified search hints carry only the ISBN.
              selectCandidateForRow(row,candidate);
              render();
            });
            actions.append(accept);
          }else{
            const noIsbn=make('span','hint',
              'Controleer het nummer op dit boek voordat je het koppelt.');
            actions.append(noIsbn);
          }
          info.append(cover,details,actions);
          return info;
        };
        for(const row of recommended.slice(0,visibleMatchCards)){
          const card=make('article','bb-match-review__card');
          card.dataset.reviewRowKey='match:'+row.index;
          const heading=make('div','bb-match-review__card-heading');
          heading.append(make('strong','',row.book?.title||'Boek'));
          heading.append(make('span','bb-match-review__state',
            'Excelrij '+row.sourceRowNumber+' · '+(row.book?.editionIsbn
              ?'Identiteit controleren':'ISBN onzeker')));
          card.append(heading);
          const compare=make('div','bb-match-review__compare');
          const excel=make('section','bb-match-review__excel');
          excel.append(make('span','bb-match-review__eyebrow','In Excel'),
            make('strong','',row.book?.title||'Titel onbekend'),
            make('span','',row.book?.author||'Auteur onbekend'),
            make('span','bb-match-review__isbn',
              'Code: '+(rawIsbn(row)||'niet ingevuld')));
          const proposed=make('section','bb-match-review__proposed');
          proposed.append(make('span','bb-match-review__eyebrow','Beste voorstel'));
          proposed.append(candidateView(row,row.matchSuggestions[0]));
          compare.append(excel,proposed);
          card.append(compare);
          const options=make('div','bb-match-review__options');
          const alternatives=row.matchSuggestions.slice(1);
          if(alternatives.length){
            const more=button('Andere editie bekijken ('+alternatives.length+')',
              'btn btn--secondary');
            more.setAttribute('aria-expanded',
              String(expandedMatchAlternatives.has(row.index)));
            more.addEventListener('click',()=>{
              if(expandedMatchAlternatives.has(row.index))
                expandedMatchAlternatives.delete(row.index);
              else expandedMatchAlternatives.add(row.index);
              render();
            });
            options.append(more);
          }
          const own=button(openEditor===row.index?'Correctie sluiten':'Zelf corrigeren',
            'btn btn--secondary');
          own.addEventListener('click',()=>{
            openEditor=openEditor===row.index?null:row.index;
            render();
          });
          options.append(own);
          card.append(options);
          if(expandedMatchAlternatives.has(row.index)){
            const alternativesList=make('div','bb-match-review__alternatives');
            for(const candidate of alternatives)
              alternativesList.append(candidateView(row,candidate,true));
            card.append(alternativesList);
          }
          if(openEditor===row.index)
            editRow(row,card,{onlyFields:['title','author','editionIsbn']});
          const selected=corrections.get(row.index)?.fields||{};
          if(selected.editionIsbn||selected.title||selected.author)
            card.append(make('p','bb-match-review__selection-note',
              'Je wijziging is gekozen maar nog niet verwerkt. '
              +'Gebruik ‘Controle opnieuw berekenen’ om alle controles te herhalen.'));
          matchList.append(card);
        }
        matchSection.append(matchList);
        if(recommended.length>visibleMatchCards){
          const showMore=button('Nog '+Math.min(5,recommended.length-visibleMatchCards)
            +' boekvoorstellen bekijken','btn btn--secondary');
          showMore.addEventListener('click',()=>{
            visibleMatchCards+=5;
            render();
          });
          matchSection.append(showMore);
        }
        const matchFooter=make('div','bb-match-review__footer');
        matchFooter.append(make('p','hint',
          'Je keuzes worden pas verwerkt na een nieuwe controle en de definitieve import.'));
        const recalculate=button('Gekozen boeken opnieuw controleren','btn');
        recalculate.disabled=Boolean(remotePending||busy);
        recalculate.addEventListener('click',()=>run(async()=>{
          await reviewChoices([...assignmentResolutions.values()],
            [...metadataResolutions.values()]);
        },'De boekvoorstellen worden opnieuw gecontroleerd…'));
        matchFooter.append(recalculate);
        matchSection.append(matchFooter);
        problems.append(matchSection);
      }
      const assignmentCards=make('div','bb-import__exceptions-list');
      const metadataCards=make('div','bb-import__exceptions-list');
      const stockCards=make('div','bb-import__exceptions-list');
      const reasonNames={
        ...importErrorText,
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
        source_needs_review:'De Excelrij heeft een nog niet opgelost invoer- of ISBN-conflict. Bekijk de brongegevens hierboven.',
        edition_identity_mismatch:'Titel of auteur wijkt af van de bestaande bibliotheekregistratie bij dit ISBN. Controleer welke gegevens bij de fysieke editie horen.',
        missing_valid_isbn:'Geen geldig ISBN herkend. Controleer het ISBN van deze editie.',
        possible_existing_book_without_isbn:'Een vergelijkbaar boek staat al zonder ISBN in de bibliotheek. Controleer of dit hetzelfde exemplaar is.',
        invalid_quantity:'Het aantal exemplaren is ongeldig.',
        reduction_requires_manual_review:'Excel vermeldt minder exemplaren dan de bibliotheek. Bestaande boeken worden niet verwijderd.',
      };
      for(const diff of exceptions){
        const card=make('article','bb-import__exception');
        card.dataset.reviewIsbn=diff.editionIsbn||('unknown:'+diff.id);
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
        card.append(input);assignmentCards.append(card);
      }
      for(const issue of metadataPlan.issues){
        const card=make('article','bb-import__exception');
        card.dataset.reviewIsbn=issue.isbn;
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
        metadataCards.append(card);
      }
      for(const item of blocked){
        const source=(stage.rows||[]).find(row=>row.index===item.index);
        const card=make('article','bb-import__exception');
        card.dataset.reviewIsbn=item.editionIsbn||('row:'+item.index);
        card.dataset.reviewRowKey='stock:'+item.index;
        card.append(make('strong','',source?.book?.title||'Boek'));
        card.append(make('p','hint','Excelrij '+item.worksheetRow+' · '+(item.editionIsbn||'Geen ISBN')));
        card.append(make('p','bb-review__reason',
          'Voorraadcontrole: '+(reasonNames[item.reason]||item.reason)));
        const reasons=item.blockers?.length?item.blockers:[item.reason];
        for(const reason of reasons.filter(value=>value&&value!==item.reason)){
          card.append(make('p','hint',
            'Ook gevonden: '+(reasonNames[reason]||reason)));
        }
        if(reasons.includes('edition_identity_mismatch')){
          for(const existing of item.existingIdentitySamples||[]){
            card.append(make('p','hint',
              'Al geregistreerd: '+existing.title+' · '+existing.author));
          }
        }
        if(reasons.includes('possible_existing_book_without_isbn')){
          for(const existing of item.legacyIdentitySamples||[]){
            card.append(make('p','hint',
              'Bestaand zonder ISBN: '+existing.title+' · '+existing.author));
          }
        }
        if(reasons.includes('source_needs_review')&&source){
          const relevant=(source.issues||[]).filter(issue=>
            ['warning','conflict'].includes(issue.severity)
            &&issue.reviewLevel!=='informational');
          for(const issue of relevant){
            const field=issue.field?' ('+issue.field+')':'';
            card.append(make('p','hint',
              'Broncontrole'+field+': '
              +(importErrorText[issue.code]||issueNames[issue.code]||issue.code)));
          }
        }
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
        stockCards.append(card);
      }
      const mergeSameBook=(cards)=>{
        const originals=Array.from(cards.children);
        cards.replaceChildren();
        const groups=new Map();
        for(const card of originals){
          const isbn=card.dataset.reviewIsbn||('other:'+groups.size);
          let parent=groups.get(isbn);
          if(!parent){
            parent=make('article','bb-import__book-check');
            parent.append(make('strong','bb-import__book-isbn',isbn));
            groups.set(isbn,parent);
            cards.append(parent);
          }
          parent.append(card);
        }
      };
      mergeSameBook(assignmentCards);
      mergeSameBook(metadataCards);
      mergeSameBook(stockCards);
      const groups=[
        ['assignments','Uitleningen en vaste locaties',assignmentCards],
        ['metadata','Boekgegevens',metadataCards],
        ['stock','Boekenvoorraad',stockCards],
      ];
      const totalCards=groups.reduce((count,[, ,cards])=>count+cards.children.length,0);
      if(!totalCards){
        problems.append(make('p','hint',
          'Geen handmatige controles nodig voor deze import.'));
      }
      for(const [kind,label,cards] of groups){
        const count=cards.children.length;
        if(!count)continue;
        const group=make('details','bb-import__exception-group');
        group.open=unifiedOpenGroups.has(kind)
          ||(count<=5&&!(kind==='stock'&&recommended.length));
        group.addEventListener('toggle',()=>{
          if(!group.isConnected)return;
          if(group.open)unifiedOpenGroups.add(kind);
          else unifiedOpenGroups.delete(kind);
        });
        group.append(make('summary','',label+' ('+count+')'));
        const limit=unifiedLimits[kind];
        while(cards.children.length>limit)cards.lastElementChild.remove();
        group.append(cards);
        if(count>limit){
          const more=button('Volgende '+Math.min(15,count-limit)
            +' controlepunten tonen','btn btn--secondary');
          more.addEventListener('click',()=>{
            unifiedLimits[kind]+=15;
            unifiedOpenGroups.add(kind);
            render();
          });
          group.append(more,make('p','hint',
            'Getoond: '+limit+' van '+count+'. Je keuzes blijven bewaard.'));
        }
        problems.append(group);
      }
      results.append(problems);

      const suggested=make('details','bb-import__proposals');
      suggested.open=automaticExpanded;
      suggested.addEventListener('toggle',()=>{
        if(suggested.isConnected)automaticExpanded=suggested.open;
      });
      suggested.append(make('summary','',
        'Automatische keuzes bekijken en aanpassen ('+
        (automatic.length+(metadataPlan.automaticDecisions||[]).length)+')'));
      suggested.append(make('p','hint',
        'Hoge zekerheid betekent bronbevestigd. Bij redelijke zekerheid '
        +'kiest Boekenbaai veilig zelf, vaak door bestaande gegevens te behouden. '
        +'Elke keuze blijft aanpasbaar en wordt vastgelegd in het importverslag.'));
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
        return tr;
      };
      for(const diff of automatic){
        const control=make('select');
        const possible=diff.kind==='class_context'
          ?[['keep','Bestaande registratie behouden'],
            ['class_fixed','Vaste plek in deze klas'],
            ...(diff.classId&&!diff.hasExplicitLoan
              ?[['class_loan','Als uitlening aan klas']]:[]),
            ['later','Later controleren']]
          :[['apply','Excel overnemen'],
            ['keep','Bestaande behouden'],['later','Later controleren']];
        for(const [value,label] of possible){
          const option=make('option','',label);option.value=value;control.append(option);
        }
        control.value=assignmentResolutions.get(diff.id)?.action||diff.choice||'apply';
        control.addEventListener('change',()=>{
          assignmentResolutions.set(diff.id,{id:diff.id,action:control.value});
          render();
        });
        const description=diff.kind==='class_context'
          ?'Onduidelijke klasnotitie: '+(diff.className||'onbekend')
            +'. Huidige uitlening en vaste plek blijven behouden.'
          :diff.kind==='loan'
            ?'Naar '+(diff.after?.name||'onbekend')
            :'Naar '+String(diff.after||'');
        addRow(diff.title||'Boek',diff.editionIsbn||'',
          diff.kind==='class_context'?'Klasnotitie'
            :diff.kind==='loan'?'Uitlening':'Vaste plek',
          description,control);
      }
      const formatValue=value=>{
        if(value===null||value===undefined)return 'leeg';
        if(Array.isArray(value))return value.join(', ');
        if(typeof value==='object')return String(value.value||JSON.stringify(value));
        return String(value);
      };
      for(const item of metadataPlan.automaticDecisions||[]){
        const control=make('select');
        const possibilities=[
          ['default','Automatisch voorstel volgen'],
          ['keep','Huidige waarde behouden'],
        ];
        if(item.canUseExcel&&item.excel!==null)
          possibilities.push(['excel','Excelwaarde overnemen']);
        for(const [value,label] of possibilities){
          const option=make('option','',label);
          option.value=value;control.append(option);
        }
        control.value=metadataResolutions.get(item.id)?.action||'default';
        control.addEventListener('change',()=>{
          if(control.value==='default')metadataResolutions.delete(item.id);
          else metadataResolutions.set(item.id,{
            id:item.id,action:control.value,
          });
          render();
        });
        const marker=item.confidence==='high'?'Hoge zekerheid'
          :item.confidence==='manual'?'Door beheer gekozen':'Redelijke zekerheid';
        const description=(item.action==='keep'
            ?'Bestaande waarde behouden'
            :'Voorgesteld: '+formatValue(item.after))
          +' · '+marker+' · '+item.reason
          +(item.sources?.length
            ?' · Bronnen: '+item.sources.join(', '):' · Geen onafhankelijke bronconsensus');
        const wrapper=make('div','bb-import__decision-control');
        wrapper.append(control);
        if(!item.canUseExcel&&!item.enrichmentOnly &&item.worksheetRows?.length){
          // The same ISBN may appear in several worksheet rows. Every
          // affected row must remain directly editable, including when
          // stock synchronization is not selected.
          const affected=(stage.rows||[]).filter(row=>
            item.worksheetRows.includes(row.sourceRowNumber));
          for(const source of affected){
            const correction=button('Excelrij '+source.sourceRowNumber+' corrigeren',
              'btn btn--secondary');
            correction.disabled=Boolean(remotePending||busy);
            correction.addEventListener('click',()=>{
              openEditor=openEditor===source.index?null:source.index;
              render();
            });
            wrapper.append(correction);
            if(openEditor===source.index){
              editRow(source,wrapper,{onlyFields:[
                item.field==='manualThemes'?'themes':
                  item.field==='suitableForExamList'?'examMaterial':item.field,
              ],metadataIssueId:item.id});
            }
          }
        }
        addRow(item.title||'Boek',item.isbn,item.field,description,wrapper);
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
      if(typeof scheduleGuidedDraftSave==='function')scheduleGuidedDraftSave();
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
        ?0:stage.status==='completed'?3
          :stage.mode==='unified_sync'?guidedStep:1;
      for(let index=0;index<stepNodes.length;index++){
        stepNodes[index].classList.toggle('bb-import__step--active',index===activeStep);
        const navigable=stage?.status==='open'
          &&stage.mode==='unified_sync'&&index>0
          &&!(index===3&&guidedStep===1);
        stepNodes[index].disabled=!navigable;
        if(index===activeStep)stepNodes[index].setAttribute('aria-current','step');
        else stepNodes[index].removeAttribute('aria-current');
      }
      const activeImport=Boolean(stage&&['preparing','open','reviewing','applying']
        .includes(stage.status));
      root.classList.toggle('bb-review--active',activeImport);
      header.querySelector('.hint').hidden=activeImport;
      enrichmentExtra.hidden=activeImport;
      results.replaceChildren();
      deferredPanel.hidden=activeImport;
      form.hidden=activeImport;
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
          const sourceLog=done.report?.automaticSourceDecisions||[];
          if(sourceLog.length){
            const audit=make('details','bb-import__selection-details');
            audit.open=automaticReceiptOpen;
            audit.addEventListener('toggle',()=>{
              if(audit.isConnected)automaticReceiptOpen=audit.open;
            });
            audit.append(make('summary','',
              'Automatische bronkeuzes en behouden gegevens ('+sourceLog.length+')'));
            audit.append(make('p','hint',
              'Hoge zekerheid: meerdere onafhankelijke ISBN-bronnen komen overeen. '
              +'Redelijke zekerheid: Boekenbaai kiest een veilige standaard. '
              +'Het volledige verslag blijft beschikbaar via de JSON-knop.'));
            const format=value=>typeof value==='string'?value
              :Array.isArray(value)?value.join(', ')
              :value&&typeof value==='object'?(value.value||JSON.stringify(value))
              :value===undefined||value===null?'leeg':String(value);
            for(const item of sourceLog.slice(0,automaticReceiptLimit)){
              const line=make('p','bb-review__detail',
                (item.isbn||'Onbekende ISBN')+' · '+item.field
                +' · '+(item.action==='keep'?'Bestaande behouden':'Bijgewerkt')
                +' ('+(item.confidence==='high'?'hoge zekerheid'
                  :item.confidence==='manual'?'beheerder':'redelijke zekerheid')+')'
                +' · '+format(item.before)+' → '+format(item.after));
              audit.append(line);
            }
            if(sourceLog.length>automaticReceiptLimit){
              const more=button('Nog '+Math.min(20,sourceLog.length-automaticReceiptLimit)
                +' keuzes bekijken','btn btn--secondary');
              more.addEventListener('click',()=>{
                automaticReceiptLimit+=20;
                automaticReceiptOpen=true;
                render();
              });
              audit.append(more);
            }
            complete.append(audit);
          }
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

    file.addEventListener('change',()=>{
      if(stage?.status==='cancelled'||stage?.status==='failed'){
        stage=null;
        results.replaceChildren();
      }
      updateSetupProgress(null);
      setNotice('');
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const selected = file.files?.[0];
      if (!selected) return setNotice('Kies eerst een Excelbestand.');
      if (selected.size > 25 * 1024 * 1024) return setNotice('Het Excelbestand is te groot (maximaal 25 MB).');
      // A previous cancellation must not remain visible underneath the
      // new import progress indicator.
      if(stage?.status==='cancelled'||stage?.status==='failed'){
        stage=null;
        results.replaceChildren();
      }
      setNotice('');
      updateSetupProgress('reading',0,selected.size);
      run(async () => {
        const encoded = await encodeFile(selected,(loaded,total)=>
          updateSetupProgress('reading',loaded,total));
        updateSetupProgress('analyzing');
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
      }, 'Het Excelbestand wordt gecontroleerd…').finally(()=>{
        updateSetupProgress(null);
      });
    });
    syncStage();
    void refreshDeferred();
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
