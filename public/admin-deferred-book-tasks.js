'use strict';

// Admin-only physical book identity checks. These remain independent of
// the Excel file and of the deferred loan/class reconciliation queue.
const panel=document.getElementById('book-import-followups-panel');
const sibling=document.getElementById('book-import-assignment-tasks');
if(panel&&sibling){
  const host=document.createElement('section');
  host.id='book-import-deferred-books';
  sibling.after(host);
  const historyHost=document.createElement('section');
  historyHost.id='book-import-completed-history';
  // Keep the history inside the same task workspace panel as the open list.
  const configured=(typeof import.meta!=='undefined'&&import.meta.env
    &&(import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      ||import.meta.env.VITE_BOEKENBAAI_API_BASE))||'';
  const prefix=(window.BOEKENBAAI_API_BASE||configured
    ||document.querySelector('meta[name="boekenbaai-api-base"]')?.content||'').trim();
  const api=p=>prefix?prefix.replace(/\/$/,'')+p:p;
  const root='/api/admin/book-import-book-tasks';
  let pending=false;
  let items=[];
  let recentResolutions=[];
  let historyExpanded=false;
  // The queue refreshes every ten seconds. Preserve the administrator's
  // expanded edition groups while new task data is rendered.
  const expandedGroups=new Set();
  // Keep unfinished administrative evidence even when the ten-second status
  // poll rebuilds the cards. A revised/closed task never reuses a stale draft.
  const administrativeDrafts=new Map();
  function elem(tag,label,cls){
    const node=document.createElement(tag);
    if(label!==undefined)node.textContent=label;
    if(cls)node.className=cls;
    return node;
  }
  async function request(path,method='GET',body){
    const token=localStorage.getItem('boekenbaai_token');
    if(!token)throw Error('Meld je opnieuw aan.');
    const response=await fetch(api(path),{
      method,headers:{Authorization:'Bearer '+token,
        Accept:'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.message||'Controle niet beschikbaar.');
    return data;
  }
  function render(){
    const current=new Set(items.map(task=>task.id+':'+task.revision));
    for(const [id,draft] of administrativeDrafts)
      if(!current.has(id+':'+draft.revision))administrativeDrafts.delete(id);
    host.replaceChildren();
    historyHost.replaceChildren();
    if(recentResolutions.length){
      const history=elem('details',undefined,'bb-deferred-book-history');
      history.open=historyExpanded;
      history.addEventListener('toggle',()=>{historyExpanded=history.open;});
      history.append(elem('summary',
        'Recent afgehandelde boek- en importmeldingen ('+recentResolutions.length+')'));
      for(const record of recentResolutions){
        const row=elem('article',undefined,'class-card');
        row.append(elem('h4',record.title||'Onbekend boek'));
        const action=record.resolution==='administrative_done'
          ?'Administratief opgelost'
          :record.resolution==='manual_done'
          ?'Fysiek gecontroleerd':'Automatisch herbeoordeeld';
        row.append(elem('p',[action,
          record.fileName?'Import: '+record.fileName:'',
          record.worksheetRow?'Excelrij: '+record.worksheetRow:'',
          record.bookId?'Exemplaar-ID: '+record.bookId:'',
          record.completedAt?'Afgehandeld: '+record.completedAt:'',
        ].filter(Boolean).join(' · '),'hint'));
        if(record.evidenceNote)
          row.append(elem('p','Onderbouwing: '+record.evidenceNote,'hint'));
        if(record.proofReportId)
          row.append(elem('p','Bewezen met import '+record.proofReportId,'hint'));
        history.append(row);
      }
      historyHost.append(history);
    }
    panel.dataset.deferredBooksCount=String(items.length);
    window.dispatchEvent(new Event('boekenbaai:deferred-books-changed'));
    host.append(elem('h3','Openstaande boek- en importcontroles'
      +(items.length?' ('+items.length+')':'')));
    host.append(historyHost);
    host.append(elem('p','Niet iedere openstaande importmelding vereist een fysieke controle. '
      +'Je kunt aantoonbaar opgeloste verschillen administratief afhandelen; '
      +'onzekere exemplaren blijven open. Er worden geen boek- of uitleengegevens '
      +'gewijzigd bij het afsluiten van een melding.', 'hint'));
    if(!items.length){
      host.append(elem('p','Geen openstaande boek- of importcontroles.','hint'));
      return;
    }
    // Group repeat reports for the same edition rather than showing 29
    // indistinguishable cards. Keep each source record and its own action:
    // identical editions are not necessarily identical physical copies.
    const groups=new Map();
    for(const task of items){
      const key=task.sameEditionGroup||task.id;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(task);
    }
    const repeated=[...groups.values()].reduce((total,group)=>
      total+Math.max(0,group.length-1),0);
    if(repeated)host.append(elem('p',
      repeated+' herhaalde controles voor dezelfde editie gegroepeerd. '
      +'Dit betekent niet dat de fysieke exemplaren gelijk zijn.','hint'));
    // Drop keys for closed/completed groups; do not accumulate stale state.
    for(const key of expandedGroups)if(!groups.has(key))expandedGroups.delete(key);
    for(const [groupKey,group] of groups){
      let destination=host;
      if(group.length>1){
        const container=elem('details',undefined,'bb-deferred-book-group');
        // Assign before the event handler to avoid the initial open toggle
        // being mistaken for a user-initiated close.
        container.open=expandedGroups.has(groupKey);
        container.addEventListener('toggle',()=>{
          if(container.open)expandedGroups.add(groupKey);
          else expandedGroups.delete(groupKey);
        });
        const summary=elem('summary',
          (group[0].title||'Onbekend boek')+' · '+group.length
          +' controles uit imports');
        container.append(summary);
        host.append(container);
        destination=container;
      }
      for(const task of group){
      const card=elem('article',undefined,'class-card');
      card.append(elem('h4',task.title||'Onbekend boek'));
      card.append(elem('p',[
        task.author||'',task.excelIdentifier
          ?'Excelnummer: '+task.excelIdentifier:'',
        task.editionIsbn?'ISBN: '+task.editionIsbn:'',
        task.fileName?'Import: '+task.fileName:'',
        'Excelrij: '+task.worksheetRow,
      ].filter(Boolean).join(' · '),'hint'));
      const button=elem('button','Fysiek gecontroleerd, taak afronden',
        'btn btn--secondary');
      button.type='button';
      button.disabled=pending;
      button.addEventListener('click',async()=>{
        if(pending||!window.confirm(
          'Heb je dit boek daadwerkelijk gecontroleerd en de juiste '
          +'gegevens zo nodig onder Boeken aangepast? '
          +'Hiermee wordt alleen de taak afgesloten.'))return;
        pending=true;
        try{
          await request(root+'/'+encodeURIComponent(task.id)+'/resolve',
            'POST',{revision:task.revision,choice:'manual_done'});
          pending=false;
          window.dispatchEvent(new Event('boekenbaai:book-task-resolved'));
          await refresh();
        }catch(error){
          const message=elem('p',error.message,'hint');
          card.append(message);
        }finally{pending=false;}
      });
      const books=elem('button','Boeken openen','btn btn--ghost');
      books.type='button';
      books.addEventListener('click',()=>{
        document.querySelector('[data-admin-modern-tab="books"]')?.click();
      });
      if(task.newerImport){
        const last=task.newerImport;
        const date=String(last.at||'').slice(0,10);
        const evidence=last.authorConfirmed&&last.sourceIdentifierConfirmed
          ?'De latere import herkent dezelfde brongegevens.'
          :'De latere import heeft een rij met deze titel; de oorspronkelijke '
            +'identiteit is nog niet bevestigd.';
        card.append(elem('p','Latere import '+date
          +' · resultaat: '+String(last.rowStatus||'onbekend')+'. '
          +evidence+' Dit is geen bewijs van een fysiek exemplaar of '
          +'uitlening en sluit de oude taak niet automatisch af.','hint'));
      }
      if(task.possibleExistingEdition)card.append(elem('p',
        'Een editie met dit ISBN en deze titel staat inmiddels in de collectie. '
        +'Controleer eerst of dit het bedoelde fysieke exemplaar is; '
        +'de oude taak is niet automatisch afgesloten.','hint'));
      // Administrative resolution is explicitly different from observing a
      // physical copy. The server verifies the selected current catalogue ID,
      // revision, title/author identity and (when known) exact edition ISBN.
      if(Array.isArray(task.catalogCandidates)&&task.catalogCandidates.length){
        const adminDetails=elem('details',undefined,'bb-deferred-administrative');
        const draft=administrativeDrafts.get(task.id) || {
          revision:task.revision,bookId:'',manualId:'',reason:'',
          evidenceNote:'',expanded:false,
        };
        adminDetails.open=draft.expanded===true;
        // Preserve typed values immediately; render() runs repeatedly.
        const saveDraft=()=>administrativeDrafts.set(task.id,{
          revision:task.revision,
          bookId:copySelect.value,manualId:manualId?.value||'',
          reason:reasonSelect.value,evidenceNote:note.value,
          expanded:adminDetails.open,
        });
        adminDetails.addEventListener('toggle',saveDraft);
        adminDetails.append(elem('summary',
          'Administratief opgelost via bestaande registratie'));
        adminDetails.append(elem('p',
          'Gebruik dit alleen als de oorspronkelijke Excelrij en het juiste '
          +'bestaande exemplaar aantoonbaar zijn gekoppeld. Bij meerdere '
          +'exemplaren moet ook de hoeveelheid en uitlening zijn gecontroleerd. '
          +'Dit legt geen fysieke controle vast.','hint'));
        const copySelect=elem('select');
        copySelect.setAttribute('aria-label','Gekoppeld bestaand exemplaar');
        const empty=elem('option','Kies het gecontroleerde exemplaar');
        empty.value='';copySelect.append(empty);
        for(const copy of task.catalogCandidates){
          const option=elem('option',[copy.title,copy.publisher,
            copy.isbn?'ISBN '+copy.isbn:'',
            copy.barcode?'barcode '+copy.barcode:'',
            copy.matchReason==='source_barcode_exact'?'Excelbarcode herkend':'',
            copy.authorMatches===false?'Auteur nog vergelijken':'',
            'ID '+copy.id].filter(Boolean).join(' · '));
          option.value=copy.id;copySelect.append(option);
        }
        copySelect.value=draft.bookId||'';
        copySelect.addEventListener('change',saveDraft);
        let manualId=null;
        if(task.catalogCandidateCount>task.catalogCandidates.length){
          adminDetails.append(elem('p','Er zijn meer dan 20 passende exemplaren. '
            +'Vul voor een niet-getoond exemplaar het exacte ID in dat je '
            +'onder Boeken hebt gecontroleerd. De server verifieert dat ID.', 'hint'));
          manualId=elem('input');
          manualId.type='text';manualId.maxLength=128;
          manualId.placeholder='Exact exemplaar-ID uit Boeken (indien niet in lijst)';
          manualId.setAttribute('aria-label','Handmatig gecontroleerd exemplaar-ID');
          manualId.value=draft.manualId||'';
          manualId.addEventListener('input',saveDraft);
          adminDetails.append(manualId);
        }
        const reasonSelect=elem('select');
        reasonSelect.setAttribute('aria-label','Reden administratieve afhandeling');
        for(const [value,label] of [
          ['','Kies een reden'],
          ['catalog_registration_verified','Bestaande registratie bevestigd'],
          ['source_identifier_corrected','Afwijkend Excelnummer verklaard'],
          ['earlier_import_reconciled','Eerdere import al verwerkt'],
        ]){
          const option=elem('option',label);option.value=value;
          reasonSelect.append(option);
        }
        reasonSelect.value=draft.reason||'';
        reasonSelect.addEventListener('change',saveDraft);
        const note=elem('textarea');
        note.rows=3;note.maxLength=800;
        note.placeholder='Welk bewijs uit Excel, importverslag of boekgegevens '
          +'bevestigt dit exemplaar? Vermeld bij meerdere exemplaren de telling.';
        note.setAttribute('aria-label','Onderbouwing administratieve afhandeling');
        note.value=draft.evidenceNote||'';
        note.addEventListener('input',saveDraft);
        const closeAdmin=elem('button','Administratief afhandelen',
          'btn btn--secondary');
        closeAdmin.type='button';closeAdmin.disabled=pending;
        closeAdmin.addEventListener('click',async()=>{
          const evidenceNote=note.value.trim();
          const bookId=(manualId?.value||'').trim()||copySelect.value;
          if(pending||!bookId||!reasonSelect.value||evidenceNote.length<20){
            card.append(elem('p','Kies een exemplaar en reden, en geef een '
              +'onderbouwing van minimaal 20 tekens.','hint'));return;
          }
          if(!window.confirm('Is deze Excelrij aantoonbaar met het gekozen '
            +'exemplaar vergeleken en is ook een eventuele dubbele of '
            +'uitgeleende registratie nagekeken? Alleen de taak wordt '
            +'administratief afgesloten; er is geen fysieke controle vastgelegd.'))
            return;
          pending=true;closeAdmin.disabled=true;
          try{
            await request(root+'/'+encodeURIComponent(task.id)+'/resolve',
              'POST',{revision:task.revision,choice:'administrative_done',
                bookId,reason:reasonSelect.value,
                evidenceNote,confirmed:true});
            pending=false;
            window.dispatchEvent(new Event('boekenbaai:book-task-resolved'));
            await refresh();
          }catch(error){card.append(elem('p',error.message,'hint'));}
          finally{pending=false;closeAdmin.disabled=false;}
        });
        adminDetails.append(copySelect,reasonSelect,note,closeAdmin);
        card.append(adminDetails);
      }
            card.append(button,books);
      destination.append(card);
      }
    }
  }
  async function refresh(){
    if(panel.classList.contains('hidden')||!localStorage.getItem('boekenbaai_token'))
      return;
    try{
      const result=await request(root);
      items=Array.isArray(result.tasks)?result.tasks:[];
      recentResolutions=Array.isArray(result.recentResolutions)
        ?result.recentResolutions:[];
      render();
    }catch(error){
      if(error.message==='Meld je opnieuw aan.')return;
    }
  }
  new MutationObserver(()=>{
    if(!panel.classList.contains('hidden'))void refresh();
  }).observe(panel,{attributes:true,attributeFilter:['class']});
  window.addEventListener('boekenbaai:staff-refresh',refresh);
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{
    items=[];recentResolutions=[];
    expandedGroups.clear();administrativeDrafts.clear();render();
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refresh();
  });
  setInterval(()=>{
    if(!document.hidden&&!panel.classList.contains('hidden'))void refresh();
  },10000);
  void refresh();
}
