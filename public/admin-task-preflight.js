// A GET-only workspace. No correction or approval endpoint exists in this phase.
export function installTaskPreflight(parent) {
  const host = document.createElement('section');
  host.className = 'class-card';
  host.setAttribute('aria-label', 'Voorcontrole taakafhandeling');
  const heading = document.createElement('h3');
  heading.textContent = 'Voorcontrole taakafhandeling';
  const intro = document.createElement('p');
  intro.textContent = 'Bekijk wat veilig afsluitbaar lijkt, welke voorstellen klaarstaan en wat onderzoek vraagt. Deze controle wijzigt niets en start geen zoekopdrachten.';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn btn--secondary';
  button.textContent = 'Voorcontrole uitvoeren';
  const status = document.createElement('p'); status.setAttribute('role','status');
  const output = document.createElement('div');
  host.append(heading,intro,button,status,output); parent.append(host);
  let active = false, running = false, epoch = 0, lastFingerprint = '';
  const reasons = {physical_identity:'Identiteit van het fysieke boek nog niet vastgesteld', book_identity:'Identiteit van het boek nog niet vastgesteld', source_conflict:'Tegenstrijdige gegevens in de import', issue:'Een conflict in de oorspronkelijke import', loan:'Afwijkende uitleenregistratie', location:'Afwijkende vaste locatie', class_context:'Onduidelijke klaskoppeling', studentExitTasks:'Vertrek van een leerling', teacherExitTasks:'Vertrek van een docent'};
  const expanded = new Set();
  const configured = import.meta.env?.BOEKENBAAI_PUBLIC_API_BASE || import.meta.env?.VITE_BOEKENBAAI_API_BASE || '';
  const prefix = (window.BOEKENBAAI_API_BASE || configured || document.querySelector('meta[name="boekenbaai-api-base"]')?.content || '').trim().replace(/\/$/,'');
  const labels = {automatic_candidate:'Veilig afsluitbare doublures',proposal:'Voorstellen ter beoordeling',attention:'Aandacht of aanvullend onderzoek nodig'};
  const text = (tag, value) => {const node=document.createElement(tag);node.textContent=value;return node;};
  function render(data) {
    output.replaceChildren();
    output.append(text('p', `${data.summary.open} openstaande taken · ${data.summary.uniqueSourceEvents} meldingen na samenvoeging van dezelfde bron · 0 wijzigingen uitgevoerd.`));
    output.append(text('p','Herhaalde meldingen kunnen over verschillende exemplaren gaan. Een gelijk ISBN is geen bewijs van hetzelfde fysieke boek.'));
    for (const [category,label] of Object.entries(labels)) {
      const group=document.createElement('details'); group.open=expanded.has(category);
      group.append(text('summary',`${label} (${data.summary[category]})`));
      group.addEventListener('toggle',()=>{if(!group.isConnected)return; if(group.open)expanded.add(category);else expanded.delete(category);});
      for (const task of data.tasks.filter(t=>t.category===category)) {
        const card=document.createElement('article');card.className='class-card';
        card.append(text('h4', task.title),text('p',task.explanation));
        card.append(text('p',[task.source.fileName,task.source.worksheetRow ? `Rij ${task.source.worksheetRow}` : '',`Oorzaak: ${reasons[task.source.reason] || 'Conflict in de oorspronkelijke import'}`].filter(Boolean).join(' · ')));
        if (task.current.matchingEditionCount) card.append(text('p',`${task.current.matchingEditionCount} ${task.current.matchingEditionCount === 1 ? 'exemplaar' : 'exemplaren'} met overeenkomend ISBN, titel en auteur gevonden.`));
        if (task.proposedAction) card.append(text('p',`Voorstel: ${task.proposedAction}`));
        if (task.duplicateOf) card.append(text('p',`Te behouden taak: ${task.duplicateOf}`));
        const proof=document.createElement('details');proof.append(text('summary','Technische details van de beoordeling'));
        proof.append(text('p',`Regel: ${task.rule} · Taak: ${task.id} · Revisie: ${task.revision}`));
        const evidence=text('pre',JSON.stringify(task.evidence,null,2));
        evidence.style.whiteSpace='pre-wrap';evidence.style.overflowWrap='anywhere';
        proof.append(evidence);
        card.append(proof);group.append(card);
      }
      output.append(group);
    }
    output.append(text('p','Niet meegenomen: '+data.coverage.excluded.join(', ')+'.'));
    output.append(text('p','Automatische uitvoering staat uit. Iedere toekomstige correctie vereist eerst toestemming voor categorie en reikwijdte.'));
  }
  async function refresh() {
    if (!active || running || document.hidden || !host.getClientRects().length) return;
    const token=localStorage.getItem('boekenbaai_token');if(!token)return;
    const requestEpoch=epoch;running=true;button.disabled=true;status.textContent='Actuele taken en gegevens controleren…';
    try {
      const response=await fetch(prefix+'/api/admin/task-preflight',{headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store'});
      const data=await response.json();
      if(requestEpoch!==epoch||localStorage.getItem('boekenbaai_token')!==token)return;
      if(!response.ok)throw Error(data.message||'Voorcontrole niet beschikbaar.');
      if(data.fingerprint!==lastFingerprint){render(data);lastFingerprint=data.fingerprint;}
      status.textContent='Voorcontrole bijgewerkt. Geen gegevens gewijzigd.';
    } catch(error) {
      if(requestEpoch===epoch){lastFingerprint='';output.replaceChildren();status.textContent=error.message||'Voorcontrole mislukt.';}
    } finally {running=false;button.disabled=false;}
  }
  button.addEventListener('click',()=>{active=true;void refresh();});
  window.addEventListener('boekenbaai:staff-refresh',()=>void refresh());
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{epoch++;active=false;lastFingerprint='';output.replaceChildren();status.textContent='';expanded.clear();});
  document.addEventListener('visibilitychange',()=>void refresh());
  // Reassess against fresh state, without persisting decisions or approvals.
  setInterval(()=>void refresh(),15000);
}

function install() {
  const parent=document.getElementById('bb-workspace-task-overview');
  if(!parent)return false;
  installTaskPreflight(parent);return true;
}
if(!install()) {
  const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
  observer.observe(document.body,{childList:true,subtree:true});
}
