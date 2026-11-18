'use strict';

// An active loan is not a completed loan period. Never simulate a return
// when correcting a false active assignment. Historical correction is
// available only for pupils in the currently assigned teacher classes.
const loanPanel=document.getElementById('staff-loan-panel');
if(loanPanel){
  const root=document.createElement('section');
  root.id='admin-loan-history-management';
  root.className='panel__content bb-admin-loan-history-card';
  root.hidden=true;
  loanPanel.append(root);

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
  const message=initial=>{
    const p=node('p',initial,'hint');
    p.setAttribute('role','status');
    return p;
  };
  const searchField=hint=>{
    const input=node('input');input.type='search';input.placeholder=hint;
    return input;
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
      const error=new Error(result.message||'De uitleenregistratie kon niet worden verwerkt.');
      error.status=response.status;
      throw error;
    }
    return result;
  }
  const announceChange=()=>{
    window.dispatchEvent(new Event('boekenbaai:loans-changed'));
    window.dispatchEvent(new Event('boekenbaai:staff-refresh'));
  };
  root.append(node('h3','Administratieve uitleencorrecties'));
  root.append(node('p','Kies hieronder eerst of de fout in de huidige uitlening '
    +'of in de leenhistorie zit. Dit zijn afzonderlijke registraties.','hint'));

  // Removing a wrong *current* link is administrator-only. The server
  // checks the exact physical copy, original borrower and a fresh revision.
  const currentSection=node('section',undefined,'bb-admin-loan-correction');
  currentSection.hidden=true; // Show only after the admin permission probe.
  const currentTitle=node('h4','Foutieve actuele uitlening corrigeren');
  const currentNote=node('p','Alleen voor beheerders. Verwijdert de onjuiste '
    +'actuele koppeling zonder een inlevering of leesantwoord vast te leggen. '
    +'Bestaande leenhistorie blijft ongewijzigd.','hint');
  const currentForm=node('form',undefined,'form-grid form-grid--compact');
  const currentBorrower=searchField('Zoek leerling of klas');
  const currentBook=searchField('Zoek boektitel');
  const currentSubmit=node('button','Actuele uitleningen zoeken','btn btn--secondary');
  currentSubmit.type='submit';
  currentForm.append(currentBorrower,currentBook,currentSubmit);
  const currentStatus=message('');
  const currentResults=node('div',undefined,'class-list');
  currentSection.append(currentTitle,currentNote,currentForm,currentStatus,currentResults);
  root.append(currentSection);

  let activeBusy=false;
  async function searchCurrent(){
    if(activeBusy)return;
    activeBusy=true;currentSubmit.disabled=true;
    currentStatus.textContent='Huidige uitleningen ophalen…';
    currentResults.replaceChildren();
    try{
      const query=new URLSearchParams({
        borrower:currentBorrower.value.trim(),book:currentBook.value.trim(),
      });
      const result=await request('/api/admin/loan-history/current?'+query);
      const items=Array.isArray(result.items)?result.items:[];
      currentStatus.textContent=items.length+' actuele uitleningen gevonden.';
      for(const loan of items){
        const card=node('article',undefined,'class-card');
        card.append(node('h4',loan.title||'Onbekend boek'));
        card.append(node('p','Aan '+loan.borrowerName+' · '+(loan.author||'')
          +' · Barcode: '+(loan.barcode||'niet geregistreerd')
          +' · Exemplaar-ID: '+loan.bookId,'hint'));
        const remove=node('button','Foutieve actuele uitlening verwijderen','btn btn--danger');
        remove.type='button';
        remove.addEventListener('click',async()=>{
          if(activeBusy)return;
          if(!window.confirm('Controleer deze specifieke koppeling:\n\n'
            +'Boek: '+loan.title+'\n'
            +'Lener: '+loan.borrowerName+'\n'
            +'Barcode: '+(loan.barcode||'niet geregistreerd')+'\n'
            +'Exemplaar-ID: '+loan.bookId+'\n\n'
            +'Alleen de foutieve HUIDIGE uitlening wordt verwijderd. '
            +'Dit is geen inlevering, maakt geen leesregistratie aan '
            +'en wijzigt bestaande historie niet. '
            +'Controleer zelf of het boek daadwerkelijk beschikbaar is. '
            +'Weet je zeker dat deze koppeling onjuist is?'))return;
          activeBusy=true;remove.disabled=true;
          try{
            const outcome=await request('/api/admin/loan-history/current/remove',
              'POST',{bookId:loan.bookId,borrowerId:loan.borrowerId,
                borrowerType:loan.borrowerType,
                expectedFingerprint:loan.fingerprint,confirm:true});
            if(!outcome.activeLoanRemoved)throw Error('De correctie is niet bevestigd.');
            currentStatus.textContent='De foutieve actuele koppeling is verwijderd. '
              +'Er is geen inlevering aangemaakt en de bestaande leenhistorie is behouden. '
              +'Controleer die historie apart als daar ook een oude fout in staat.';
            currentResults.replaceChildren();
            announceChange();
          }catch(error){currentStatus.textContent=error.message;}
          finally{activeBusy=false;remove.disabled=false;}
        });
        card.append(remove);
        currentResults.append(card);
      }
    }catch(error){
      if(error.status===403){currentSection.hidden=true;return;}
      currentStatus.textContent=error.message;
    }finally{activeBusy=false;currentSubmit.disabled=false;}
  }
  currentForm.addEventListener('submit',event=>{
    event.preventDefault();void searchCurrent();
  });

  // A false return immediately followed by a recheckout is NOT a
  // completed loan. This narrowly scoped admin workflow preserves the
  // initial checkout and active physical copy, unlike whole-pair deletion.
  const continuity=node('section',undefined,'bb-admin-loan-correction');
  continuity.append(node('h4','Foutieve inlevering en heruitlening corrigeren'));
  continuity.append(node('p','Gebruik dit alleen wanneer het boek nooit echt '
    +'is teruggebracht en dezelfde leerling hetzelfde exemplaar doorlopend '
    +'in bezit had. De oorspronkelijke uitlening blijft bestaan.','hint'));
  const continuityForm=node('form',undefined,'form-grid form-grid--compact');
  const continuityStudent=searchField('Zoek leerling');
  const continuityBook=searchField('Zoek boektitel');
  const continuitySubmit=node('button','Doorlopende uitleningen controleren','btn btn--secondary');
  continuitySubmit.type='submit';
  continuityForm.append(continuityStudent,continuityBook,continuitySubmit);
  const continuityStatus=message('');
  const continuityResults=node('div',undefined,'class-list');
  continuity.append(continuityForm,continuityStatus,continuityResults);
  currentSection.append(continuity);
  let continuityBusy=false;
  async function findContinuity(){
    if(continuityBusy)return;
    continuityBusy=true;continuitySubmit.disabled=true;
    continuityResults.replaceChildren();
    continuityStatus.textContent='Onjuiste leenreeksen controleren…';
    try{
      const query=new URLSearchParams({
        borrower:continuityStudent.value.trim(),book:continuityBook.value.trim(),
      });
      const data=await request('/api/admin/loan-history/continuity?'+query);
      const items=Array.isArray(data.items)?data.items:[];
      continuityStatus.textContent=items.length
        ?items.length+' mogelijk foutieve leenreeksen gevonden.'
        :'Geen veilig herkenbare leenreeks gevonden. Verwijder niet de volledige historie.';
      for(const item of items){
        const card=node('article',undefined,'class-card');
        const format=value=>new Date(value).toLocaleString('nl-NL');
        card.append(node('h4',item.title));
        card.append(node('p',item.studentName
          +' · Exemplaar-ID: '+item.bookId
          +' · Oorspronkelijk geleend: '+format(item.originalCheckoutAt)
          +' · Inlevering: '+format(item.incorrectReturnAt)
          +' · Opnieuw geleend: '+format(item.recheckoutAt),'hint'));
        const fix=node('button','Corrigeer deze foutieve inlevering en heruitlening',
          'btn btn--danger');
        fix.type='button';
        fix.addEventListener('click',async()=>{
          if(continuityBusy)return;
          if(!window.confirm('Controleer eerst de fysieke werkelijkheid.\\n\\n'
            +'Leerling: '+item.studentName+'\\nBoek: '+item.title
            +'\\nExemplaar-ID: '+item.bookId
            +'\\nInlevering: '+format(item.incorrectReturnAt)
            +'\\nNieuwe uitlening: '+format(item.recheckoutAt)
            +'\\n\\nBevestig alleen wanneer dit boek NOOIT echt is ingeleverd. '
            +'De twee logregels en de bijbehorende leesregistratie worden '
            +'verwijderd. De oorspronkelijke uitlening blijft actief. '
            +'Een aparte correctie-audit wordt bewaard. Doorgaan?'))return;
          continuityBusy=true;fix.disabled=true;
          try{
            const result=await request('/api/admin/loan-history/continuity/correct',
              'POST',{studentId:item.studentId,bookId:item.bookId,
                expectedFingerprint:item.fingerprint,
                reason:'false_return_and_recheckout',confirm:true});
            if(!result.originalLoanStillActive)throw Error('Correctie niet bevestigd.');
            continuityStatus.textContent='De onjuiste inlevering, heruitlening '
              +'en leesregistratie zijn gecorrigeerd. De oorspronkelijke '
              +'uitlening bleef actief.';
            continuityResults.replaceChildren();
            announceChange();
          }catch(error){continuityStatus.textContent=error.message;}
          finally{continuityBusy=false;fix.disabled=false;}
        });
        card.append(fix);continuityResults.append(card);
      }
    }catch(error){continuityStatus.textContent=error.message;}
    finally{continuityBusy=false;continuitySubmit.disabled=false;}
  }
  continuityForm.addEventListener('submit',event=>{
    event.preventDefault();void findContinuity();
  });

  // Teachers may review and remove false historical student/book links
  // only inside their own current class roster. Admins retain full access.
  const historySection=node('section',undefined,'bb-admin-loan-history');
  historySection.append(node('h4','Foutieve leenhistorie corrigeren'));
  historySection.append(node('p','Verwijder uitsluitend aantoonbaar onjuiste '
    +'historische uitleengebeurtenissen en leesregistraties. '
    +'Ook afgeleide examenleeslijstvermeldingen kunnen daardoor verdwijnen. '
    +'Actuele uitleningen veranderen nooit. Docenten zien alleen hun eigen leerlingen.',
    'hint'));
  const form=node('form',undefined,'form-grid form-grid--compact');
  const student=searchField('Zoek leerling');
  const book=searchField('Zoek boek');
  const submit=node('button','Historie zoeken','btn btn--secondary');
  submit.type='submit';
  form.append(student,book,submit);
  const status=message('');
  const results=node('div',undefined,'class-list');
  historySection.append(form,status,results);
  root.append(historySection);

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
          +item.readingRecords+' leesregistraties · '
          +item.examEntries+' examenleeslijstvermeldingen','hint'));
        if(item.activeLoan)card.append(node('p',
          'Dit boek is momenteel uitgeleend. De actuele uitlening blijft bestaan.',
          'hint'));
        const remove=node('button',
          'Foutieve leenhistorie verwijderen','btn btn--danger');
        remove.type='button';
        remove.addEventListener('click',async()=>{
          if(busy)return;
          if(!window.confirm(
            'Leerling: '+item.studentName+'\nBoek: '+item.title+'\n\n'
            +'Alle historische uitleningen EN leesregistraties voor deze '
            +'leerling en dit fysieke exemplaar worden verwijderd, '
            +'mogelijk inclusief automatisch gekoppelde examenleeslijstvermeldingen. '
            +'Dit kan niet via de website ongedaan worden gemaakt. '
            +'De huidige uitlening blijft staan. Weet je zeker dat deze historie foutief is?'
          ))return;
          busy=true;remove.disabled=true;
          try{
            const outcome=await request('/api/admin/loan-history/remove',
              'POST',{studentId:item.studentId,bookId:item.bookId,
                expectedFingerprint:item.fingerprint,confirm:true});
            status.textContent=outcome.eventsRemoved+
              ' historische gebeurtenissen en '+outcome.readingRecordsRemoved+
              ' leesregistraties en '+outcome.importedPeriodsRemoved+
              ' geïmporteerde leenperiodes en '+outcome.examEntriesRemoved+
              ' examenleeslijstvermeldingen verwijderd. De actuele uitlening bleef staan.';
            announceChange();
            results.replaceChildren();
          }catch(error){status.textContent=error.message;}
          finally{busy=false;remove.disabled=false;}
        });
        card.append(remove);
        results.append(card);
      }
    }catch(error){
      if(error.status===403){historySection.hidden=true;return;}
      status.textContent=error.message;
    }finally{busy=false;submit.disabled=false;}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();void find();
  });

  let checkSerial=0;
  async function visibleForStaff(){
    const serial=++checkSerial;
    if(loanPanel.classList.contains('hidden')
      ||!localStorage.getItem('boekenbaai_token')){
      root.hidden=true;
      return;
    }
    try{
      const data=await request('/api/admin/loan-history?student=__none__');
      if(serial!==checkSerial)return;
      root.hidden=!Array.isArray(data.items);
      if(root.hidden)return;
      try{
        const current=await request('/api/admin/loan-history/current?borrower=__none__');
        if(serial!==checkSerial)return;
        currentSection.hidden=!Array.isArray(current.items);
      }catch(error){
        if(serial!==checkSerial)return;
        currentSection.hidden=true;
      }
    }catch(error){
      if(serial===checkSerial)root.hidden=true;
    }
  }
  new MutationObserver(()=>void visibleForStaff())
    .observe(loanPanel,{attributes:true,attributeFilter:['class']});
  window.addEventListener('boekenbaai:staff-refresh',()=>void visibleForStaff());
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{
    checkSerial++;root.hidden=true;currentSection.hidden=true;
    currentResults.replaceChildren();results.replaceChildren();
    currentStatus.textContent='';status.textContent='';
  });
  void visibleForStaff();
}
