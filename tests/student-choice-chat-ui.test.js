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
  const firstChoice=actions.children.find(x=>x.textContent==='Ja, met mijn PIN');
  assert.ok(firstChoice,'PIN is integrated as first chat answer');
  firstChoice.listeners.click();
  const form=actions.children[0];
  assert.equal(form.tag,'form','PIN verification is inside the chat, not a separate login page');
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
  assert.ok(actions.children.some(x=>x.textContent==='Iets nieuws ontdekken'),
    'Anonymous chat should advance immediately');
  resolvePin(makeResponse(200,{grant:'valid-late-token',firstName:'Sanne'}));
  await pending;
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(invalidated.includes('valid-late-token'),
    'A late PIN success after switching mode is explicitly revoked');
  assert.ok(!log.children.some(row=>row.children[0]?.textContent?.includes('Hoi Sanne')),
    'A late reply must never revive personalized mode');
  assert.ok(actions.children.some(x=>x.textContent==='Iets nieuws ontdekken'));
  console.log('Choice chat pending PIN response, anonymous switch and privacy cleanup: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
