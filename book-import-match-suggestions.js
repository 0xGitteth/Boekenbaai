'use strict';

// These are candidates for a teacher to verify against the PHYSICAL book,
// never automatic ISBN repairs. Import confirmation continues to use the
// unchanged, server-side edition, quantity, loan and barcode checks.
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const {sameBookTitle,nearlySameBookText}=require('./book-import-autonomy');

const MAX_SUGGESTIONS=4;
const previewText=(value,max=180)=>typeof value==='string'?value.trim().slice(0,max):'';
const goodIsbn=book=>canonicalizeBookIsbn13(book?.editionIsbn)
  ||canonicalizeBookIsbn13(book?.metadataIsbn)
  ||canonicalizeBookIsbn13(book?.isbn13)
  ||canonicalizeBookIsbn13(book?.barcode);
const validCover=value=>typeof value==='string'
  &&/^https:\/\/[^\s"'<>]{1,600}$/i.test(value)?value:'';

function identityCompatible(row,candidate){
  if(!row?.title||!row?.author||!candidate?.title||!candidate?.author)return false;
  return sameBookTitle(row.title,candidate.title)
    &&nearlySameBookText(row.author,candidate.author);
}

function bookMatchSuggestions(row,existingBooks=[]){
  if(!row?.book||row.status==='skipped')return [];
  const source=row.book;
  const targetIsbn=canonicalizeBookIsbn13(source.editionIsbn);
  const requireSuggestions=!targetIsbn
    ||(row.issues||[]).some(issue=>issue.severity==='conflict'
      &&['metadata_title_conflict','edition_identity_conflict',
        'conflicting_edition_isbns','metadata_identifier_conflict'].includes(issue.code));
  if(!requireSuggestions)return [];
  const results=new Map();
  const put=(candidate)=>{
    if(!candidate.editionIsbn && candidate.origin!=='existing')return;
    const key=candidate.origin+':'+candidate.editionIsbn+':'
      +candidate.title.toLocaleLowerCase('nl');
    const previous=results.get(key);
    if(!previous){
      results.set(key,candidate);
    }else{
      previous.copies=Math.max(previous.copies||0,candidate.copies||0);
      previous.sources=[...new Set([...previous.sources,...candidate.sources])].slice(0,4);
      if(!previous.coverUrl&&candidate.coverUrl)previous.coverUrl=candidate.coverUrl;
    }
  };
  // A valid ISBN on a pre-existing physical book is a useful proposal
  // ONLY when both title and author match the worksheet. No IDs, borrowers,
  // class names, loan history or physical barcodes are exposed.
  const existingGroups=new Map();
  for(const book of Array.isArray(existingBooks)?existingBooks:[]){
    if(!identityCompatible(source,book))continue;
    const isbn=goodIsbn(book);
    const identity=[isbn,previewText(book.title),previewText(book.author)].join('|');
    let group=existingGroups.get(identity);
    if(!group){
      group={origin:'existing',editionIsbn:isbn,
        title:previewText(book.title),author:previewText(book.author),
        coverUrl:validCover(book.coverUrl),publisher:previewText(book.publisher,100),
        language:previewText(book.language,20),sources:[],copies:0};
      existingGroups.set(identity,group);
    }
    group.copies++;
  }
  for(const group of existingGroups.values())put(group);
  // Title/author lookups are discovery, not exact-edition proof. Retain
  // source-attributed candidates without promoting them to safe writes.
  for(const suggestion of Array.isArray(row.onlineMatchCandidates)
    ?row.onlineMatchCandidates:[]){
    const isbn=canonicalizeBookIsbn13(suggestion.editionIsbn);
    if(!isbn)continue;
    const candidate={
      origin:'online',editionIsbn:isbn,
      title:previewText(suggestion.title||source.title),
      author:previewText(suggestion.author||source.author),
      coverUrl:validCover(suggestion.coverUrl),
      publisher:previewText(suggestion.publisher,100),
      language:previewText(suggestion.language,20),
      sources:Array.isArray(suggestion.sources)
        ?suggestion.sources.map(s=>previewText(s,50)).filter(Boolean).slice(0,4):[],
      copies:0,unverifiedTitle:suggestion.unverifiedTitle===true,
    };
    put(candidate);
  }
  const isNear=(isbn)=>{
    const raw=[row.identifierAnalysis?.explicit?.raw,
      row.identifierAnalysis?.legacy?.raw,
      row.identifierAnalysis?.ambiguous?.raw]
      .find(Boolean);
    const digits=String(raw||'').replace(/[^0-9X]/gi,'');
    if(digits.length!==13||isbn.length!==13)return false;
    return [...isbn].filter((digit,index)=>digit!==digits[index]).length===1;
  };
  return [...results.values()].sort((a,b)=>{
    const score=x=>(x.editionIsbn?6:0)
      +(x.origin==='existing'?5:0)
      +(x.editionIsbn&&isNear(x.editionIsbn)?4:0)
      +(identityCompatible(source,x)?3:0)
      +(x.sources?.length>=2?2:0)
      +(x.coverUrl?1:0);
    return score(b)-score(a)
      ||a.title.localeCompare(b.title,'nl');
  }).slice(0,MAX_SUGGESTIONS);
}
module.exports={bookMatchSuggestions,identityCompatible};
