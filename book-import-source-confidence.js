'use strict';

// Per-edition source comparison. A merged Google/OpenLibrary result counts as
// zero independent votes. Only individual, matched provider replies qualify.
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const PROVIDERS=new Set(['bureau isbn','googlebooks','openlibrary','isbnbarcode.org']);
function normalizeSource(value) {
  const text=typeof value==='string'?value.toLowerCase().trim():'';
  if(text==='google books'||text==='googlebooks')return 'googlebooks';
  if(text==='open library'||text==='openlibrary')return 'openlibrary';
  if(text==='bureau isbn')return 'bureau isbn';
  if(text==='isbnbarcode.org')return 'isbnbarcode.org';
  return '';
}
const FIELDS=new Set(['title','author','publisher']);

function display(value) {
  return typeof value==='string'?value.normalize('NFC').replace(/\s+/gu,' ').trim():'';
}
function comparison(value) {
  return display(value).normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
}
function equivalentSpelling(a,b) {
  const left=comparison(a),right=comparison(b);
  return Boolean(left&&right&&left===right);
}
function independentVotes(isbn,field,entries) {
  if(!FIELDS.has(field)||!Array.isArray(entries))return [];
  const target=canonicalizeBookIsbn13(isbn);
  if(!target)return [];
  const byProvider=new Map();
  for(const entry of entries){
    const provider=normalizeSource(entry?.source);
    if(!PROVIDERS.has(provider)||byProvider.has(provider)
      ||canonicalizeBookIsbn13(entry.editionIsbn)!==target)continue;
    const value=display(entry[field]);
    if(!value)continue;
    byProvider.set(provider,{
      source:provider,value,
      authors:Array.isArray(entry.authors)
        ?entry.authors.map(display).filter(Boolean):[],
    });
  }
  return [...byProvider.values()].sort((a,b)=>a.source.localeCompare(b.source));
}
function sourceConsensus(isbn,field,entries) {
  const votes=independentVotes(isbn,field,entries);
  const groups=new Map();
  for(const vote of votes){
    // Accent, spacing and punctuation variants are the same orthographic
    // claim. Two independent providers must not become opposing votes solely
    // because one writes "P.S." and another writes "PS".
    const key=comparison(vote.value);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(vote);
  }
  const ranked=[...groups.values()].sort((a,b)=>
    b.length-a.length||a[0].value.localeCompare(b[0].value,'nl'));
  const winners=ranked[0]||[];
  const runnerUp=ranked[1]?.length||0;
  return {votes,value:winners[0]?.value||'',
    authors:winners[0]?.authors||[],
    agreeing:winners.length,conflicting:winners.length<=runnerUp,
    sources:winners.map(vote=>vote.source)};
}
function decide({isbn,field,excel,current,evidence=[]}){
  const incoming=display(excel);
  const old=display(current);
  const consensus=sourceConsensus(isbn,field,evidence);
  const base={field,confidence:'medium',sourceCount:consensus.votes.length,
    agreeingSources:consensus.sources,sourceValue:consensus.value,
    excelValue:incoming,currentValue:old};
  if(!incoming||!FIELDS.has(field))return {...base,action:'excel',value:excel,
    reason:'Geselecteerde ingevulde Excelkolom'};
  if(consensus.value && consensus.agreeing>=2 && !consensus.conflicting
    && equivalentSpelling(incoming,consensus.value)){
    return {...base,confidence:'high',action:'source',
      value:consensus.value,authors:consensus.authors,
      reason:consensus.agreeing+' onafhankelijke ISBN-bronnen bevestigen dezelfde schrijfwijze'};
  }
  if(consensus.value && consensus.agreeing===1 &&!consensus.conflicting
    &&equivalentSpelling(incoming,consensus.value)
    &&(!old||equivalentSpelling(old,incoming))){
    return {...base,action:'source',value:consensus.value,authors:consensus.authors,
      reason:'Eén ISBN-bron bevestigt een equivalente schrijfwijze'};
  }
  if(['title','author'].includes(field) && old
    &&!equivalentSpelling(incoming,old)){
    return {...base,action:'keep',value:old,
      reason:'Bestaande titel of auteur behouden; inhoudelijk afwijkende schrijfwijze niet zeker'};
  }
  return {...base,action:'excel',value:excel,
    reason:consensus.votes.length
      ?'Geen onafhankelijke bronovereenstemming, geldige Excelwaarde voorgesteld'
      :'Geen onafhankelijke bronnen geraadpleegd; geselecteerde Excelwaarde voorgesteld'};
}
module.exports={normalizeSource,equivalentSpelling,independentVotes,sourceConsensus,decide};
