'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  addJob,getJobPlan,approveJob,currentUsage,claimNext,finishClaim,
}=require('../book-brave-core');
const {parseMonthlyRemaining}=require('../book-brave-fetch');
const {listDeferredBookTasks}=require('../book-import-deferred-book-tasks');

const fakeHeaders=(policy,remaining)=>({headers:{get(name){
  if(name==='x-ratelimit-policy')return policy;
  if(name==='x-ratelimit-remaining')return remaining;
  return null;
}});

// A short-window zero is not proof of zero MONTHLY credit.
assert.equal(parseMonthlyRemaining(fakeHeaders('2;w=1, 50;w=60','0, 49')),null);
assert.equal(parseMonthlyRemaining(fakeHeaders('2;w=1, 900;w=2592000','0, 899')),899);
assert.equal(parseMonthlyRemaining(fakeHeaders('2;w=1, 900;w=2592000','1, 0')),0);
assert.equal(parseMonthlyRemaining(fakeHeaders('', '0, 500')),null);

const env={BOEKENBAAI_BRAVE_MONTHLY_CAP:'12'};
const now=new Date('2026-11-17T12:00:00Z');
const copy={id:'copy-1',title:'Een geheim',author:'Auteur',
  metadataIsbn:'9789083316642',coverUrl:'',description:'',tags:[]};
const db={books:[copy],braveUsage:{month:'2026-11',reserved:1,
  providerRemaining:0},braveEnrichmentJobs:[]};
const job=addJob(db,['copy-1'],{id:'brave-legacy'});
job.state='paused';
job.lastError='budget_exhausted';
assert.equal(currentUsage(db,now,env).providerRemaining,null,
  'Old stored zero must not be considered a verified monthly limit');
assert.equal(currentUsage(db,now,env).legacyProviderRemaining,0);
const plan=getJobPlan(db,job,{braveConfigured:true,now,env});
assert.equal(plan.possibleWorks,1,
  'An unverified old zero must not permanently disable reapproval');
assert.equal(plan.canApprove,true);
assert.equal(job.state,'paused',
  'Fixing the budget calculation must NEVER automatically resume a paused job');
assert.equal(approveJob(db,job.id,{confirmed:true,expectedMonth:'2026-11',
  expectedRequests:3,braveConfigured:true,now,env}).ok,true);
const claim=claimNext(db,{now,env});
assert.equal(claim?.step,0,'Approved work may proceed with old unverified zero');
assert.equal(db.braveUsage.reserved,2);
finishClaim(db,claim,{providerRemaining:null,error:'rate_limited'});
assert.equal(job.state,'paused','A real rate-limit error must pause work safely');
assert.equal(db.braveUsage.reserved,2,'Reserved request is never refunded');

// A confirmed MONTHLY zero must remain a strict, immediate hard stop.
const dbVerified={books:[copy],braveUsage:{month:'2026-11',
  reserved:0,providerRemaining:0,providerRemainingVerified:true},
  braveEnrichmentJobs:[]};
const jobVerified=addJob(dbVerified,['copy-1'],{id:'verified-zero'});
assert.equal(currentUsage(dbVerified,now,env).available,0);
assert.equal(getJobPlan(dbVerified,jobVerified,{braveConfigured:true,now,env}).canApprove,false);

// Repeated tasks are shown as a group, never silently closed.
const item=(id,editionIsbn,title='De perfecte misdaad')=>({
  id,status:'open',batchId:'batch-'+id,editionIsbn,
  title,author:'Auteur',excelIdentifier:'source-'+id,
  fileName:id+'.xlsx',worksheetRow:15,revision:1,createdAt:'2026-11-16',
});
const taskDb={books:[{id:'copy-live',title:'De perfecte misdaad',
  author:'Auteur',metadataIsbn:'9789083316642'}],
  bookImportDeferredBookChecks:[
    item('one','9789083316642'),item('two','9789083316642'),
    item('three','9789000000001'),item('unknown','','Onbekend'),
  ]};
const before=JSON.stringify(taskDb);
const grouped=listDeferredBookTasks(taskDb);
assert.equal(grouped.summary.open,4);
assert.equal(grouped.summary.groups,3);
assert.equal(grouped.summary.repeatedChecks,1);
assert.equal(grouped.tasks.find(task=>task.id==='one').sameEditionCount,2);
assert.equal(grouped.tasks.find(task=>task.id==='one').possibleExistingEdition,true);
assert.equal(grouped.tasks.find(task=>task.id==='three').sameEditionCount,1,
  'Different ISBN editions must not merge even if the title matches');
assert.equal(JSON.stringify(taskDb),before,
  'Listing and grouping must not change the persistent tasks or books');

const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const admin=read('admin-modern.js'),history=read('admin-loan-history.js'),
  ui=read('admin-deferred-book-tasks.js'),
  style=read('admin-modern.css'),
  braveUi=read('admin-book-import-review.js');
assert.match(admin,/api\/admin\/book-import-book-tasks/);
assert.match(admin,/api\/admin\/book-import-assignment-tasks/);
assert.match(admin,/api\/staff\/book-import-followups/);
assert.match(admin,/openstaande boek- en importcontroles/);
assert.match(admin,/loanHistoryAdmin\) panel\.append\(loanHistoryAdmin\)/,
  'Activity/loan layout must not drop the privileged history form');
assert.match(history,/const loanPanel=document\.getElementById\('staff-loan-panel'\)/);
assert.doesNotMatch(history,/historyPanel\.append\(root\)/,
  'Loan history management cannot live inside recent activity');
assert.match(style,/#bb-admin-v31-loans #admin-loan-history-management/);
assert.match(ui,/bb-deferred-book-group/);
assert.match(ui,/destination\.append\(card\)/);
assert.match(ui,/de oude taak is niet automatisch afgesloten/i);
assert.match(braveUi,/usage\.legacyProviderRemaining === 0/);
console.log('Brave quota safety, legacy recovery, task grouping and dashboard layout regressions: OK');
