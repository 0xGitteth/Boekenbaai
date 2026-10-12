'use strict';

const crypto = require('crypto');
const { buildReviewDecisions } = require('./book-import-review');
const { canonicalizeBookIsbn13 } = require('./book-edition-core');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_STAGES = 12;
const MAX_PER_OWNER = 2;

function createImportStageStore({ now = Date.now, createId = () => crypto.randomUUID(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const entries = new Map();
  function prune() {
    const current = now();
    for (const [key, item] of entries) {
      if (item.expiresAt <= current) entries.delete(key);
    }
  }
  function get(id, ownerId) {
    prune();
    const entry = entries.get(id);
    return entry && entry.ownerId === ownerId ? entry : null;
  }
  function create({ ownerId, sourceRows, workbook, analysis, fileName = '', options = {} }) {
    if (!ownerId || !Array.isArray(sourceRows) || !analysis?.ok) throw Error('invalid_stage');
    prune();
    const mine = Array.from(entries.values()).filter((entry) => entry.ownerId === ownerId);
    if (mine.some((entry) => entry.status === 'reviewing' || entry.status === 'applying')) {
      return { ok: false, error: 'stage_busy' };
    }
    for (const entry of mine.slice(0, Math.max(0, mine.length - MAX_PER_OWNER + 1))) entries.delete(entry.id);
    if (entries.size >= MAX_STAGES) {
      const removable = [...entries.values()].find((entry) => !['reviewing', 'applying'].includes(entry.status));
      if (!removable) return { ok: false, error: 'stage_capacity' };
      entries.delete(removable.id);
    }
    const id = createId();
    const stage = {
      id, ownerId, sourceRows, workbook, fileName,
      analysis, corrections: [], acceptWarnings: false,
      options, revision: 1, status: 'open',
      createdAt: new Date(now()).toISOString(), expiresAt: now() + ttlMs,
      result: null,
    };
    entries.set(id, stage);
    return { ok: true, stage };
  }
  function beginReview(stage, expectedRevision) {
    if (!stage || stage.status !== 'open') return { ok: false, error: 'stage_busy_or_closed' };
    if (stage.revision !== expectedRevision) return { ok: false, error: 'stale_review' };
    stage.status = 'reviewing';
    return { ok: true };
  }
  function finishReview(stage, reviewed, corrections, acceptWarnings) {
    if (stage.status !== 'reviewing') throw Error('invalid_stage_transition');
    stage.analysis = reviewed;
    stage.corrections = corrections;
    stage.acceptWarnings = acceptWarnings;
    stage.revision += 1;
    stage.expiresAt = now() + ttlMs;
    stage.status = 'open';
  }
  function abortReview(stage) {
    if (stage?.status === 'reviewing') stage.status = 'open';
  }
  function beginApply(stage, expectedRevision) {
    if (!stage || stage.status !== 'open') return { ok: false, error: 'stage_busy_or_closed' };
    if (stage.revision !== expectedRevision) return { ok: false, error: 'stale_review' };
    stage.status = 'applying';
    return { ok: true };
  }
  function finishApply(stage, result) {
    if (stage.status !== 'applying') throw Error('invalid_stage_transition');
    stage.status = 'completed';
    stage.result = result;
    stage.sourceRows = null;
    stage.analysis = null;
    stage.expiresAt = now() + ttlMs;
  }
  function abortApply(stage) {
    // A failed write must never allow an unguarded retry. Start a new review.
    if (stage?.status === 'applying') stage.status = 'failed';
  }
  return { create, get, beginReview, finishReview, abortReview, beginApply, finishApply, abortApply };
}

function importStageView(stage) {
  if (stage.status === 'completed') {
    return {
      id: stage.id, status: stage.status, revision: stage.revision,
      fileName: stage.fileName, expiresAt: new Date(stage.expiresAt).toISOString(),
      result: stage.result,
    };
  }
  const analysis = stage.analysis;
  return {
    id: stage.id, status: stage.status, revision: stage.revision,
    fileName: stage.fileName, workbook: stage.workbook,
    expiresAt: new Date(stage.expiresAt).toISOString(),
    corrections: stage.corrections, acceptWarnings: stage.acceptWarnings,
    summary: analysis?.summary || null,
    rows: analysis?.rows || [],
    decisions: analysis?.decisions || null,
    columns: analysis?.columns || null,
  };
}

function buildStageApplyPlan(analysis, existingBooks, { maxCopies = 5000 } = {}) {
  if (!analysis?.ok || !Array.isArray(analysis.rows)) return { ok: false, error: 'invalid_review' };
  const decisions = buildReviewDecisions(analysis, existingBooks, { acceptWarnings: analysis.acceptWarnings === true });
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
    // Loan contexts are handled in PR5; importing them as available would
    // silently erase their checkout state, so do not apply them here.
    if (row.context?.studentLoan || row.context?.classLoan) {
      return { ok: false, error: 'loan_context_requires_followup', index };
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
    created.push({ index, row, editionIsbn, quantity: copies, barcode });
  }
  if (!created.length) return { ok: false, error: 'nothing_to_import' };
  return { ok: true, created, totalCopies: total, decisions };
}

module.exports = { createImportStageStore, importStageView, buildStageApplyPlan };
