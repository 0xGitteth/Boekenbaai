'use strict';
const {isHidden,isUnavailable,studentLoanIds}=require('./book-catalog-integrity');
const {workKey}=require('./book-reservations');
// Publisher-confirmed integer volumes, separate from prequels and extras.
// The sequence is publication order unless the series name says otherwise.
const SERIES=require('./student-choice-series-data');
const norm=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const authorKey=v=>norm(v).replace(/ /g,'');
const exactAuthors=(s,author)=>s.authors.some(a=>authorKey(a)===authorKey(author));
function partFor(book){
 if(!book?.title||!book.author)return null;
 const title=norm(book.title);
 const matches=[];
 for(const series of SERIES){
  if(!exactAuthors(series,book.author))continue;
  for(const part of series.parts){
   const names=new Set(part.titles.map(norm));
   for(const prefix of series.prefixes.map(norm)){
    for(const name of part.titles.map(norm)){
     names.add(prefix+' '+name);
     names.add(prefix+' '+part.number+' '+name);
     names.add(prefix+' deel '+part.number+' '+name);
     names.add(prefix+' boek '+part.number+' '+name);
    }
    names.add(prefix+' '+part.number);
    names.add(prefix+' deel '+part.number);
    names.add(prefix+' boek '+part.number);
   }
   if(names.has(title))matches.push({series,part});
  }
 }
 return matches.length===1?matches[0]:null;
}
function describe(book){
 const found=partFor(book);if(!found)return null;
 return {id:found.series.id,name:found.series.name,number:found.part.number,source:found.series.source,
  parts:found.series.parts.map(p=>({number:p.number,title:p.titles[0]}))};
}
function nextPart(db,reference,readPart,studentId='',consent=false,signals={}){
 const found=partFor(reference);
 if(!found)return {series:null};
 const series=describe(reference);
 const confirmed=new Set();
 if(studentId&&consent){
  const byId=new Map((db.books||[]).map(b=>[b.id,b]));
  for(const r of db.readingRecords||[]){
   if(r?.subjectType!=='student'||r.subjectId!==studentId||r.finished!==true)continue;
   const b=byId.get(r.bookId);
   if(!b||(r.title&&workKey(r)!==workKey(b)))continue;
   const p=partFor(b);if(p?.series.id===series.id)confirmed.add(p.part.number);
  }
 }
 if(!Number.isInteger(readPart)||!series.parts.some(p=>p.number===readPart))return {series,readParts:[...confirmed].sort((a,b)=>a-b)};
 const target=found.series.parts.find(p=>p.number===readPart+1);
 if(!target)return {series,status:'last_known',readParts:[...confirmed]};
 if(confirmed.has(target.number))return {series,status:'already_read',target:{number:target.number,title:target.titles[0]},readParts:[...confirmed]};
 const {validateSignals}=require('./student-choice-open-text');
 const {traitsForBook}=require('./student-choice-dialogue');
 const avoid=validateSignals(signals).avoid;
 const copies=(db.books||[]).filter(b=>!isHidden(b)&&b.personalLoanOnly!==true&&b.id&&partFor(b)?.series.id===series.id&&partFor(b)?.part.number===target.number);
 if(!copies.length)return {series,status:'not_in_collection',target:{number:target.number,title:target.titles[0]}};
 // Never present a known excluded topic as a recommendation.
 if(copies.some(b=>avoid.some(t=>traitsForBook(b).has(t))))return {series,status:'excluded',target:{number:target.number,title:target.titles[0]}};
 const owners=studentLoanIds(db),available=copies.filter(b=>!isUnavailable(b,owners)),book=available[0]||copies[0];
 return {series,status:'found',suggestion:{bookId:book.id,key:workKey(book),title:book.title,author:book.author,
  available:available.length,total:copies.length,reason:'Deel '+target.number+' van '+series.name+'; het volgende deel na het door jou genoemde boek.'}};
}
module.exports={SERIES,partFor,describe,nextPart};
