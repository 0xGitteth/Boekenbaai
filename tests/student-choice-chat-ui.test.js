'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'public','student-book-choice-chat.js'),'utf8');
function node(tag='div'){
  return {tag,children:[],listeners:{},value:'',textContent:'',isConnected:true,
    disabled:false,open:false,attrs:{},style:{},
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
  'student-choice-chat-actions','student-choice-chat-status','student-choice-close'];
const elements=new Map(ids.map(id=>[id,node()]));
const makeResponse=(status,body)=>({
  ok:status>=200&&status<300,status,
  json:async()=>body,
});
let resolvePin;
let loggedIn=false;
let blocked=false;
let failSuggest=false;
let resetStatus=200;
let holdSuggestions=false,releaseSuggestion=null;
const invalidated=[];
const suggestRequests=[];
const questionRequests=[];
const fetchStub=async (url,options={})=>{
  if(url==='/api/me')return loggedIn
    ? makeResponse(200,{id:'s',role:'student',firstName:'Sanne'})
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
    assert.equal(JSON.parse(options.body).consent,true);
    return makeResponse(200,{recent:null,favorites:[]});
  }
  if(url==='/api/auth/student-pin/choice-interpret'){
    assert.equal(JSON.parse(options.body).text,'Een mysterie zonder moord');
    return makeResponse(200,{recognized:true,prefer:['mystery'],avoid:['murder'],labels:{mystery:'mysteries',murder:'moord'}});
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
  localStorage:{getItem(){return null;}},
  addEventListener(){},
  BoekenbaaiResolveApiUrl:route=>route,
};
const documentStub={
  activeElement:node('button'),
  getElementById:id=>elements.get(id)||null,
  createElement:node,
};
vm.runInNewContext(code,{
  window:windowStub,document:documentStub,fetch:fetchStub,
  setTimeout,clearTimeout,AbortController,console,
});
(async()=>{
  await elements.get('student-help-choose').listeners.click();
  const actions=elements.get('student-choice-chat-actions');
  const log=elements.get('student-choice-chat-log');
  assert.equal(log.children.length,1,
    'The chat should open with one conversational message, not two introductory messages');
  assert.match(log.children[0].children[0].textContent,/Log in voor persoonlijke tips/);
  const firstChoice=actions.children.find(x=>x.textContent==='Inloggen');
  assert.ok(actions.children.some(x=>x.textContent==='Zonder inloggen'));
  firstChoice.listeners.click();
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
  assert.ok(actions.children.some(x=>x.textContent==='Vertel zelf wat je zoekt'));
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
  actions.children.find(x=>x.textContent==='Ontdek mijn interesses').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(log.children.some(row=>row.children[0]?.textContent==='Welke situatie maakt je nieuwsgierig?'));
  elements.get('student-choice-close').listeners.click();
  await elements.get('student-help-choose').listeners.click();
  actions.children[0].listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  actions.children.find(x=>x.textContent==='Vertel zelf wat je zoekt').listeners.click();
  const free=actions.children[0];
  assert.equal(free.tag,'form');
  free.children[1].value='Een mysterie zonder moord';
  await free.listeners.submit({preventDefault(){}});
  assert.ok(log.children.some(row=>row.children[0]?.textContent.includes('Heb ik dat goed begrepen')));
  actions.children.find(x=>x.textContent==='Ja, zoek boeken').listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(suggestRequests.at(-1).choices.openSignals,{prefer:['mystery'],avoid:['murder']});
  assert.equal(suggestRequests.at(-1).choices.useReadingHistory,true);
  assert.ok(!JSON.stringify(suggestRequests.at(-1)).includes('Een mysterie zonder moord'));

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
  actions.children.find(x=>x.textContent==='Vorige vraag').listeners.click();
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
  blocked=true;
  await elements.get('student-help-choose').listeners.click();
  assert.match(log.children[0].children[0].textContent,/geblokkeerd.*mentor/);
  assert.equal(actions.children.length,0);
  console.log('Choice chat: approved route, dynamic followups, back, privacy and blocked state: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
