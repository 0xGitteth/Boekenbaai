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
const invalidated=[];
const suggestRequests=[];
const fetchStub=async (url,options={})=>{
  if(url==='/api/me')return makeResponse(401,{message:'Geen toegang'});
  if(url.startsWith('/api/login-search?'))return makeResponse(200,{
    matches:[{id:'s',displayName:'Sanne J. · Bovenbouw'}],
  });
  if(url==='/api/auth/student-pin/choice-begin')
    return new Promise(resolve=>{resolvePin=resolve;});
  if(url==='/api/auth/student-pin/choice-end'){
    invalidated.push(JSON.parse(options.body).choiceGrant);
    return makeResponse(200,{closed:true});
  }
  if(url==='/api/auth/student-pin/choice-suggest'){
    suggestRequests.push(JSON.parse(options.body));
    return makeResponse(200,{suggestions:[1,2,3].map(i=>({
      key:String(i),bookId:'book-'+i,title:'Titel '+i,author:'Auteur',
      reason:'Een willekeurige keuze uit de bibliotheek',available:1,
    }))});
  }
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
  assert.ok(firstChoice,'PIN is integrated as first chat answer');
  firstChoice.listeners.click();
  const form=actions.children[0];
  assert.equal(form.tag,'form','PIN verification is inside the chat, not a separate login page');
  assert.equal(log.children[2].children[0].textContent,'Zoek je naam en vul je PIN in.');
  const name=form.children[1],matches=form.children[2],pin=form.children[4],other=form.children[7];
  name.value='San';name.listeners.input();
  await new Promise(resolve=>setTimeout(resolve,260));
  assert.ok(matches.children.length>0);
  matches.children[0].children[0].listeners.click();
  pin.value='123456';
  const pending=form.listeners.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(resolvePin,'PIN response deliberately held pending');
  other.listeners.click();
  assert.equal(pin.value,'','Switching to anonymous mode must wipe PIN input');
  assert.ok(log.children.some(row=>row.children[0]?.textContent===
    'Wil je zelf ontdekken wat je leuk vindt, of liever meteen een paar boeken bekijken?'),
    'Show the selected exact question to anonymous learners');
  assert.ok(actions.children.some(x=>x.textContent==='Ontdek mijn interesses'),
    'The first answer should start the questionnaire');
  assert.ok(actions.children.some(x=>x.textContent==='Laat me drie boeken zien'),
    'The second answer should show three books immediately');
  assert.equal(actions.children.length,2,'Only the two approved answers appear');
  resolvePin(makeResponse(200,{grant:'valid-late-token',firstName:'Sanne'}));
  await pending;
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(invalidated.includes('valid-late-token'),
    'A late PIN success after switching mode is explicitly revoked');
  assert.ok(!log.children.some(row=>row.children[0]?.textContent?.includes('Hoi Sanne')),
    'A late reply must never revive personalized mode');
  assert.ok(actions.children.some(x=>x.textContent==='Laat me drie boeken zien'));
  const surprise=actions.children.find(x=>x.textContent==='Laat me drie boeken zien');
  surprise.listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(suggestRequests.length,1,'Surprise must immediately query for books');
  assert.equal(suggestRequests[0].choices.route,'surprise');
  assert.equal(suggestRequests[0].choices.activity,undefined,
    'Surprise must not force a question about hobbies');
  assert.equal(suggestRequests[0].anonymous,true);
  assert.equal(log.children.filter(row=>
    row.children[0]?.textContent?.includes('Wat doe je graag')).length,0,
    'Surprise mode must skip the questionnaire');
  assert.ok(actions.children.some(x=>x.textContent==='Nog drie verrassingen'));
  console.log('Choice chat anonymous switch, login wording, instant surprise and privacy: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
