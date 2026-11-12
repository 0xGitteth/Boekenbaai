(function choiceChat() {
  'use strict';
  const button=document.getElementById('student-help-choose');
  const dialog=document.getElementById('student-choice-dialog');
  const log=document.getElementById('student-choice-chat-log');
  const actions=document.getElementById('student-choice-chat-actions');
  const status=document.getElementById('student-choice-chat-status');
  const closeButton=document.getElementById('student-choice-close');
  if(!button||!dialog||!log||!actions||!status||!closeButton)return;

  const seenInTab=new Set();
  let active=false,epoch=0,grant='',personal=false,firstName='',previousFocus=null;
  let choices={},currentStep='',busy=false,shownInDialogue=new Set(),seed='';
  let lastBooks=[],detailHandoff=false,searchController=null,searchTimer=null;
  const el=(tag,className,text)=>{
    const x=document.createElement(tag);
    if(className)x.className=className;
    if(text!==undefined)x.textContent=String(text);
    return x;
  };
  const normalized=x=>String(x||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('nl-NL');
  function apiUrl(route){
    if(typeof window.BoekenbaaiResolveApiUrl==='function')return window.BoekenbaaiResolveApiUrl(route);
    const base=String(window.BOEKENBAAI_API_BASE||'').trim().replace(/\/$/,'');
    return base+route;
  }
  function token(){
    try{return window.localStorage.getItem('boekenbaai_token')||'';}catch(_){return '';}
  }
  async function api(path,body,signal){
    const userToken=token();
    const headers={Accept:'application/json'};
    if(userToken && userToken!=='cookie')headers.Authorization='Bearer '+userToken;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(apiUrl(path),{
      method:body===undefined?'GET':'POST',credentials:'same-origin',
      signal,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=Error(data.message||'Er is iets misgegaan.');
      error.status=response.status;
      throw error;
    }
    return data;
  }
  function clearActions(){actions.replaceChildren();}
  function message(text,who='assistant'){
    const row=el('div','bb-choice-chat__row bb-choice-chat__row--'+who);
    const bubble=el('div','bb-choice-chat__bubble',text);
    row.append(bubble);log.append(row);
    log.scrollTop=log.scrollHeight;
    return bubble;
  }
  function notice(text){status.textContent=text||'';}
  function options(items){
    clearActions();
    for(const [label,callback] of items){
      const x=el('button','bb-choice-chat__option',label);
      x.type='button';
      x.addEventListener('click',()=>{
        if(!active||busy)return;
        message(label,'student');
        clearActions();
        notice('');
        callback();
      });
      actions.append(x);
    }
    actions.querySelector('button')?.focus();
  }
  function username(data){
    const raw=String(data?.firstName||data?.name||'').normalize('NFKC').trim();
    return raw.split(/\s+/)[0].slice(0,60);
  }
  function resetSession(){
    epoch++;
    clearTimeout(searchTimer);
    searchController?.abort();
    searchController=null;searchTimer=null;
    active=false;busy=false;personal=false;firstName='';
    const oldGrant=grant;
    grant='';currentStep='';choices={};lastBooks=[];detailHandoff=false;
    shownInDialogue=new Set();
    if(oldGrant){
      // Invalidate on the server as well as forgetting the token in memory.
      api('/api/auth/student-pin/choice-end',{choiceGrant:oldGrant}).catch(()=>{});
    }
    log.replaceChildren();clearActions();notice('');
  }
  function beginInterests(){
    if(!personal){
      answer('route','new');
      return;
    }
    // Let the learner decide whether past reading is relevant, rather than
    // interpreting every finished book as a book they enjoyed.
    message('Wil je ook tips die lijken op boeken die je eerder hebt gelezen?');
    options([
      ['Ja, graag',()=>answer('route','similar')],
      ['Nee, liever iets anders',()=>answer('route','new')],
    ]);
  }
  function finishIdentity(){
    message((personal&&firstName ? 'Hoi '+firstName+'! ' : '') +
      'Wil je zelf ontdekken wat je leuk vindt, of zal ik je 3 boeken voorstellen?');
    currentStep='route';
    options([
      ['Ontdek mijn interesses',beginInterests],
      ['Laat me drie boeken zien',()=>answer('route','surprise')],
    ]);
  }
  async function begin(){
    previousFocus=document.activeElement;
    resetSession();
    active=true;seed=Math.random().toString(36).slice(2)+Date.now().toString(36);
    dialog.showModal();
    notice('Controleren of je al ingelogd bent…');
    const marker=epoch;
    try{
      const me=await api('/api/me');
      if(!active||marker!==epoch)return;
      if(me?.role==='student'&&me.id){
        personal=true;firstName=username(me);
        notice('');
        finishIdentity();
        return;
      }
    }catch(_){/* Invalid/guest sessions never inherit personal data. */}
    if(!active||marker!==epoch)return;
    notice('');
    message('Hoi! Ik help je een boek te vinden. Log in voor persoonlijke tips, of ga zonder inloggen verder.');
    options([
      ['Inloggen',showPin],
      ['Zonder inloggen',()=>{personal=false;finishIdentity();}],
    ]);
  }
  function showPin(){
    currentStep='pin';
    message('Zoek je naam en vul je PIN in.');
    const form=el('form','bb-choice-chat__pin');
    form.autocomplete='off';
    const label=el('label','','Jouw naam');
    const name=el('input');
    name.type='search';name.required=true;name.autocomplete='off';
    name.placeholder='Typ minimaal 3 letters';
    name.setAttribute('aria-label','Zoek jouw naam');
    name.setAttribute('aria-expanded','false');
    const matches=el('ul','bb-choice-chat__matches');
    const pinLabel=el('label','','PIN (6 cijfers)');
    const pin=el('input');
    pin.type='password';pin.inputMode='numeric';pin.autocomplete='off';
    pin.pattern='[0-9]{6}';pin.maxLength=6;pin.minLength=6;pin.required=true;
    const submit=el('button','btn','Inloggen');
    submit.type='submit';
    const other=el('button','btn btn--ghost','Zonder inloggen');
    other.type='button';
    const google=el('button','btn btn--ghost','Inloggen met Google');
    google.type='button';
    const feedback=el('p','hint');
    feedback.setAttribute('role','status');
    form.append(label,name,matches,pinLabel,pin,feedback,submit,other,google);
    clearActions();actions.append(form);
    name.focus();
    let selected='',searchSerial=0;
    function clearSearch(){
      clearTimeout(searchTimer);searchController?.abort();searchController=null;
      matches.replaceChildren();name.setAttribute('aria-expanded','false');
      searchSerial++;
    }
    name.addEventListener('input',()=>{
      selected='';clearSearch();feedback.textContent='';
      const query=name.value.trim();
      if(query.length<3)return;
      const serial=searchSerial;
      const marker=epoch;
      searchTimer=setTimeout(async()=>{
        const controller=new AbortController();searchController=controller;
        try{
          const found=await api('/api/login-search?type=student&q='+encodeURIComponent(query),undefined,controller.signal);
          if(!active||marker!==epoch||serial!==searchSerial||!form.isConnected)return;
          for(const learner of (Array.isArray(found.matches)?found.matches:[]).slice(0,10)){
            if(!learner.id||!learner.displayName&&!learner.name)continue;
            const li=el('li');
            const option=el('button','bb-choice-chat__match',learner.displayName||learner.name);
            option.type='button';
            option.addEventListener('click',()=>{
              selected=learner.id;name.value=learner.displayName||learner.name;
              clearSearch();pin.focus();
            });
            li.append(option);matches.append(li);
          }
          name.setAttribute('aria-expanded',matches.children.length?'true':'false');
          if(!matches.children.length)feedback.textContent='Geen leerling gevonden. Controleer je naam.';
        }catch(err){
          if(serial===searchSerial&&active&&err.name!=='AbortError')feedback.textContent=err.message;
        }
      },200);
    });
    other.addEventListener('click',()=>{
      // A pending successful PIN response must never reactivate personal
      // mode after the learner explicitly chose anonymous recommendations.
      epoch++;
      clearSearch();
      pin.value='';selected='';busy=false;personal=false;firstName='';
      grant='';
      message('Zonder inloggen','student');
      finishIdentity();
    });
    google.addEventListener('click',()=>{
      clearSearch();close();
      document.getElementById('student-nav-profile')?.click();
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      if(!selected){feedback.textContent='Kies je naam uit de zoekresultaten.';name.focus();return;}
      if(!/^[0-9]{6}$/.test(pin.value)){feedback.textContent='Vul je PIN van zes cijfers in.';pin.focus();return;}
      const code=pin.value;pin.value='';
      const marker=epoch;
      busy=true;submit.disabled=true;name.disabled=true;pin.disabled=true;
      feedback.textContent='PIN controleren…';
      try{
        const result=await api('/api/auth/student-pin/choice-begin',{studentId:selected,pin:code});
        if(!active||marker!==epoch){
          if(result.grant)api('/api/auth/student-pin/choice-end',{choiceGrant:result.grant}).catch(()=>{});
          return;
        }
        clearSearch();
        grant=result.grant;personal=true;firstName=username(result);
        clearActions();notice('');
        finishIdentity();
      }catch(err){
        if(active&&marker===epoch)feedback.textContent=err.message;
      }finally{
        if(marker===epoch){busy=false;submit.disabled=false;name.disabled=false;pin.disabled=false;}
      }
    });
  }
  function answer(field,value){
    choices[field]=value;
    if(field==='route') value==='surprise' ? showRecommendations() : askActivity();
    else if(field==='activity')askDetail();
    else if(field==='detail')askSituation();
    else if(field==='situation')askMood();
    else if(field==='mood')askLength();
    else if(field==='length')showRecommendations();
  }
  function askActivity(){
    currentStep='activity';
    message('Wat doe je graag in je vrije tijd?');
    options([
      ['Gamen',()=>answer('activity','gaming')],
      ['Films of series kijken',()=>answer('activity','film')],
      ['Sporten',()=>answer('activity','sport')],
      ['Muziek luisteren of maken',()=>answer('activity','music')],
      ['Dieren of natuur',()=>answer('activity','nature')],
      ['Iets anders',()=>answer('activity','other')],
      ['Weet ik niet',()=>answer('activity','unknown')],
    ]);
  }
  function askDetail(){
    currentStep='detail';
    const questions={
      gaming:'Wat vind je leuk aan een game?',
      film:'Wat vind je leuk aan een film of serie?',
      sport:'Wat vind je leuk aan sporten?',
      music:'Wat vind je leuk aan muziek?',
      nature:'Wat vind je interessant aan dieren of de natuur?',
      other:'Wat maakt een verhaal voor jou interessant?',
      unknown:'Wat zou je in een verhaal willen ontdekken?',
    };
    message(questions[choices.activity]||questions.unknown);
    options([
      ['Actie en avontuur',()=>answer('detail','action')],
      ['Raadsels oplossen',()=>answer('detail','puzzles')],
      ['Mensen en hun keuzes',()=>answer('detail','people')],
      ['Nieuwe werelden ontdekken',()=>answer('detail','worlds')],
      ['Echte dingen leren',()=>answer('detail','facts')],
      ['Maakt me niet uit',()=>answer('detail','none')],
    ]);
  }
  function askSituation(){
    currentStep='situation';
    message('Welke situatie maakt jou het meest nieuwsgierig naar wat er verder gebeurt?');
    options([
      ['Iemand ontdekt een geheim',()=>answer('situation','secret')],
      ['Twee vrienden moeten iets moeilijks beslissen',()=>answer('situation','friends')],
      ['Iemand krijgt een onverwachte kans',()=>answer('situation','chance')],
      ['Je leest wat iemand echt heeft meegemaakt',()=>answer('situation','true')],
      ['Geen van deze',()=>answer('situation','none')],
    ]);
  }
  function askMood(){
    currentStep='mood';
    message('Wat lijkt je leuk om te lezen?');
    options([
      ['Spannend verhaal',()=>answer('mood','exciting')],
      ['Iets grappigs',()=>answer('mood','funny')],
      ['Iets herkenbaars',()=>answer('mood','realistic')],
      ['Fantasie en magie',()=>answer('mood','fantasy')],
      ['Een waargebeurd verhaal',()=>answer('mood','true')],
      ['Geen voorkeur',()=>answer('mood','none')],
    ]);
  }
  function askLength(){
    currentStep='length';
    message('Wil je liever een kort boek, of maakt de lengte je niet uit?');
    options([
      ['Liever niet te lang',()=>answer('length','short')],
      ['Maakt niet uit',()=>answer('length','any')],
    ]);
  }
  function resultCard(item,catalogue){
    const card=el('article','bb-choice-chat__result');
    const cover=el('div','bb-choice-chat__cover');
    const representative=catalogue.find(b=>b.id===item.bookId);
    const imageUrl=representative?.localCoverUrl||representative?.coverUrl||'';
    if(imageUrl){
      const image=el('img');image.alt='Omslag van '+item.title;image.loading='lazy';
      image.src=/^\/api\/covers\/[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/i.test(imageUrl)?apiUrl(imageUrl):imageUrl;
      image.onerror=()=>{image.remove();cover.append(el('span','','Geen omslag'));};
      cover.append(image);
    }else cover.append(el('span','','Geen omslag'));
    const main=el('div','bb-choice-chat__result-copy');
    main.append(el('strong','',item.title));
    main.append(el('small','',item.author||'Auteur onbekend'));
    main.append(el('p','',item.reason));
    main.append(el('small','',item.available>0?item.available+' beschikbaar':'Momenteel niet beschikbaar'));
    const open=el('button','btn btn--secondary','Bekijk boek');
    open.type='button';
    open.addEventListener('click',()=>openBook(item,open));
    main.append(open);card.append(cover,main);
    return card;
  }
  async function openBook(item,buttonElement){
    if(busy||!active)return;
    busy=true;buttonElement.disabled=true;const marker=epoch;
    try{
      // Recheck stock just before opening book details; do not trust cached
      // availability or a deleted physical copy.
      const list=await api('/api/books');
      if(!active||marker!==epoch)return;
      const books=Array.isArray(list)?list:[];
      const copy=books.find(b=>b.id===item.bookId);
      if(!copy)throw Error('Dit boek is niet meer beschikbaar in de catalogus.');
      if(typeof window.BoekenbaaiOpenBookDetail!=='function')throw Error('De boekdetails zijn nog niet geladen.');
      const copies=books.filter(b=>normalized(b.title)===normalized(copy.title)
        && normalized(b.author)===normalized(copy.author)
        && normalized(b.editionIsbn||b.metadataIsbn)===normalized(copy.editionIsbn||copy.metadataIsbn));
      const preferred=copies.find(b=>b.status==='available'&&!b.borrowedBy&&!b.borrowedByClassId)||copy;
      const group={
        id:item.key,title:copy.title,author:copy.author,
        representativeBook:preferred,copies,totalCopies:copies.length,
        availableCopies:copies.filter(b=>b.status==='available'&&!b.borrowedBy&&!b.borrowedByClassId).length,
        borrowedCopies:copies.filter(b=>b.status==='borrowed').length,
        themes:copy.themes||[],easyReading:copy.easyReading===true,
        suitableForExamList:copy.suitableForExamList===true,
        metadataIsbn:copy.metadataIsbn||null,
        coverUrl:copy.localCoverUrl||copy.coverUrl||'',
      };
      close(true);
      await window.BoekenbaaiOpenBookDetail(group);
    }catch(err){
      if(active&&marker===epoch)notice(err.message);
    }finally{
      busy=false;buttonElement.disabled=false;
    }
  }
  async function showRecommendations(extra={}){
    if(!active||busy)return;
    busy=true;currentStep='results';
    const marker=epoch;notice('Boeken zoeken…');clearActions();
    const submitted={
      ...choices,seed,excludeKeys:[...(!personal?seenInTab:[]),...shownInDialogue].slice(-130),
      ...extra,
    };
    try{
      const results=await api('/api/auth/student-pin/choice-suggest',{
        ...(grant?{choiceGrant:grant}:{}),anonymous:!personal,choices:submitted,
      });
      if(!active||marker!==epoch)return;
      if(!results.suggestions?.length){
        notice(results.emptyCatalog?'Er staan nog geen boeken in de bibliotheek.':
          'Ik heb geen nieuwe passende boeken meer. Je kunt een andere richting proberen of eerdere tips bekijken.');
        message(results.emptyCatalog?'Er zijn nu nog geen boeken om voor te stellen.':
          'Ik heb geen andere boeken gevonden die bij je antwoorden passen.');
        followupButtons(true);
        return;
      }
      const available=await api('/api/books');
      if(!active||marker!==epoch)return;
      const catalogue=Array.isArray(available)?available:[];
      lastBooks=results.suggestions;
      const block=message(choices.route==='surprise'
        ? 'Deze drie boeken heb ik voor je uitgekozen:'
        : 'Ik heb deze boeken voor je gevonden:');
      const list=el('div','bb-choice-chat__result-list');
      for(const book of results.suggestions){
        shownInDialogue.add(book.key);
        if(!personal)seenInTab.add(book.key);
        list.append(resultCard(book,catalogue));
      }
      block.append(list);
      notice(choices.route==='surprise'
        ? 'Een afwisselende selectie uit de bibliotheek.'
        : 'Deze tips zijn gebaseerd op je antwoorden.');
      message('Zit er iets tussen?');
      followupButtons(false);
    }catch(err){
      if(!active||marker!==epoch)return;
      if(err.status===401&&grant){
        grant='';personal=false;firstName='';
        message('Je persoonlijke sessie is verlopen. Je kunt opnieuw met je PIN aanmelden of zonder inloggen verder.');
        options([['Opnieuw met mijn PIN',showPin],['Zonder inloggen',finishIdentity]]);
      }else{
        notice(err.message);
        options([['Opnieuw proberen',()=>showRecommendations(extra)],['Andere richting',()=>{choices.route='new';askSituation();}]]);
      }
    }finally{busy=false;}
  }
  function followupButtons(exhausted){
    options([
      ...(!exhausted?[[choices.route==='surprise'?'Nog drie verrassingen':'Nog drie voorstellen',
        ()=>showRecommendations()]]:[]),
      ...(choices.route==='surprise'
        ? [['Ontdek mijn interesses',()=>{choices={route:'new'};askActivity();}]]
        : [['Andere richting',()=>{choices.route='new';askSituation();}],
          ['Liever een kort boek',()=>{choices.length='short';showRecommendations();}],
          ['Verras me',()=>{choices={route:'surprise'};showRecommendations();}]]),
      ['Eerdere suggesties bekijken',()=>showRecommendations({allowRepeats:true})],
      ['Helemaal opnieuw',()=>{choices={};message('Prima, we beginnen opnieuw.');finishIdentity();}],
      ...(personal?[['Mijn eerdere aanbevelingen wissen',async()=>{
        if(busy)return;busy=true;
        const marker=epoch;
        try{
          await api('/api/auth/student-pin/choice-reset',grant?{choiceGrant:grant}:{});
          if(!active||marker!==epoch)return;
          seenInTab.clear();shownInDialogue.clear();
          message('Je eerdere aanbevelingen zijn gewist. We beginnen weer zonder eerdere voorstellen.');
          finishIdentity();
        }catch(err){
          if(!active||marker!==epoch)return;
          if(err.status===401&&grant){
            grant='';personal=false;firstName='';
            message('Je persoonlijke sessie is verlopen. Je kunt opnieuw met je PIN aanmelden of zonder inloggen verder.');
            options([['Opnieuw met mijn PIN',showPin],['Zonder inloggen',finishIdentity]]);
          }else{
            notice(err.message);
            followupButtons(false);
          }
        }finally{busy=false;}
      }]]:[]),
    ]);
  }
  function close(toDetail=false){
    const focus=previousFocus;
    resetSession();
    detailHandoff=toDetail;
    if(dialog.open)dialog.close();
    if(!toDetail)focus?.focus?.();
  }
  button.disabled=false;
  button.removeAttribute('aria-describedby');
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-controls','student-choice-dialog');
  button.addEventListener('click',begin);
  closeButton.addEventListener('click',()=>close());
  dialog.addEventListener('close',()=>{
    const handoff=detailHandoff,focus=previousFocus;
    if(active)resetSession();
    detailHandoff=false;
    if(!handoff)focus?.focus?.();
  });
  window.addEventListener('boekenbaai:student-auth-pending',()=>{
    if(active)close();
  });
  window.addEventListener('boekenbaai:staff-auth-cleared',()=>{
    if(active)close();
  });
})();
