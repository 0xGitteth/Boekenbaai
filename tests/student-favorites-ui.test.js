'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const start=code.indexOf('  let favoriteSession=null;'),end=code.indexOf('  function showStudentPage(',start);
assert.ok(start>=0&&end>start);
function node(cls=''){
 return {children:[],dataset:{},hidden:false,disabled:false,textContent:'',listeners:{},
  classList:{contains:x=>x===cls},replaceChildren(){this.children=[];},remove(){},
  querySelectorAll(selector){const all=this.children.flatMap(x=>[x,...x.querySelectorAll(selector)]);return all.filter(x=>x.classList.contains(selector.slice(1)));},
  setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},focus(){ctx.document.activeElement=this;}};
}
const list=node(),card=node(),feedback=node(),retry=node(),grid=node(),heading=node();
let pending=[];
const ctx={authUser:{id:'A',role:'student'},authToken:'cookie',groupedBooks:[],
 favoriteList:list,favoriteCard:card,favoriteFeedback:feedback,favoriteRetry:retry,bookGrid:grid,
 studentActionMessage:node(),document:{activeElement:null,body:node(),visibilityState:'visible',addEventListener(){},querySelector:()=>heading},
 window:{addEventListener(){}},resolveApiUrl:x=>x,renderBooks(){},openBookDetail(){},
 appendElement(parent,tag,opts={}){const x=node(opts.className);parent.children.push(x);return x;},
 appendTextElement(parent,tag,text,opts){const x=ctx.appendElement(parent,tag,opts);x.textContent=text;return x;},
 fetch(url,options){return new Promise(resolve=>pending.push({url,options,resolve}));}};
vm.createContext(ctx);
vm.runInContext(code.slice(start,end)+'\nthis.f={syncFavorites,clearFavorites,changeFavorite,loadFavorites,state:()=>({favoriteSession,favorites,favoritePending})};',ctx);
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 ctx.f.syncFavorites(true);
 assert.match(pending[0].url,/account=A$/);
 ctx.f.clearFavorites();ctx.authUser={id:'B',role:'student'};
 ctx.f.syncFavorites(true);
 pending.shift().resolve(response(401,{}));await flush();
 assert.equal(ctx.f.state().favoriteSession.id,'B');
 pending.shift().resolve(response(200,{studentId:'B',favorites:[{key:'1',title:'Een'},{key:'2',title:'Twee'}]}));await flush();
 const remove=list.querySelectorAll('.bb-favorite-remove')[0];remove.focus();
 const operation=ctx.f.changeFavorite('1',false,undefined,remove);
 pending.shift().resolve(response(500,{message:'Mislukt'}));await operation;
 assert.equal(ctx.document.activeElement.dataset.favoriteKey,'1','Retry focus on failed removal');
 const replacement=ctx.document.activeElement;
 const operation2=ctx.f.changeFavorite('1',false,undefined,replacement);
 pending.shift().resolve(response(200,{studentId:'B',favorites:[{key:'2',title:'Twee'}]}));await operation2;
 assert.equal(ctx.document.activeElement.dataset.favoriteKey,'2','Focus next remaining row');
 const operation3=ctx.f.changeFavorite('2',false,undefined,ctx.document.activeElement);
 pending.shift().resolve(response(200,{studentId:'B',favorites:[]}));await operation3;
 assert.equal(ctx.document.activeElement,heading);
 const current=ctx.f.state().favoriteSession;
 const loading=ctx.f.loadFavorites(current);
 pending.shift().resolve(response(409,{code:'FAVORITE_ACCOUNT_CHANGED'}));await loading;
 assert.equal(ctx.f.state().favoriteSession,null);
 assert.equal(ctx.authUser.id,'B','Do not clear global auth');
 console.log('Favorite account isolation, stale responses and keyboard focus OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
