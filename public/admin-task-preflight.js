// Administrative preflight with explicitly approved, task-only duplicate cleanup.
// No metadata, loan, class, student, teacher or physical-book changes are sent.
export function installTaskPreflight(parent) {
  const host=document.createElement('section');
  host.className='class-card bb-task-preflight';
  host.setAttribute('aria-label','Voorcontrole taakafhandeling');
  const heading=document.createElement('h3');
  heading.textContent='Voorcontrole taakafhandeling';
  const intro=document.createElement('p');
  intro.textContent='Bekijk bestaande meldingen en hun bewijs. Alleen aantoonbaar dubbele meldingen over exact dezelfde Excelrij uit dezelfde import kunnen na jouw bevestiging worden afgesloten.';
  const button=document.createElement('button');
  button.type='button';button.className='btn btn--secondary';
  button.textContent='Voorcontrole uitvoeren';
  const selectAll=document.createElement('button');
  selectAll.type='button';selectAll.className='btn btn--ghost';
  selectAll.textContent='Selecteer veilige doublures';
  selectAll.hidden=true;
  const execute=document.createElement('button');
  execute.type='button';execute.className='btn btn--secondary';
  execute.textContent='Geselecteerde meldingen afsluiten';
  execute.hidden=true;execute.disabled=true;
  const controls=document.createElement('div');
  controls.className='bb-task-preflight__actions';
  controls.append(button,selectAll,execute);
  const status=document.createElement('p');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actionStatus=document.createElement('p');
  actionStatus.setAttribute('role','status');actionStatus.setAttribute('aria-live','assertive');
  const output=document.createElement('div');
  host.append(heading,intro,controls,status,actionStatus,output);
  parent.append(host);

  const MAX_BATCH=50;
  let active=false,running=false,executing=false,epoch=0,lastFingerprint='';
  let latest=null,pendingOperation=null;
  const selected=new Set(),expanded=new Set(['automatic_candidate']);
  const configured=import.meta.env?.BOEKENBAAI_PUBLIC_API_BASE
    ||import.meta.env?.VITE_BOEKENBAAI_API_BASE||'';
  const prefix=(window.BOEKENBAAI_API_BASE||configured
    ||document.querySelector('meta[name="boekenbaai-api-base"]')?.content||'')
    .trim().replace(/\/$/,'');
  const labels={
    automatic_candidate:'Aantoonbaar dubbele meldingen',
    proposal:'Voorstellen ter beoordeling',
    attention:'Aandacht of aanvullend onderzoek nodig',
  };
  const reasons={
    physical_identity:'Identiteit van het fysieke boek nog niet vastgesteld',
    book_identity:'Identiteit van het boek nog niet vastgesteld',
    source_conflict:'Tegenstrijdige gegevens in de import',
    issue:'Een conflict in de oorspronkelijke import',
    loan:'Afwijkende uitleenregistratie',
    location:'Afwijkende vaste locatie',
    class_context:'Onduidelijke klaskoppeling',
    studentExitTasks:'Vertrek van een leerling',
    teacherExitTasks:'Vertrek van een docent',
  };
  const text=(tag,value)=>{
    const node=document.createElement(tag);node.textContent=value;return node;
  };
  function candidates(data=latest) {
    return (data?.tasks||[]).filter(task=>task.family==='physical'
      &&task.category==='automatic_candidate'
      &&['duplicate_source_event','source_event_already_reviewed'].includes(task.rule));
  }
  function updateControls() {
    const eligible=candidates();
    const ids=new Set(eligible.map(task=>task.id));
    for(const id of selected)if(!ids.has(id))selected.delete(id);
    selectAll.hidden=!eligible.length;
    execute.hidden=!eligible.length;
    execute.disabled=!selected.size||running||executing;
    selectAll.disabled=running||executing;
    execute.textContent='Sluit '+selected.size+' geselecteerde '
      +(selected.size===1?'melding':'meldingen')+' af';
  }
  function render(data) {
    latest=data;
    const eligible=candidates(data);
    for(const id of selected)if(!eligible.some(task=>task.id===id))selected.delete(id);
    output.replaceChildren();
    output.append(text('p',data.summary.open+' openstaande meldingen · '
      +data.summary.uniqueSourceEvents+' brongebeurtenissen · '
      +data.summary.automaticallyResolved+' eerder veilig afgesloten.'));
    output.append(text('p',
      'Een gelijk ISBN bewijst niet dat twee fysieke exemplaren hetzelfde zijn. '
      +'Alleen exact dezelfde bronmelding uit dezelfde import kan hier worden '
      +'afgesloten. De oorspronkelijke controle blijft bestaan.'));
    for(const [category,label] of Object.entries(labels)){
      const group=document.createElement('details');
      group.open=expanded.has(category);
      group.addEventListener('toggle',()=>{
        if(!group.isConnected)return;
        if(group.open)expanded.add(category);else expanded.delete(category);
      });
      group.append(text('summary',label+' ('+data.summary[category]+')'));
      for(const task of data.tasks.filter(item=>item.category===category)){
        const card=document.createElement('article');card.className='class-card';
        card.append(text('h4',task.title),text('p',task.explanation));
        card.append(text('p',[task.source.fileName,
          task.source.worksheetRow?'Rij '+task.source.worksheetRow:'',
          'Oorzaak: '+(reasons[task.source.reason]||'Conflict in de oorspronkelijke import'),
        ].filter(Boolean).join(' · ')));
        if(task.current.matchingEditionCount)card.append(text('p',
          task.current.matchingEditionCount+' '+(task.current.matchingEditionCount===1
            ?'overeenkomend exemplaar':'overeenkomende exemplaren')+' gevonden.'));
        if(task.proposedAction)card.append(text('p','Voorstel: '+task.proposedAction));
        if(task.duplicateOf)card.append(text('p','Te behouden melding: '+task.duplicateOf));
        if(category==='automatic_candidate'&&task.family==='physical'){
          const labelNode=document.createElement('label');
          labelNode.className='bb-task-preflight__choice';
          const checkbox=document.createElement('input');checkbox.type='checkbox';
          checkbox.checked=selected.has(task.id);
          checkbox.addEventListener('change',()=>{
            if(checkbox.checked&&selected.size>=MAX_BATCH){
              checkbox.checked=false;
              actionStatus.textContent='Maximaal '+MAX_BATCH
                +' meldingen per bewerking. Sluit eerst de geselecteerde meldingen af.';
              return;
            }
            if(checkbox.checked)selected.add(task.id);else selected.delete(task.id);
            pendingOperation=null;
            updateControls();
          });
          labelNode.append(checkbox,text('span','Alleen deze extra melding afsluiten'));
          card.append(labelNode);
        }
        const proof=document.createElement('details');
        proof.append(text('summary','Bewijs en technische details'));
        proof.append(text('p','Regel: '+task.rule+' · Taak: '+task.id
          +' · Revisie: '+task.revision));
        const evidence=text('pre',JSON.stringify(task.evidence,null,2));
        evidence.style.whiteSpace='pre-wrap';evidence.style.overflowWrap='anywhere';
        proof.append(evidence);card.append(proof);group.append(card);
      }
      output.append(group);
    }
    if(data.recentAutoResolutions?.length){
      const history=document.createElement('details');
      history.append(text('summary','Recent veilig afgesloten ('
        +data.summary.automaticallyResolved+' totaal)'));
      for(const item of data.recentAutoResolutions){
        history.append(text('p',(item.at||'Onbekende datum')+' · Melding '
          +item.taskId+' · oorspronkelijke taak '+item.retainedTaskId));
      }
      output.append(history);
    }
    output.append(text('p','Nog niet meegenomen: '
      +data.coverage.excluded.join(', ')+'.'));
    output.append(text('p',
      'Deze voorcontrole verandert niets. Uitleningen, boeken en personen worden '
      +'ook bij bevestiging nooit door deze functie aangepast.'));
    updateControls();
  }

  async function refresh() {
    if(!active||running||executing||document.hidden||!host.getClientRects().length)return;
    const token=localStorage.getItem('boekenbaai_token');if(!token)return;
    const requestEpoch=epoch;running=true;
    button.disabled=true;status.textContent='Actuele taken en gegevens controleren…';
    try{
      const response=await fetch(prefix+'/api/admin/task-preflight',{
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        cache:'no-store',
      });
      const data=await response.json();
      if(requestEpoch!==epoch||localStorage.getItem('boekenbaai_token')!==token)return;
      if(!response.ok)throw Error(data.message||'Voorcontrole niet beschikbaar.');
      if(data.fingerprint!==lastFingerprint){
        pendingOperation=null;
        render(data);
        lastFingerprint=data.fingerprint;
      }
      status.textContent='Voorcontrole bijgewerkt. Deze controle zelf heeft geen gegevens gewijzigd.';
    }catch(error){
      if(requestEpoch===epoch){
        lastFingerprint='';latest=null;output.replaceChildren();
        status.textContent=error.message||'Voorcontrole mislukt.';
      }
    }finally{
      running=false;button.disabled=false;updateControls();
    }
  }

  selectAll.addEventListener('click',()=>{
    const eligible=candidates();
    if(selected.size===eligible.length)selected.clear();
    else {
      // Replace the selection: never exceed the same 50-task cap as the server.
      selected.clear();
      for(const task of eligible.slice(0,MAX_BATCH))selected.add(task.id);
    }
    pendingOperation=null;
    if(latest)render(latest);
  });
  execute.addEventListener('click',async()=>{
    if(executing||running||!latest||!selected.size)return;
    const allowed=candidates().filter(task=>selected.has(task.id));
    if(allowed.length!==selected.size)return;
    if(!window.confirm('Je sluit '+allowed.length+' aantoonbaar dubbele bron'
      +(allowed.length===1?'melding':'meldingen')
      +' af. De oorspronkelijke melding, het fysieke boek en de uitleningen '
      +'blijven behouden. Doorgaan?'))return;
    const token=localStorage.getItem('boekenbaai_token');
    if(!token)return;
    const requestEpoch=epoch;
    const signature=JSON.stringify([latest.fingerprint,
      allowed.map(task=>[task.id,task.revision]).sort()]);
    if(!pendingOperation||pendingOperation.signature!==signature){
      pendingOperation={signature,payload:{
        scope:'verified_source_notification_duplicate',confirm:true,
        confirmation:'close_verified_duplicate_notifications',
        fingerprint:latest.fingerprint,operationId:crypto.randomUUID(),
        taskIds:allowed.map(task=>task.id),
        revisions:allowed.map(task=>({id:task.id,revision:task.revision})),
      }};
    }
    executing=true;updateControls();
    actionStatus.textContent='Geselecteerde meldingen worden opnieuw gecontroleerd…';
    try{
      const response=await fetch(prefix+'/api/admin/task-preflight/execute',{
        method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/json',
          'Content-Type':'application/json'},
        body:JSON.stringify(pendingOperation.payload),cache:'no-store',
      });
      const data=await response.json();
      if(requestEpoch!==epoch||localStorage.getItem('boekenbaai_token')!==token)return;
      if(!response.ok)throw Error(data.message||'Afsluiting niet toegestaan.');
      actionStatus.textContent=data.closed+' '+(data.closed===1
        ?'melding veilig afgesloten.':'meldingen veilig afgesloten.')
        +' De oorspronkelijke boekgegevens zijn behouden.';
      selected.clear();pendingOperation=null;lastFingerprint='';
      // The existing task modules own their refresh. Notify them after the
      // committed task-only change so the menu/dashboard counters stay fresh.
      window.dispatchEvent(new Event('boekenbaai:staff-refresh'));
    }catch(error){
      if(requestEpoch===epoch)actionStatus.textContent=
        (error.message||'Afsluiting mislukt.')
        +' Controleer de voorcontrole; bij een verbindingsfout kan dezelfde '
        +'bewerking veilig opnieuw worden geprobeerd.';
    }finally{
      executing=false;updateControls();
      if(lastFingerprint===''&&requestEpoch===epoch)void refresh();
    }
  });
  button.addEventListener('click',()=>{active=true;void refresh();});
  window.addEventListener('boekenbaai:staff-refresh',()=>void refresh());
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{
    epoch++;active=false;lastFingerprint='';latest=null;
    selected.clear();pendingOperation=null;output.replaceChildren();
    status.textContent='';actionStatus.textContent='';expanded.clear();
    updateControls();
  });
  document.addEventListener('visibilitychange',()=>void refresh());
  setInterval(()=>void refresh(),15000);
}
function install(){
  const parent=document.getElementById('bb-workspace-task-overview');
  if(!parent)return false;
  installTaskPreflight(parent);return true;
}
if(!install()){
  const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
  observer.observe(document.body,{childList:true,subtree:true});
}
