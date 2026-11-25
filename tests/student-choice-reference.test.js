'use strict';
const assert=require('node:assert/strict');
const {lookup,getReference,cleanQuery,isbn13}=require('../student-choice-reference');
const {SERIES,partFor,nextPart}=require('../student-choice-series');
const {rankBooks}=require('../student-choice-recommendations');
const db={books:[
 {id:'hp1',title:'Harry Potter en de steen der wijzen',author:'J.K. Rowling',themes:['Fantasy'],pageCount:200},
 {id:'hp2a',title:'Harry Potter en de geheime kamer',author:'J.K. Rowling',themes:['Fantasy'],status:'borrowed'},
 {id:'hp2b',title:'Harry Potter en de geheime kamer',author:'J.K. Rowling',themes:['Fantasy']},
 {id:'hp3',title:'Harry Potter en de gevangene van Azkaban',author:'J.K. Rowling',themes:['Fantasy'],catalogHidden:true},
 {id:'other',title:'Harry Potter en de geheime kamer',author:'Een andere auteur',themes:['Fantasy']},
 {id:'crime',title:'Het onderzoek',author:'A',themes:['Misdaad'],description:'Politieonderzoek naar criminaliteit.'},
 {id:'outsidecopy',title:'Een vreemde wereld',author:'A. Auteur',themes:['Fantasy']},
 {id:'private',title:'Privéboek',author:'A',personalLoanOnly:true}
],readingRecords:[{subjectType:'student',subjectId:'a',bookId:'hp2a',finished:true}]};
const first=db.books[0];
assert.equal(SERIES.length,10);
assert.equal(partFor(first).part.number,1);
assert.equal(partFor({title:'Harry Potter - Orde van de Feniks',author:'J. K. Rowling'}).part.number,5);
assert.equal(partFor({title:'Vette pech!',author:'Jeff Kinney'}).part.number,2);
assert.equal(partFor({title:'Vette pech!',author:'Onbekende auteur'}),null);
assert.equal(partFor({title:'Harry Potter en de vervloekte kind',author:'J.K. Rowling'}),null);
assert.equal(nextPart(db,first).series.number,1);
assert.deepEqual(nextPart(db,first,undefined,'a',true).readParts,[2]);
const result=nextPart(db,first,1);
assert.equal(result.status,'found');
assert.equal(result.suggestion.bookId,'hp2b');
assert.equal(result.suggestion.available,1);
assert.equal(result.suggestion.total,2);
assert.equal(nextPart(db,first,1,'a',true).status,'already_read');
assert.equal(nextPart(db,first,2,'a',true).status,'not_in_collection');
assert.equal(nextPart(db,first,1,'a',false,{avoid:['fantasy']}).status,'excluded');
assert.equal(nextPart(db,first,7).status,'last_known');
assert.equal(cleanQuery({title:'https://example.invalid'}),null);
assert.equal(cleanQuery({title:'leerling@example.nl'}),null);
assert.equal(isbn13('0-7475-3269-9'),'9780747532699');
(async()=>{
 let calls=0;
 const nope=async()=>{calls++;throw Error('No network expected');};
 let r=await lookup(db,{title:'Harry Potter en de steen der wijzen'},{fetchImpl:nope});
 assert.equal(r.matches[0].bookId,'hp1');
 assert.equal(calls,0);
 r=await lookup(db,{title:'Privéboek'},{fetchImpl:nope});
 assert.equal(r.matches.length,0);
 assert.equal(calls,0);
 r=await lookup(db,{title:'Niet in collectie'},{fetchImpl:nope});
 assert.equal(r.status,'not_found');
 assert.equal(calls,0);
 const requests=[];
 const mock=async(url,opts)=>{
  requests.push({url,opts});
  const u=new URL(url);
  if(u.hostname==='www.googleapis.com')return {ok:true,json:async()=>({items:[{volumeInfo:{
    title:'De externe bende',authors:['B. Auteur'],description:'Een crimineel in een drugsbende.',categories:['Criminaliteit'],industryIdentifiers:[]}}]})};
  assert.equal(u.hostname,'openlibrary.org');
  return {ok:true,json:async()=>({docs:[{title:'De externe bende',author_name:['B. Auteur'],subject:['Crime']},
   {title:'Onverwante titel',author_name:['C']} ]})};
 };
 const opts={external:true,fetchImpl:mock,env:{GOOGLE_BOOKS_API_KEY:'test-key'},now:()=>Date.now()+2000};
 r=await lookup(db,{title:'De externe bende'},opts);
 assert.equal(r.matches.length,1);
 assert.equal(r.matches[0].title,'De externe bende');
 assert.ok(r.matches[0].externalRef);
 const token=r.matches[0].externalRef;
 assert.ok(getReference(token));
 assert.equal(getReference('invalid'),null);
 assert.ok(requests.every(x=>!x.url.includes('test-key')));
 assert.ok(requests.every(x=>!x.url.includes('hp1')&&!x.url.includes('studentId')));
 const ranked=rankBooks(db,{route:'new',externalRef:token,openSignals:{prefer:['crime'],avoid:[]},seed:'external'});
 assert.ok(ranked.suggestions.some(b=>b.bookId==='crime'));
 assert.ok(!ranked.suggestions.some(b=>b.title==='De externe bende'));
 const count=requests.length;
 await lookup(db,{title:'De externe bende'},opts);
 assert.equal(requests.length,count,'cache');
 console.log('School-first lookup, provider isolation, external reference ranking and verified series order OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
