'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

async function run(){
  const script=fs.readFileSync(path.join(__dirname,
    '../public/admin-book-import-review.js'),'utf8');
  const start=script.indexOf('    let draftSavePending=false;');
  const end=script.indexOf('    const setNotice = ',start);
  assert.ok(start>0&&end>start,'Autosave implementation must exist');
  const source=script.slice(start,end);
  const code=[
    "let stage={id:'test-stage',revision:1,mode:'unified_sync',status:'open',draft:null};",
    'let remotePending=null,busy=false,draftSaveTimer=null,draftSaveInFlight=false;',
    'let warningsAccepted=false,corrections=new Map([[0,{index:0,fields:{title:"First choice"}}]]);',
    'let inventoryResolutions=new Map(),assignmentResolutions=new Map();',
    'let metadataResolutions=new Map(),dirty=true,notices=[],renderCount=0;',
    "const rootPath='/api/admin/book-import-stages';",
    'const hasUnreviewedChanges=()=>dirty;',
    'const request=endpoint;',
    'const setNotice=message=>notices.push(message);',
    'const render=()=>{renderCount++;};',
    'const setTimeout=fn=>setImmediate(fn);',
    'const clearTimeout=handle=>clearImmediate(handle);',
    source,
    'return {flushGuidedDraft,scheduleGuidedDraftSave,',
    'setCorrection:value=>{corrections.set(0,{index:0,fields:{title:value}});dirty=true;scheduleGuidedDraftSave();},',
    'revert:()=>{dirty=false;corrections.clear();scheduleGuidedDraftSave();},',
    'state:()=>({draft:stage.draft,notices,renderCount,draftSaveInFlight,draftSavePending})};',
  ].join('\n');
  const make=new Function('endpoint',code);
  const sent=[];
  let resolveFirst;
  const endpoint=async(url,body)=>{
    sent.push(body);
    if(sent.length===1)
      return new Promise(resolve=>{resolveFirst=resolve;});
    return {persisted:true,cleared:body.clear===true,
      savedAt:'2026-11-15T20:00:00.000Z'};
  };
  const flow=make(endpoint);
  const saving=flow.flushGuidedDraft();
  assert.equal(sent.length,1);
  assert.equal(sent[0].corrections[0].fields.title,'First choice');

  flow.setCorrection('Second choice');
  assert.equal(flow.state().draftSavePending,true,
    'Second edit must not get lost during first pending save');
  resolveFirst({persisted:true,cleared:false,
    savedAt:'2026-11-15T20:00:00.000Z'});
  await saving;
  for(let i=0;i<30&&sent.length<2;i++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,2,
    'Second edit must be saved after first request settles');
  assert.equal(sent[1].corrections[0].fields.title,'Second choice');

  for(let i=0;i<30&&flow.state().draft?.corrections?.[0]
    ?.fields?.title!=='Second choice';i++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(flow.state().draft.corrections[0].fields.title,'Second choice');

  flow.revert();
  for(let i=0;i<30&&sent.length<3;i++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,3);
  assert.equal(sent[2].clear,true,
    'Reverting choices must erase the stale server-side draft');
  for(let i=0;i<30&&flow.state().draft;i++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(flow.state().draft,null);
  assert.ok(flow.state().renderCount>0,
    'The final confirmation button is rerendered after clearing');
  console.log('Guided autosave: edits during in-flight request, reverse and clear OK');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
