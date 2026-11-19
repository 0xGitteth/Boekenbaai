'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class Element{
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.parent=null;this.handlers={};
    this.id='';this.className='';this.hidden=false;this.textContent='';
    this.isConnected=true;
    const names=new Set();
    this.classList={
      contains:name=>names.has(name),add:name=>names.add(name),
      remove:name=>names.delete(name),
    };
  }
  append(...nodes){for(const node of nodes){node.parent?.removeChild(node);
    node.parent=this;this.children.push(node);}}
  prepend(node){node.parent?.removeChild(node);node.parent=this;this.children.unshift(node);}
  removeChild(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
  remove(){this.parent?.removeChild(this);}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;
    this.children=[];this.append(...nodes);}
  addEventListener(name,fn){this.handlers[name]=fn;}
  querySelector(selector){return null;}
}
const dashboard=new Element('section');
const tasks=new Element('section');
dashboard.querySelector=selector=>selector==='[data-admin-modern-view="tasks"]'
  ?tasks:null;
dashboard.classList.add('hidden');
const staffHost=new Element('div');
const studentHost=new Element('div');
const doc={
  body:{dataset:{page:'staff'}},
  handlers:{},
  addEventListener(name,fn){this.handlers[name]=fn;},
  querySelector(selector){
    if(selector==='#admin-dashboard')return dashboard;
    if(selector==='#admin-staff-link-requests-host')return staffHost;
    if(selector==='#admin-staff-link-requests')return null;
    return null;
  },
  getElementById(id){
    if(id==='admin-student-link-requests-host')return studentHost;
    return null;
  },
  createElement(tag){return new Element(tag);}
};
let observer;
class Observer{
  constructor(cb){observer=cb;}
  observe(){}
}
const callbacks={};let requests=[{
  id:'req-a',studentName:'Leerling A',googleName:'A School',
  classNames:['Klas A'],email:'learner@example.org'
}];
const calls=[];
async function fetch(url,options={}){
  calls.push({url,method:options.method||'GET'});
  if(url==='/api/auth/google/manage')
    return {ok:true,json:async()=>({role:'admin',requests:requests.slice()})};
  if(url==='/api/auth/google/staff-link-requests')
    return {ok:true,json:async()=>({requests:[]})};
  if(url==='/api/auth/google/link-requests/req-a/approve'){
    requests=[];return {ok:true,json:async()=>({ok:true})};
  }
  throw Error('Unexpected network call: '+url);
}
const browser={
  location:{search:''},
  addEventListener(name,fn){callbacks[name]=fn;},
  setInterval(){return 1;},clearInterval(){},dispatchEvent(){},
  confirm(){return true;},alert(msg){throw Error('Unexpected alert: '+msg);},
};
const source=fs.readFileSync(path.join(__dirname,'..',
  'public/staff-google-link.js'),'utf8');
vm.runInNewContext(source,{window:browser,document:doc,
  MutationObserver:Observer,URLSearchParams,fetch,console,
  CustomEvent:class CustomEvent{constructor(name,data){this.type=name;this.detail=data?.detail;}}},{
  filename:'staff-google-link.js'});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  doc.handlers.DOMContentLoaded();
  await flush();
  assert.equal(calls.length,0,'No privileged fetch is made before login');
  assert.equal(studentHost.children.length,0);
  dashboard.classList.remove('hidden');
  observer();
  await flush();
  assert.equal(studentHost.children.length,1,
    'Student request panel appears when admin session starts');
  let panel=studentHost.children[0];
  assert.equal(panel.id,'admin-student-link-request-panel');
  assert.match(panel.children[0].textContent,/Leerlingaccounts goedkeuren \(1\)/);
  const row=panel.children.find(x=>x.tag==='article');
  assert.ok(row,'Student request offers actual approval action');
  const approve=row.children.find(x=>x.children.some(y=>y.textContent==='Goedkeuren'))
    .children.find(x=>x.textContent==='Goedkeuren');
  approve.handlers.click();
  await flush();
  panel=studentHost.children[0];
  assert.match(panel.children[0].textContent,/Leerlingaccounts goedkeuren \(0\)/);
  assert.match(panel.children.at(-1).textContent,/Geen openstaande leerlingkoppelverzoeken/);
  assert.equal(calls.filter(x=>x.url==='/api/auth/google/link-requests/req-a/approve'
    &&x.method==='POST').length,1);
  dashboard.classList.add('hidden');
  observer();
  assert.equal(studentHost.children.length,0,
    'Private pupil requests must not remain visible after logout');
  console.log('Student request lifecycle (login, approve, empty, logout): OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
