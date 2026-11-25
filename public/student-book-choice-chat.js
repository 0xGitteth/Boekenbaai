(function choiceChat() {
  'use strict';
  const button=document.getElementById('student-help-choose');
  const dialog=document.getElementById('student-choice-dialog');
  const log=document.getElementById('student-choice-chat-log');
  const viewport=document.getElementById('student-choice-chat-viewport');
  const dock=document.getElementById('student-choice-chat-dock');
  const actions=document.getElementById('student-choice-chat-actions');
  const status=document.getElementById('student-choice-chat-status');
  const closeButton=document.getElementById('student-choice-close');
  if(!button||!dialog||!log||!viewport||!dock||!actions||!status||!closeButton)return;

  let followLatest=true,longDock=false,scrollScheduled=false;
  let refreshSuggestions=()=>{};
  // One scrolling surface for the conversation and its controls. A compact
  // composer stays at the bottom; long lists become part of the same scroll.
  function scrollLatest(force=false){
    if(force)followLatest=true;
    if(!dialog.open)return;
    refreshSuggestions();
    const nextLong=dock.offsetHeight>Math.max(0,viewport.clientHeight-110);
    if(nextLong!==longDock){
      longDock=nextLong;dock.setAttribute('data-long',String(longDock));
    }
    if(!followLatest)return;
    if(longDock){
      const top=dock.getBoundingClientRect().top-viewport.getBoundingClientRect().top+viewport.scrollTop;
      // Keep the latest question and the beginning of long options visible.
      viewport.scrollTop=Math.max(0,top-80);
    }else viewport.scrollTop=viewport.scrollHeight;
  }
  function scheduleLatest(force=false){
    if(force)followLatest=true;
    if(scrollScheduled)return;
    scrollScheduled=true;
    const marker=epoch;
    const update=()=>{
      scrollScheduled=false;
      if(marker===epoch)scrollLatest();
      else if(dialog.open)scheduleLatest();
    };
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(update);
    else update();
  }
  viewport.addEventListener('scroll',()=>{
    // Scrolling back through history must not be interrupted by a resize
    // or a delayed network response. A new answer resumes following.
    if(longDock){
      const top=dock.getBoundingClientRect().top-viewport.getBoundingClientRect().top;
      followLatest=top>=-2&&top<=100;
    }else followLatest=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<=32;
  });
  log.addEventListener('focusin',event=>{
    if(!dialog.open||longDock)return;
    const target=event.target;
    if(!target?.getBoundingClientRect)return;
    const rect=target.getBoundingClientRect();
    const visibleBottom=dock.getBoundingClientRect().top;
    if(rect.bottom>visibleBottom-6){
      followLatest=false;
      viewport.scrollTop+=rect.bottom-visibleBottom+6;
    }
  });
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(()=>scheduleLatest());
    observer.observe(viewport);observer.observe(dock);observer.observe(log);
  }
  if(typeof MutationObserver==='function'){
    const observer=new MutationObserver(()=>scheduleLatest());
    observer.observe(log,{childList:true,subtree:true});
    observer.observe(dock,{childList:true,subtree:true,characterData:true});
  }

  const seenInTab=new Set();
  const recentQuestionsInTab=new Set();
  let active=false,epoch=0,grant='',personal=false,firstName='',previousFocus=null;
  let openingToken='',openingStudentId=null;
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
  function accountChanged(){
    if(active){seenInTab.clear();recentQuestionsInTab.clear();recentAdviceQuestions.clear();close();}
    const err=Error('Je account is gewijzigd. Open Help me kiezen opnieuw.');
    err.status=409;err.code='CHOICE_ACCOUNT_CHANGED';return err;
  }
  function headersFor(userToken,body){
    const headers={Accept:'application/json'};
    if(userToken&&userToken!=='cookie')headers.Authorization='Bearer '+userToken;
    if(body!==undefined)headers['Content-Type']='application/json';
    return headers;
  }
  async function verifyOpeningAccount(marker){
    if(!active||marker!==epoch)return;
    if(token()!==openingToken)throw accountChanged();
    // A cookie-only account switch does not necessarily fire a storage event.
    // Recheck the actual current session before rendering a personal response.
    if(openingStudentId&&!grant){
      const response=await fetch(apiUrl('/api/me'),{
        credentials:'same-origin',cache:'no-store',headers:headersFor(openingToken)
      });
      const me=await response.json().catch(()=>({}));
      if(!active||marker!==epoch)return;
      if(token()!==openingToken||!response.ok||me.role!=='student'||me.id!==openingStudentId)
        throw accountChanged();
    }
  }
  async function api(path,body,signal){
    const cleanup=path==='/api/auth/student-pin/choice-end';
    const marker=epoch;
    if(!cleanup&&active&&token()!==openingToken)throw accountChanged();
    const userToken=cleanup?'':openingToken;
    const bound=path.startsWith('/api/auth/student-pin/choice-')&&body!==undefined
      &&!cleanup&&path!=='/api/auth/student-pin/choice-begin';
    const payload=bound?{...body,expectedStudentId:openingStudentId}:body;
    const response=await fetch(apiUrl(path),{
      method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
      signal,headers:headersFor(userToken,body),...(body===undefined?{}:{body:JSON.stringify(payload)}),
    });
    const data=await response.json().catch(()=>({}));
    // A late PIN grant still needs to be revoked by its original caller.
    if(!cleanup&&(!active||marker!==epoch))return data;
    if(!cleanup&&token()!==openingToken){
      if(path==='/api/auth/student-pin/choice-begin'&&data.grant){
        api('/api/auth/student-pin/choice-end',{choiceGrant:data.grant}).catch(()=>{});
      }
      throw accountChanged();
    }
    if(!response.ok){
      const error=Error(data.message||'Er is iets misgegaan.');
      error.status=response.status;
      if(!cleanup&&active&&marker===epoch){
        if(data.code==='CHOICE_ACCOUNT_CHANGED'||(openingStudentId&&response.status===401))throw accountChanged();
        if(response.status===423){
          if(data.code==='CHOICE_BLOCKED')showBlocked();
          else if(data.code==='CHOICE_GUEST_PAUSED')showGuestPaused();
        }
      }
      throw error;
    }
    if(!cleanup&&path!=='/api/me'&&path!=='/api/auth/student-pin/choice-begin')await verifyOpeningAccount(marker);
    return data;
  }
  function showBlocked(){
    resetSession();
    message('Help me kiezen is geblokkeerd. Vraag je mentor om de functie weer open te zetten.');
    clearActions();
  }
  function showGuestPaused(){
    resetSession();active=true;openingToken=token();
    message('Dit gesprek is gestopt. Over vijf minuten kun je weer zonder inloggen beginnen. Je kunt ook met je eigen PIN inloggen.');
    options([['Inloggen met mijn PIN',showPin]]);
  }
  async function startGuest(){
    if(!active||busy)return;
    const marker=epoch;
    busy=true;personal=false;firstName='';grant='';openingStudentId=null;
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
  function clearActions(){refreshSuggestions=()=>{};actions.replaceChildren();scheduleLatest();}
  function message(text,who='assistant'){
    const row=el('div','bb-choice-chat__row bb-choice-chat__row--'+who);
    const bubble=el('div','bb-choice-chat__bubble',text);
    row.append(bubble);log.append(row);
    scheduleLatest(who==='student');
    return bubble;
  }
  function notice(text){status.textContent=text||'';scheduleLatest();}
  function suggestionShelf(items){
    const shelf=el('div','bb-choice-chat__suggestions');
    shelf.setAttribute('role','group');shelf.setAttribute('aria-label','Hulp bij je antwoord');
    const row=el('div','bb-choice-chat__suggestion-track');
    const back=el('button','bb-choice-chat__suggestion-arrow','‹');
    const next=el('button','bb-choice-chat__suggestion-arrow','›');
    back.type=next.type='button';
    back.setAttribute('aria-label','Vorige suggesties');next.setAttribute('aria-label','Meer suggesties');
    const marker=epoch;
    for(const [label,callback] of items){
      const item=el('button','bb-choice-chat__suggestion',label);item.type='button';
      item.addEventListener('click',()=>{if(active&&!busy&&marker===epoch)callback();});
      row.append(item);
    }
    const refresh=()=>{
      const remaining=Math.max(0,row.scrollWidth-row.clientWidth);
      const overflow=remaining>2;
      shelf.setAttribute('data-overflow',String(overflow));
      back.disabled=!overflow||row.scrollLeft<=2;
      next.disabled=!overflow||row.scrollLeft>=remaining-2;
    };
    const move=direction=>{
      row.scrollLeft+=direction*Math.max(80,row.clientWidth*.8);
      refresh();
    };
    back.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
    row.addEventListener('scroll',refresh);
    shelf.append(back,row,next);refreshSuggestions=refresh;
    return shelf;
  }
  function options(items,helpers=[]){
    const marker=epoch;
    clearActions();
    const invoke=(label,callback)=>{
      if(!active||busy||marker!==epoch)return;
      message(label,'student');clearActions();notice('');callback();
    };
    for(const [label,callback] of items){
      const x=el('button','bb-choice-chat__option',label);
      x.type='button';
      x.addEventListener('click',()=>invoke(label,callback));
      actions.append(x);
    }
    if(helpers.length)actions.append(suggestionShelf(helpers.map(([label,callback])=>[label,()=>invoke(label,callback)])));
    actions.querySelector('button')?.focus({preventScroll:true});
    scheduleLatest();
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
    openingStudentId=null;openingToken='';
    const oldGrant=grant;
    grant='';currentStep='';choices={};lastBooks=[];detailHandoff=false;
    currentQuestion=null;questionHistory=[];adviceContext=null;adviceQuestion=null;
    shownInDialogue=new Set();
    if(oldGrant){
      // Invalidate on the server as well as forgetting the token in memory.
      api('/api/auth/student-pin/choice-end',{choiceGrant:oldGrant}).catch(()=>{});
    }
    followLatest=true;longDock=false;dock.setAttribute('data-long','false');
    log.replaceChildren();clearActions();notice('');
  }
  function beginInterests(){
    answer('route','new');
  }
  // The server selects the next open question and supplies corresponding
  // example choices. Only normalized preferences and question IDs are retained.
  function freshAdvice(current='opening'){
    adviceContext={current};adviceQuestion=null;
  }
  function advicePayload(optionId){
    return {...(adviceContext||{}),signals:choices.openSignals||{prefer:[],avoid:[]},
      length:choices.length||'any',seed,recent:[...recentAdviceQuestions].slice(-30),
      ...(optionId===undefined?{}:{optionId})};
  }
  function applyAdvice(plan){
    adviceContext=plan.context;
    if(plan.clearReference){delete choices.referenceBookId;delete choices.referencePreference;delete choices.externalRef;}
    choices={...choices,route:'new',openSignals:plan.context.signals,length:plan.context.length,
      questionIds:[...new Set([...(plan.context.used||[]),...(plan.kind==='question'?[plan.context.current]:[])])]};
    if(plan.context.current&&plan.kind==='question'){
      recentAdviceQuestions.add(plan.context.current);
      if(recentAdviceQuestions.size>20)recentAdviceQuestions.delete(recentAdviceQuestions.values().next().value);
    }
  }
  function showAdviceExamples(q){
    adviceQuestion=q||adviceQuestion;
    if(!adviceQuestion){offerOpenAnswer('');return;}
    message(adviceQuestion.id==='clarify-topic'?adviceQuestion.prompt:(adviceQuestion.examples||'Misschien zit hier iets tussen.'));
    const items=(adviceQuestion.options||[]).map(o=>[o.label,()=>void submitAdvice(o.label,o.id,true)]);
    options(items,[['Iets anders',()=>offerOpenAnswer('Vertel maar.',adviceQuestion)],
      ['Weet ik nog steeds niet',()=>{message('Geen probleem! We proberen iets anders.');startExploration();}],
      ...(choices.openSignals?.prefer?.length||choices.openSignals?.avoid?.length?[['Toon boeken met wat je nu weet',()=>void showRecommendations()]]:[])]);
  }
  function continueAdvice(plan){
    applyAdvice(plan);
    if(plan.reaction)message(plan.reaction);
    if(plan.reference?.bookId){
      chooseBookReference(plan.reference);
      return;
    }
    if(plan.kind==='book-search'){
      message('Bedoel je een boek met die titel? Ik kan kijken of ik het herken.');
      showReferenceSearch(plan.title);
    }else if(plan.kind==='question'){
      offerOpenAnswer(plan.question.prompt,plan.question);
    }else if(plan.kind==='recommend'){
      message('Eens kijken wat we voor je in de kast hebben! 📚');
      void showRecommendations();
    }else if(plan.kind==='offer'){
      const noPreference=!choices.openSignals?.prefer?.length&&!choices.openSignals?.avoid?.length&&!choices.referenceBookId&&!choices.externalRef&&choices.length!=='short'&&!choices.answers?.length;
      message(noPreference?'Zal ik je gewoon drie verschillende boeken laten zien?':'Zal ik alvast een paar boeken voor je zoeken? 📚');
      options([[noPreference?'Laat me drie boeken zien':'Toon boeken met wat je nu weet',()=>{if(noPreference)choices.route='surprise';void showRecommendations();}],
        ['Ontdek meer interesses',startExploration]]);
    }else if(plan.kind==='examples'){
      showAdviceExamples(plan.question);
    }else{
      adviceQuestion=plan.question||adviceQuestion;
      if(!plan.reaction)message('Hmm, ik snap het nog niet helemaal. Vertel eens iets meer?');
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
          ['Pas mijn antwoord aan',()=>offerOpenAnswer('Wat bedoelde je dan?',adviceQuestion)]]);
      }else continueAdvice(plan);
    }catch(err){
      if(!active||marker!==epoch)return;
      busy=false;notice(err.message||'Je antwoord kon niet worden verwerkt.');
      options([['Opnieuw proberen',()=>offerOpenAnswer('',adviceQuestion)],['Kies liever uit antwoorden',startExploration]]);
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function offerOpenAnswer(prompt='Waar lees je graag over?',question=null,explicitNavigation=false){
    if(prompt)message(prompt);
    adviceQuestion=question;
    clearActions();
    const form=el('form','bb-choice-chat__free bb-choice-chat__free--answer');
    const label=el('label','bb-choice-chat__sr-only','Jouw antwoord');
    label.setAttribute('for','bb-choice-free-text');
    const input=el('textarea');input.id='bb-choice-free-text';input.maxLength=500;input.rows=1;
    input.placeholder='Typ je antwoord…';input.required=true;
    const submit=el('button','btn btn--primary','Verstuur');submit.type='submit';
    const marker=epoch;
    const items=[['Geef voorbeelden',()=>{if(adviceQuestion)showAdviceExamples(adviceQuestion);else void submitAdvice('Weet ik niet');}]];
    if(choices.openSignals?.prefer?.length||choices.openSignals?.avoid?.length)items.push(['Laat boeken zien',()=>void showRecommendations()]);
    items.push(['Ik ken een leuk boek',()=>showReferenceSearch('','',true)],
      ['Liever kiezen uit antwoorden',beginInterests],
      ['Opnieuw beginnen',()=>{choices={route:'new'};freshAdvice();offerOpenAnswer(undefined,null,true);}]);
    const suggestions=suggestionShelf(items);
    form.append(suggestions,label,input,submit);
    actions.append(form);input.focus({preventScroll:true});
    if(explicitNavigation)scrollLatest(true);else scheduleLatest();
    const send=()=>{if(active&&!busy&&marker===epoch)return submitAdvice(input.value.trim());};
    form.addEventListener('submit',event=>{event.preventDefault();return send();});
    input.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
      event.preventDefault();
      return send();
    });
  }
  function showReferenceSearch(initialTitle='',initialAuthor='',explicitNavigation=false){
    if(!active||busy)return;
    clearActions();
    const form=el('form','bb-choice-chat__free');
    const label=el('label','','Titel of ISBN');const title=el('input');title.type='text';title.value=initialTitle||'';title.maxLength=120;title.required=true;
    const authorLabel=el('label','','Auteur (als je die weet)');const author=el('input');author.type='text';author.maxLength=90;author.value=initialAuthor||'';
    const submit=el('button','btn btn--primary','Zoek in de schoolbibliotheek');submit.type='submit';
    const back=el('button','btn btn--secondary','Verder met het gesprek');back.type='button';
    back.addEventListener('click',()=>offerOpenAnswer('',adviceQuestion,true));
    form.append(label,title,authorLabel,author,submit,back);actions.append(form);title.focus({preventScroll:true});
    if(explicitNavigation)scrollLatest(true);else scheduleLatest();
    form.addEventListener('submit',event=>{event.preventDefault();void findReference({title:title.value.trim(),author:author.value.trim()},false);});
  }
  async function findReference(query,external){
    if(!active||busy)return;
    busy=true;clearActions();const marker=epoch;notice('Boektitel zoeken…');
    try{
      const result=await api('/api/auth/student-pin/choice-reference',{...query,external,...(grant?{choiceGrant:grant}:{})});
      if(!active||marker!==epoch)return;
      busy=false;notice('');
      const matches=Array.isArray(result.matches)?result.matches:[];
      if(matches.length)message('Bedoel je een van deze boeken?');
      else message(result.status==='invalid'?'Vul alleen een boektitel, ISBN en eventueel de auteur in.':result.status==='unavailable'||result.status==='busy'?'Ik kan de externe boekenbron nu niet bereiken.':'Ik heb geen passend boek gevonden.');
      options([
        ...matches.map(book=>[book.title+(book.author?' · '+book.author:'')+' ('+book.source+')',()=>chooseBookReference(book)]),
        ...(!external?[['Zoek ook buiten school (Google Books / Open Library)',()=>{
          message('Ik zoek alleen met de ingevulde titel en auteur, zonder je naam of gespreksgegevens.');
          void findReference(query,true);
        }]]:[]),
        ['Titel of auteur aanpassen',()=>showReferenceSearch(query.title,query.author)],
        ['Verder zonder boekherkenning',()=>{message('Vertel gerust wat je leuk vond aan dat boek.');offerOpenAnswer('',adviceQuestion);}],
      ]);
    }catch(err){
      if(!active||marker!==epoch)return;busy=false;notice(err.message);
      options([['Opnieuw proberen',()=>void findReference(query,external)],['Verder zonder boekherkenning',()=>offerOpenAnswer('',adviceQuestion)]]);
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function chooseBookReference(book){
    if(!active||busy)return;
    message('Wil je een boek dat lijkt op '+book.title+' of wil je kijken of er een volgend deel is?');
    options([
      ['Een boek dat erop lijkt',()=>useBookReference(book)],
      ['Kijk of er een volgend deel is',()=>void inspectSeries(book)],
      ['Toch iets anders',()=>offerOpenAnswer('',adviceQuestion)],
    ]);
  }
  function useBookReference(book){
    choices={...choices,route:'new',referenceBookId:book.bookId||'',externalRef:book.externalRef||'',answers:[]};
    freshAdvice('book-interest');
    offerOpenAnswer('Wat vond je leuk aan '+book.title+'?');
  }
  async function inspectSeries(book,readPart){
    if(!active||busy)return;
    busy=true;clearActions();const marker=epoch;notice('Serie controleren…');
    try{
      const result=await api('/api/auth/student-pin/choice-series',{
        ...(book.bookId?{bookId:book.bookId}:{externalRef:book.externalRef}),readPart,consent:readingConsent,
        signals:choices.openSignals,...(grant?{choiceGrant:grant}:{})});
      if(!active||marker!==epoch)return;
      busy=false;notice('');
      if(!result.series){
        message('Ik kan voor dit boek geen betrouwbare serievolgorde vaststellen.');
        options([['Zoek een vergelijkbaar boek',()=>useBookReference(book)],['Verder met interesses',()=>offerOpenAnswer('',adviceQuestion)]]);return;
      }
      if(result.status==='found'&&result.suggestion){
        message('Dit is het volgende deel in '+result.series.name+'.');
        const list=await api('/api/books');
        if(!active||marker!==epoch)return;
        const block=message('Dit boek staat in onze bibliotheek:');
        block.append(resultCard(result.suggestion,Array.isArray(list)?list:[]));
        options([['Zoek ook andere boeken',()=>useBookReference(book)],['Controleer een ander deel',()=>void inspectSeries(book)]]);return;
      }
      if(result.status==='not_in_collection')message('Het volgende deel is '+result.target.title+'. Dat staat niet in onze bibliotheek.');
      if(result.status==='already_read')message('Dit volgende deel staat al als uitgelezen in je leesgeschiedenis.');
      if(result.status==='excluded')message('Het volgende deel bevat mogelijk een onderwerp dat je liever vermijdt.');
      if(result.status==='last_known')message('Ik heb geen betrouwbaar vastgesteld volgend deel bij dit deel.');
      if(!result.status){
        message('Welk deel van '+result.series.name+' heb je als laatste uitgelezen?');
        const read=new Set(result.readParts||[]);
        options([...result.series.parts.map(p=>['Deel '+p.number+': '+p.title+(read.has(p.number)?' (uitgelezen)':''),()=>void inspectSeries(book,p.number)]),
          ['Weet ik niet',()=>useBookReference(book)],['Ik zoek liever iets anders',()=>offerOpenAnswer('',adviceQuestion)]]);
      }else options([['Controleer een ander deel',()=>void inspectSeries(book)],['Zoek een vergelijkbaar boek',()=>useBookReference(book)]]);
    }catch(err){
      if(!active||marker!==epoch)return;busy=false;notice(err.message);
      options([['Opnieuw proberen',()=>void inspectSeries(book,readPart)],['Zoek een vergelijkbaar boek',()=>useBookReference(book)]]);
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function selectReference(book,read){
    chooseBookReference(book);
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
    message('Weet je al wat je graag wilt lezen, of zullen we samen iets zoeken? Ik kan je ook verrassen!');
    currentStep='route';
    options([
      ['Ik weet wat ik zoek',()=>{choices={route:'new'};freshAdvice();offerOpenAnswer();}],
      ['Help me ontdekken',()=>{choices={route:'new'};freshAdvice('free-time');offerOpenAnswer('Wat doe je graag in je vrije tijd?');}],
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
    active=true;openingToken=token();seed=Math.random().toString(36).slice(2)+Date.now().toString(36);
    dialog.showModal();
    notice('Controleren of je al ingelogd bent…');
    const marker=epoch;
    try{
      const me=await api('/api/me');
      if(!active||marker!==epoch)return;
      if(me?.role==='student'&&me.id){
        openingStudentId=me.id;
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
    name.focus({preventScroll:true});scheduleLatest();
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
        grant=result.grant;openingStudentId=selected;personal=true;firstName=username(result);
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
    delete choices.externalRef;
    freshAdvice();
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
    ],[
      ['Weet ik niet',()=>recordAnswer('skip')],
      ['Zelf antwoorden',()=>offerOpenAnswer('Vertel wat voor jou belangrijk is.')],
      ...(questionHistory.length?[['Vorige vraag',goBack]]:[]),
      ['Laat boeken zien',()=>void showRecommendations()],
    ]);
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
      message('Zit er iets tussen dat je leuk lijkt?');
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
    }finally{if(active&&marker===epoch)busy=false;}
  }
  function followupButtons(exhausted){
    options([
      ...(!exhausted?[[choices.route==='surprise'?'Nog drie verrassingen':'Nog drie voorstellen',
        ()=>showRecommendations()]]:[]),
      ...(choices.route==='surprise'
        ? [['Ontdek mijn interesses',()=>{choices={route:'new'};freshAdvice();offerOpenAnswer('Waar lees je graag over?');}]]
        : [['Andere richting',()=>{choices={route:'new'};startExploration();}],
          ['Liever een kort boek',()=>{choices.length='short';showRecommendations();}],
          ['Verras me',()=>{choices={route:'surprise'};showRecommendations();}]]),
      ['Vertel wat je anders wilt',()=>{freshAdvice('feedback');offerOpenAnswer('Wat spreekt je niet aan in deze voorstellen?');}],
      ['Eerdere suggesties bekijken',()=>showRecommendations({allowRepeats:true})],
      ['Helemaal opnieuw',()=>{choices={};message('Helemaal goed! We beginnen opnieuw.');finishIdentity();}],
      ...(personal?[['Mijn eerdere aanbevelingen wissen',async()=>{
        if(busy)return;busy=true;
        const marker=epoch;
        try{
          await api('/api/auth/student-pin/choice-reset',grant?{choiceGrant:grant}:{});
          if(!active||marker!==epoch)return;
          seenInTab.clear();shownInDialogue.clear();recentQuestionsInTab.clear();recentAdviceQuestions.clear();
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
        }finally{if(active&&marker===epoch)busy=false;}
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
  window.addEventListener('storage',event=>{
    if(event.key==='boekenbaai_token'||event.key===null){
      seenInTab.clear();recentQuestionsInTab.clear();recentAdviceQuestions.clear();
      if(active)close();
    }
  });
  // Never retain another pupil's private conversation on a hidden tab.
  document.addEventListener('visibilitychange',()=>{
    if(active&&document.visibilityState==='hidden'&&openingStudentId&&!grant)close();
  });
  window.addEventListener('focus',()=>{
    if(!active)return;
    const marker=epoch;
    void verifyOpeningAccount(marker).catch(()=>{if(active&&marker===epoch)close();});
  });
})();
