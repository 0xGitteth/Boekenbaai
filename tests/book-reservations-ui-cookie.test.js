'use strict';
// Browser-level VM regression without network: reservations must work for
// cookie-only sessions, and stale previous-account responses must be discarded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/book-reservations-ui.js'),'utf8');
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};
    this.hidden=false;this.textContent='';this.attributes={};}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  insertAdjacentElement(_where,child){this.append(child);}
}
const host=new Element('section'),heading=new Element('h1');
const nodes=new Map([['#student-profile-view',host]]);
const listeners={};
const calls=[];
let fetchResponses=[];
const document={
  body:{dataset:{page:'student'}},
  querySelector:selector=>nodes.get(selector)||null,
  getElementById:id=>id==='student-profile-title'?heading:null,
  createElement:tag=>new Element(tag),
  addEventListener(type,handler){(listeners[type]||=[]).push(handler);},
};
const window={
  addEventListener(type,handler){(listeners[type]||=[]).push(handler);},
  dispatchEvent(event){for(const handler of listeners[event.type]||[])handler(event);},
};
const localStorage={getItem:()=>null};
const fetch=(url,options)=>{
  calls.push({url,options});
  if(!fetchResponses.length)throw Error('Unexpected fetch');
  return fetchResponses.shift()();
};
const ready=(title)=>({ok:true,json:async()=>({
  reservations:[{id:'reservation-1',title,author:'Auteur',
    status:'waiting',position:1}],
})});
async function flush(){await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  fetchResponses=[()=>Promise.resolve(ready('Mijn nieuwe boek'))];
  vm.runInNewContext(source,{document,window,localStorage,fetch,
    setInterval:()=>1,Date,Intl,console,Event:class Event{
      constructor(type){this.type=type;}
    }});
  await flush();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/book-reservations');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.headers)),{},
    'A browser cookie session must work without a local bearer token');
  assert.equal(calls[0].options.credentials,'same-origin');
  const panel=heading.children.find(n=>n.id==='bb-reservations-panel');
  assert.equal(panel.hidden,false);
  const list=panel.children.find(n=>n.className==='bb-reservations-list');
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].textContent,'Mijn nieuwe boek');

  // A previous pupil's response must not flash on the next pupil's screen.
  let resolveOld;
  fetchResponses=[
    ()=>new Promise(resolve=>{resolveOld=resolve;}),
    ()=>Promise.resolve(ready('Boek van tweede leerling')),
  ];
  window.dispatchEvent({type:'boekenbaai:student-auth-validated'});
  await flush();
  window.dispatchEvent({type:'boekenbaai:student-auth-pending'});
  assert.equal(panel.hidden,true);
  assert.equal(list.children.length,0);
  window.dispatchEvent({type:'boekenbaai:student-auth-validated'});
  resolveOld(ready('Boek van vorige leerling'));
  await flush();await flush();
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].textContent,'Boek van tweede leerling');
  assert.ok(calls.length>=3,'New pupil receives a separate authenticated request');
  window.dispatchEvent({type:'boekenbaai:staff-auth-cleared'});
  assert.equal(panel.hidden,true);
  assert.equal(list.children.length,0);
  console.log('Cookie-only reservation alerts and account-switch privacy: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
