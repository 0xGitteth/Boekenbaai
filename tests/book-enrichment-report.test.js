'use strict';
const assert=require('node:assert/strict');
const {recordCheck,getCheck,catalogue}=require('../book-enrichment-trial');
const {report,details}=require('../book-enrichment-report');
const {workKey}=require('../book-free-metadata');
const {storeTrialResult}=require('../book-brave-trial');
const isbn='9789086960088';
const book={id:'one',metadataIsbn:isbn,title:'Testtitel',author:'Test Auteur',
  description:'',pageCount:null,coverUrl:'https://example.org/cover.jpg',localCoverUrl:'/covers/one.jpg'};
const copy={...book,id:'two',description:'Een verhaal over paarden en vriendschap.',localCoverUrl:''};
const other={id:'three',title:'Zonder ISBN',author:'Auteur'};
const db={books:[book,copy,other,{...book,id:'personal',personalLoanOnly:true}],students:[{id:'secret'}],history:[]};
const metadata={isbn,title:book.title,author:book.author,pageCount:128,sourceUrl:'https://example.org/book'};
recordCheck(db,book,{status:'found',metadata},{source:'boekenbase',now:new Date(1000)});
recordCheck(db,book,{status:'timeout',metadata:null},{source:'boekenbase',now:new Date(2000)});
recordCheck(db,book,{status:'found',metadata:{...metadata,pageCount:256}},{source:'easycb',now:new Date(3000)});
assert.equal(getCheck(db,book,'boekenbase').status,'found');
assert.deepEqual(getCheck(db,book,'boekenbase').attemptHistory.map(x=>x.status),['found','timeout']);
db.bookEnrichmentChecks={[JSON.stringify([book.id,workKey(book)])]:{brave:{0:{status:'found',checkedAt:new Date(4000).toISOString(),
  evidence:[{field:'description',url:'https://example.org/publisher',confidence:'isbn'}]}}}};
const before=JSON.stringify(db);
const all=report(db,{enabledSources:['boekenbase','easycb'],hasLocalCover:()=>false});
assert.equal(all.counts.all,2);
assert.equal(all.counts.conflicts,1);
assert.equal(all.counts.no_isbn,1);
assert.equal(all.counts.partial,1);
assert.equal(all.counts.unresearched,1);
const row=all.rows.find(r=>r.id===book.id);
assert.equal(row.copies,2);
assert.equal(row.localCovers,0);
assert.equal(row.checked,2);
assert.ok(row.missing.includes('pageCount'));
assert.ok(row.content.textual>0);
assert.equal(report(db,{filter:'conflicts'}).rows.length,1);
assert.equal(report(db,{query:'zonder isbn'}).rows[0].id,'three');
assert.equal(report(db,{limit:1,page:2}).rows.length,1);
const view=details(db,'one');
assert.equal(view.length,2);
assert.equal(view[0].brave[0].evidence[0].url,'https://example.org/publisher');
assert.equal(view[0].statuses.find(s=>s.source==='boekenbase').history.length,2);
assert.equal(details(db,'personal'),null);
assert.equal(catalogue(db)[0].copies,2);
assert.equal(JSON.stringify(db),before,'Diagnostic reads must not modify collection or pupil records');
for(let i=0;i<30;i++)recordCheck(db,book,{status:'not_found',metadata:null},{source:'open_library',now:new Date(5000+i)});
assert.equal(getCheck(db,book,'open_library').attemptHistory.length,20);
const pilot={id:'pilot',source:'trial',state:'paused',bookIds:['one'],trialResults:{}};
const pilotDb={books:[{...book,barcode:'EX-001',description:''}],braveEnrichmentJobs:[pilot]};
storeTrialResult(pilot,{key:workKey(pilotDb.books[0]),step:0},[{
  isbn,title:book.title,author:book.author,confidence:'isbn',
  description:'Een verhaal over twee vrienden die een raadsel proberen op te lossen in een bos en ontdekken wat er jaren geleden met hun familie is gebeurd.',
  sourceUrl:'https://example.org/story',
}]);
const pilotReport=report(pilotDb,{enabledSources:['boekenbase']});
assert.deepEqual(pilotReport.enabledSources,['boekenbase']);
assert.equal(pilotReport.rows[0].freePending,0);
assert.equal(pilotReport.rows[0].bravePending,1);
assert.equal(pilotReport.counts.pending,1);
const pilotDetails=details(pilotDb,'one')[0];
assert.equal(pilotDetails.barcode,'EX-001');
assert.equal(pilotDetails.braveProposals[0].field,'description');
pilot.trialDismissedAt=new Date().toISOString();
assert.equal(report(pilotDb).rows[0].bravePending,0);
console.log('Read-only enrichment coverage, source history, filtering and local cover diagnostics passed.');
