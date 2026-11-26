'use strict';
const assert=require('node:assert/strict');
const {createSourceGate}=require('../book-enrichment-source-gate');
let now=1000;
const gate=createSourceGate({now:()=>now});
const first=gate.claim('boekenbase');
assert.equal(first.ok,true);
assert.equal(gate.claim('easycb').status,'busy');
first.finish('rate_limited');
assert.equal(gate.claim('boekenbase').status,'cooldown');
assert.equal(gate.claim('boekenbase').retryAt,61000);
const other=gate.claim('easycb');
assert.equal(other.ok,true);
first.finish('found');
assert.equal(gate.claim('open_library').status,'busy');
other.finish('found');
for(let i=0;i<4;i++)gate.claim('easycb').finish('found');
assert.equal(gate.claim('easycb').status,'cooldown');
assert.equal(gate.claim('brave').status,'invalid_source');
now=61000;
const next=gate.claim('boekenbase');
assert.equal(next.ok,true);
next.finish('timeout');
assert.equal(gate.claim('easycb').ok,true);
const {createEnrichmentSources}=require('../book-enrichment-sources');
const {createIsbnLookup}=require('../isbn-lookup-core-impl');
async function verifyRateLimits(){
  const isbn='9789086960088';
  const book={metadataIsbn:isbn,title:'Testtitel',author:'Test Auteur'};
  let requests=0;
  const fetchImpl=async()=>{requests++;return new Response(null,{status:429});};
  const env={BOEKENBAAI_EASYCB_CONTACT:'test@example.org',GOOGLE_BOOKS_API_KEY:'test'};
  const lookup=createIsbnLookup({env,fetchImpl});
  const sources=createEnrichmentSources({env,fetchImpl,isbnLookup:lookup});
  for(const source of ['boekenbase','easycb','bureau_isbn','google_books','open_library']){
    const before=requests;
    const result=await sources.probe(source,book);
    assert.equal(result.status,'rate_limited',source);
    assert.equal(requests,before+1,'Stop further HTTP requests for '+source);
  }
  console.log('Provider-specific cooldown, bounded requests and exclusive claims passed.');
}
verifyRateLimits().catch(e=>{console.error(e);process.exitCode=1;});
