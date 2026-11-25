'use strict';

// Student reservation inbox and mentor readiness alerts. Personal queue data
// is fetched using either the active same-origin session cookie or a bearer
// token, and is never cached locally.
const page=document.body?.dataset.page;
const student=page==='student';
const host=document.querySelector(student?'#student-profile-view':'#teacher-dashboard');
if(host){
  const panel=document.createElement('section');
  panel.id='bb-reservations-panel';
  panel.className='panel bb-reservations-panel';
  panel.setAttribute('aria-label',student?'Mijn reserveringen':'Reserveringen voor leerlingen');
  panel.hidden=true;
  if(student){
    const title=document.getElementById('student-profile-title');
    title?.insertAdjacentElement('afterend',panel);
  }else{
    const header=host.querySelector('.panel__header');
    if(header)header.insertAdjacentElement('afterend',panel);
    else host.prepend(panel);
  }
  const heading=document.createElement('h3');
  heading.textContent=student?'Mijn reserveringen':'Boeken klaar voor leerlingen';
  panel.append(heading);
  const list=document.createElement('div');
  list.className='bb-reservations-list';
  list.setAttribute('aria-live','polite');
  panel.append(list);
  const configuredBase=(typeof import.meta !== 'undefined' && import.meta.env
    && (import.meta.env.BOEKENBAAI_PUBLIC_API_BASE || import.meta.env.VITE_BOEKENBAAI_API_BASE))||'';
  const apiBase=(window.BOEKENBAAI_API_BASE||configuredBase
    ||document.querySelector('meta[name="boekenbaai-api-base"]')?.content||'').trim();
  const apiUrl=route=>apiBase?apiBase.replace(/\/$/,'')+route:route;
  let inFlight=false;
  let generation=0;
  let queuedRefresh=false;
  const authHeaders=()=>{
    const token=localStorage.getItem('boekenbaai_token')||'';
    return token?{Authorization:'Bearer '+token}:{};
  };
  function clearPersonalData(){
    generation++;
    panel.hidden=true;
    list.replaceChildren();
  }
  function add(tag,text,parent=list,cls=''){
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    node.textContent=text;
    parent.append(node);
    return node;
  }
  function formatDate(date){
    const ts=Date.parse(date||'');
    return Number.isFinite(ts)?new Intl.DateTimeFormat('nl-NL',{
      dateStyle:'medium',timeStyle:'short',
    }).format(ts):'';
  }
  function render(rows){
    list.replaceChildren();
    if(!rows.length){panel.hidden=true;return;}
    panel.hidden=false;
    for(const item of rows){
      const card=document.createElement('article');
      card.className='bb-reservations-item';
      add('strong',item.title||'Onbekend boek',card);
      if(student){
        const ready=item.status==='ready';
        const label=ready
          ?'Beschikbaar! Dit boek ligt voor je klaar'+
            (item.expiresAt?' tot '+formatDate(item.expiresAt):'')+'.'
          :'Op wachtlijst'+(item.position?' (positie '+item.position+')':'')+'.';
        add('p',label,card,ready?'bb-reservations-ready':'bb-reservations-waiting');
        const actions=add('div','',card,'bb-reservations-actions');
        if(ready){
          const open=add('button','Bekijk in bibliotheek',actions,'btn btn--secondary');
          open.type='button';
          open.addEventListener('click',()=>{
            document.querySelector('#student-nav-library')?.click();
            const search=document.getElementById('search-input');
            if(search){search.value=item.title||'';
              search.dispatchEvent(new Event('input',{bubbles:true}));
              search.focus();}
          });
        }
        const cancel=add('button','Reservering annuleren',actions,'btn btn--ghost');
        cancel.type='button';
        cancel.addEventListener('click',async()=>{
          cancel.disabled=true;
          try{
            const response=await fetch(apiUrl('/api/book-reservations/'+encodeURIComponent(item.id)),{
              method:'DELETE',headers:authHeaders(),credentials:'same-origin',
            });
            if(!response.ok)throw Error((await response.json()).message||'Annuleren mislukt.');
            window.dispatchEvent(new Event('boekenbaai:reservations-changed'));
            await refresh();
          }catch(error){add('p',error.message||'Annuleren mislukt.',card);
          }finally{cancel.disabled=false;}
        });
      }else{
        add('p','Voor: '+(item.studentName||'leerling'),card);
        add('p','Gereed sinds '+formatDate(item.readyAt)+
          (item.expiresAt?' · Beschikbaar tot '+formatDate(item.expiresAt):''),
          card,'bb-reservations-ready');
      }
      list.append(card);
    }
  }
  async function refresh(){
    const requestGeneration=++generation;
    if(inFlight){queuedRefresh=true;return;}
    inFlight=true;
    const token=localStorage.getItem('boekenbaai_token')||'';
    try{
      const response=await fetch(apiUrl('/api/book-reservations'),{
        headers:authHeaders(),credentials:'same-origin',cache:'no-store',
      });
      if(requestGeneration!==generation
        ||(localStorage.getItem('boekenbaai_token')||'')!==token)return;
      if(!response.ok){
        if([401,403].includes(response.status))clearPersonalData();
        return;
      }
      const result=await response.json();
      // A user may have signed out or switched accounts while decoding JSON.
      if(requestGeneration!==generation
        ||(localStorage.getItem('boekenbaai_token')||'')!==token)return;
      render(student?(result.reservations||[]):(result.mentorAlerts||[]));
    }catch(_){ /* Keep the current user's message when the network is offline. */ }
    finally{
      inFlight=false;
      if(queuedRefresh){queuedRefresh=false;void refresh();}
    }
  }
  window.addEventListener('boekenbaai:student-auth-validated',()=>void refresh());
  window.addEventListener('boekenbaai:staff-refresh',()=>void refresh());
  window.addEventListener('boekenbaai:reservations-changed',()=>void refresh());
  window.addEventListener('boekenbaai:student-auth-pending',()=>{
    clearPersonalData();
  });
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{
    clearPersonalData();
  });
  window.addEventListener('storage',event=>{
    if(event.key==='boekenbaai_token'){clearPersonalData();void refresh();}
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refresh();
  });
  const interval=setInterval(()=>void refresh(),60_000);
  if(typeof interval.unref==='function')interval.unref();
  void refresh();
}
