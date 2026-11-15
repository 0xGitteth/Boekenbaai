'use strict';

// Suggestions are ONLY for teacher review against the physical book. They
// never bypass server-side edition, quantity, barcode or loan validation.
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const {sameBookTitle,nearlySameBookText,normalized}=require('./book-import-autonomy');
const MAX_SUGGESTIONS=4;
const safeText=value=>typeof value==='string'?value.trim():'';
const goodIsbn=book=>canonicalizeBookIsbn13(book?.editionIsbn)
  ||canonicalizeBookIsbn13(book?.metadataIsbn)
  ||canonicalizeBookIsbn13(book?.isbn13)
  ||canonicalizeBookIsbn13(book?.barcode);
const validCover=value=>typeof value==='string'
  &&/^https:\/\/[^\s"'<>]{1,600}$/i.test(value)?value:'';

function identityCompatible(row,candidate){
  return Boolean(row?.title&&row?.author&&candidate?.title&&candidate?.author
    &&sameBookTitle(row.title,candidate.title)
    &&nearlySameBookText(row.author,candidate.author));
}
function titleKeys(value){
  const words=safeText(value).normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu,'').toLocaleLowerCase('nl')
    .match(/[\p{L}\p{N}]+/gu)||[];
  return {exact:normalized(value),start:words.slice(0,2).join(''),
    end:words.slice(-2).join('')};
}
function addIndex(map,key,item){
  if(!key)return;
  if(!map.has(key))map.set(key,[]);
  map.get(key).push(item);
}

// Build ONCE for a whole import, not once for each worksheet row. One
// object per distinct book identity is stored, no borrower or physical ID.
function buildMatchCandidateIndex(existingBooks=[]){
  const groups=new Map();
  for(const book of Array.isArray(existingBooks)?existingBooks:[]){
    if(!book||typeof book!=='object')continue;
    const title=safeText(book.title),author=safeText(book.author);
    if(!title||!author)continue;
    const isbn=goodIsbn(book);
    const key=JSON.stringify([isbn,title,author]);
    let entry=groups.get(key);
    if(!entry){
      entry={origin:'existing',editionIsbn:isbn,title,author,
        coverUrl:validCover(book.coverUrl),publisher:safeText(book.publisher),
        language:safeText(book.language),sources:[],copies:0};
      groups.set(key,entry);
    }
    entry.copies++;
  }
  const byIsbn=new Map(),byTitle=new Map(),byStart=new Map(),
    byEnd=new Map(),byAuthor=new Map();
  for(const entry of groups.values()){
    const title=titleKeys(entry.title);
    addIndex(byIsbn,entry.editionIsbn,entry);
    addIndex(byTitle,title.exact,entry);
    addIndex(byStart,title.start,entry);
    addIndex(byEnd,title.end,entry);
    addIndex(byAuthor,normalized(entry.author),entry);
  }
  return {byIsbn,byTitle,byStart,byEnd,byAuthor,sourceSize:groups.size};
}
function candidatesFor(row,index){
  const isbn=canonicalizeBookIsbn13(row?.editionIsbn);
  const title=titleKeys(row?.title);
  const pooled=new Set();
  for(const [map,key] of [
    [index.byIsbn,isbn],[index.byTitle,title.exact],
    [index.byStart,title.start],[index.byEnd,title.end],
  ]){
    for(const entry of map.get(key)||[])pooled.add(entry);
  }
  // Typos can change every title prefix/suffix key. A matching author
  // provides a bounded second discovery path without scanning the entire
  // collection for each row. Keep common-author lookups bounded.
  const bySameAuthor=index.byAuthor?.get(normalized(row?.author))||[];
  if(bySameAuthor.length<=120)
    for(const entry of bySameAuthor)pooled.add(entry);
  return [...pooled];
}
function bookMatchSuggestions(row,existingIndex=[]){
  if(!row?.book||row.status==='skipped')return [];
  const source=row.book;
  const index=Array.isArray(existingIndex)
    ?buildMatchCandidateIndex(existingIndex):existingIndex;
  const targetIsbn=canonicalizeBookIsbn13(source.editionIsbn);
  const indexedCandidates=candidatesFor(source,index);
  const mismatchedExisting=Boolean(targetIsbn&&indexedCandidates.some(entry=>
    entry.editionIsbn===targetIsbn&&!identityCompatible(source,entry)));
  const requireSuggestions=!targetIsbn||mismatchedExisting
    ||(row.issues||[]).some(issue=>issue.severity==='conflict'
      &&['metadata_title_conflict','edition_identity_conflict',
        'conflicting_edition_isbns','metadata_identifier_conflict',
        'author_sources_differ'].includes(issue.code));
  if(!requireSuggestions)return [];
  const results=new Map();
  const put=candidate=>{
    if(!candidate.editionIsbn&&candidate.origin!=='existing')return;
    const key=candidate.origin+':'+candidate.editionIsbn+':'
      +candidate.title.toLocaleLowerCase('nl');
    const previous=results.get(key);
    if(!previous)results.set(key,candidate);
    else {
      previous.copies=Math.max(previous.copies||0,candidate.copies||0);
      previous.sources=[...new Set([...previous.sources,...candidate.sources])].slice(0,4);
      if(!previous.coverUrl&&candidate.coverUrl)previous.coverUrl=candidate.coverUrl;
    }
  };
  for(const entry of indexedCandidates){
    const sameIsbn=Boolean(targetIsbn&&entry.editionIsbn===targetIsbn);
    const sameTitle=Boolean(source.title&&sameBookTitle(source.title,entry.title));
    // An exact ISBN can reveal a wrongly entered title/author. An exact
    // title without a corroborating author is merely a tentative candidate.
    if(!sameIsbn&&!identityCompatible(source,entry)&&!sameTitle)continue;
    put({...entry,identityWarning:!identityCompatible(source,entry)});
  }
  for(const suggestion of Array.isArray(row.onlineMatchCandidates)
    ?row.onlineMatchCandidates:[]){
    const isbn=canonicalizeBookIsbn13(suggestion.editionIsbn);
    if(!isbn)continue;
    put({
      origin:'online',editionIsbn:isbn,
      title:safeText(suggestion.title||source.title),
      author:safeText(suggestion.author||source.author),
      coverUrl:validCover(suggestion.coverUrl),
      publisher:safeText(suggestion.publisher),
      language:safeText(suggestion.language),
      sources:Array.isArray(suggestion.sources)
        ?suggestion.sources.map(safeText).filter(Boolean).slice(0,4):[],
      copies:0,unverifiedTitle:suggestion.unverifiedTitle===true,
    });
  }
  const raw=[row.identifierAnalysis?.explicit?.raw,
    row.identifierAnalysis?.legacy?.raw,
    row.identifierAnalysis?.ambiguous?.raw].find(Boolean);
  const digits=String(raw||'').replace(/[^0-9X]/gi,'');
  const isNear=isbn=>digits.length===13&&isbn.length===13
    &&[...isbn].filter((digit,i)=>digit!==digits[i]).length===1;
  return [...results.values()].sort((a,b)=>{
    const score=x=>(x.editionIsbn?6:0)+(x.origin==='existing'?5:0)
      +(targetIsbn&&x.editionIsbn===targetIsbn?8:0)
      +(x.editionIsbn&&isNear(x.editionIsbn)?4:0)
      +(identityCompatible(source,x)?3:0)+(x.identityWarning?-6:0)
      +(x.sources?.length>=2?2:0)+(x.coverUrl?1:0);
    return score(b)-score(a)||a.title.localeCompare(b.title,'nl');
  }).slice(0,MAX_SUGGESTIONS);
}
module.exports={bookMatchSuggestions,buildMatchCandidateIndex,identityCompatible};
