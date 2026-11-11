'use strict';
const assert = require('node:assert/strict');
const {
  validContact, isbnOf, parseEasyCb, nextCandidate, applyResult, fetchEasyCb,
} = require('../book-free-metadata');
const {createFreeMetadataWorker} = require('../book-free-metadata-worker');
const isbn = '9789083316642';
const sample = [
  'isbn:' + isbn,
  'title:Het Tegelen van opa en oma',
  'author:Gertie Schouwenberg',
  'pages:80',
  'publisher:Heemkundige Kring Tegelen',
  'publishingdate:20230501',
  'synopsis:Een &amp; ander over de stad.',
  'mutationlog:',
  'CollateralDetail.SupportingResource.0.ResourceVersion.ResourceLink:' + isbn + '_VRK.jpg',
  'CollateralDetail.SupportingResource.1.ResourceVersion.ResourceLink:' + isbn + '_ATK.jpg',
  'DescriptiveDetail.Subject.SubjectHeadingText:Lokaal verleden',
].join('\n');
const source = parseEasyCb(sample, isbn);
assert.equal(source.isbn,isbn);
assert.equal(source.title,'Het Tegelen van opa en oma');
assert.equal(source.description,'Een & ander over de stad.');
assert.equal(source.coverUrl,'https://easycbapi.nl/resources/jpg/'+isbn+'_VRK.jpg');
assert.deepEqual(source.tags,['Lokaal verleden']);
assert.equal(source.publishedYear,2023);
assert.equal(parseEasyCb(sample.replace('isbn:'+isbn,'isbn:9789025869977'),isbn),null,
  'Never attach data returned for a different edition');
assert.equal(validContact('test@example.org'),true);
assert.equal(validContact('invalid'),false);
assert.equal(isbnOf({metadataIsbn:isbn}),isbn);
const noCover = parseEasyCb(sample.replace(isbn+'_VRK.jpg','unrelated.jpg'),isbn);
assert.equal(noCover.coverUrl,'','Do not mistake rear or arbitrary image for front cover');
const current = {
  books:[
    {id:'a',metadataIsbn:isbn,title:source.title,author:'Gertie Schouwenberg',
      description:'Door school geschreven tekst',tags:['Handmatig'],pageCount:null,coverUrl:''},
    {id:'b',metadataIsbn:isbn,title:source.title,author:'Gertie Schouwenberg',
      description:'',tags:[],pageCount:null,coverUrl:''},
    {id:'c',metadataIsbn:isbn,title:'Andere titel',author:'Andere schrijver',
      description:'',tags:[],pageCount:null,coverUrl:''},
  ],
};
const choice = nextCandidate(current.books);
assert.ok(choice);
const changed = applyResult(current,choice,source,'2026-11-11T00:00:00Z');
assert.equal(changed.newCover,true);
assert.equal(current.books[0].description,'Door school geschreven tekst');
assert.deepEqual(current.books[0].tags,['Handmatig']);
assert.equal(current.books[0].pageCount,80);
assert.equal(current.books[1].description,source.description);
assert.equal(current.books[1].coverUrl,source.coverUrl);
assert.equal(current.books[2].description,'');
assert.equal(current.books[2].freeMetadataCheck,undefined);
assert.equal(nextCandidate(current.books,Date.parse('2026-11-12T00:00:00Z'))?.title,'Andere titel');
const staleCover = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg';
const failedUrls = new Set([staleCover]);
const broken = {
  books:[
    {id:'broken',metadataIsbn:isbn,title:source.title,author:source.author,
      description:'Zelf geschreven',tags:['Handmatig'],pageCount:80,coverUrl:staleCover,localCoverUrl:'',
      importProvenance:{fieldSources:{coverUrl:{sourceType:'metadata',sourceDetail:'openlibrary'}}},
      freeMetadataCheck:{checkedAt:'2026-11-11T00:00:00Z',title:source.title,isbn,failedCoverUrl:''}},
    {id:'manual',metadataIsbn:isbn,title:source.title,author:source.author,
      description:'Zelf geschreven',tags:['Handmatig'],pageCount:80,coverUrl:staleCover,localCoverUrl:'',
      importProvenance:{fieldSources:{coverUrl:{sourceType:'manual'}}},
      freeMetadataCheck:{checkedAt:'2026-11-11T00:00:00Z',title:source.title,isbn,failedCoverUrl:''}},
  ],
};
const alternative = nextCandidate(broken.books,Date.parse('2026-11-12T00:00:00Z'),new Set(),failedUrls);
assert.ok(alternative,'A failed image may be retried despite a recent metadata check');
applyResult(broken,alternative,source,'2026-11-12T00:00:00Z','found',failedUrls);
assert.equal(broken.books[0].coverUrl,source.coverUrl,'Replace a verified failed metadata cover');
assert.equal(broken.books[1].coverUrl,staleCover,'Preserve manually selected cover even if broken');
assert.equal(nextCandidate(broken.books,Date.parse('2026-11-13T00:00:00Z'),
  new Set(),failedUrls),null,'Do not repeatedly retry an unchanged failed URL');
const corrected={...broken.books[0],description:'',metadataIsbn:'9789025869977',
  freeMetadataCheck:{checkedAt:'2026-11-11T00:00:00Z',title:source.title,isbn}};
assert.equal(nextCandidate([corrected],Date.parse('2026-11-12T00:00:00Z'))?.isbn,
  '9789025869977','A corrected ISBN must trigger a new lookup');
async function run(){
  let calls=0, changedCover=0;
  const db = {books:[{id:'x',metadataIsbn:isbn,title:source.title,author:source.author,
    description:'',tags:[],pageCount:0,coverUrl:''}]};
  const fetchImpl=async (url,opts)=>{
    calls++;
    assert.ok(url.startsWith('https://easycbapi.nl/isbn/'));
    assert.equal(opts.headers.contact,'school@example.org');
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>sample};
  };
  const disabled=createFreeMetadataWorker({loadDb:()=>db,commit:async()=>{},
    contact:'',fetchImpl});
  disabled.schedule();
  assert.equal(disabled.status().enabled,false);
  assert.equal(calls,0);
  const missingContact=await fetchEasyCb(isbn,{contact:'',fetchImpl});
  assert.equal(missingContact.status,'not_configured');
  assert.equal(calls,0);

  const worker=createFreeMetadataWorker({
    loadDb:()=>db,contact:'school@example.org',fetchImpl,delayMs:1000,
    commit:async callback=>callback(db),onNewCover:()=>changedCover++,
  });
  worker.schedule();
  assert.equal(calls,0,'The import path must not await network requests');
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(calls,1);
  assert.equal(db.books[0].description,source.description);
  assert.equal(db.books[0].coverUrl,source.coverUrl);
  assert.equal(changedCover,1);
  assert.equal(worker.status().pendingWorks,0);
  worker.schedule();
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(calls,1,'Persisted check prevents repeated scraping');
  worker.stop();
  const resumed=createFreeMetadataWorker({loadDb:()=>db,commit:async()=>{},
    contact:'school@example.org',fetchImpl});
  resumed.schedule();
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(calls,1,'Restart respects saved enrichment checkpoint');
  resumed.stop();
  console.log('Free metadata parser, asynchronous processing and checkpoints passed.');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
