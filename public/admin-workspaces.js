(() => {
  'use strict';

  // Navigation only: the original forms, handlers, import stages and
  // privileged server requests remain mounted as their original DOM nodes.
  const $ = selector => document.querySelector(selector);
  const make = (tag, className, text) => {
    const element=document.createElement(tag);
    if (className) element.className=className;
    if (text!==undefined) element.textContent=text;
    return element;
  };
  function setInactive(node, inactive) {
    if (node) node.classList.toggle('bb-workspace-inactive', inactive);
  }
  function createNavigation(entries, idPrefix, choose) {
    const nav=make('nav','bb-workspace-tabs');
    nav.setAttribute('aria-label','Onderdelen van deze beheerpagina');
    nav.setAttribute('role','tablist');
    const buttons=new Map();
    for (const entry of entries) {
      const button=make('button','bb-workspace-tab');
      button.type='button';
      button.id=idPrefix+'-tab-'+entry.id;
      button.dataset.workspaceTab=entry.id;
      button.setAttribute('role','tab');
      button.setAttribute('aria-controls',entry.panel);
      button.append(make('span','bb-workspace-tab-name',entry.label));
      if (entry.count) {
        const count=make('span','bb-workspace-tab-count');
        count.dataset.workspaceCount=entry.id;
        count.hidden=true;
        button.append(count);
      }
      button.addEventListener('click',()=>choose(entry.id));
      nav.append(button);
      buttons.set(entry.id,button);
    }
    nav.addEventListener('keydown',event=>{
      if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
      const items=[...buttons.values()];
      const index=items.indexOf(document.activeElement);
      if (index<0) return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?items.length-1
        :(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
      items[next].click();
      items[next].focus();
    });
    return {nav,buttons};
  }
  function activate(buttons,selected) {
    for (const [id,button] of buttons) {
      const active=id===selected;
      button.setAttribute('aria-selected',String(active));
      button.tabIndex=active?0:-1;
      button.classList.toggle('bb-workspace-tab--active',active);
    }
  }
  function setCount(button, count) {
    const target=button?.querySelector('[data-workspace-count]');
    if (!target) return;
    const number=Number(count);
    const valid=Number.isFinite(number)&&number>=0;
    target.hidden=!valid;
    if (valid) target.textContent=String(Math.floor(number));
  }

  function installImports() {
    const view=$('#admin-dashboard [data-admin-modern-view="imports"]');
    const card=view?.querySelector('.admin-card--imports');
    const content=card?.querySelector('#admin-card-imports-content');
    const reviewed=content?.querySelector('#reviewed-import-panel');
    const students=content?.querySelector('#student-import-form')?.closest('.admin-card__section--import');
    const teachers=content?.querySelector('#teacher-import-form')?.closest('.admin-card__section--import');
    if (!view||!card||!content||!reviewed||!students||!teachers) return false;
    if (view.dataset.bbWorkspacesReady==='true') return true;

    const entries=[
      {id:'books',label:'Boeken synchroniseren',panel:'reviewed-import-panel',
        description:'Importeer je Excelbestand, bekijk verschillen en bevestig pas na de controle.'},
      {id:'enrichment',label:'Omslagen en boekgegevens',panel:'bb-import-workspace-enrichment',
        description:'Bekijk de gratis aanvulling, de Brave-voortgang en eventueel benodigde toestemming.'},
      {id:'students',label:'Leerlingen importeren',panel:'bb-import-workspace-students',
        description:'Maak leerlingaccounts aan of werk bestaande accounts bij via een Excel-voorcontrole.'},
      {id:'teachers',label:'Docenten importeren',panel:'bb-import-workspace-teachers',
        description:'Werk docentaccounts en klaskoppelingen bij via een afzonderlijke Excel-voorcontrole.'},
    ];
    const intro=make('p','bb-workspace-description');
    intro.setAttribute('role','status');
    const {nav,buttons}=createNavigation(entries,'bb-import-workspace',choose);
    view.insertBefore(nav,card);
    nav.after(intro);

    const enrichment=make('section','bb-workspace-enrichment admin-card__section--import');
    enrichment.id='bb-import-workspace-enrichment';
    const extra=reviewed.querySelector('.bb-import__extras');
    if (extra) {
      // Preserve the original Brave and free-metadata controls and their
      // listeners; changing subpage must never start a paid search.
      enrichment.append(extra);
      extra.hidden=false;
    }
    content.append(enrichment);
    // The full ParnasSys integration creates its own active sync blocks
    // asynchronously and hides these original Excel forms. Give each tab a
    // stable host, then move the actual active block (not a copy) into it.
    const studentPane=make('section','bb-workspace-people-pane');
    studentPane.id='bb-import-workspace-students';
    const teacherPane=make('section','bb-workspace-people-pane');
    teacherPane.id='bb-import-workspace-teachers';
    studentPane.append(students);
    teacherPane.append(teachers);
    content.append(studentPane,teacherPane);

    function attachActiveSchoolSync() {
      const container=content.querySelector('.school-sync__container');
      if(!container)return false;
      const blocks=[...container.children].filter(node=>
        node.classList?.contains('school-sync__block'));
      if(blocks.length!==2)return false;
      studentPane.append(blocks[0]);
      teacherPane.append(blocks[1]);
      students.hidden=true;
      teachers.hidden=true;
      container.hidden=true;
      return true;
    }
    if(!attachActiveSchoolSync()) {
      // The integration may initialize after this module. Observe until it
      // mounts its two complete sections; retain their handlers and state.
      const syncObserver=new MutationObserver(()=>{
        if(attachActiveSchoolSync())syncObserver.disconnect();
      });
      syncObserver.observe(content,{childList:true,subtree:true});
    }
    const oldBookImport=content.querySelector('.bb-review__legacy');

    const panes=new Map([
      ['books',[reviewed,...(oldBookImport?[oldBookImport]:[])]],
      ['enrichment',[enrichment]],
      ['students',[studentPane]],
      ['teachers',[teacherPane]],
    ]);
    // Identify all panes by property rather than relying on title text.
    for (const [id,nodes] of panes) {
      for (const node of nodes) {
        node.dataset.bbImportPane=id;
        if(node!==oldBookImport)node.setAttribute('role','tabpanel');
      }
    }
    function choose(id) {
      const entry=entries.find(item=>item.id===id);
      if (!entry) return;
      view.dataset.bbImportSection=id;
      activate(buttons,id);
      intro.textContent=entry.description;
      for (const [pane,nodes] of panes) nodes.forEach(node=>
        setInactive(node,pane!==id));
      // A running import normally hides this details element. Its dedicated
      // subpage should remain available for status checks.
      if (id==='enrichment'&&extra) {
        extra.hidden=false;
        extra.open=true; // native toggle refreshes GET-only Brave status
      }
    }
    choose('books');
    view.dataset.bbWorkspacesReady='true';
    return true;
  }

  function installTasks() {
    const view=$('#admin-dashboard [data-admin-modern-view="tasks"]');
    const bookHost=view?.querySelector('#bb-admin-v31-tasks');
    const bookPanel=$('#book-import-followups-panel');
    if (!view||!bookHost||!bookPanel||!bookHost.contains(bookPanel))
      return false;
    if (view.dataset.bbWorkspacesReady==='true') return true;
    const accountLinks=view.querySelector('.bb-admin-v31-task-actions')?.closest('.bb-admin-v31-card');
    if(accountLinks)accountLinks.classList.add('bb-workspace-account-links');
    const teacherExit=view.querySelector('#teacher-exit-tasks-panel');
    const linkHost=make('section','bb-workspace-google-requests');
    linkHost.id='admin-staff-link-requests-host';
    // Keep the request card mounted permanently on the Accounts tab, even
    // when its asynchronous initial load ran before this navigation module.
    const existingLink=view.querySelector('#admin-staff-link-requests');
    if(existingLink)linkHost.append(existingLink);
    view.append(linkHost);

    const entries=[
      {id:'overview',label:'Overzicht',panel:'bb-workspace-task-overview'},
      {id:'physical',label:'Fysieke boeken',panel:'book-import-deferred-books',count:true},
      {id:'administration',label:'Administratie',panel:'book-import-assignment-tasks',count:true},
      {id:'classes',label:'Klascontroles',panel:'book-import-followups-list',count:true},
      {id:'accounts',label:'Accounts en vertrek',panel:'teacher-exit-tasks-panel'},
    ];
    const intro=make('p','bb-workspace-description');
    const {nav,buttons}=createNavigation(entries,'bb-task-workspace',choose);
    view.insertBefore(nav,bookHost);
    nav.after(intro);

    const overview=make('section','bb-workspace-task-overview');
    overview.id='bb-workspace-task-overview';
    overview.setAttribute('role','tabpanel');
    overview.setAttribute('aria-labelledby','bb-task-workspace-tab-overview');
    overview.append(make('h3','', 'Welke taken staan er open?'));
    overview.append(make('p','hint',
      'Boekcontroles zijn per soort verdeeld. Herhaalde boekmeldingen staan bij dezelfde editie. '
      +'Er wordt niets automatisch afgesloten of gewijzigd.'));
    const grid=make('div','bb-workspace-task-grid');
    const summaryNodes=new Map();
    for (const [id,title,description] of [
      ['physical','Fysieke boeken','Onduidelijke exemplaren of ISBN-uitgaven controleren.'],
      ['administration','Administratie','Uitleningen, vaste plekken en importconflicten beoordelen.'],
      ['classes','Klascontroles','Door een klas of mentor te bevestigen boekregistraties.'],
      ['accounts','Accounts en vertrek','Schoolaccounts, koppelingen en uitdiensttredingen.'],
    ]) {
      const link=make('button','bb-workspace-task-card');
      link.type='button';
      const top=make('span','bb-workspace-task-card-head');
      const label=make('strong','',title);
      const count=make('span','bb-workspace-task-card-count',id==='accounts'?'Openen':'0');
      top.append(label,count);
      link.append(top,make('span','bb-workspace-task-card-desc',description));
      link.addEventListener('click',()=>choose(id));
      grid.append(link);
      summaryNodes.set(id,count);
    }
    overview.append(grid);
    view.insertBefore(overview,bookHost);

    function counts() {
      const panel=$('#book-import-followups-panel');
      if(!panel)return;
      const physical=Number(panel.dataset.deferredBooksCount||0);
      const administration=Number(panel.dataset.deferredCount||0);
      const badge=Number($('#book-import-followups-badge')?.textContent||0);
      const classes=Math.max(0,badge-physical-administration);
      for(const [key,count] of Object.entries({physical,administration,classes})){
        const value=Number.isFinite(count)&&count>=0?count:0;
        setCount(buttons.get(key),value);
        if (summaryNodes.has(key)) summaryNodes.get(key).textContent=String(value);
      }
    }
    function choose(id) {
      const entry=entries.find(item=>item.id===id);
      if(!entry)return;
      view.dataset.bbTaskSection=id;
      activate(buttons,id);
      setInactive(overview,id!=='overview');
      setInactive(bookHost,id==='overview');
      setInactive(teacherExit,id!=='accounts');
      setInactive(accountLinks,id!=='accounts');
      setInactive(linkHost,id!=='accounts');
      const explanations={
        overview:'Kies het soort controle. Je ziet alleen de bijbehorende taken.',
        physical:'Controleer fysieke exemplaren. Gelijke edities blijven afzonderlijke taken.',
        administration:'Beoordeel uitleningen, locaties en niet herkende koppelingen.',
        classes:'Controles die horen bij boeken van een klas of mentor.',
        accounts:'Openstaande accountverzoeken en taken rond vertrekkende medewerkers of leerlingen.',
      };
      intro.textContent=explanations[id];
      counts();
    }
    // All three existing task modules own their own refresh cadence. Only
    // read their counters here; do not make a second batch of API requests.
    for(const event of ['boekenbaai:assignment-tasks-changed',
      'boekenbaai:deferred-books-changed','boekenbaai:staff-refresh'])
      window.addEventListener(event,counts);
    const badge=$('#book-import-followups-badge');
    if(badge)new MutationObserver(counts).observe(badge,{
      childList:true,characterData:true,subtree:true,
    });
    const panel=$('#book-import-followups-panel');
    if(panel)new MutationObserver(counts).observe(panel,{
      attributes:true,attributeFilter:['data-deferred-count','data-deferred-books-count'],
    });
    choose(location.hash==='#book-import-followups-panel'?'classes':'overview');
    view.dataset.bbWorkspacesReady='true';
    return true;
  }

  function installPageDescriptions() {
    const info={
      overview:'Actueel overzicht van de bibliotheek en acties die aandacht vragen.',
      books:'Zoek boeken, controleer uitgaven en beheer fysieke exemplaren.',
      people:'Beheer leerlingen en docenten in afzonderlijke overzichten.',
      classes:'Beheer klassen en de bijbehorende docentkoppelingen.',
      loans:'Registreer een nieuwe uitlening, controleer uitstaande boeken of corrigeer aantoonbaar foutieve historie.',
      settings:'Stel meldingen en beheerdersadressen in.',
    };
    for(const [section,text] of Object.entries(info)){
      const view=$('#admin-dashboard [data-admin-modern-view="'+section+'"]');
      const heading=view?.querySelector('.bb-admin-v31-heading');
      if(!heading||heading.querySelector('.bb-workspace-page-lead'))continue;
      const paragraph=make('p','bb-workspace-page-lead',text);
      heading.querySelector('div')?.append(paragraph);
    }
  }

  function install() {
    const admin=$('#admin-dashboard [data-admin-modern-view="imports"]');
    if(!admin)return false;
    installPageDescriptions();
    const tasksReady=installTasks();
    const importsReady=installImports();
    return tasksReady&&importsReady;
  }
  function start() {
    if(install())return;
    // Import controls and the admin view are initialized by existing modules.
    // Observe only until both are available, then stop to avoid DOM work loops.
    const observer=new MutationObserver(()=>{
      if(install())observer.disconnect();
    });
    observer.observe(document.getElementById('admin-dashboard')||document.body,{
      childList:true,subtree:true,
    });
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
