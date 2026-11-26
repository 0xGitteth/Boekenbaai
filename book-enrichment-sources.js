'use strict';
const {isbnOf,fetchEasyCb,validContact}=require('./book-free-metadata');
const {createIsbnLookup}=require('./isbn-lookup-core-impl');
const {fetchBoekenBase}=require('./book-boekenbase');

const SOURCE_ORDER=['boekenbase','bureau_isbn','easycb','google_books','open_library','isbnbarcode'];
const SOURCE_NAMES={boekenbase:'BoekenBase',bureau_isbn:'Bureau ISBN',easycb:'EasyCB',
  google_books:'Google Books',open_library:'Open Library',isbnbarcode:'ISBNBarcode'};
const sourceRank=source=>{const i=SOURCE_ORDER.indexOf(source);return i<0?SOURCE_ORDER.length:i;};
function createEnrichmentSources({env=process.env,fetchImpl=globalThis.fetch,
  boekenbase=fetchBoekenBase,easycb=fetchEasyCb,isbnLookup=createIsbnLookup({env,fetchImpl})}={}){
  const contact=env.BOEKENBAAI_EASYCB_CONTACT||'';
  const available=new Map(isbnLookup.availableSources().map(s=>[s.id,s.enabled]));
  available.set('boekenbase',true);
  available.set('easycb',validContact(contact));
  function list(){return SOURCE_ORDER.map(id=>({id,name:SOURCE_NAMES[id],enabled:available.get(id)===true}));}
  async function probe(source,book){
    const isbn=isbnOf(book);
    if(!isbn)return {status:'invalid_isbn',metadata:null};
    if(available.get(source)!==true)return {status:'not_configured',metadata:null};
    try{
      let rateLimited=false;
      const checkedFetch=async(...args)=>{
        const response=await fetchImpl(...args);
        if(response?.status===429)rateLimited=true;
        return response;
      };
      const result=source==='boekenbase'?await boekenbase(isbn,{fetchImpl})
        :source==='easycb'?await easycb(isbn,{contact,fetchImpl:checkedFetch})
        :await isbnLookup.lookupSource(source,isbn);
      if(rateLimited)return {status:'rate_limited',metadata:null};
      if(!result||typeof result.status!=='string')return {status:'invalid_response',metadata:null};
      if(result.status==='found'&&result.metadata&&['bureau_isbn','google_books'].includes(source)){
        // Existing ISBN parsers expose their classification systems as tags.
        // Preserve them as source categories instead of calling them verified
        // content keywords or counting them towards content coverage.
        const categories=Array.isArray(result.metadata.tags)?result.metadata.tags:[];
        return {...result,metadata:{...result.metadata,categories,tags:[]}};
      }
      return result;
    }catch{return {status:'error',metadata:null};}
  }
  return {list,probe};
}
module.exports={SOURCE_ORDER,SOURCE_NAMES,sourceRank,createEnrichmentSources};
