'use strict';

// Admin-only physical book identity checks. These remain independent of
// the Excel file and of the deferred loan/class reconciliation queue.
const panel=document.getElementById('book-import-followups-panel');
const sibling=document.getElementById('book-import-assignment-tasks');
if(panel&&sibling){
  const host=document.createElement('section');
  host.id='book-import-deferred-books';
  sibling.after(host);
  const configured=(typeof import.meta!=='undefined'&&import.meta.env
    &&(import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      ||import.meta.env.VITE_BOEKENBAAI_API_BASE))||'';
  const prefix=(window.BOEKENBAAI_API_BASE||configured
    ||document.querySelector('meta[name="boekenbaai-api-base"]')?.content||'').trim();
  const api=p=>prefix?prefix.replace(/\/$/,'')+p:p;
  const root='/api/admin/book-import-book-tasks';
  let pending=false;
  let items=[];
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
    host.replaceChildren();
    panel.dataset.deferredBooksCount=String(items.length);
    window.dispatchEvent(new Event('boekenbaai:deferred-books-changed'));
    host.append(elem('h3','Boeken nog fysiek controleren'
      +(items.length?' ('+items.length+')':'')));
    host.append(elem('p','Controleer deze boeken later aan de hand van '
      +'het exemplaar op school. Een onduidelijk ISBN wordt niet automatisch '
      +'toegevoegd. Je kunt elke taak afzonderlijk afsluiten.', 'hint'));
    if(!items.length){
      host.append(elem('p','Geen openstaande fysieke boekcontroles.','hint'));
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
    for(const group of groups.values()){
      let destination=host;
      if(group.length>1){
        const container=elem('details',undefined,'bb-deferred-book-group');
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
      if(task.possibleExistingEdition)card.append(elem('p',
        'Een editie met dit ISBN en deze titel staat inmiddels in de collectie. '
        +'Controleer eerst of dit het bedoelde fysieke exemplaar is; '
        +'de oude taak is niet automatisch afgesloten.','hint'));
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
    items=[];render();
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refresh();
  });
  setInterval(()=>{
    if(!document.hidden&&!panel.classList.contains('hidden'))void refresh();
  },10000);
  void refresh();
}
