'use strict';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildReviewDecisions } = require('./book-import-review');
const { canonicalizeBookIsbn13 } = require('./book-edition-core');
const { inspectReviewedLoans } = require('./book-import-loan-migration');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
// One shared administrator account can be open in several browsers.
// The app has only one active book import for ALL administrator sessions.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const BUSY_STATUSES = new Set(['preparing', 'reviewing', 'applying']);
const MAX_FINISHED_STAGES = 8;

function createImportStageStore({now=Date.now,createId=()=>crypto.randomUUID(),
  ttlMs=DEFAULT_TTL_MS,persistenceFile=''}={}){
  const entries=new Map();
  const file=persistenceFile?path.resolve(persistenceFile):'';
  const serialOptions=options=>({
    mode:options?.mode||'unified_sync',syncParts:options?.syncParts||null,
    maxRows:options?.maxRows||1500,maxCopies:options?.maxCopies||50000,
    enrichIsbn:options?.enrichIsbn===true,
    loanHistoryMode:['preserve','correct'].includes(options?.loanHistoryMode)
      ?options.loanHistoryMode:null,
  });
  function persist(){
    if(!file)return;
    const stage=[...entries.values()].find(entry=>entry.status==='open');
    if(!stage){
      try{fs.unlinkSync(file);}catch(error){
        if(error.code!=='ENOENT')console.error('Boekimportdraft opruimen mislukt',error);
      }
      return;
    }
    let temporary='';
    try{
      // SheetJS keeps the physical worksheet position in a non-enumerable
      // __rowNum__ property. JSON.stringify silently discards it. Keep
      // positions in a parallel array and recreate their descriptors on
      // restore; they must not become user-editable workbook columns.
      const worksheetRowPositions=stage.sourceRows.map(row=>{
        const descriptor=Object.getOwnPropertyDescriptor(row,'__rowNum__');
        return descriptor&&Number.isInteger(descriptor.value)
          &&descriptor.value>=0?descriptor.value:null;
      });
      const value=JSON.stringify({...stage,options:serialOptions(stage.options),
        worksheetRowPositions});
      if(Buffer.byteLength(value)>32*1024*1024)throw Error('import_draft_too_large');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      temporary=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
      fs.writeFileSync(temporary,value,{encoding:'utf8',mode:0o600,flag:'wx'});
      fs.renameSync(temporary,file);
      stage.draftPersisted=true;
    }catch(error){
      stage.draftPersisted=false;
      console.error('Boekimportdraft opslaan mislukt',error);
      if(temporary)try{fs.unlinkSync(temporary);}catch{}
    }
  }
  function restore(){
    if(!file)return;
    try{
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!saved||saved.status!=='open'||!saved.id||!saved.ownerId
        ||!Number.isInteger(saved.revision)||saved.revision<1
        ||!Array.isArray(saved.sourceRows)||saved.sourceRows.length>1500
        ||saved.analysis?.ok!==true||!Array.isArray(saved.analysis.rows)
        ||!saved.options||!Number.isFinite(saved.expiresAt)
        ||saved.expiresAt<=now()){
        fs.unlinkSync(file);return;
      }
      // Old imports already preserved the accurate physical worksheet
      // number in the analyzed row. Migrate drafts created before the
      // dedicated positions array instead of deleting a teacher's work.
      const storedPositions=Array.isArray(saved.worksheetRowPositions)
        ?saved.worksheetRowPositions
        :saved.analysis.rows.map(row=>Number.isSafeInteger(row?.sourceRowNumber)
          &&row.sourceRowNumber>=1?row.sourceRowNumber-1:null);
      if(storedPositions.length!==saved.sourceRows.length
        ||storedPositions.some(value=>value!==null
          &&(!Number.isSafeInteger(value)||value<0||value>2000000))){
        fs.unlinkSync(file);return;
      }
      for(let index=0;index<saved.sourceRows.length;index++){
        const position=storedPositions[index];
        if(position===null)continue;
        Object.defineProperty(saved.sourceRows[index],'__rowNum__',{
          value:position,configurable:true,
        });
      }
      delete saved.worksheetRowPositions;
      saved.options=serialOptions(saved.options);
      saved.draftPersisted=true;
      entries.set(saved.id,saved);
    }catch(error){
      if(error.code!=='ENOENT'){
        console.error('Boekimportdraft herstellen mislukt',error);
        try{fs.unlinkSync(file);}catch{}
      }
    }
  }
  function prune() {
    const current = now();
    for (const [id, item] of entries) {
      // A long metadata lookup or save can exceed the usual inactivity TTL.
      // Never detach a still-running stage from the live session.
      if (item.expiresAt <= current && !BUSY_STATUSES.has(item.status)) {entries.delete(id);persist();}
    }
    const terminal = [...entries.values()].filter((item) => TERMINAL_STATUSES.has(item.status));
    for (const item of terminal.slice(0, Math.max(0, terminal.length - MAX_FINISHED_STAGES))) entries.delete(item.id);
  }
  function active({ refresh = false } = {}) {
    prune();
    const stage = [...entries.values()].find((entry) => !TERMINAL_STATUSES.has(entry.status)) || null;
    // An authenticated, visible import page polls /active every 1.5s.
    // That activity is a heartbeat, not an abandoned draft. Only the status
    // endpoint opts into refresh so unrelated admissions cannot extend TTL.
    if (refresh && stage?.status === 'open') stage.expiresAt = now() + ttlMs;
    return stage;
  }
  function get(id) {
    prune();
    const stage = entries.get(id) || null;
    if (stage?.status === 'open') stage.expiresAt = now() + ttlMs;
    return stage;
  }
  function reserve(ownerId) {
    if (!ownerId) throw Error('invalid_stage');
    const current = active();
    if (current) return { ok: false, error: 'stage_busy', stage: current };
    const id = createId();
    const stage = {
      id, ownerId, sourceRows: null, workbook: null, fileName: '',
      analysis: null, initialAnalysis: null, corrections: [],
      inventoryResolutions: [], assignmentResolutions: [], metadataResolutions: [],
      acceptWarnings: false, options: {}, revision: 0,
      status: 'preparing', createdAt: new Date(now()).toISOString(),
      expiresAt: now() + ttlMs, result: null,
    };
    entries.set(id, stage);
    return { ok: true, stage };
  }
  function activate(stage, { sourceRows, workbook, analysis, fileName = '', options = {} }) {
    if (entries.get(stage?.id) !== stage || stage.status !== 'preparing'
      || !Array.isArray(sourceRows) || !analysis?.ok) throw Error('invalid_stage_transition');
    Object.assign(stage, {
      sourceRows, workbook, fileName, analysis, initialAnalysis: analysis,
      options, status: 'open', revision: 1, expiresAt: now() + ttlMs,
    });
    persist();
    return stage;
  }
  function abandon(stage) {
    if (entries.get(stage?.id) === stage && stage.status === 'preparing') {
      entries.delete(stage.id);
    }
  }
  // Pure-store callers can create an already analyzed stage.
  function create({ ownerId, sourceRows, workbook, analysis, fileName = '', options = {} }) {
    if (!ownerId || !Array.isArray(sourceRows) || !analysis?.ok) throw Error('invalid_stage');
    const reserved = reserve(ownerId);
    if (!reserved.ok) return reserved;
    return { ok: true, stage: activate(reserved.stage, { sourceRows, workbook, analysis, fileName, options }) };
  }
  function saveDraft(stage, expectedRevision, draft) {
    if(!stage||entries.get(stage.id)!==stage||stage.status!=='open')
      return {ok:false,error:'stage_busy_or_closed'};
    if(stage.revision!==expectedRevision)
      return {ok:false,error:'stale_review'};
    // An explicit clear removes a reverted set of choices so the final
    // confirmation cannot be blocked by a stale, otherwise invisible draft.
    stage.draft=draft;
    stage.draftSavedAt=draft===null?null:new Date(now()).toISOString();
    stage.expiresAt=now()+ttlMs;
    persist();
    return {ok:true,savedAt:stage.draftSavedAt,cleared:draft===null,
      persisted:stage.draftPersisted===true};
  }
  function beginReview(stage, expectedRevision) {
    if (!stage || entries.get(stage.id) !== stage || stage.status !== 'open') {
      return { ok: false, error: 'stage_busy_or_closed' };
    }
    if (stage.revision !== expectedRevision) return { ok: false, error: 'stale_review' };
    stage.status = 'reviewing';
    return { ok: true };
  }
  function finishReview(stage, reviewed, corrections, acceptWarnings, inventoryResolutions = [], assignmentResolutions = [], metadataResolutions = []) {
    if (entries.get(stage?.id) !== stage || stage.status !== 'reviewing') throw Error('invalid_stage_transition');
    stage.analysis = reviewed;
    stage.corrections = corrections;
    stage.inventoryResolutions = inventoryResolutions;
    stage.assignmentResolutions = assignmentResolutions;
    stage.metadataResolutions = metadataResolutions;
    stage.draft=null;
    stage.draftSavedAt=null;
    stage.acceptWarnings = acceptWarnings;
    stage.revision += 1;
    stage.expiresAt = now() + ttlMs;
    stage.status = 'open';
    persist();
  }
  function abortReview(stage) {
    if (stage?.status === 'reviewing') stage.status = 'open';
  }
  function beginApply(stage, expectedRevision) {
    if (!stage || entries.get(stage.id) !== stage || stage.status !== 'open') {
      return { ok: false, error: 'stage_busy_or_closed' };
    }
    if (stage.revision !== expectedRevision) return { ok: false, error: 'stale_review' };
    if(stage.draft)return {ok:false,error:'draft_must_be_reviewed'};
    stage.status = 'applying';
    return { ok: true };
  }
  function finishApply(stage, result) {
    if (entries.get(stage?.id) !== stage || stage.status !== 'applying') throw Error('invalid_stage_transition');
    stage.status = 'completed';
    stage.result = result;
    stage.sourceRows = null;
    stage.analysis = null;
    stage.initialAnalysis = null;
    stage.expiresAt = now() + ttlMs;
    persist();
  }
  function abortApply(stage) {
    // A failed write must never allow an unguarded retry. Start a new review.
    if (stage?.status === 'applying') {
      stage.status = 'failed';
      stage.expiresAt = now() + ttlMs;
      persist();
    }
  }
  function cancel(stage, expectedRevision) {
    if (!stage || entries.get(stage.id) !== stage || stage.status !== 'open') {
      return { ok: false, error: 'stage_busy_or_closed' };
    }
    if (stage.revision !== expectedRevision) return { ok: false, error: 'stale_review' };
    stage.status = 'cancelled';
    stage.revision += 1;
    stage.sourceRows = null;
    stage.analysis = null;
    stage.initialAnalysis = null;
    stage.expiresAt = now() + ttlMs;
    persist();
    return { ok: true };
  }
  restore();
  return {
    create, reserve, activate, abandon, get, active, cancel,
    saveDraft, beginReview, finishReview, abortReview,
    beginApply, finishApply, abortApply,
  };
}

function importStageView(stage) {
  if (TERMINAL_STATUSES.has(stage.status) || stage.status === 'preparing') {
    return {
      id: stage.id, status: stage.status, revision: stage.revision,
      mode: ['create','inventory_sync','assignment_reconcile','unified_sync'].includes(stage.options?.mode) ? stage.options.mode : 'create',
      fileName: stage.fileName, expiresAt: new Date(stage.expiresAt).toISOString(),
      result: stage.status === 'completed' ? stage.result : null,
    };
  }
  const analysis = stage.analysis;
  return {
    id: stage.id, status: stage.status, revision: stage.revision,
    mode: ['create','inventory_sync','assignment_reconcile','unified_sync'].includes(stage.options?.mode) ? stage.options.mode : 'create',
    fileName: stage.fileName, workbook: stage.workbook,
    expiresAt: new Date(stage.expiresAt).toISOString(),
    corrections: stage.corrections, acceptWarnings: stage.acceptWarnings,
    draftPersisted: stage.draftPersisted === true,
    draft: stage.draft || null,draftSavedAt:stage.draftSavedAt||null,
    syncParts: stage.options?.mode === 'unified_sync' ? stage.options.syncParts : null,
    inventoryResolutions: ['inventory_sync','unified_sync'].includes(stage.options?.mode) ? stage.inventoryResolutions : [],
    assignmentResolutions: ['assignment_reconcile','unified_sync'].includes(stage.options?.mode) ? stage.assignmentResolutions : [],
    metadataResolutions: stage.options?.mode === 'unified_sync' ? stage.metadataResolutions : [],
    summary: analysis?.summary || null,
    rows: analysis?.rows || [],
    decisions: analysis?.decisions || null,
    columns: analysis?.columns || null,
  };
}

function buildStageApplyPlan(analysis, existingBooks, {
  maxCopies = 5000, students = [], classes = [],
} = {}) {
  if (!analysis?.ok || !Array.isArray(analysis.rows)) return { ok: false, error: 'invalid_review' };
  const loanValidation = inspectReviewedLoans(analysis.rows, {
    students, classes, books: existingBooks,
  });
  const decisions = buildReviewDecisions(analysis, existingBooks, {
    acceptWarnings: analysis.acceptWarnings === true, students, classes,
  });
  if (!decisions.summary.readyToApply) {
    return { ok: false, error: 'review_not_ready', decisions };
  }
  const existingBarcodes = new Set((existingBooks || [])
    .map((item) => typeof item?.barcode === 'string' ? item.barcode.replace(/[^0-9X]/gi, '').toUpperCase() : '')
    .filter(Boolean));
  // Existing barcodes are always reserved. A generated ISBN barcode may
  // legitimately be shared by several copies of the SAME new edition so the
  // existing scanner can select an available copy from the barcode group.
  const seen = new Map(Array.from(existingBarcodes, (barcode) => [barcode, { existing: true }]));
  const created = [];
  let total = 0;
  for (let index = 0; index < decisions.rows.length; index += 1) {
    const decision = decisions.rows[index];
    if (!decision.canCreate) continue;
    const row = analysis.rows[index];
    const book = row.book;
    const editionIsbn = canonicalizeBookIsbn13(book.editionIsbn);
    const copies = book.quantity?.value;
    if (!editionIsbn || !book.title || !book.author
      || book.quantity?.valid !== true
      || !Number.isSafeInteger(copies) || copies < 1 || copies > 1000) {
      return { ok: false, error: 'unsafe_row', index };
    }
    // Never import an Excel loan as "available". The loan identity must
    // still be unique and valid against the fresh database at apply-time.
    const loan = loanValidation.get(index);
    if ((row.context?.studentLoan || row.context?.classLoan) && !loan?.ok) {
      return { ok: false, error: loan?.error || 'loan_context_requires_followup', index };
    }
    if (total + copies > maxCopies) return { ok: false, error: 'too_many_copies', index };
    total += copies;
    const suppliedBarcode = typeof book.barcode === 'string'
      ? book.barcode.toUpperCase().replace(/[^0-9X]/g, '') : '';
    // The running library exposes loaned books by barcode. Never create
    // copies that exist in storage but cannot be discovered by its scanner.
    const barcode = suppliedBarcode || editionIsbn;
    const previous = seen.get(barcode);
    if ((suppliedBarcode && copies !== 1) || (
      previous && (previous.existing || suppliedBarcode
        || !previous.automatic || previous.editionIsbn !== editionIsbn)
    )) {
      return { ok: false, error: 'duplicate_physical_barcode', index };
    }
    if (!previous) seen.set(barcode, { automatic: !suppliedBarcode, editionIsbn });
    created.push({ index, row, editionIsbn, quantity: copies, barcode,
      loanBorrower: loan?.borrower || null });
  }
  if (!created.length) return { ok: false, error: 'nothing_to_import' };
  return { ok: true, created, totalCopies: total, decisions };
}

module.exports = { createImportStageStore, importStageView, buildStageApplyPlan };
