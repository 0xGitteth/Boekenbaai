'use strict';

// PR4: compare a reviewed school Excel against the PHYSICAL library.
// This pure preview never modifies existing books, loans or loan history.
// An omitted ISBN or lower Excel quantity NEVER silently deletes stock.
const { canonicalizeBookIsbn13, normalizeBookIdentityComparable } = require('./book-edition-core');
const { normalizeRuntimeBarcode } = require('./book-import-analysis-values');
const { inspectReviewedLoans, excelLoanReceiptKey } = require('./book-import-loan-migration');

function editionKeys(book) {
  // A physical barcode that merely LOOKS like another ISBN must not give a
  // different edition the same physical book. Use barcode-as-ISBN only if no
  // genuine edition identifier exists (legacy books).
  const identified = [...new Set([book?.editionIsbn, book?.metadataIsbn, book?.isbn13]
    .map(canonicalizeBookIsbn13).filter(Boolean))];
  return identified.length ? identified : [canonicalizeBookIsbn13(book?.barcode)].filter(Boolean);
}
function comparableIdentity(book) {
  return [normalizeBookIdentityComparable(book?.title || ''),
    normalizeBookIdentityComparable(book?.author || '')].join('|');
}
function inventoryIndex(books) {
  const editions = new Map();
  const barcodes = new Map();
  const unidentifiedTitles = new Map();
  const ambiguousEditions = new Set();
  for (const book of Array.isArray(books) ? books : []) {
    if (!book || typeof book !== 'object') continue;
    const keys = editionKeys(book);
    if (!keys.length) {
      const identity = comparableIdentity(book);
      if (identity !== '|') {
        if (!unidentifiedTitles.has(identity)) unidentifiedTitles.set(identity, []);
        unidentifiedTitles.get(identity).push(book);
      }
    }
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
  return { editions, barcodes, ambiguousEditions, unidentifiedTitles };
}
function normalizeInventoryResolutions(input) {
  if (input === undefined) return { ok: true, values: [] };
  if (!Array.isArray(input) || input.length > 1500) return { ok: false, error: 'invalid_sync_resolutions' };
  const seen = new Set();
  const values = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.isbn !== 'string' || item.action !== 'keep_existing') {
      return { ok: false, error: 'invalid_sync_resolutions' };
    }
    const isbn = canonicalizeBookIsbn13(item.isbn);
    if (!isbn || isbn !== item.isbn || seen.has(isbn)) {
      return { ok: false, error: 'invalid_sync_resolutions' };
    }
    seen.add(isbn);
    values.push({ isbn, action: 'keep_existing' });
  }
  return { ok: true, values };
}

function buildInventorySyncPreview(analysis, existingBooks = [], {
  acceptWarnings = false, resolutions = [], students = [], classes = [], loanReceipts = [],
} = {}) {
  if (!analysis?.ok || !Array.isArray(analysis.rows)) return { ok: false, error: 'invalid_review' };
  const normalizedResolutions = normalizeInventoryResolutions(resolutions);
  if (!normalizedResolutions.ok) return normalizedResolutions;
  const retain = new Set(normalizedResolutions.values.map((item) => item.isbn));
  const inventory = inventoryIndex(existingBooks);
  // Re-evaluated against the CURRENT student/class directory at preview,
  // review and final apply. Existing loans may be acknowledged idempotently.
  const loanChecks = inspectReviewedLoans(analysis.rows, {
    students, classes, books: existingBooks, allowExistingLoan: true,
  });
  const previouslyProcessed = new Set(loanReceipts);
  const groups = new Map();
  const decisions = analysis.rows.map((row) => ({
    index: row.index, worksheetRow: row.sourceRowNumber,
    action: row.status === 'skipped' ? 'skipped' : 'pending',
    reason: row.status === 'skipped' ? 'skipped' : '',
    existingCopies: 0, borrowedCopies: 0, targetCopies: 0, addCopies: 0,
    rowAddCopies: 0,
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

  // A resolution is meaningful only for a known edition in this workbook.
  // Reject forged choices for unknown editions and prevent stale old choices
  // from carrying over to a corrected ISBN.
  for (const isbn of retain) {
    if (!groups.has(isbn) || !(inventory.editions.get(isbn) || []).length) {
      return { ok: false, error: 'unknown_sync_resolution' };
    }
  }
  const proposedAdds = [];
  const loanAssignments = [];
  for (const [isbn, rows] of groups) {
    const existing = inventory.editions.get(isbn) || [];
    const borrowed = existing.filter((book) => book.status === 'borrowed' || Boolean(book.borrowedBy)).length;
    const fingerprint = comparableIdentity(rows[0].book);
    let reason = inventory.ambiguousEditions.has(isbn)
      ? 'ambiguous_existing_edition_isbn' : '';
    // The first reason is useful for the UI, but a later safety blocker must
    // NEVER disappear behind it. Especially important for an administrator's
    // explicit "keep existing" choice on an Excel stock reduction.
    const blockers = new Set(reason ? [reason] : []);
    const block = (code) => {
      blockers.add(code);
      if (!reason) reason = code;
    };
    if (rows.some((row) => comparableIdentity(row.book) !== fingerprint)
      || existing.some((book) => comparableIdentity(book) !== fingerprint)) {
      block('edition_identity_mismatch');
    }
    // Legacy copies with a physical barcode but no edition ISBN must not
    // become silent duplicates just because the new Excel supplies an ISBN.
    // An administrator can add the correct ISBN to the existing book first.
    if (!existing.length && inventory.unidentifiedTitles.has(fingerprint)) {
      block('possible_existing_book_without_isbn');
    }
    // A brand-new edition must never create an empty title/author book, even
    // if ordinary Excel warnings were explicitly accepted.
    if (rows.some((row) => !row.book?.title || !row.book?.author)) {
      block('missing_title_or_author');
    }
    let target = 0;
    const seenPrinted = new Set();
    const newPrinted = [];
    const pendingLoans = [];
    for (const row of rows) {
      const quantity = row.book?.quantity?.value;
      if (['conflict', 'unresolved'].includes(row.status)
        || (row.status === 'warning' && !acceptWarnings)) block('source_needs_review');
      if (row.context?.studentLoan || row.context?.classLoan) {
        const check = loanChecks.get(row.index);
        if (!check?.ok || !check.borrower) {
          block(check?.error || 'loan_context_requires_followup');
        } else {
          pendingLoans.push({ index: row.index, row, borrower: check.borrower });
        }
      }
      if ((row.context?.classContext || []).length || row.context?.libraryPresence
        || (row.context?.fixedLocation && row.context.fixedLocation.status !== 'resolved')) {
        block('location_context_requires_followup');
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000
        || row.book?.quantity?.valid !== true) block('invalid_quantity');
      else target += quantity;
      const printed = normalizeRuntimeBarcode(row.book?.barcode);
      if (printed) {
        if (quantity !== 1) block('printed_barcode_requires_one_copy');
        if (seenPrinted.has(printed)) block('duplicate_printed_barcode');
        seenPrinted.add(printed);
        const owners = inventory.barcodes.get(printed) || [];
        if (owners.some((book) => !existing.includes(book))) block('barcode_belongs_to_other_edition');
        if (!owners.length) newPrinted.push({ index: row.index, barcode: printed });
      }
    }
    const additional = Math.max(0, target - existing.length);
    // No random assignment among copies of the same edition. A distinct
    // physical barcode is decisive, otherwise there must be a uniquely
    // identifiable existing copy or an entirely NEW edition.
    const plannedLoans = [];
    for (const pending of pendingLoans) {
      const barcode = normalizeRuntimeBarcode(pending.row.book.barcode);
      const matching = barcode ? existing.filter((book) =>
        normalizeRuntimeBarcode(book.barcode) === barcode) : [];
      let destination;
      if (barcode && matching.length === 1) destination = { target: 'existing', book: matching[0] };
      else if (barcode && matching.length === 0 && newPrinted.some((item) =>
        item.index === pending.index)) destination = { target: 'new' };
      else if (!barcode && existing.length === 0) destination = { target: 'new' };
      else if (!barcode && existing.length === 1 && rows.length === 1
        && additional === 0) destination = { target: 'existing', book: existing[0] };
      else {
        block('loan_requires_physical_copy_match');
        continue;
      }
      const { borrower } = pending;
      if (borrower.type === 'student') {
        const student = students.find((item) => item.id === borrower.id);
        const heldBooks = (Array.isArray(student?.borrowedBooks) ? student.borrowedBooks : [])
          .map((loan) => existingBooks.find((book) =>
            book.id === (typeof loan === 'string' ? loan : loan?.bookId))).filter(Boolean);
        // Check BOTH sides of legacy lending state: old databases can
        // disagree on book.borrowedBy versus student.borrowedBooks. Neither
        // representation may be used to grant a second copy of the edition.
        const alreadyBorrowedPhysical = existing.some((book) =>
          book.id !== destination.book?.id
          && book.borrowedBy === borrower.id
          && (book.status === 'borrowed' || Boolean(book.borrowedBy)));
        if (alreadyBorrowedPhysical || heldBooks.some((book) =>
          editionKeys(book).includes(isbn) && book.id !== destination.book?.id)) {
          block('student_already_borrowed_edition');
          continue;
        }
      }
      if (destination.target === 'existing') {
        const book = destination.book;
        const occupied = book.status === 'borrowed'
          || Boolean(book.borrowedBy) || Boolean(book.borrowedByClassId);
        if (occupied) {
          const sameOwner = book.status === 'borrowed'
            && (borrower.type === 'student'
              ? book.borrowedBy === borrower.id && !book.borrowedByClassId
              : book.borrowedByClassId === borrower.id && !book.borrowedBy);
          if (!sameOwner) {
            block('loan_copy_borrowed_by_other');
            continue;
          }
          if (borrower.type === 'student') {
            const student = students.find((item) => item.id === borrower.id);
            const recorded = Array.isArray(student?.borrowedBooks)
              && student.borrowedBooks.some((loan) =>
                (typeof loan === 'string' ? loan : loan?.bookId) === book.id);
            if (!recorded) {
              block('loan_book_student_records_disagree');
              continue;
            }
          }
          plannedLoans.push({ editionIsbn: isbn, index: pending.index, target: 'already_recorded',
            bookId: book.id, borrower });
        } else {
          // An old Excel snapshot is not proof that a returned book is
          // currently on loan. A previously processed physical borrower pair
          // must remain returned even after logs and reports are rotated.
          if (previouslyProcessed.has(excelLoanReceiptKey(book.id, borrower))) {
            plannedLoans.push({ editionIsbn: isbn, index: pending.index,
              target: 'previously_imported', bookId: book.id, borrower });
            continue;
          }
          const student = borrower.type === 'student'
            ? students.find((item) => item.id === borrower.id) : null;
          if (student && Array.isArray(student.borrowedBooks)
            && student.borrowedBooks.some((loan) =>
              (typeof loan === 'string' ? loan : loan?.bookId) === book.id)) {
            block('loan_book_student_records_disagree');
            continue;
          }
          plannedLoans.push({ editionIsbn: isbn, index: pending.index,
            target: 'existing', bookId: book.id, borrower });
        }
      } else {
        plannedLoans.push({ editionIsbn: isbn, index: pending.index,
          target: 'new', borrower });
      }
    }
    // Sync limits only new physical copies, never an existing inventory total.
    if (additional > 5000) block('quantity_limit_exceeded');
    if (target < existing.length) block('reduction_requires_manual_review');
    if (newPrinted.length > additional) block('barcodes_exceed_new_copies');
    // With more than one unlabelled worksheet row containing different copy
    // metadata, an old ISBN-only book cannot be assigned to a specific row.
    // Arbitrarily choosing the first would silently put the wrong description
    // or themes on the added physical copy. Require a corrected worksheet or
    // explicit keep-existing choice instead of guessing.
    const unprintedRows = rows.filter((row) => !normalizeRuntimeBarcode(row.book?.barcode));
    if (existing.length && additional > newPrinted.length && unprintedRows.length > 1) {
      const metadataKey = (row) => JSON.stringify([
        row.book.description, row.book.publisher, row.book.publishedYear,
        row.book.pageCount, row.book.language, row.book.coverUrl,
        row.book.easyReading, row.book.suitableForExamList,
        row.book.tags, row.book.themes, row.book.manualThemes,
        row.context?.fixedLocation?.label,
      ]);
      if (unprintedRows.some((row) => metadataKey(row) !== metadataKey(unprintedRows[0]))) {
        block('ambiguous_unlabelled_copy_metadata');
      }
    }
    if (additional > newPrinted.length
      && (inventory.barcodes.get(isbn) || []).some((book) => !existing.includes(book))) {
      block('isbn_barcode_belongs_to_other_edition');
    }
    // If a later barcode check also failed, present THAT actionable reason,
    // not the otherwise resolvable reduction that a manager cannot approve.
    if (reason === 'reduction_requires_manual_review' && blockers.size > 1) {
      reason = [...blockers].find((item) => item !== 'reduction_requires_manual_review');
    }
    const first = rows[0].index;
    const canKeepExisting = target < existing.length
      && pendingLoans.length === 0
      && blockers.size === 1 && blockers.has('reduction_requires_manual_review');
    const keepExisting = retain.has(isbn);
    // Retention is ONLY an explicit acknowledgement of a lower total in
    // Excel. It must not override invalid ISBN identity, outstanding loans,
    // uncertain locations, unapproved warnings or barcode/quantity conflicts.
    if (keepExisting && !canKeepExisting) {
      return { ok: false, error: 'invalid_sync_resolution_reason', index: first, reason };
    }
    const totals = { existingCopies: existing.length, borrowedCopies: borrowed,
      targetCopies: target, addCopies: reason || keepExisting ? 0 : additional };
    decisions[first] = { ...decisions[first], ...totals, editionIsbn: isbn,
      canKeepExisting,
      action: keepExisting ? 'kept_existing'
        : reason ? 'blocked' : additional ? 'add_copies' : 'unchanged',
      reason: keepExisting ? '' : reason,
      resolution: keepExisting ? 'keep_existing' : null };
    if (!reason && !keepExisting) {
      for (const item of newPrinted) proposedAdds.push({
        editionIsbn: isbn, index: item.index, quantity: 1, barcode: item.barcode,
        templateBookId: existing[0]?.id || null,
      });
      // Assign automatic-ISBN copies to their ACTUAL worksheet rows, not
      // unconditionally to the first row in the group. Otherwise different
      // description/tags/themes on another row could be silently discarded.
      let unprintedToAdd = additional - newPrinted.length;
      for (const row of rows) {
        if (unprintedToAdd <= 0) break;
        if (normalizeRuntimeBarcode(row.book?.barcode)) continue;
        const count = Math.min(unprintedToAdd, row.book.quantity.value);
        if (count > 0) {
          proposedAdds.push({
            editionIsbn: isbn, index: row.index, quantity: count, barcode: isbn,
            templateBookId: existing[0]?.id || null,
          });
          unprintedToAdd -= count;
        }
      }
      if (unprintedToAdd > 0) {
        // No guessing which physical row the remaining copies belong to.
        reason = 'unmatched_physical_copies';
        const firstAddition = proposedAdds.findIndex((item) => item.editionIsbn === isbn);
        if (firstAddition >= 0) proposedAdds.splice(firstAddition);
        decisions[first] = { ...decisions[first], action: 'blocked', reason, addCopies: 0 };
      }
      if (!reason) {
        for (const item of plannedLoans) {
          if (item.target === 'new' && !proposedAdds.some((addition) =>
            addition.index === item.index && addition.editionIsbn === isbn
            && addition.quantity === 1)) {
            reason = 'loan_requires_physical_copy_match';
            break;
          }
        }
      }
      if (reason) {
        const firstAddition = proposedAdds.findIndex((item) => item.editionIsbn === isbn);
        if (firstAddition >= 0) proposedAdds.splice(firstAddition);
        decisions[first] = { ...decisions[first], action: 'blocked', reason, addCopies: 0 };
      } else {
        for (const item of plannedLoans) {
          loanAssignments.push(item);
          decisions[item.index] = { ...decisions[item.index], loanBorrower: item.borrower,
            loanState: item.target };
        }
      }
    }
    for (const row of rows.slice(1)) decisions[row.index] = {
      ...decisions[row.index], ...totals, addCopies: 0,
      action: decisions[first].action === 'blocked' ? 'blocked' : 'combined',
      reason: decisions[first].action === 'blocked' ? decisions[first].reason : '',
      combinedWith: first,
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
  const safeLoans = loanAssignments.filter((item) => !invalidEditions.has(item.editionIsbn));
  for (const addition of safeAdds) {
    decisions[addition.index].rowAddCopies += addition.quantity;
  }

  // Every physical copy is counted exactly once. Iterating only known ISBN
  // groups used to HIDE old books without an ISBN, and could count an
  // ambiguous multi-ISBN record as "omitted" even when it was present.
  const presentCopies = new Set();
  for (const isbn of groups.keys()) {
    for (const book of inventory.editions.get(isbn) || []) presentCopies.add(book);
  }
  const omittedGroups = new Map();
  const absentIds = new Set();
  for (const book of Array.isArray(existingBooks) ? existingBooks : []) {
    if (!book || typeof book !== 'object' || presentCopies.has(book)) continue;
    absentIds.add(book.id || book);
    const isbn = editionKeys(book)[0] || '';
    const groupKey = isbn || 'legacy:' + comparableIdentity(book);
    if (!omittedGroups.has(groupKey)) {
      omittedGroups.set(groupKey, {
        editionIsbn: isbn, title: book.title || '(geen titel)',
        author: book.author || '', copies: 0, borrowedCopies: 0,
      });
    }
    const missing = omittedGroups.get(groupKey);
    missing.copies += 1;
    if (book.status === 'borrowed' || Boolean(book.borrowedBy)) missing.borrowedCopies += 1;
  }
  const omittedEditions = [...omittedGroups.values()].slice(0, 50);
  // Only the first decision represents an ISBN group. Its other worksheet
  // rows remain blocked for review, but are not additional editions.
  // Rows without a valid ISBN cannot be grouped, so count them individually.
  const blocked = decisions.filter((entry) =>
    entry.action === 'blocked' && entry.combinedWith === undefined).length;
  const additionalCopies = safeAdds.reduce((sum, entry) => sum + entry.quantity, 0);
  if (additionalCopies > 5000) return { ok: false, error: 'too_many_copies' };
  return {
    ok: true, rows: decisions, proposedAdds: safeAdds, loanAssignments: safeLoans, omittedEditions,
    summary: {
      addCopies: additionalCopies,
      restoreLoans: safeLoans.filter((item) => item.target === 'existing' || item.target === 'new').length,
      alreadyRecordedLoans: safeLoans.filter((item) => item.target === 'already_recorded').length,
      previouslyImportedLoans: safeLoans.filter((item) => item.target === 'previously_imported').length,
      blockedEditions: blocked,
      unchangedEditions: decisions.filter((entry) => entry.action === 'unchanged').length,
      acknowledgedEditions: decisions.filter((entry) => entry.action === 'kept_existing').length,
      skippedRows: decisions.filter((entry) => entry.action === 'skipped').length,
      omittedExistingCopies: absentIds.size,
      readyToApply: blocked === 0 && groups.size > 0,
    },
  };
}
module.exports = { buildInventorySyncPreview, normalizeInventoryResolutions };
