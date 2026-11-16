'use strict';

// Permanent, book-only memory of explicit corrections. Never store pupil,
// class, borrower or current-loan decisions: their validity changes over time.
const crypto=require('node:crypto');
const {mapImportRow}=require('./book-import-workbook');
const {canonicalizeBookIsbn13}=require('./book-edition-core');

const FIELDS=new Set([
  'title','author','editionIsbn','publisher','publishedYear','pageCount',
  'language','description','coverUrl','tags','themes','easyReading','examMaterial',
]);
const MAX_ITEMS=5000;
const text=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const norm=value=>text(value).toLocaleLowerCase('nl-NL');
const mapped=row=>mapImportRow(row||{}).fields||{};
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceIdentity=row=>{
  const f=mapped(row);
  const title=norm(f.title),author=norm(f.author),
    first=norm(f.authorFirst),last=norm(f.authorLast),
    isbn=norm(f.isbn),metadataIsbn=norm(f.metadataIsbn),
    ambiguous=norm(f.ambiguousIdentifier),barcode=norm(f.barcode);
  // An edition ISBN or a physical barcode and a title are required.
  // Blank identifiers never distinguish different physical copies.
  if(!title||!(isbn||metadataIsbn||ambiguous||barcode))return null;
  return digest([title,author,first,last,isbn,metadataIsbn,ambiguous,barcode]);
};
function sourceValue(row,field){
  const f=mapped(row);
  if(field==='author')return [f.author,f.authorFirst,f.authorLast].map(norm).join('|');
  if(field==='editionIsbn')return [f.isbn,f.metadataIsbn,f.ambiguousIdentifier].map(norm).join('|');
  return norm(f[field]);
}
function rowFingerprint(row,field){
  const identity=sourceIdentity(row);
  return identity&&FIELDS.has(field)
    ?digest([identity,field,sourceValue(row,field)]):null;
}
function editionOf(book){
  return canonicalizeBookIsbn13(book?.editionIsbn)
    ||canonicalizeBookIsbn13(book?.metadataIsbn)
    ||canonicalizeBookIsbn13(book?.barcode);
}
function currentValue(book,field){
  if(field==='editionIsbn')return editionOf(book);
  if(field==='examMaterial')return book.suitableForExamList?'ja':'nee';
  if(field==='easyReading')return book.easyReading?'ja':'nee';
  if(field==='themes')return (book.manualThemes||book.themes||[]).join('; ');
  if(field==='tags')return (book.tags||[]).join('; ');
  return book[field];
}
function safeRowReplays(db,sourceRows){
  const saved=Array.isArray(db?.bookImportDecisionMemory)
    ?db.bookImportDecisionMemory.slice(-MAX_ITEMS):[];
  const choices=new Map();
  // Explicit choices from the latest batch win, but contradictory choices
  // for the same source within ONE batch are not safe to replay.
  const byKey=new Map();
  for(const item of saved){
    if(!item||!FIELDS.has(item.field)||typeof item.fingerprint!=='string'
      ||!/^[a-f0-9]{64}$/.test(item.fingerprint)
      ||typeof item.value!=='string'||item.value.length>4000
      ||!canonicalizeBookIsbn13(item.editionIsbn))continue;
    const key=item.fingerprint;
    const old=byKey.get(key);
    if(old&&old.batchId===item.batchId&&old.value!==item.value){
      byKey.set(key,{conflict:true,batchId:item.batchId});
      continue;
    }
    byKey.set(key,item);
  }
  let recovered=0,books=0;
  for(let index=0;index<(sourceRows||[]).length;index++){
    const row=sourceRows[index],fields={},f=mapped(row);
    const fingerprint=sourceIdentity(row);
    if(!fingerprint)continue;
    const matched=new Set();
    for(const field of FIELDS){
      const item=byKey.get(rowFingerprint(row,field));
      if(!item||item.conflict||item.sourceIdentity!==fingerprint)continue;
      const edition=item.editionIsbn;
      const candidates=(db.books||[]).filter(book=>editionOf(book)===edition);
      if(!candidates.length)continue;
      // Existing physical data has priority. If edited after the earlier
      // approval, NEVER silently overwrite that newer decision.
      if(!candidates.every(book=>{
        const existing=currentValue(book,field);
        return field==='editionIsbn'||norm(existing)===norm(item.value)
          ||(field==='themes'&&norm((book.themes||[]).join('; '))===norm(item.value));
      }))continue;
      if(field==='editionIsbn'&&canonicalizeBookIsbn13(item.value)!==edition)
        continue;
      // Never turn a barcode/quantity, a location or a loan from an old
      // workbook into an operation against today's physical inventory.
      fields[field]=item.value;
      matched.add(field);
    }
    if(matched.size){
      choices.set(index,{index,fields});
      recovered+=matched.size;
      books++;
    }
  }
  return {corrections:[...choices.values()],fieldsReused:recovered,rowsReused:books};
}
function recordBookReviewChoices(db,sourceRows,corrections,analysis,batchId,now){
  if(!Array.isArray(db.bookImportDecisionMemory))db.bookImportDecisionMemory=[];
  const ledger=db.bookImportDecisionMemory;
  const seen=new Set();
  let recorded=0;
  for(const correction of corrections||[]){
    if(!Number.isSafeInteger(correction?.index)||correction.index<0
      ||correction.index>=sourceRows.length||correction.skip===true)continue;
    const row=sourceRows[correction.index],identity=sourceIdentity(row);
    if(!identity||!correction.fields)continue;
    const analyzed=analysis?.rows?.[correction.index]?.book;
    const edition=canonicalizeBookIsbn13(analyzed?.editionIsbn)
      ||canonicalizeBookIsbn13(correction.fields.editionIsbn);
    if(!edition||(db.books||[]).every(book=>editionOf(book)!==edition))continue;
    for(const [field,value] of Object.entries(correction.fields)){
      const fingerprint=rowFingerprint(row,field);
      if(!fingerprint||typeof value!=='string'||value.length>4000)continue;
      const unique=batchId+'|'+fingerprint;
      if(seen.has(unique))continue;
      seen.add(unique);
      ledger.push({fingerprint,sourceIdentity:identity,field,
        value,editionIsbn:edition,batchId,recordedAt:now});
      recorded++;
    }
  }
  // Bounded independent memory survives rotation of the short import reports.
  db.bookImportDecisionMemory=ledger.slice(-MAX_ITEMS);
  return recorded;
}
module.exports={FIELDS,sourceIdentity,rowFingerprint,safeRowReplays,
  recordBookReviewChoices};
