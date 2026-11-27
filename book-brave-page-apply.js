'use strict';
const {workKey,isbnOf}=require('./book-free-metadata');
const {isValidIsbn,toIsbn13}=require('./isbn-lookup-core-impl');
const {comparison}=require('./book-enrichment-comparison');
const {narrativeDescription}=require('./book-brave-description');
const {approvedDescriptions,identity:descriptionIdentity}=require('./book-enrichment-content');
const {normalizeLanguage}=require('./isbn-lookup-core-impl');

function addProvenance(book,field,source){
  if(!book.importProvenance||typeof book.importProvenance!=='object')
    book.importProvenance={fieldSources:{}};
  if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
  book.importProvenance.fieldSources[field]={sourceType:'metadata',sourceDetail:source};
}
function userEdited(book,field){
  const source=book.importProvenance?.fieldSources?.[field]?.sourceType;
  // An intentionally cleared value is protected only if a teacher explicitly
  // cleared it. Imported "unknown" and absent/legacy values can be enriched
  // when empty, but populated non-metadata values must never be replaced.
  if(source==='manual')return true;
  const value=book[field];
  const populated=Array.isArray(value)?value.length>0
    : field==='pageCount' ? Number(value)>0
      : value!==null&&value!==undefined&&String(value).trim()!=='';
  return populated && source!=='metadata';
}
function updateFromPages(db,claim,pages,{imageUrl='',failedCovers=new Set()}={}) {
  let added=0,newCover=false;
  const evidenceByBook=Object.create(null);
  const approvedIds=new Set(Array.isArray(claim.bookIds)?claim.bookIds:[]);
  for(const book of db.books||[]){
    if(book.personalLoanOnly===true||!approvedIds.has(book.id)||workKey(book)!==claim.key)continue;
    const conflicts=new Set(comparison(db,book,failedCovers).conflicts.map(c=>c.field));
    const isbn=isbnOf(book);
    const evidence=[];
    evidenceByBook[book.id]=evidence;
    const remember=(field,page)=>{
      if(typeof page.sourceUrl==='string'&&page.sourceUrl.startsWith('https://'))
        evidence.push({field,url:page.sourceUrl,confidence:page.confidence});
    };
    const valid=(pages||[]).filter(page=>page&&['isbn','title_author'].includes(page.confidence));
    const editionPages=valid.filter(page=>isbn&&page.confidence==='isbn'&&isValidIsbn(page.isbn)&&toIsbn13(page.isbn)===isbn);
    const disagreement=field=>new Set(editionPages.map(p=>p[field]).filter(v=>v!==null&&v!==undefined&&v!=='')
      .map(v=>String(v).trim().toLocaleLowerCase('nl-NL'))).size>1;
    for(const page of [...valid].sort((a,b)=>Number(editionPages.includes(b))-Number(editionPages.includes(a)))){
      if(!page||!['isbn','title_author'].includes(page.confidence))continue;
      const exactEdition=Boolean(isbn&&page.confidence==='isbn'&&isValidIsbn(page.isbn)&&toIsbn13(page.isbn)===isbn);
      const description=narrativeDescription(page.description);
      if(!userEdited(book,'description') && description.length>=90
        && String(book.description||'').length<280
        && description.length>String(book.description||'').length+40){
        book.description=description;addProvenance(book,'description','verified_book_page');remember('description',page);added++;
      }
      // Use a verified source synopsis as additional recommendation evidence
      // when a teacher has their own description. Never replace it.
      if(description&&book.themesCleared!==true&&book.importProvenance?.fieldSources?.enrichmentDescriptions?.sourceType!=='manual'
        &&description!==String(book.description||'').trim()){
        const existing=approvedDescriptions(book);
        if(existing.length<6&&!existing.some(e=>e.text===description)){
          book.enrichmentDescriptions=[...existing,{source:'brave_verified_page',text:description,identity:descriptionIdentity(book)}];
          addProvenance(book,'enrichmentDescriptions','verified_book_page');remember('enrichmentDescriptions',page);added++;
        }
      }
      if(exactEdition&&!disagreement('publisher')&&!conflicts.has('publisher')&&!userEdited(book,'publisher')&&!book.publisher&&page.publisher){
        book.publisher=page.publisher;addProvenance(book,'publisher','verified_book_page');remember('publisher',page);added++;
      }
      if(exactEdition&&!disagreement('pageCount')&&!conflicts.has('pageCount')&&!userEdited(book,'pageCount')&&!book.pageCount&&page.pageCount){
        book.pageCount=page.pageCount;addProvenance(book,'pageCount','verified_book_page');remember('pageCount',page);added++;
      }
      for(const field of ['publishedYear','language']){
        const value=field==='language'?normalizeLanguage(page.language||''):page.publishedYear;
        if(exactEdition&&value&&!disagreement(field)&&!conflicts.has(field)&&!userEdited(book,field)&&!book[field]){
          book[field]=value;addProvenance(book,field,'verified_book_page');remember(field,page);added++;
        }
      }
      // Keep source keywords separate from teacher/import labels, as EasyCB does.
      if(book.themesCleared!==true && book.importProvenance?.fieldSources?.enrichmentTags?.sourceType!=='manual' && Array.isArray(page.tags)&&page.tags.length){
        const current=Array.isArray(book.enrichmentTags)?book.enrichmentTags:[];
        const merged=new Map(current.filter(t=>typeof t==='string'&&t.trim())
          .map(t=>[t.trim().toLocaleLowerCase('nl-NL'),t.trim()]));
        for(const tag of page.tags){
          if(typeof tag!=='string'||!tag.trim()||merged.size>=30)continue;
          const key=tag.trim().toLocaleLowerCase('nl-NL');
          if(!merged.has(key))merged.set(key,tag.trim());
        }
        const fresh=[...merged.values()];
        if(JSON.stringify(current)!==JSON.stringify(fresh)){
          book.enrichmentTags=fresh;
          addProvenance(book,'enrichmentTags','verified_book_page');remember('enrichmentTags',page);added++;
        }
      }
      if(book.themesCleared!==true&&!userEdited(book,'tags')&&Array.isArray(page.tags)&&page.tags.length){
        const current=Array.isArray(book.tags)?book.tags:[];
        const values=new Set(current.map(t=>String(t).toLocaleLowerCase('nl-NL')));
        const merged=[...current];
        for(const t of page.tags){
          if(merged.length>=25)break;
          const key=String(t).toLocaleLowerCase('nl-NL');
          if(!values.has(key)){values.add(key);merged.push(t);}
        }
        if(merged.length>current.length){
          book.tags=merged;addProvenance(book,'tags','verified_book_page');remember('tags',page);added++;
        }
      }
      const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
      if(exactEdition&&!book.localCoverUrl&&!userEdited(book,'coverUrl')&&page.coverUrl
        &&(!book.coverUrl||failed)&&book.coverUrl!==page.coverUrl){
        book.coverUrl=page.coverUrl;
        book.localCoverUrl='';book.coverCrop=null;addProvenance(book,'coverUrl','verified_book_page');remember('coverUrl',page);
        newCover=true;added++;
      }
    }
    const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
    if(!isbn&&imageUrl&&!book.localCoverUrl&&!userEdited(book,'coverUrl')&&(!book.coverUrl||failed)
      &&book.coverUrl!==imageUrl){
      book.coverUrl=imageUrl;book.localCoverUrl='';book.coverCrop=null;
      addProvenance(book,'coverUrl','verified_book_image');
      newCover=true;added++;
    }
  }
  return {added,newCover,evidenceByBook};
}

module.exports={updateFromPages};
