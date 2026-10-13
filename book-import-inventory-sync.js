'use strict';

// PR4: compare a reviewed school Excel against the PHYSICAL library.
// This pure preview never modifies existing books, loans or loan history.
// An omitted ISBN or lower Excel quantity NEVER silently deletes stock.
const { canonicalizeBookIsbn13, normalizeBookIdentityComparable } = require('./book-edition-core');
const { normalizeRuntimeBarcode } = require('./book-import-analysis-values');

function editionKeys(book) {
  // A physical barcode that merely LOOKS like another ISBN must not give a
  // different edition the same physical book. Use barcode-as-ISBN only if no
  // genuine edition identifier exists (legacy books).
  const identified = [...new Set([book?.editionIsbn, book?.metadataIsbn, book?.isbn13]
    .map(canonicalizeBookIsbn13).filter(Boolean))];
  return identified.length ? identified : [canonicalizeBookIsbn13(book?.barcode)].filter(Boolean);
}
function inventoryIndex(books) {
  const editions = new Map();
  const barcodes = new Map();
  const ambiguousEditions = new Set();
  for (const book of Array.isArray(books) ? books : []) {
    if (!book || typeof book !== 'object') continue;
    const keys = editionKeys(book);
    if (keys.length > 1) for (const isbn of keys) ambiguousEditions.add(isbn);
    for (const isbn of keys) {
      if (!editions.has(isbn)) editions.set(isbn, []);
      editions.get(isbn).push(book);
    }
    const barcode = normalizeRuntimeBarcode(book.barcode);
    if (barcode) {
      if (!barcodes.has(barcode)) barcodes.set(barcode, []);
      barcodes.get(barcode).push(book);
    }
  }
  return { editions, barcodes, ambiguousEditions };
}
function buildInventorySyncPreview(analysis, existingBooks = [], { acceptWarnings = false } = {}) {
  if (!analysis?.ok || !Array.isArray(analysis.rows)) return { ok: false, error: 'invalid_review' };
  const inventory = inventoryIndex(existingBooks);
  const groups = new Map();
  const decisions = analysis.rows.map((row) => ({
    index: row.index, worksheetRow: row.sourceRowNumber,
    action: row.status === 'skipped' ? 'skipped' : 'pending',
    reason: row.status === 'skipped' ? 'skipped' : '',
    existingCopies: 0, borrowedCopies: 0, targetCopies: 0, addCopies: 0,
  }));
  for (const row of analysis.rows) {
    if (row.status === 'skipped') continue;
    const isbn = canonicalizeBookIsbn13(row.book?.editionIsbn);
    if (!isbn) {
      decisions[row.index] = { ...decisions[row.index], action: 'blocked', reason: 'missing_valid_isbn' };
      continue;
    }
    if (!groups.has(isbn)) groups.set(isbn, []);
    groups.get(isbn).push(row);
  }

  const proposedAdds = [];
  for (const [isbn, rows] of groups) {
    const existing = inventory.editions.get(isbn) || [];
    const borrowed = existing.filter((book) => book.status === 'borrowed' || Boolean(book.borrowedBy)).length;
    const identity = (book) => [normalizeBookIdentityComparable(book?.title || ''),
      normalizeBookIdentityComparable(book?.author || '')].join('|');
    const fingerprint = identity(rows[0].book);
    let reason = inventory.ambiguousEditions.has(isbn)
      ? 'ambiguous_existing_edition_isbn' : '';
    if (rows.some((row) => identity(row.book) !== fingerprint)
      || existing.some((book) => identity(book) !== fingerprint)) {
      reason ||= 'edition_identity_mismatch';
    }
    let target = 0;
    const seenPrinted = new Set();
    const newPrinted = [];
    for (const row of rows) {
      const quantity = row.book?.quantity?.value;
      if (['conflict', 'unresolved'].includes(row.status)
        || (row.status === 'warning' && !acceptWarnings)) reason ||= 'source_needs_review';
      if (row.context?.studentLoan || row.context?.classLoan) reason ||= 'loan_context_requires_followup';
      if ((row.context?.classContext || []).length || row.context?.libraryPresence
        || (row.context?.fixedLocation && row.context.fixedLocation.status !== 'resolved')) {
        reason ||= 'location_context_requires_followup';
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000
        || row.book?.quantity?.valid !== true) reason ||= 'invalid_quantity';
      else target += quantity;
      const printed = normalizeRuntimeBarcode(row.book?.barcode);
      if (printed) {
        if (quantity !== 1) reason ||= 'printed_barcode_requires_one_copy';
        if (seenPrinted.has(printed)) reason ||= 'duplicate_printed_barcode';
        seenPrinted.add(printed);
        const owners = inventory.barcodes.get(printed) || [];
        if (owners.some((book) => !existing.includes(book))) reason ||= 'barcode_belongs_to_other_edition';
        if (!owners.length) newPrinted.push({ index: row.index, barcode: printed });
      }
    }
    if (target > 5000) reason ||= 'quantity_limit_exceeded';
    const additional = Math.max(0, target - existing.length);
    if (target < existing.length) reason ||= 'reduction_requires_manual_review';
    if (newPrinted.length > additional) reason ||= 'barcodes_exceed_new_copies';
    if (additional > newPrinted.length
      && (inventory.barcodes.get(isbn) || []).some((book) => !existing.includes(book))) {
      reason ||= 'isbn_barcode_belongs_to_other_edition';
    }
    const first = rows[0].index;
    const totals = { existingCopies: existing.length, borrowedCopies: borrowed,
      targetCopies: target, addCopies: reason ? 0 : additional };
    decisions[first] = { ...decisions[first], ...totals,
      action: reason ? 'blocked' : additional ? 'add_copies' : 'unchanged', reason };
    if (!reason) {
      for (const item of newPrinted) proposedAdds.push({
        editionIsbn: isbn, index: item.index, quantity: 1, barcode: item.barcode,
        templateBookId: existing[0]?.id || null,
      });
      if (additional > newPrinted.length) proposedAdds.push({
        editionIsbn: isbn, index: first, quantity: additional - newPrinted.length, barcode: isbn,
        templateBookId: existing[0]?.id || null,
      });
    }
    for (const row of rows.slice(1)) decisions[row.index] = {
      ...decisions[row.index], ...totals, addCopies: 0, action: 'combined',
      reason: '', combinedWith: first,
    };
  }
  // An ISBN-based fallback may be shared only by copies of the same edition.
  // A physical printed barcode must never collide with another new copy,
  // including another row's generated ISBN barcode.
  const additionsByBarcode = new Map();
  for (const addition of proposedAdds) {
    if (!additionsByBarcode.has(addition.barcode)) additionsByBarcode.set(addition.barcode, []);
    additionsByBarcode.get(addition.barcode).push(addition);
  }
  const invalidEditions = new Set();
  for (const matches of additionsByBarcode.values()) {
    if (matches.length < 2) continue;
    const sameEdition = matches.every((add) => add.editionIsbn === matches[0].editionIsbn);
    const allAutomatic = matches.every((add) => !analysis.rows[add.index]?.book?.barcode);
    if (!sameEdition || !allAutomatic) {
      for (const addition of matches) invalidEditions.add(addition.editionIsbn);
    }
  }
  for (const isbn of invalidEditions) {
    const first = groups.get(isbn)[0].index;
    decisions[first] = { ...decisions[first], action: 'blocked',
      reason: 'workbook_physical_barcode_conflict', addCopies: 0 };
  }
  const safeAdds = proposedAdds.filter((addition) => !invalidEditions.has(addition.editionIsbn));

  const received = new Set(groups.keys());
  const absentIds = new Set();
  for (const [isbn, books] of inventory.editions) {
    if (received.has(isbn)) continue;
    for (const book of books) absentIds.add(book.id || book);
  }
  const blocked = decisions.filter((entry) => entry.action === 'blocked').length;
  const additionalCopies = safeAdds.reduce((sum, entry) => sum + entry.quantity, 0);
  if (additionalCopies > 5000) return { ok: false, error: 'too_many_copies' };
  return {
    ok: true, rows: decisions, proposedAdds: safeAdds,
    summary: {
      addCopies: additionalCopies, blockedEditions: blocked,
      unchangedEditions: decisions.filter((entry) => entry.action === 'unchanged').length,
      skippedRows: decisions.filter((entry) => entry.action === 'skipped').length,
      omittedExistingCopies: absentIds.size,
      readyToApply: blocked === 0 && additionalCopies > 0,
    },
  };
}
module.exports = { buildInventorySyncPreview };
