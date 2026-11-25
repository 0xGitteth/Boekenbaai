'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const conversation=require('../student-choice-conversation');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'public','student-book-choice-chat.js'),'utf8');
function node(tag='div'){
  return {tag,children:[],listeners:{},value:'',textContent:'',isConnected:true,
    disabled:false,open:false,attrs:{},style:{},
    scrollHeight:1000,scrollTop:0,clientHeight:500,offsetHeight:120,scrollWidth:800,clientWidth:500,scrollLeft:0,
    getBoundingClientRect(){return {top:0};},
    addEventListener(k,fn){this.listeners[k]=fn;},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    setAttribute(k,v){this.attrs[k]=v;},
    removeAttribute(k){delete this.attrs[k];},
    focus(){this.focused=true;},
    querySelector(selector){return selector==='button'?this.children.find(x=>x.tag==='button'):null;},
    showModal(){this.open=true;},
    close(){this.open=false;this.listeners.close?.();},
  };
}
const ids=['student-help-choose','student-choice-dialog','student-choice-chat-log',
  'student-choice-chat-actions','student-choice-chat-status','student-choice-close',
  'student-choice-chat-viewport','student-choice-chat-dock'];
const elements=new Map(ids.map(id=>[id,node()]));
const viewport=elements.get('student-choice-chat-viewport'),dock=elements.get('student-choice-chat-dock');
let resizeCallback;
class ResizeObserverStub{constructor(fn){resizeCallback=fn;}observe(){}}
const makeResponse=(status,body)=>({
  ok:status>=200&&status<300,status,
  json:async()=>body,
});
let resolvePin;
let loggedIn=false;
let activeId='s',storageToken='',holdContext=false,releaseContext=null,contextCalls=0;
let blocked=false;
let failSuggest=false;
let resetStatus=200;
let holdSuggestions=false,releaseSuggestion=null;
let holdInterpretation=false,releaseInterpretation=null;
const invalidated=[];
const suggestRequests=[];
const questionRequests=[];
const fetchStub=async (url,options={})=>{
  if(url==='/api/me')return loggedIn
    ? makeResponse(200,{id:activeId,role:'student',firstName:activeId==='s'?'Sanne':'Pieter'})
    : makeResponse(401,{message:'Geen toegang'});
  if(url.startsWith('/api/login-search?'))return makeResponse(200,{
    matches:[{id:'s',displayName:'Sanne J. · Bovenbouw'}],
  });
  if(url==='/api/auth/student-pin/choice-begin')
    return new Promise(resolve=>{resolvePin=resolve;});
  if(url==='/api/auth/student-pin/choice-end'){
    invalidated.push(JSON.parse(options.body).choiceGrant);
    return makeResponse(200,{closed:true});
  }
  if(url==='/api/auth/student-pin/choice-status')return blocked?makeResponse(423,{code:'CHOICE_BLOCKED',message:'Geblokkeerd'}):makeResponse(200,{warned:false});
  if(url==='/api/auth/student-pin/choice-context'){
    const body=JSON.parse(options.body);contextCalls++;
    assert.equal(body.consent,true);
    if(body.expectedStudentId!==activeId)return makeResponse(409,{code:'CHOICE_ACCOUNT_CHANGED'});
    if(holdContext)return new Promise(resolve=>{releaseContext=()=>resolve(makeResponse(200,{recent:{bookId:'private',title:'Privéboek A'},favorites:[]}));});
    return makeResponse(200,{recent:null,favorites:[]});
  }
  if(url==='/api/auth/student-pin/choice-interpret'){
    const body=JSON.parse(options.body);
    const response=makeResponse(200,{...conversation.analyze(body.text,body.context,[]),moderation:'normal'});
    if(holdInterpretation)return new Promise(resolve=>{releaseInterpretation=()=>resolve(response);});
    return response;
  }
  if(url==='/api/auth/student-pin/choice-next'){
    const payload=JSON.parse(options.body);
    questionRequests.push(payload);
    const n=payload.answers?.length||0;
    const questions=[
      {id:'curiosity-1',prompt:'Welke situatie maakt je nieuwsgierig?',
        options:[{id:'secret',label:'Iemand ontdekt een geheim'},
          {id:'real',label:'Iets dat echt gebeurd is'}]},
      {id:'tension-1',prompt:'Wat wil je dan weten?',
        options:[{id:'exciting',label:'Of het spannend wordt'},
          {id:'quiet',label:'Wat de persoon voelt'}]},
      {id:'pace-1',prompt:'Hoe wil je het meemaken?',
        options:[{id:'fast',label:'Er gebeurt veel'},
          {id:'any',label:'Maakt niet uit'}]},
      {id:'style-1',prompt:'Wat volg je graag?',
        options:[{id:'talk',label:'Gesprekken'},
          {id:'facts',label:'Feiten'}]},
    ];
    return makeResponse(200,n>=4?{done:true}:{done:false,question:questions[n]});
  }
  if(url==='/api/auth/student-pin/choice-suggest'){
    suggestRequests.push(JSON.parse(options.body));
    if(failSuggest)return makeResponse(503,{message:'Tijdelijk niet bereikbaar'});
    const result=makeResponse(200,{suggestions:[1,2,3].map(i=>({
      key:String(i),bookId:'book-'+i,title:'Titel '+i,author:'Auteur',
      reason:'Een willekeurige keuze uit de bibliotheek',available:1,
    }))});
    if(holdSuggestions)return new Promise(resolve=>{releaseSuggestion=()=>resolve(result);});
    return result;
  }
  if(url==='/api/auth/student-pin/choice-reset')
    return makeResponse(resetStatus,resetStatus===200?{ok:true}:{message:'Wissen mislukt'});
  if(url==='/api/books')return makeResponse(200,[1,2,3].map(i=>({
    id:'book-'+i,title:'Titel '+i,author:'Auteur',status:'available',
  })));
  throw Error('Unexpected URL: '+url);
};
const windowStub={
  localStorage:{getItem(){return storageToken;}},
  listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},
  BoekenbaaiResolveApiUrl:route=>route,
};
const documentStub={
  activeElement:node('button'),visibilityState:'visible',listeners:{},
  addEventListener(k,fn){this.listeners[k]=fn;},
  getElementById:id=>elements.get(id)||null,
  createElement:node,
};
vm.runInNewContext(code,{
  window:windowStub,document:documentStub,fetch:fetchStub,
  setTimeout,clearTimeout,AbortController,console,ResizeObserver:ResizeObserverStub,
});
(async()=>{
  await elements.get('student-help-choose').listeners.click();
  const actions=elements.get('student-choice-chat-actions');
  const log=elements.get('student-choice-chat-log');
  assert.equal(viewport.scrollTop,viewport.scrollHeight,'Chat follows the newest message');
  viewport.scrollTop=80;viewport.listeners.scroll();
  resizeCallback();
  assert.equal(viewport.scrollTop,80,'Reading earlier messages is not interrupted');
  assert.equal(log.children.length,1,
    'The chat should open with one conversational message, not two introductory messages');
  assert.match(log.children[0].children[0].textContent,/Log in voor persoonlijke tips/);
  const firstChoice=actions.children.find(x=>x.textContent==='Inloggen');
  assert.ok(actions.children.some(x=>x.textContent==='Zonder inloggen'));
  firstChoice.listeners.click();
  assert.equal(viewport.scrollTop,viewport.scrollHeight,'Sending an answer resumes following');
  dock.offsetHeight=600;dock.getBoundingClientRect=()=>({top:300});
  resizeCallback();
  assert.equal(dock.attrs['data-long'],'true','Tall controls share the scrolling surface');
  dock.offsetHeight=120;resizeCallback();
  assert.equal(dock.attrs['data-long'],'false','Compact controls return to the sticky composer');
  const form=actions.children[0];
  assert.equal(form.tag,'form');
  const name=form.children[1],matches=form.children[2],pin=form.children[4],other=form.children[7];
  name.value='San';name.listeners.input();
  await new Promise(resolve=>setTimeout(resolve,260));
  matches.children[0].children[0].listeners.click();
  pin.value='123456';
  const pending=form.listeners.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  other.listeners.click();
  assert.equal(pin.value,'');
  resolvePin(makeResponse(200,{grant:'valid-late-token',firstName:'Sanne'}));
  await pending;
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(invalidated.includes('valid-late-token'));
  assert.equal(suggestRequests.length,0);
  await elements.get('student-help-choose').listeners.click();
  actions.children.find(x=>x.textContent==='Zonder inloggen').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(actions.children.map(x=>x.textContent),['Ik weet wat ik zoek','Help me ontdekken','Laat me drie boeken zien']);
  actions.children.find(x=>x.textContent==='Laat me drie boeken zien').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(suggestRequests.at(-1).anonymous,true);
  // Signed-in pupils choose whether to use private reading context.
  elements.get('student-choice-close').listeners.click();
  loggedIn=true;
  await elements.get('student-help-choose').listeners.click();
  assert.match(log.children[0].children[0].textContent,/Mag ik rekening houden/);
  assert.deepEqual(actions.children.map(x=>x.textContent),
    ['Ja, graag','Nee, iets nieuws ontdekken','Laat me drie boeken zien']);
  actions.children[1].listeners.click();
  actions.children.find(x=>x.textContent==='Ik weet wat ik zoek').listeners.click();
  actions.children[0].children[0].children[1].children.find(x=>x.textContent==='Liever kiezen uit antwoorden').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(log.children.some(row=>row.children[0]?.textContent==='Welke situatie maakt je nieuwsgierig?'));
  assert.equal(actions.children.filter(x=>x.className==='bb-choice-chat__option').length,2);
  const helpers=actions.children.find(x=>x.className==='bb-choice-chat__suggestions');
  assert.deepEqual(helpers.children[1].children.map(x=>x.textContent),['Weet ik niet','Zelf antwoorden','Laat boeken zien']);
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  actions.children[0].listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Ik weet wat ik zoek').listeners.click();
  // Explicit navigation from history must reveal a taller reference form.
  viewport.scrollTop=80;viewport.listeners.scroll();
  dock.offsetHeight=600;dock.getBoundingClientRect=()=>({top:300});
  actions.children[0].children[0].children[1].children.find(x=>x.textContent==='Ik ken een leuk boek').listeners.click();
  assert.equal(dock.attrs['data-long'],'true');
  assert.equal(viewport.scrollTop,300,'Explicit form change reveals the reference controls');
  dock.offsetHeight=120;
  actions.children[0].children.find(x=>x.textContent==='Verder met het gesprek').listeners.click();
  assert.equal(viewport.scrollTop,viewport.scrollHeight);
  // Keyboard focus on an earlier result must clear the sticky composer.
  viewport.scrollTop=80;viewport.listeners.scroll();
  dock.getBoundingClientRect=()=>({top:380});
  log.listeners.focusin({target:{getBoundingClientRect:()=>({top:390,bottom:425})}});
  assert.equal(viewport.scrollTop,131);
  resizeCallback();
  assert.equal(viewport.scrollTop,131,'Passive updates preserve keyboard history position');
  const free=actions.children[0];
  assert.equal(free.tag,'form');
  assert.equal(free.children[0].className,'bb-choice-chat__suggestions');
  const [previous,track,more]=free.children[0].children;
  assert.equal(previous.disabled,true);
  assert.equal(more.disabled,false);
  more.listeners.click();
  assert.ok(track.scrollLeft>0);
  assert.equal(previous.disabled,false);
  assert.equal(more.disabled,true);
  previous.listeners.click();
  assert.equal(track.scrollLeft,0);
  assert.equal(previous.disabled,true);
  track.scrollLeft=100;track.listeners.scroll();
  assert.equal(previous.disabled,false,'Native swipe updates the navigation arrows');
  assert.equal(more.disabled,false);
  track.clientWidth=900;track.scrollLeft=0;resizeCallback();
  assert.equal(free.children[0].attrs['data-overflow'],'false');
  assert.equal(more.disabled,true);
  assert.equal(free.children[2].tag,'textarea');
  assert.equal(free.children[3].type,'submit');
  free.children[2].value='Een mysterie zonder moord';
  let prevented=false;
  free.children[2].listeners.keydown({key:'Enter',shiftKey:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'Shift+Enter keeps a newline');
  free.children[2].listeners.keydown({key:'Enter',isComposing:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'Enter during composition is not submitted');
  await free.children[2].listeners.keydown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true,'Enter sends the response');
  assert.ok(log.children.some(row=>row.children[0]?.textContent.includes('Klopt dat?')));
  actions.children.find(x=>x.textContent==='Ja, ga verder').listeners.click();
  assert.equal(actions.children[0].tag,'form','Confirming an exclusion must lead to a real follow-up');
  actions.children[0].children[0].children[1].children.find(x=>x.textContent==='Laat boeken zien').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(suggestRequests.at(-1).choices.openSignals,{prefer:['mystery'],avoid:['murder']});
  assert.equal(suggestRequests.at(-1).choices.useReadingHistory,true);
  assert.ok(!JSON.stringify(suggestRequests.at(-1)).includes('Een mysterie zonder moord'));

  // Broad interests automatically start a meaningful follow-up.
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  actions.children.find(x=>x.textContent==='Nee, iets nieuws ontdekken').listeners.click();
  actions.children.find(x=>x.textContent==='Ik weet wat ik zoek').listeners.click();
  async function submitOpen(value){
    const form=actions.children[0];
    assert.equal(form.tag,'form');
    form.children[2].value=value;
    await form.listeners.submit({preventDefault(){}});
  }
  const countBeforeOpen=suggestRequests.length;
  holdInterpretation=true;
  const delayed=submitOpen('misterie');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(releaseInterpretation);
  viewport.scrollTop=80;viewport.listeners.scroll();
  holdInterpretation=false;releaseInterpretation();releaseInterpretation=null;
  await delayed;
  assert.equal(viewport.scrollTop,80,'A delayed reply must not interrupt reading earlier messages');
  assert.equal(suggestRequests.length,countBeforeOpen,'A single genre must not trigger a search');
  const firstOpenPrompt=log.children.at(-1).children[0].textContent;
  assert.ok(require('../student-choice-conversation').Q.some(q=>q.prompt===firstOpenPrompt&&q.when.includes('mystery')),'The opening follow-up is thematically relevant');
  assert.ok(!log.children.some(row=>row.children[0]?.textContent.includes('Klopt dat?')));
  await submitOpen('misterie');
  const secondOpenPrompt=log.children.at(-1).children[0].textContent;
  assert.notEqual(secondOpenPrompt,firstOpenPrompt);
  assert.ok(require('../student-choice-conversation').Q.some(q=>q.prompt===secondOpenPrompt),'A real question from the expanded bank');
  assert.equal(suggestRequests.length,countBeforeOpen,'Repeating the same preference is not detail');
  await submitOpen('Ik wil zelf aanwijzingen ontdekken');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(suggestRequests.at(-1).choices.openSignals,{prefer:['mystery','puzzles'],avoid:[]});
  assert.equal(suggestRequests.at(-1).choices.useReadingHistory,false);
  // A detailed initial answer can go directly to recommendations.
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  actions.children.find(x=>x.textContent==='Nee, iets nieuws ontdekken').listeners.click();
  actions.children.find(x=>x.textContent==='Ik weet wat ik zoek').listeners.click();
  await submitOpen('Een realistisch mysterie met aanwijzingen');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(new Set(suggestRequests.at(-1).choices.openSignals.prefer),new Set(['mystery','puzzles','realistic']));
  assert.deepEqual(suggestRequests.at(-1).choices.openSignals.avoid,[]);

  // Reset errors must leave meaningful actions available. The option click
  // itself clears all buttons before the API request begins.
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  actions.children.find(x=>x.textContent==='Laat me drie boeken zien').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(actions.children.some(x=>x.textContent==='Mijn eerdere aanbevelingen wissen'));
  resetStatus=503;
  actions.children.find(x=>x.textContent==='Mijn eerdere aanbevelingen wissen').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(actions.children.some(x=>x.textContent==='Mijn eerdere aanbevelingen wissen'),
    'A failed reset must restore the available chat actions');
  resetStatus=200;

  // After surprise fails, "Andere richting" must use the answers rather
  // than accidentally submitting the surprise route again.
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  failSuggest=true;
  actions.children.find(x=>x.textContent==='Laat me drie boeken zien').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(actions.children.some(x=>x.textContent==='Andere richting'));
  actions.children.find(x=>x.textContent==='Andere richting').listeners.click();
  failSuggest=false;
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Iemand ontdekt een geheim').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(questionRequests.at(-1).answers[0].questionId,'curiosity-1');
  // Back must undo only the last answer, without erasing the entire chat.
  actions.children.find(x=>x.className==='bb-choice-chat__suggestions').children[1].children.find(x=>x.textContent==='Vorige vraag').listeners.click();
  assert.ok(actions.children.some(x=>x.textContent==='Iets dat echt gebeurd is'));
  actions.children.find(x=>x.textContent==='Iets dat echt gebeurd is').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Of het spannend wordt').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Maakt niet uit').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Gesprekken').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(suggestRequests.at(-1).choices.route,'new',
    'The fallback questionnaire must use the answered route, not surprise');
  assert.equal(suggestRequests.at(-1).choices.answers.length,4,
    'Adaptive conversation submits the actual answered questions');
  // An older suggestion card must not start a second request while the
  // next adaptive recommendation is still loading.
  const deepFind=(root,label)=>{
    if(root?.textContent===label&&root?.tag==='button')return root;
    for(const child of root?.children||[]){
      const found=deepFind(child,label);
      if(found)return found;
    }
    return null;
  };
  const existingCard=deepFind(log,'Meer zoals dit');
  assert.ok(existingCard,'Earlier results remain visible in the dialogue');
  actions.children.find(x=>x.textContent==='Andere richting').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  for(const choice of ['Iemand ontdekt een geheim','Of het spannend wordt',
    'Maakt niet uit','Gesprekken']){
    if(choice==='Gesprekken')holdSuggestions=true;
    actions.children.find(x=>x.textContent===choice).listeners.click();
    await new Promise(resolve=>setImmediate(resolve));
  }
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(releaseSuggestion,'Deferred recommendation request must be pending');
  const countBefore=suggestRequests.length;
  existingCard.listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(suggestRequests.length,countBefore,
    'Busy guard prevents overlapping suggestions from old cards');
  holdSuggestions=false;releaseSuggestion();releaseSuggestion=null;
  await new Promise(resolve=>setImmediate(resolve));
  elements.get('student-choice-close').listeners.click();
  // Cookie-only switch after opening: server must refuse the old identity.
  storageToken='cookie';activeId='s';
  await elements.get('student-help-choose').listeners.click();
  activeId='b';
  actions.children[0].listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('student-choice-dialog').open,false);
  assert.equal(log.children.length,0);
  // Cookie switch while an otherwise valid personal response is in flight:
  // validate the current session again before showing its content.
  activeId='s';holdContext=true;
  await elements.get('student-help-choose').listeners.click();
  actions.children[0].listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(releaseContext);
  activeId='b';releaseContext();holdContext=false;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('student-choice-dialog').open,false);
  assert.equal(log.children.length,0);
  // Ordinary localStorage switches close immediately, before the old
  // consent handler can submit a request.
  activeId='s';storageToken='token-a';
  await elements.get('student-help-choose').listeners.click();
  const oldConsent=actions.children[0],beforeCalls=contextCalls;
  storageToken='token-b';activeId='b';
  windowStub.listeners.storage({key:'boekenbaai_token'});
  oldConsent.listeners.click();
  assert.equal(contextCalls,beforeCalls);
  assert.equal(log.children.length,0);
  activeId='s';storageToken='cookie';
  await elements.get('student-help-choose').listeners.click();
  documentStub.visibilityState='hidden';documentStub.listeners.visibilitychange();
  assert.equal(elements.get('student-choice-dialog').open,false);
  documentStub.visibilityState='visible';
  blocked=true;
  await elements.get('student-help-choose').listeners.click();
  assert.match(log.children[0].children[0].textContent,/geblokkeerd.*mentor/);
  assert.equal(actions.children.length,0);
  console.log('Choice chat: approved route, dynamic followups, back, privacy and blocked state: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
