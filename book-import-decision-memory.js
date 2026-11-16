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
const mapped=row=>mapImportRow(row||{});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Include *all* recognized source columns, not just the first Excel cell.
// New, duplicate or contradictory source columns invalidate prior permission.
// URL paths are case-sensitive; do not lowercase covers in the fingerprint.
function fieldSources(mapping,field){
  return (mapping.sources[field]||[]).map(entry=>[
    text(entry.header).toLocaleLowerCase('nl-NL'),
    field==='coverUrl'?text(entry.value):norm(entry.value),
  ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
const sourceIdentity=row=>{
  const m=mapped(row),f=m.fields;
  const title=norm(f.title),
    isbn=norm(f.isbn),metadataIsbn=norm(f.metadataIsbn),
    ambiguous=norm(f.ambiguousIdentifier),barcode=norm(f.barcode);
  // An edition ISBN or a physical barcode and a title are required.
  // Blank identifiers never distinguish different physical copies.
  if(!title||!(isbn||metadataIsbn||ambiguous||barcode))return null;
  return digest(['identity',...['title','author','authorFirst','authorLast',
    'isbn','metadataIsbn','ambiguousIdentifier','barcode']
    .map(field=>[field,fieldSources(m,field)])]);
};
function sourceValue(row,field){
  const m=mapped(row);
  if(field==='author')return ['author','authorFirst','authorLast']
    .map(part=>[part,fieldSources(m,part)]);
  if(field==='editionIsbn')return ['isbn','metadataIsbn','ambiguousIdentifier']
    .map(part=>[part,fieldSources(m,part)]);
  return fieldSources(m,field);
}
function equalCurrent(field,a,b){
  return field==='coverUrl'?text(a)===text(b):norm(a)===norm(b);
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
    const row=sourceRows[index],fields={};
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
        return field==='editionIsbn'||equalCurrent(field,existing,item.value)
          ||(field==='themes'&&equalCurrent(field,(book.themes||[]).join('; '),item.value));
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
  const decisions=new Map();
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
      const earlier=decisions.get(unique);
      if(earlier&&earlier.value!==value){
        decisions.set(unique,{conflict:true});
        continue;
      }
      if(!earlier)decisions.set(unique,{
        fingerprint,sourceIdentity:identity,field,
        value,editionIsbn:edition,batchId,recordedAt:now,
      });
    }
  }
  // Two physically indistinguishable rows with opposite corrections
  // cannot be remembered safely. Keep neither, rather than guessing.
  for(const candidate of decisions.values()){
    if(candidate.conflict)continue;
    ledger.push(candidate);recorded++;
  }
  // Bounded independent memory survives rotation of the short import reports.
  db.bookImportDecisionMemory=ledger.slice(-MAX_ITEMS);
  return recorded;
}
// Explicit Keep/Use Excel choices are edition-wide and may have no row
// correction. Retain them independently of the short 30-report audit window.
function recordMetadataReviewChoices(db,decisions,batchId,now){
  if(!Array.isArray(db.bookImportManualMetadataMemory))
    db.bookImportManualMetadataMemory=[];
  let saved=0;
  for(const choice of decisions||[]){
    const field=choice?.field,isbn=canonicalizeBookIsbn13(choice?.isbn);
    if(choice?.confidence!=='manual'||!isbn
      ||!['title','author','description','publisher','publishedYear','pageCount',
        'language','coverUrl','easyReading','suitableForExamList','tags','manualThemes']
        .includes(field))continue;
    const serial=JSON.stringify({excel:choice.excel??null,after:choice.after??null});
    if(serial.length>7000)continue;
    const item={isbn,field,excel:choice.excel??null,after:choice.after??null,
      batchId,recordedAt:now};
    db.bookImportManualMetadataMemory.push(item);
    saved++;
  }
  db.bookImportManualMetadataMemory=db.bookImportManualMetadataMemory.slice(-MAX_ITEMS);
  return saved;
}

module.exports={FIELDS,sourceIdentity,rowFingerprint,safeRowReplays,
  recordBookReviewChoices,recordMetadataReviewChoices};
