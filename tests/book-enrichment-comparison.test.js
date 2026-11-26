'use strict';
const assert=require('node:assert/strict');
const {recordCheck,getCheck,shouldProbe}=require('../book-enrichment-trial');
const {comparison,applyComparison,compareEdition}=require('../book-enrichment-comparison');
const {createEnrichmentSources}=require('../book-enrichment-sources');
const {createIsbnLookup}=require('../isbn-lookup-core-impl');
const isbn='9789086960088';
const book={id:'one',metadataIsbn:isbn,title:'Testtitel',author:'Test Auteur',
  description:'Korte tekst',tags:['School'],publishedYear:2020,
  importProvenance:{fieldSources:{description:{sourceType:'metadata'},publisher:{sourceType:'manual'}}}};
const other={...book,id:'two',description:'Eigen tekst',importProvenance:{fieldSources:{description:{sourceType:'manual'}}}};
let db={books:[book,other],students:[{id:'s'}],history:[{id:'l'}]};
const base={isbn,title:book.title,author:book.author};
const full='Een uitvoerige beschrijving van het verhaal en de gebeurtenissen. '.repeat(5);
recordCheck(db,book,{status:'found',metadata:{...base,description:full,coverUrl:'https://example.org/front.jpg',
  pageCount:128,publisher:'Uitgever A',publishedYear:2021,tags:['Paarden'],nurCategory:'Fictie 7-9 jaar'}},{source:'boekenbase'});
recordCheck(db,book,{status:'found',metadata:{...base,description:'Kort',pageCount:130,publisher:'Uitgever B',
  tags:['paarden','Vriendschap']}},{source:'open_library'});
recordCheck(db,book,{status:'timeout',metadata:null},{source:'easycb'});
recordCheck(db,book,{status:'found',metadata:{...base,title:'Onjuist boek',pageCount:999}},{source:'bureau_isbn'});
assert.equal(getCheck(db,book,'bureau_isbn').status,'identity_mismatch');
assert.equal(shouldProbe(db,book,false,'boekenbase'),false);
assert.equal(shouldProbe(db,book,false,'easycb'),true);
db=JSON.parse(JSON.stringify(db));
const current=db.books[0],second=db.books[1],view=comparison(db,current);
assert.equal(view.statuses.find(s=>s.source==='easycb').status,'timeout');
assert.equal(view.changes.find(c=>c.field==='description').after,full);
assert.equal(view.changes.find(c=>c.field==='pageCount').after,128);
assert.equal(view.changes.find(c=>c.field==='pageCount').source,'boekenbase');
assert.ok(view.conflicts.some(c=>c.field==='pageCount'));
assert.ok(view.conflicts.some(c=>c.field==='publishedYear'));
assert.ok(!view.changes.some(c=>c.field==='publisher'||c.field==='publishedYear'));
assert.deepEqual(view.changes.find(c=>c.field==='enrichmentTags').after,['Paarden','Vriendschap']);
assert.deepEqual(view.changes.find(c=>c.field==='enrichmentTags').sources,['boekenbase','open_library']);
assert.equal(compareEdition(db,current).length,2);
assert.ok(!comparison(db,second).changes.some(c=>c.field==='description'));
assert.equal(applyComparison(db,current,'old').ok,false);
assert.equal(applyComparison(db,current,view.revision).ok,true);
assert.equal(current.description,full);
assert.equal(current.pageCount,128);
assert.deepEqual(current.tags,['School']);
assert.deepEqual(current.enrichmentTags,['Paarden','Vriendschap']);
assert.equal(second.description,'Eigen tekst');
assert.equal(second.coverUrl,undefined);
assert.deepEqual(db.students,[{id:'s'}]);
assert.deepEqual(db.history,[{id:'l'}]);
assert.ok(getCheck(db,current,'open_library').appliedCopies);
assert.equal(applyComparison(db,current,view.revision).ok,false);
async function run(){
  let calls=0;
  const lookup=createIsbnLookup({env:{GOOGLE_BOOKS_API_KEY:'test'},fetchImpl:async(url,opts)=>{
    calls++;
    assert.ok(url.startsWith('https://www.googleapis.com/books/'));
    assert.equal(opts.headers['x-goog-api-key'],'test');
    return new Response(JSON.stringify({items:[{volumeInfo:{title:book.title,authors:[book.author],
      industryIdentifiers:[{type:'ISBN_13',identifier:isbn}],pageCount:128,categories:['Fiction']}}]}),
      {headers:{'content-type':'application/json'}});
  }});
  const sources=createEnrichmentSources({env:{},isbnLookup:lookup});
  const google=await sources.probe('google_books',book);
  assert.equal(google.status,'found');
  assert.equal(google.metadata.isbn,isbn);
  assert.equal(google.metadata.pageCount,128);
  assert.deepEqual(google.metadata.tags,[]);
  assert.deepEqual(google.metadata.categories,['fiction']);
  assert.ok(calls>0);
  assert.equal((await sources.probe('easycb',book)).status,'not_configured');
  assert.equal((await sources.probe('isbnbarcode',book)).status,'not_configured');
  assert.equal((await sources.probe('unknown',book)).status,'not_configured');
  console.log('Independent provider lookups, durable comparison, provenance and safe approval passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
