'use strict';

// Private admin tool; existing live loans are explicitly not affected.
const historyPanel=document.getElementById('history-panel');
if(historyPanel){
  const root=document.createElement('section');
  root.id='admin-loan-history-management';
  root.className='panel__content';
  root.hidden=true;
  historyPanel.append(root);
  const cfg=(typeof import.meta!=='undefined'&&import.meta.env
    &&(import.meta.env.BOEKENBAAI_PUBLIC_API_BASE
      ||import.meta.env.VITE_BOEKENBAAI_API_BASE))||'';
  const prefix=(window.BOEKENBAAI_API_BASE||cfg
    ||document.querySelector('meta[name="boekenbaai-api-base"]')?.content||'').trim();
  const endpoint=path=>prefix?prefix.replace(/\/$/,'')+path:path;
  const node=(tag,text,cls)=>{
    const x=document.createElement(tag);
    if(text!==undefined)x.textContent=text;
    if(cls)x.className=cls;
    return x;
  };
  async function request(path,method='GET',data){
    const token=localStorage.getItem('boekenbaai_token');
    if(!token)throw Error('Log opnieuw in.');
    const response=await fetch(endpoint(path),{
      method,headers:{
        Authorization:'Bearer '+token,Accept:'application/json',
        ...(data===undefined?{}:{'Content-Type':'application/json'}),
      },...(data===undefined?{}:{body:JSON.stringify(data)}),
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(result.message||'Leenhistorie kon niet worden verwerkt.');
      error.status=response.status;
      throw error;
    }
    return result;
  }
  const heading=node('h3','Leenhistorie beheren');
  const explanation=node('p',
    'Verwijder uitsluitend aantoonbaar foutieve historische uitleningen '
    +'en leesregistraties. Een actuele uitlening wordt niet gewijzigd. '
    +'Zelfstandig toegevoegde examenboeken blijven behouden.','hint');
  const form=node('form',undefined,'form-grid form-grid--compact');
  const student=node('input');
  student.type='search';student.placeholder='Zoek leerling';
  const book=node('input');
  book.type='search';book.placeholder='Zoek boek';
  const submit=node('button','Historie zoeken','btn btn--secondary');
  submit.type='submit';
  form.append(student,book,submit);
  const status=node('p','', 'hint');
  status.setAttribute('role','status');
  const results=node('div',undefined,'class-list');
  root.append(heading,explanation,form,status,results);
  let busy=false;
  async function find(){
    if(busy)return;
    busy=true;submit.disabled=true;
    results.replaceChildren();
    status.textContent='Leenhistorie ophalen…';
    try{
      const query=new URLSearchParams({
        student:student.value.trim(),book:book.value.trim(),
      });
      const data=await request('/api/admin/loan-history?'+query);
      const entries=Array.isArray(data.items)?data.items:[];
      status.textContent=entries.length+' historische combinaties gevonden.';
      for(const item of entries){
        const card=node('article',undefined,'class-card');
        card.append(node('h4',item.title));
        card.append(node('p',item.studentName+' · '+(item.author||'')
          +' · '+item.historyEvents+' uitleengebeurtenissen · '
          +item.importedPeriods+' geïmporteerde leenperiodes · '
          +item.readingRecords+' leesregistraties','hint'));
        if(item.activeLoan)card.append(node('p',
          'Dit boek is momenteel uitgeleend. De actuele uitlening blijft bestaan.',
          'hint'));
        const remove=node('button',
          'Foutieve leenhistorie verwijderen','btn btn--danger');
        remove.type='button';
        remove.addEventListener('click',async()=>{
          if(busy)return;
          if(!window.confirm(
            'Deze historische uitleningen EN leesregistraties worden '
            +'voor deze leerling en dit boek verwijderd. '
            +'Dit kan niet via de website ongedaan worden gemaakt. '
            +'De huidige uitlening blijft staan. Bevestigen?'))return;
          busy=true;remove.disabled=true;
          try{
            const outcome=await request('/api/admin/loan-history/remove',
              'POST',{studentId:item.studentId,bookId:item.bookId,
                expectedFingerprint:item.fingerprint,confirm:true});
            status.textContent=outcome.eventsRemoved+
              ' historische gebeurtenissen en '+outcome.readingRecordsRemoved+
              ' leesregistraties en '+outcome.importedPeriodsRemoved+
              ' geïmporteerde leenperiodes verwijderd. De actieve uitlening is ongewijzigd.';
            window.dispatchEvent(new Event('boekenbaai:loans-changed'));
            results.replaceChildren();
          }catch(error){status.textContent=error.message;}
          finally{busy=false;remove.disabled=false;}
        });
        card.append(remove);
        results.append(card);
      }
    }catch(error){
      if(error.status===403){root.hidden=true;return;}
      status.textContent=error.message;
    }finally{busy=false;submit.disabled=false;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();void find();});
  async function visibleForAdmin(){
    if(historyPanel.classList.contains('hidden')||
      !localStorage.getItem('boekenbaai_token'))return;
    try{
      const data=await request('/api/admin/loan-history?student=__none__');
      root.hidden=!Array.isArray(data.items);
    }catch(error){if(error.status===401||error.status===403)root.hidden=true;}
  }
  new MutationObserver(()=>void visibleForAdmin())
    .observe(historyPanel,{attributes:true,attributeFilter:['class']});
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{root.hidden=true;});
  void visibleForAdmin();
}
