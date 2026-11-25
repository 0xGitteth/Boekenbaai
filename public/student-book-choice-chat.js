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
  const recentQuestionsInTab=new Set();
  const recentOpenPromptsInTab=new Set();
  let active=false,epoch=0,grant='',personal=false,firstName='',previousFocus=null;
  let choices={},currentStep='',busy=false,shownInDialogue=new Set(),seed='';
  let lastBooks=[],detailHandoff=false,searchController=null,searchTimer=null;
  let currentQuestion=null,questionHistory=[],readingConsent=false;
  let adviceContext=null,adviceQuestion=null;
  const recentAdviceQuestions=new Set();
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
    const userToken=token(),marker=epoch;
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
      if(response.status===423&&active&&marker===epoch){
        if(data.code==='CHOICE_BLOCKED')showBlocked();
        else if(data.code==='CHOICE_GUEST_PAUSED')showGuestPaused();
      }
      throw error;
    }
    return data;
  }
  function showBlocked(){
    resetSession();
    message('Help me kiezen is geblokkeerd. Vraag je mentor om de functie weer open te zetten.');
    clearActions();
  }
  function showGuestPaused(){
    resetSession();active=true;
    message('Dit gesprek is gestopt. Over vijf minuten kun je weer zonder inloggen beginnen. Je kunt ook met je eigen PIN inloggen.');
    options([['Inloggen met mijn PIN',showPin]]);
  }
  async function startGuest(){
    if(!active||busy)return;
    const marker=epoch;
    busy=true;personal=false;firstName='';grant='';
    try{
      await api('/api/auth/student-pin/choice-status',{});
      if(!active||marker!==epoch)return;
      busy=false;notice('');finishIdentity();
    }catch(err){
      if(!active||marker!==epoch)return;
      busy=false;notice(err.message);
      options([['Opnieuw proberen',startGuest],['Inloggen',showPin]]);
    }finally{if(active&&marker===epoch)busy=false;}
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
    active=false;busy=false;personal=false;firstName='';readingConsent=false;
    const oldGrant=grant;
    grant='';currentStep='';choices={};lastBooks=[];detailHandoff=false;
    currentQuestion=null;questionHistory=[];adviceContext=null;adviceQuestion=null;
    shownInDialogue=new Set();
    if(oldGrant){
      // Invalidate on the server as well as forgetting the token in memory.
      api('/api/auth/student-pin/choice-end',{choiceGrant:oldGrant}).catch(()=>{});
    }
    log.replaceChildren();clearActions();notice('');
  }
  function beginInterests(){
    answer('route','new');
  }
  // The server selects the next open question and supplies corresponding
  // example choices. Only normalized preferences and question IDs are retained.
  function freshAdvice(){
    adviceContext=null;adviceQuestion=null;
  }
  function advicePayload(optionId){
    return {...(adviceContext||{}),signals:choices.openSignals||{prefer:[],avoid:[]},
      length:choices.length||'any',seed,recent:[...recentAdviceQuestions].slice(-30),
      ...(optionId===undefined?{}:{optionId})};
  }
  function applyAdvice(plan){
    adviceContext=plan.context;
    choices={...choices,route:'new',openSignals:plan.context.signals,length:plan.context.length,
      questionIds:plan.context.used};
    if(plan.context.current&&plan.kind==='question'){
      recentAdviceQuestions.add(plan.context.current);
      if(recentAdviceQuestions.size>20)recentAdviceQuestions.delete(recentAdviceQuestions.values().next().value);
    }
  }
  function showAdviceExamples(q){
    adviceQuestion=q||adviceQuestion;
    if(!adviceQuestion){offerOpenAnswer('');return;}
    message(adviceQuestion.examples||'Misschien helpt het als ik een paar voorbeelden geef.');
    const items=(adviceQuestion.options||[]).map(o=>[o.label,()=>void submitAdvice(o.label,o.id,true)]);
    options([...items,['Iets anders',()=>offerOpenAnswer('Vertel maar.',adviceQuestion)],
      ['Weet ik nog steeds niet',()=>{message('Geen probleem. We kunnen ook naar een ander onderwerp kijken.');startExploration();}],
      ...(choices.openSignals?.prefer?.length||choices.openSignals?.avoid?.length?[['Toon boeken met wat je nu weet',()=>void showRecommendations()]]:[])]);
  }
  function continueAdvice(plan){
    applyAdvice(plan);
    if(plan.reaction)message(plan.reaction);
    if(plan.kind==='question'){
      offerOpenAnswer(plan.question.prompt,plan.question);
    }else if(plan.kind==='recommend'){
      message('Ik denk dat ik genoeg weet om een paar boeken voor je uit te zoeken.');
      void showRecommendations();
    }else if(plan.kind==='offer'){
      message('Ik weet al iets over wat je zoekt. Zal ik daarmee een paar boeken voorstellen?');
      options([['Toon boeken met wat je nu weet',()=>void showRecommendations()],
        ['Ontdek meer interesses',startExploration]]);
    }else if(plan.kind==='examples'){
      showAdviceExamples(plan.question);
    }else{
      adviceQuestion=plan.question||adviceQuestion;
      message('Ik weet nog niet precies wat je bedoelt. Kun je het anders uitleggen?');
      offerOpenAnswer('',adviceQuestion);
    }
  }
  async function submitAdvice(value,optionId,alreadyShown=false){
    if(!active||busy||!value.trim())return;
    if(!alreadyShown)message(value,'student');
    clearActions();busy=true;const marker=epoch;notice('Je antwoord bekijken…');
    try{
      const result=await api('/api/auth/student-pin/choice-interpret',{text:value.slice(0,500),
        context:advicePayload(optionId),consent:readingConsent,...(grant?{choiceGrant:grant}:{})});
      if(!active||marker!==epoch)return;
      busy=false;notice('');
      if(result.moderation==='redirect'||result.moderation==='warning'){
        message(result.moderation==='warning'
          ?result.guest
            ?'Let op: gebruik Help me kiezen om een boek te vinden. Als je blijft schelden of het gesprek blijft verstoren, stop ik dit gesprek.'
            :'Let op: gebruik Help me kiezen om een boek te vinden. Als je blijft schelden of het gesprek blijft verstoren, blokkeer ik deze functie. Je mentor moet hem dan weer openzetten.'
          :'Dit helpt me nog niet om een boek voor je te zoeken. Vertel iets over wat je graag leest.');
        offerOpenAnswer('',adviceQuestion);
        return;
      }
      const plan=result.advice;
      if(!plan){throw Error('De keuzehulp kon geen vervolgvraag bepalen.');}
      if(result.avoid?.length){
        const labels=result.avoid.map(t=>result.labels?.[t]||t).join(', ');
        message('Je wilt '+labels+' liever vermijden. Klopt dat?');
        options([['Ja, ga verder',()=>continueAdvice(plan)],
          ['Pas mijn antwoord aan',()=>offerOpenAnswer('Vertel het nog eens in je eigen woorden.',adviceQuestion)]]);
      }else continueAdvice(plan);
    }catch(err){
      if(!active||marker!==epoch)return;
      busy=false;notice(err.message||'Je antwoord kon niet worden verwerkt.');
      options([['Opnieuw proberen',()=>offerOpenAnswer('',adviceQuestion)],['Kies liever uit antwoorden',startExploration]]);
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function offerOpenAnswer(prompt='Waar lees je graag over?',question=null){
    if(prompt)message(prompt);
    adviceQuestion=question;
    clearActions();
    const form=el('form','bb-choice-chat__free');
    const label=el('label','','Jouw antwoord');
    label.setAttribute('for','bb-choice-free-text');
    const input=el('textarea');input.id='bb-choice-free-text';input.maxLength=500;input.rows=3;
    input.placeholder='Typ je antwoord';input.required=true;
    const submit=el('button','btn btn--primary','Verstuur');submit.type='submit';
    const help=el('button','btn btn--secondary','Ik weet het niet / geef voorbeelden');help.type='button';
    help.addEventListener('click',()=>{
      if(!active||busy)return;
      if(adviceQuestion)showAdviceExamples(adviceQuestion);else void submitAdvice('Weet ik niet');
    });
    form.append(label,input,submit,help);
    if(choices.openSignals?.prefer?.length||choices.openSignals?.avoid?.length){
      const skip=el('button','btn btn--secondary','Toon boeken met wat je nu weet');skip.type='button';
      skip.addEventListener('click',()=>{if(active&&!busy)void showRecommendations();});form.append(skip);
    }
    const correct=el('button','btn btn--secondary','Ik wil opnieuw beginnen');correct.type='button';
    correct.addEventListener('click',()=>{if(active&&!busy){choices={route:'new'};freshAdvice();offerOpenAnswer();}});
    form.append(correct);actions.append(form);input.focus();
    form.addEventListener('submit',event=>{event.preventDefault();return submitAdvice(input.value.trim());});
  }
  function selectReference(book,read){
    message(read?'Wat vond je leuk aan '+book.title+'?':'Wat spreekt je aan in '+book.title+'?');
    const pick=preference=>{
      choices={route:'new',referenceBookId:book.bookId,referencePreference:preference,answers:[]};
      void showRecommendations();
    };
    options([
      ['De spanning',()=>pick('spanning')],['De personages',()=>pick('personages')],
      ['De omgeving of wereld',()=>pick('wereld')],['Het tempo',()=>pick('tempo')],
      ['De sfeer',()=>pick('sfeer')],['Wat ik ervan leer',()=>pick('informatie')],
      ['Weet ik niet',()=>pick('')],['Iets anders zoeken',beginInterests],
    ]);
  }
  function offerFavorites(items){
    if(!items.length){offerGeneral();return;}
    message('Je hebt deze boeken bewaard voor later. Welk boek spreekt je nu aan?');
    options([
      ...items.map(book=>[book.title+(book.author?' · '+book.author:''),()=>selectReference(book,false)]),
      ['Iets anders zoeken',offerGeneral],['Laat me drie boeken zien',()=>answer('route','surprise')],
    ]);
  }
  function offerGeneral(){
    message('Wil je ontdekken wat je leuk vindt of zal ik je drie boeken voorstellen?');
    currentStep='route';
    options([
      ['Vertel zelf wat je zoekt',()=>{choices={route:'new'};freshAdvice();offerOpenAnswer();}],
      ['Ontdek mijn interesses',beginInterests],
      ['Laat me drie boeken zien',()=>answer('route','surprise')],
    ]);
  }
  async function loadPersonalContext(){
    if(!active||busy)return;
    readingConsent=true;busy=true;const marker=epoch;
    notice('Je eigen leesgegevens ophalen…');
    try{
      const context=await api('/api/auth/student-pin/choice-context',{
        consent:true,...(grant?{choiceGrant:grant}:{})
      });
      if(!active||marker!==epoch)return;
      busy=false;notice('');
      const favorites=Array.isArray(context.favorites)?context.favorites:[];
      if(context.recent){
        const book=context.recent;
        message('Je hebt '+book.title+' uitgelezen. Vond je dat een leuk boek?');
        options([
          ['Ja',()=>selectReference(book,true)],
          ['Nee',()=>offerFavorites(favorites)],
          ['Weet ik niet',()=>offerFavorites(favorites)],
          ['Ik wil iets heel anders',offerGeneral],
        ]);
      }else offerFavorites(favorites);
    }catch(error){
      if(!active||marker!==epoch)return;
      readingConsent=false;busy=false;
      notice('Je leesgegevens konden niet worden geladen. Je kunt zonder deze gegevens verder.');
      offerGeneral();
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function finishIdentity(){
    readingConsent=false;
    choices={};freshAdvice();
    if(!personal){offerGeneral();return;}
    message((firstName?'Hoi '+firstName+'! ':'')+'Mag ik rekening houden met de boeken die je eerder hebt uitgelezen of bewaard?');
    options([
      ['Ja, graag',()=>void loadPersonalContext()],
      ['Nee, iets nieuws ontdekken',offerGeneral],
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
        await api('/api/auth/student-pin/choice-status',{});
        if(!active||marker!==epoch)return;
        personal=true;firstName=username(me);
        notice('');
        finishIdentity();
        return;
      }
    }catch(_){/* Invalid/guest sessions never inherit personal data. */}
    if(!active||marker!==epoch)return;
    notice('');
    message('Hoi! Ik help je een boek te vinden. Log in voor persoonlijke tips, of ga zonder inloggen verder.');
    options([['Inloggen',showPin],['Zonder inloggen',startGuest]]);
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
    const other=el('button','btn btn--ghost','Annuleren');
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
      pin.value='';clearSearch();close();
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
  // The real public catalogue determines each next question.
  // Book preferences are based on answers, not inferred from hobbies.
  function answer(field,value){
    choices[field]=value;
    if(field==='route'){
      if(value==='surprise')void showRecommendations();
      else startExploration();
    }
  }
  function startExploration(){
    choices.route='new';
    choices.answers=[];
    // A fresh route must never be biased by an earlier reference book.
    delete choices.referenceBookId;
    delete choices.referencePreference;
    // Confirmed free-text preferences stay in effect when switching answer modes.
    questionHistory=[];
    currentQuestion=null;
    void askAdaptiveQuestion();
  }
  function showQuestion(question){
    currentQuestion=question;
    currentStep='question';
    recentQuestionsInTab.add(question.id);
    message(question.prompt);
    options([
      ...(Array.isArray(question.options)?question.options:[]).map(option=>
        [option.label,()=>recordAnswer(option.id)]),
      ['Weet ik niet',()=>recordAnswer('skip')],
      ['Sla deze vraag over',()=>recordAnswer('skip')],
      ['Ik wil zelf antwoord geven',()=>offerOpenAnswer('Vertel wat voor jou belangrijk is.')],
      ...(questionHistory.length?[['Vorige vraag',goBack]]:[]),
      ['Laat nu drie boeken zien',()=>void showRecommendations()],
    ]);
    notice('Vraag '+(questionHistory.length+1)+'. Je mag een vraag overslaan.');
  }
  function recordAnswer(optionId){
    if(!currentQuestion)return;
    if(!Array.isArray(choices.answers))choices.answers=[];
    choices.answers.push({questionId:currentQuestion.id,optionId});
    questionHistory.push(currentQuestion);
    currentQuestion=null;
    void askAdaptiveQuestion();
  }
  function goBack(){
    const previous=questionHistory.pop();
    choices.answers?.pop();
    if(previous)showQuestion(previous);
    else startExploration();
  }
  async function askAdaptiveQuestion(){
    if(!active||busy)return;
    busy=true;currentStep='question';
    const marker=epoch;
    let delegated=false;
    notice('Een passende vervolgvraag kiezen…');
    clearActions();
    try{
      const next=await api('/api/auth/student-pin/choice-next',{
        ...(grant?{choiceGrant:grant}:{}),answers:choices.answers||[],seed,
        excludeQuestionIds:[...recentQuestionsInTab].slice(-100),
      });
      if(!active||marker!==epoch)return;
      if(next.done||!next.question){
        busy=false;
        delegated=true;
        await showRecommendations();
      }else{
        busy=false;
        showQuestion(next.question);
      }
    }catch(err){
      if(!active||marker!==epoch)return;
      if(delegated)return; // suggestion request provides its own error options
      notice(err.message||'De volgende vraag kon niet worden geladen.');
      options([
        ['Opnieuw proberen',()=>void askAdaptiveQuestion()],
        ...(questionHistory.length?[['Vorige vraag',goBack]]:[]),
        ['Drie boeken bekijken',()=>void showRecommendations()],
      ]);
    }finally{
      if(active&&marker===epoch&&!delegated)busy=false;
    }
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
    main.append(open);
    const similar=el('button','btn btn--ghost','Meer zoals dit');
    similar.type='button';
    similar.addEventListener('click',()=>{
      if(!active||busy)return;
      message('Meer zoals '+item.title,'student');
      // Reference similarity is distinct from the learner's earlier
      // consent to include their personal reading history.
      const includeHistory=choices.route==='similar';
      choices={route:includeHistory?'similar':'new',
        referenceBookId:item.bookId,answers:[],...(choices.openSignals?{openSignals:choices.openSignals}:{})};
      void showRecommendations();
    });
    main.append(similar);card.append(cover,main);
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
      // Recommendations are already grouped by work (title + author).
      // Show every edition of that work in the same detail dialog.
      const authorKey=b=>normalized(b.author).replace(/[.,;:!?\s]+$/g,'');
      const copies=books.filter(b=>b.catalogHidden!==true&&b.personalLoanOnly!==true
        &&normalized(b.title)===normalized(copy.title)&&authorKey(b)===authorKey(copy));
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
      ...choices,useReadingHistory:readingConsent,seed,excludeKeys:[...(!personal?seenInTab:[]),...shownInDialogue].slice(-130),
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
        : choices.openSignals?.avoid?.length
          ? 'Ik heb bekende ongewenste onderwerpen vermeden. De boekinformatie is niet altijd volledig.'
          : 'Deze tips zijn gebaseerd op je antwoorden.');
      message('Zit er iets tussen?');
      followupButtons(false);
    }catch(err){
      if(!active||marker!==epoch)return;
      if(err.status===401&&grant){
        grant='';personal=false;firstName='';
        message('Je persoonlijke sessie is verlopen. Meld je opnieuw aan met je PIN of Google-schoolaccount.');
        options([['Opnieuw met mijn PIN',showPin],['Opnieuw inloggen met Google',()=>{close();document.getElementById('student-nav-profile')?.click();}]]);
      }else{
        notice(err.message);
        options([['Opnieuw proberen',()=>showRecommendations(extra)],['Andere richting',()=>{choices={route:'new'};startExploration();}]]);
      }
    }finally{busy=false;}
  }
  function followupButtons(exhausted){
    options([
      ...(!exhausted?[[choices.route==='surprise'?'Nog drie verrassingen':'Nog drie voorstellen',
        ()=>showRecommendations()]]:[]),
      ...(choices.route==='surprise'
        ? [['Ontdek mijn interesses',()=>{choices={route:'new'};startExploration();}]]
        : [['Andere richting',()=>{choices={route:'new'};startExploration();}],
          ['Liever een kort boek',()=>{choices.length='short';showRecommendations();}],
          ['Verras me',()=>{choices={route:'surprise'};showRecommendations();}]]),
      ['Vertel wat je anders wilt',()=>{freshAdvice();offerOpenAnswer('Wat spreekt je niet aan in deze voorstellen?');}],
      ['Eerdere suggesties bekijken',()=>showRecommendations({allowRepeats:true})],
      ['Helemaal opnieuw',()=>{choices={};message('Prima, we beginnen opnieuw.');finishIdentity();}],
      ...(personal?[['Mijn eerdere aanbevelingen wissen',async()=>{
        if(busy)return;busy=true;
        const marker=epoch;
        try{
          await api('/api/auth/student-pin/choice-reset',grant?{choiceGrant:grant}:{});
          if(!active||marker!==epoch)return;
          seenInTab.clear();shownInDialogue.clear();recentQuestionsInTab.clear();
          message('Je eerdere aanbevelingen zijn gewist. We beginnen weer zonder eerdere voorstellen.');
          finishIdentity();
        }catch(err){
          if(!active||marker!==epoch)return;
          if(err.status===401&&grant){
            grant='';personal=false;firstName='';
            message('Je persoonlijke sessie is verlopen. Meld je opnieuw aan met je PIN of Google-schoolaccount.');
            options([['Opnieuw met mijn PIN',showPin],['Opnieuw inloggen met Google',()=>{close();document.getElementById('student-nav-profile')?.click();}]]);
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
