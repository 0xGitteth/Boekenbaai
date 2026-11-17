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
  if(field==='themes')return (
    book.manualThemes?.length?book.manualThemes:book.themes||[]).join('; ');
  if(field==='tags')return (book.tags||[]).join('; ');
  return book[field];
}
// A teacher enters Excel-style strings, but the parser stores normalized
// catalog values (e.g. 'Nederlands' becomes 'nl', and tags become an array).
// Keep both representations: replay the original input, verify the parsed
// value against the actual current library.
function parsedApproval(field,book){
  if(!book||typeof book!=='object')return null;
  if(field==='editionIsbn')return canonicalizeBookIsbn13(book.editionIsbn)||null;
  if(field==='examMaterial')return book.suitableForExamList?'ja':'nee';
  if(field==='easyReading')return book.easyReading?'ja':'nee';
  if(field==='themes')return (book.themes||book.manualThemes||[]).join('; ');
  if(field==='tags')return (book.tags||[]).join('; ');
  if(field==='author')return String(book.author||'');
  if(!Object.prototype.hasOwnProperty.call(book,field))return null;
  const value=book[field];
  if(value===null||value===undefined)return '';
  return String(value);
}
function rememberedByFingerprint(db){
  const saved=Array.isArray(db?.bookImportDecisionMemory)
    ?db.bookImportDecisionMemory.slice(-MAX_ITEMS):[];
  const byKey=new Map();
  // The most recent accepted decision wins. Contradictions inside a single
  // batch cannot identify which physical book an approval concerns.
  for(const item of saved){
    if(!item||!FIELDS.has(item.field)||typeof item.fingerprint!=='string'
      ||!/^[a-f0-9]{64}$/.test(item.fingerprint)
      ||typeof item.value!=='string'||item.value.length>4000
      ||!canonicalizeBookIsbn13(item.editionIsbn))continue;
    const old=byKey.get(item.fingerprint);
    if(old?.batchId===item.batchId
      &&(old.conflict||old.value!==item.value)){
      byKey.set(item.fingerprint,{conflict:true,batchId:item.batchId});
      continue;
    }
    byKey.set(item.fingerprint,item);
  }
  return byKey;
}
function copiesByEdition(db){
  const editions=new Map();
  // A single 5,000-copy library scan is far cheaper than filtering the
  // entire collection for each of up to 1,500 Excel rows x 13 fields.
  for(const book of db?.books||[]){
    const isbn=editionOf(book);
    if(!isbn)continue;
    if(!editions.has(isbn))editions.set(isbn,[]);
    editions.get(isbn).push(book);
  }
  return editions;
}
function safeRowReplays(db,sourceRows){
  const byKey=rememberedByFingerprint(db);
  const editions=copiesByEdition(db);
  const choices=new Map();
  let recovered=0,books=0;
  for(let index=0;index<(sourceRows||[]).length;index++){
    const row=sourceRows[index],fields={};
    const fingerprint=sourceIdentity(row);
    if(!fingerprint)continue;
    const isbnApproval=byKey.get(rowFingerprint(row,'editionIsbn'));
    // A later ISBN approval changes which edition *all* remembered fields
    // belong to. Never combine a title approved for A with a subsequent
    // corrected ISBN B on the same source row.
    const targetEdition=isbnApproval?.sourceIdentity===fingerprint
      &&!isbnApproval.conflict
      ?canonicalizeBookIsbn13(isbnApproval.value):null;
    if(isbnApproval?.conflict)continue;
    for(const field of FIELDS){
      const item=byKey.get(rowFingerprint(row,field));
      if(!item||item.conflict||item.sourceIdentity!==fingerprint)continue;
      const edition=item.editionIsbn;
      if(targetEdition&&edition!==targetEdition)continue;
      const candidates=editions.get(edition)||[];
      if(!candidates.length)continue;
      // A newer manual edit has precedence over an older approval.
      if(!candidates.every(book=>{
        const existing=currentValue(book,field);
        return field==='editionIsbn'
          ||equalCurrent(field,existing,
            typeof item.approvedValue==='string'?item.approvedValue:item.value);
      }))continue;
      if(field==='editionIsbn'&&canonicalizeBookIsbn13(item.value)!==edition)
        continue;
      fields[field]=item.value;
      recovered++;
    }
    if(Object.keys(fields).length){
      choices.set(index,{index,fields});
      books++;
    }
  }
  return {corrections:[...choices.values()],fieldsReused:recovered,rowsReused:books};
}
// A replayed correction is not new consent. When an administrator edits a
// book while the Excel wizard is open, remove only the still-unchanged
// automatic field. Explicitly modified wizard fields remain the teacher's
// deliberate decision and are never silently discarded.
function revalidateRememberedCorrections(db,sourceRows,submitted,initial){
  const active=safeRowReplays(db,sourceRows).corrections;
  const stillSafe=new Map(active.flatMap(row=>
    Object.entries(row.fields||{}).map(([field,value])=>
      [row.index+':'+field,value])));
  const inherited=new Map((initial||[]).flatMap(row=>
    Object.entries(row.fields||{}).map(([field,value])=>
      [row.index+':'+field,value])));
  const originalApprovals=rememberedByFingerprint(db);
  let invalidated=0;
  const corrections=[];
  for(const item of submitted||[]){
    if(!item||!Number.isSafeInteger(item.index)
      ||item.index<0||item.index>=sourceRows.length)continue;
    if(item.skip===true){corrections.push(item);continue;}
    const fields={};
    const submittedEdition=Object.prototype.hasOwnProperty.call(
      item.fields||{},'editionIsbn')
      ?canonicalizeBookIsbn13(item.fields.editionIsbn):null;
    for(const [field,value] of Object.entries(item.fields||{})){
      const id=item.index+':'+field;
      const automaticallyInherited=inherited.has(id)&&inherited.get(id)===value;
      let invalidEdition=false;
      if(automaticallyInherited&&submittedEdition&&field!=='editionIsbn'){
        const approval=originalApprovals.get(
          rowFingerprint(sourceRows[item.index],field));
        invalidEdition=!approval||approval.conflict
          ||approval.editionIsbn!==submittedEdition;
      }
      if(automaticallyInherited
        &&(stillSafe.get(id)!==value||invalidEdition)){
        invalidated++;continue;
      }
      fields[field]=value;
    }
    if(Object.keys(fields).length)corrections.push({...item,fields});
  }
  return {corrections,invalidated};
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
    const analyzedRow=analysis?.rows?.[correction.index];
    const analyzed=analyzedRow?.book;
    const edition=canonicalizeBookIsbn13(analyzed?.editionIsbn)
      ||canonicalizeBookIsbn13(correction.fields.editionIsbn);
    const copies=(db.books||[]).filter(book=>editionOf(book)===edition);
    if(!edition||!copies.length)continue;
    for(const [field,value] of Object.entries(correction.fields)){
      const fingerprint=rowFingerprint(row,field);
      if(!fingerprint||typeof value!=='string'||value.length>4000)continue;
      const parsed=parsedApproval(field,analyzed);
      if(parsed===null)continue;
      const parsedCandidates=[parsed];
      // Examenmateriaal: Strip may create a derived 'strip' tag, but a
      // metadata-only Tags sync saves just the teacher's explicit tag list.
      // Reuse whichever *actual committed representation* matches a known
      // parsed result, never the unverified original string.
      if(field==='tags'&&Array.isArray(analyzedRow?.provenance?.tags?.explicitValues))
        parsedCandidates.push(analyzedRow.provenance.tags.explicitValues.join('; '));
      const actual=copies.map(book=>currentValue(book,field));
      if(!actual.every(item=>equalCurrent(field,item,actual[0]))
        ||!parsedCandidates.some(item=>equalCurrent(field,actual[0],item)))
        continue;
      const approvedValue=String(actual[0]??'');
      const unique=batchId+'|'+fingerprint;
      const earlier=decisions.get(unique);
      if(earlier&&earlier.value!==value){
        decisions.set(unique,{conflict:true});
        continue;
      }
      if(!earlier)decisions.set(unique,{
        fingerprint,sourceIdentity:identity,field,
        value,approvedValue,editionIsbn:edition,batchId,recordedAt:now,
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
  recordBookReviewChoices,recordMetadataReviewChoices,
  revalidateRememberedCorrections};
