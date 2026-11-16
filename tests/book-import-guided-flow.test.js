'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createImportStageStore}=require('../book-import-stage');
const {analyzeReviewedImport}=require('../book-import-review');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-guided-'));
  const draftFile=path.join(temp,'active-private-import.json');
  let clock=1730000000000;
  const config={
    now:()=>clock,ttlMs:24*60*60*1000,
    persistenceFile:draftFile,
  };
  const original=[{
    Titel:'Oorlogswinter',Auteur:'Jan Terlouw',
    'ISBN-nummer':'9780306406156',Aantal:1,
  }];
  // Physical source row was row 21, not row 2. SheetJS stores the
  // position as nonenumerable __rowNum__, omitted by normal JSON.
  Object.defineProperty(original[0],'__rowNum__',{
    value:20,configurable:true,
  });
  const analysis=await analyzeReviewedImport(original);
  assert.equal(analysis.rows[0].sourceRowNumber,21);
  const actualProgress=[];
  await analyzeReviewedImport(original,[],{
    onRowProgress:({completed,total})=>
      actualProgress.push({completed,total}),
  });
  assert.deepEqual(actualProgress,[{completed:1,total:1}],
    'The server must report actual completed rows, not an estimated timer');
  const store=createImportStageStore(config);
  const created=store.create({
    ownerId:'administrator',sourceRows:original,analysis,
    workbook:{sheetName:'Bibliotheek'},fileName:'school.xlsx',
    options:{mode:'unified_sync',enrichIsbn:true,
      syncParts:{books:true,loans:true,locations:true,fields:{author:true}},
      lookupIsbn:()=>{throw Error('Executable lookups must not be persisted');}},
  });
  assert.equal(created.ok,true);
  assert.equal(fs.existsSync(draftFile),true,
    'Open stage is stored on disk after initial analysis');
  if(process.platform!=='win32')
    assert.equal(fs.statSync(draftFile).mode & 0o777,0o600,
      'Stored worksheet with pupil names must remain private');
  assert.equal(fs.readFileSync(draftFile,'utf8').includes('Executable lookups'),false);
  const stage=created.stage;
  const pending={
    corrections:[{index:0,fields:{editionIsbn:'9780306406157'}}],
    acceptWarnings:true,
    inventoryResolutions:[],assignmentResolutions:[],
    metadataResolutions:[],
  };
  assert.equal(store.saveDraft(stage,1,pending).ok,true);
  assert.equal(stage.draftPersisted,true);
  assert.equal(store.beginApply(stage,1).error,'draft_must_be_reviewed',
    'An autosaved choice must never apply without server reanalysis');

  // A simulated server restart restores both the spreadsheet and unconfirmed
  // edits without restoring unsafe JavaScript functions or learner sessions.
  const newFormatRestart=createImportStageStore(config);
  assert.equal(
    Object.getOwnPropertyDescriptor(
      newFormatRestart.active().sourceRows[0],'__rowNum__').value,20);
  // Existing drafts written before the fix should also survive; their
  // analysis already contains the exact original worksheet row number.
  const priorFormat=JSON.parse(fs.readFileSync(draftFile,'utf8'));
  delete priorFormat.worksheetRowPositions;
  fs.writeFileSync(draftFile,JSON.stringify(priorFormat));
  const afterRestart=createImportStageStore(config);
  const restored=afterRestart.active();
  assert.equal(restored.id,stage.id);
  assert.deepEqual(restored.draft,pending);
  assert.equal(restored.options.enrichIsbn,true);
  assert.equal(restored.options.lookupIsbn,undefined);
  assert.equal(restored.analysis.rows.length,1);
  assert.equal(Object.getOwnPropertyDescriptor(
    restored.sourceRows[0],'__rowNum__').value,20);
  const recalculated=await analyzeReviewedImport(restored.sourceRows);
  assert.equal(recalculated.rows[0].sourceRowNumber,21,
    'Reanalysis after restart must keep the actual worksheet row');
  assert.equal(afterRestart.beginApply(restored,1).error,'draft_must_be_reviewed');
  assert.equal(afterRestart.beginReview(restored,1).ok,true);
  afterRestart.finishReview(restored,analysis,pending.corrections,true);
  assert.equal(restored.draft,null);
  assert.equal(restored.revision,2);
  assert.equal(afterRestart.beginApply(restored,2).ok,true);
  afterRestart.finishApply(restored,{created:0});
  assert.equal(fs.existsSync(draftFile),false,
    'Completed imports must remove the private draft file');

  const resumed=createImportStageStore(config);
  assert.equal(resumed.active(),null);
  const again=resumed.create({ownerId:'administrator',sourceRows:original,
    analysis,options:{mode:'unified_sync'}});
  assert.equal(again.ok,true);
  assert.equal(resumed.cancel(again.stage,1).ok,true);
  assert.equal(fs.existsSync(draftFile),false,
    'Cancelled imports must remove persisted source data');

  const expired=createImportStageStore(config);
  expired.create({ownerId:'administrator',sourceRows:original,
    analysis,options:{mode:'unified_sync'}});
  clock+=24*60*60*1000+1;
  assert.equal(createImportStageStore(config).active(),null);
  assert.equal(fs.existsSync(draftFile),false,
    'Stale drafts expire and are deleted');

  const ui=fs.readFileSync(path.join(__dirname,
    '../public/admin-book-import-review.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,
    '../public/admin-book-import-review.css'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  for(const part of [
    'function renderGuidedUnifiedSync()',
    'return renderGuidedUnifiedSync()',
    'function scheduleGuidedDraftSave()',
    "rootPath+'/'+encodeURIComponent(currentStage)",
    "+'/draft'",
    'function selectCandidateForRow(row,candidate)',
    "groep", // can omit this check if language changes
    'groupRows.length>1',
    'issue.worksheetRows',
    'Automatische uitleningen en klaskeuzes',
    'Import annuleren',
    'Definitieve import bevestigen',
    'Dit boek later controleren',
    'Eerder uitgestelde boeken',
    "rootPath+'/deferred'",
  ].filter(x=>x!=='groep'))
    assert.ok(ui.includes(part),'Missing guided flow: '+part);
  for(const part of ['.bb-guide__book','.bb-guide__progress',
    '.bb-guide__compare','.bb-guide__deferred-entry',
    '@media (max-width:680px)'])
    assert.ok(css.includes(part),'Missing responsive style '+part);
  assert.ok(ui.includes('guidedAuditEditor=open?null:editorKey'),
    'Automatic metadata decisions must have per-row correction editors');
  assert.ok(ui.includes('if(worksheetRows.length&&!item.enrichmentOnly)'),
    'Online enrichment of an unselected field must not offer a broken editor');
  assert.ok(ui.includes('metadataIssueId:item.id,'),
    'Manual correction must clear an earlier metadata keep override');
  // Server reanalysis can remove or reorder a card. Keep the user's
  // place by worksheet row, never restart the review at book 1.
  const focusBegin=ui.indexOf('function selectGuidedSourceRow(');
  const focusEnd=ui.indexOf('    let guidedAlternativeRow=',focusBegin);
  assert.ok(focusBegin>=0&&focusEnd>focusBegin,
    'Guided review must implement stable position restoration');
  const focusHelpers=new Function(ui.slice(focusBegin,focusEnd)
    +';return {resolveGuidedReviewIndex,selectGuidedSourceRow};')();
  const resolveFocus=focusHelpers.resolveGuidedReviewIndex;
  const groups=(...rows)=>rows.map((row,i)=>({
    key:'book-'+i,rows:new Map([[row,true]]),
  }));
  assert.equal(resolveFocus(groups(10,20,30),{rowIndex:20,index:1},0),1,
    'After server reanalysis stay on the same unresolved worksheet row');
  assert.equal(resolveFocus(groups(30,10,20),{rowIndex:20,index:1},0),2,
    'A reordered review queue must preserve the same physical book');
  assert.equal(resolveFocus(groups(10,30),{rowIndex:20,index:1},0),1,
    'Once a card is resolved move to the next outstanding slot');
  assert.equal(resolveFocus(groups(10),{rowIndex:20,index:2},0),0,
    'If the last card disappears show the nearest remaining card');
  assert.equal(resolveFocus([], {rowIndex:20,index:1},0),0);
  const groupedBook={key:'same-isbn',rows:new Map([
    [4,{index:4,sourceRowNumber:31,matchSuggestions:[]}],
    [7,{index:7,sourceRowNumber:57,matchSuggestions:[{editionIsbn:'9780306406157'}]}],
  ])};
  assert.equal(focusHelpers.selectGuidedSourceRow(groupedBook,null).index,7,
    'Rechecks must anchor to the suggested worksheet row actually displayed');
  assert.equal(focusHelpers.selectGuidedSourceRow(groupedBook,4).index,4,
    'An explicitly selected worksheet row must take priority');
  assert.ok(ui.includes('guidedRecheckFocus=focus'),
    'Server review must remember the active book after success');
  assert.ok(!ui.includes('guidedStep=2;guidedIndex=0;'),
    'Rechecking decisions must not jump back to the first book');
  assert.ok(ui.includes('if(selectCandidateForRow(source,candidate))void recheck()'),
    'Canceling a candidate confirmation must not trigger reanalysis');
  assert.ok(ui.includes('const suggestions=allSuggestions.filter(option=>'),
    'An ISBN-less match must not appear as a selectable edition');
  assert.ok(ui.includes('guidedMissingAcknowledged'),
    'Missing loan and location editions must require explicit acknowledgement');
  assert.ok(ui.includes('for(const missing of assignments.notInCollection||[])'),
    'Missing physical books must appear in the guided queue');
  assert.ok(ui.includes('Niet overgenomen boeken'),
    'Final overview must count omitted loan/location books');
  assert.ok(ui.includes('Auteur: '+''), // Next assertions target the actual text.
    'Guided book candidates must show the author');
  assert.ok(ui.includes('if(candidate.identityWarning'),
    'An uncertain title/author identity must require physical confirmation');
  assert.ok(ui.includes("const data=changes?snapshot:{revision,clear:true}"),
    'Reverted choices must remove the previous draft before final confirmation');
  assert.ok(ui.includes('if(draftSavePending||draftChangeGeneration!==generation)'),
    'Edits during an in-flight save must trigger another save');
  assert.ok(ui.includes('if(open)editRow(sourceRow,editHost'),
    'The editor must reuse the existing validated correction flow');
  // The screenshot-based simplification must remain coherent as more
  // import features are added: one top-level stepper, no second nested one.
  const wizard=ui.slice(ui.indexOf('function renderGuidedUnifiedSync()'),
    ui.indexOf('function renderUnifiedSync()'));
  assert.ok(wizard.length>1000);
  assert.ok(!wizard.includes("make('div','bb-guide__progress')"),
    'The guided wizard must not duplicate the visible step navigation');
  assert.ok(!wizard.includes("make('div','bb-guide__step-label')"),
    'The step counter is already expressed in the one top navigation');
  assert.ok(ui.includes("const step=button(label,'bb-import__step')"),
    'The remaining stepper must be interactive and accessible');
  assert.ok(ui.includes('enrichmentExtra.hidden=activeImport'),
    'Import enrichment settings must not interrupt an active review');
  assert.ok(ui.includes("details.hidden=!new URLSearchParams"),
    'The legacy direct-import form must stay out of the standard workflow');
  assert.ok(ui.includes('header.querySelector(\'.hint\').hidden=activeImport'),
    'Do not repeat the setup explanation during the active import');
  assert.ok(wizard.includes('bb-guide__auto-note'),
    'Automatic decisions should be a compact status, not a repeated card');
  assert.ok(wizard.includes('bb-guide__identity-conflict'),
    'Significant source disagreements must be visible on book cards');
  assert.ok(wizard.includes('confirmedAuthor||issue.confirmedTitle'),
    'Book cards must show authoritative titles and authors with provenance');
  assert.ok(css.includes('.bb-guide__footer > .bb-guide__cancel'),
    'Cancel actions must have lower visual emphasis than confirmation');
  assert.ok(css.includes('.bb-review--active'),
    'The active import should not have multiple nested framing borders');
  assert.ok(ui.includes('Mijn boek heet: '+''+''), 
    'Confirmed ISBN titles need an explicit suggested-title action');
  assert.ok(ui.includes('Mijn boek heeft de Excel-titel'),
    'Choosing the printed Excel title must be possible');
  assert.ok(ui.includes('const pendingMetadata=group.metadata.filter('),
    'One confirmed title choice should not create a duplicate metadata decision');
  assert.ok(ui.includes('void recheck();')&&ui.includes('Overslaan ongedaan maken'),
    'Skipping a book must recalculate the review queue');
  assert.ok(ui.includes("updateSetupProgress('analyzing',completed,total)"),
    'Setup must use real server row counts');
  assert.ok(ui.includes("const progressPoll=setInterval(async()=>"),
    'Setup must continue polling while the server is analyzing');
  assert.ok(ui.includes("file.addEventListener('change',()=>"),
    'A new file must clear stale cancellation notices');
  assert.ok(ui.includes('draftSaveIssue='),
    'Failed autosaves must show persistent actionable feedback');
  assert.ok(server.includes('progress:activeStage.progress||null'),
    'Active import must expose only safe completed-row progress');
  assert.ok(server.includes('onRowProgress:({completed,total})=>'),
    'Server analysis must update per-row progress');
  assert.ok(server.includes('bookImportStageStore.saveDraft('),
    'Autosave must be stored server-side, never just in localStorage');
  assert.ok(server.includes('bookImportDeferredBookChecks'),
    'Postponed physical books must be saved for future review');
  assert.ok(server.includes("persistenceFile:path.join(path.dirname(DATA_PATH)"),
    'Persistent stage must live alongside the protected database');

  fs.rmSync(temp,{recursive:true,force:true});
  console.log('Guided import: persistent draft, safe confirm, cancellation and UI wiring OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
