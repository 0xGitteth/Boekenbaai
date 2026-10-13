'use strict';
const assert = require('assert');
const { buildInventorySyncPreview } = require('../book-import-inventory-sync');

const ISBN = '9780306406157';
const OTHER = '9780439554930';
const book = (id, extra = {}) => ({
  id, metadataIsbn: ISBN, barcode: ISBN, title: 'Het boek',
  author: 'De schrijver', status: 'available', ...extra,
});
const row = (index, amount = 1, extra = {}) => ({
  index, sourceRowNumber: index + 2, status: 'ready',
  book: {
    editionIsbn: ISBN, title: 'Het boek', author: 'De schrijver',
    quantity: { valid: true, value: amount }, barcode: '',
    ...extra,
  }, context: {},
});
const preview = (rows, existing = [], options = {}) =>
  buildInventorySyncPreview({ ok: true, rows }, existing, options);

const unchanged = preview([row(0, 2)], [book('a'), book('b')]);
assert.strictEqual(unchanged.ok, true);
assert.strictEqual(unchanged.summary.addCopies, 0);
assert.strictEqual(unchanged.summary.readyToApply, true, 'A no-change sync should be explicitly confirmable and auditable');
assert.strictEqual(unchanged.rows[0].action, 'unchanged');

const repeat = preview([row(0, 1), row(1, 1)], [book('a')]);
assert.strictEqual(repeat.rows[0].targetCopies, 2);
assert.strictEqual(repeat.rows[1].action, 'combined');
assert.strictEqual(repeat.summary.addCopies, 1);
assert.deepStrictEqual(repeat.proposedAdds.map(({ barcode, quantity }) => [barcode, quantity]),
  [[ISBN, 1]], 'A repeat upload must increase the total, not double it');

// Every newly created copy must retain the metadata of its ORIGINAL Excel
// row, including when several rows share the same ISBN.
const differentRowMetadata = preview([
  row(0, 1, { description: 'First worksheet row', tags: ['history'] }),
  row(1, 1, { description: 'Second worksheet row', tags: ['fantasy'] }),
]);
assert.deepStrictEqual(differentRowMetadata.proposedAdds.map((add) =>
  [add.index, add.quantity, add.barcode]), [[0, 1, ISBN], [1, 1, ISBN]]);
assert.deepStrictEqual(differentRowMetadata.rows.map((item) => item.rowAddCopies), [1, 1]);

// A new printed barcode on the first row cannot become the source of the
// AUTO-generated copy belonging to a different, unprinted second row.
const printedThenUnprinted = preview([
  row(0, 1, { barcode: '44221100', description: 'Printed copy' }),
  row(1, 1, { description: 'Unprinted copy' }),
]);
assert.deepStrictEqual(printedThenUnprinted.proposedAdds.map((add) =>
  [add.index, add.barcode, add.quantity]), [[0, '44221100', 1], [1, ISBN, 1]]);

// Old physical books with no saved edition ISBN should not be duplicated
// solely because the new Excel finally has a valid ISBN.
// A preexisting ISBN-only physical book cannot be arbitrarily matched to
// multiple unlabelled Excel rows with DIFFERENT metadata. Block instead of
// silently choosing the first row for a new physical copy.
const ambiguousOldAndNew = preview([
  row(0, 1, { description: 'History copy', tags: ['history'] }),
  row(1, 1, { description: 'Fantasy copy', tags: ['fantasy'] }),
], [book('old-isbn-copy')]);
assert.strictEqual(ambiguousOldAndNew.rows[0].reason, 'ambiguous_unlabelled_copy_metadata');
assert.strictEqual(ambiguousOldAndNew.summary.readyToApply, false);
assert.deepStrictEqual(ambiguousOldAndNew.proposedAdds, []);
// Identical metadata can still be distributed safely between copies.
const matchingOldAndNew = preview([row(0, 1), row(1, 1)], [book('old-isbn-copy')]);
assert.strictEqual(matchingOldAndNew.summary.addCopies, 1);

const legacyWithoutIsbn = preview([row(0, 2)], [
  book('old-copy', { metadataIsbn: null, editionIsbn: null, barcode: '44332211' }),
]);
assert.strictEqual(legacyWithoutIsbn.rows[0].reason, 'possible_existing_book_without_isbn');
assert.strictEqual(legacyWithoutIsbn.summary.readyToApply, false);
assert.deepStrictEqual(legacyWithoutIsbn.proposedAdds, []);

const borrowed = preview([row(0, 2)], [book('loan-1', {
  status: 'borrowed', borrowedBy: 'student-1',
})]);
assert.strictEqual(borrowed.rows[0].borrowedCopies, 1);
assert.strictEqual(borrowed.summary.addCopies, 1,
  'Borrowed copies count toward inventory, not toward new copies to order');

const lessThanActual = preview([row(0, 1)], [book('a'), book('b')]);
assert.strictEqual(lessThanActual.summary.readyToApply, false);
assert.strictEqual(lessThanActual.rows[0].reason, 'reduction_requires_manual_review');
assert.deepStrictEqual(lessThanActual.proposedAdds, [],
  'Never delete books or loans because a row was omitted from Excel');
const acceptedLower = preview([row(0, 1)], [book('a'), book('b')], {
  resolutions: [{ isbn: ISBN, action: 'keep_existing' }],
});
assert.strictEqual(acceptedLower.rows[0].action, 'kept_existing');
assert.strictEqual(acceptedLower.summary.acknowledgedEditions, 1);
assert.strictEqual(acceptedLower.summary.addCopies, 0);
assert.strictEqual(acceptedLower.summary.readyToApply, true);
assert.deepStrictEqual(acceptedLower.proposedAdds, [],
  'Explicitly retaining stock must never remove available or borrowed books');
const ignoredIncrease = preview([row(0, 3)], [book('a')], {
  resolutions: [{ isbn: ISBN, action: 'keep_existing' }],
});
assert.strictEqual(ignoredIncrease.ok, false,
  'Retain-existing cannot be used to bypass a requested stock increase');
assert.strictEqual(ignoredIncrease.error, 'invalid_sync_resolution_reason');
assert.strictEqual(acceptedLower.rows[0].canKeepExisting, true);
assert.strictEqual(preview([row(0, 1)], [], {
  resolutions: [{ isbn: ISBN, action: 'keep_existing' }],
}).error, 'unknown_sync_resolution');
assert.strictEqual(preview([row(0, 1)], [book('a')], {
  resolutions: [{ isbn: ISBN, action: 'delete_all' }],
}).error, 'invalid_sync_resolutions');
assert.strictEqual(preview([row(0, 1)], [book('a')], {
  resolutions: [{ isbn: OTHER, action: 'keep_existing' }],
}).error, 'unknown_sync_resolution');

// The keep-existing option must NEVER bypass unrelated unresolved problems.
// Check each blocker separately, including when the smaller Excel quantity
// would otherwise show "reduction requires review" as the primary reason.
const retainedChoice = [{ isbn: ISBN, action: 'keep_existing' }];
const withExcess = [book('a'), book('b'), book('c')];
const invalidRetentionCases = [
  {
    label: 'student loan',
    row: { ...row(0, 1), context: { studentLoan: { id: 'student-match' } } },
    reason: 'loan_context_requires_followup',
  },
  {
    label: 'class loan',
    row: { ...row(0, 1), context: { classLoan: { id: 'class-match' } } },
    reason: 'loan_context_requires_followup',
  },
  {
    label: 'location or class context',
    row: { ...row(0, 1), context: { classContext: [{ classId: 'class-match' }] } },
    reason: 'location_context_requires_followup',
  },
  {
    label: 'source warnings',
    row: { ...row(0, 1), status: 'warning' },
    reason: 'source_needs_review',
  },
  {
    label: 'invalid title',
    row: row(0, 1, { title: '' }),
    reason: 'edition_identity_mismatch',
  },
  {
    label: 'unresolved row status',
    row: { ...row(0, 1), status: 'unresolved' },
    reason: 'source_needs_review',
  },
  {
    label: 'quantity zero',
    row: row(0, 0, { quantity: { valid: false, value: 0 } }),
    reason: 'invalid_quantity',
  },
  {
    label: 'quantity with one printed barcode',
    row: row(0, 2, { barcode: '995566' }),
    reason: 'printed_barcode_requires_one_copy',
  },
  {
    label: 'barcode belongs to different edition',
    row: row(0, 1, { barcode: '123123' }),
    reason: 'barcode_belongs_to_other_edition',
    books: [
      ...withExcess,
      book('other-edition', { metadataIsbn: OTHER, barcode: '123123', title: 'Other' }),
    ],
  },
];
for (const scenario of invalidRetentionCases) {
  const existing = scenario.books || withExcess;
  const baseline = preview([scenario.row], existing);
  assert.strictEqual(baseline.summary.readyToApply, false, scenario.label);
  const attempted = preview([scenario.row], existing, { resolutions: retainedChoice });
  assert.strictEqual(attempted.ok, false, 'Cannot waive blocker: ' + scenario.label);
  assert.strictEqual(attempted.error, 'invalid_sync_resolution_reason',
    'The reason needs to be checked, not silenced: ' + scenario.label);
}
const warningAcknowledged = preview([
  { ...row(0, 1), status: 'warning' },
], withExcess, { acceptWarnings: true, resolutions: retainedChoice });
assert.strictEqual(warningAcknowledged.ok, true,
  'A genuinely acknowledged Excel warning may allow a clean stock-reduction decision');
assert.strictEqual(warningAcknowledged.rows[0].action, 'kept_existing');

// An unrecognized conflicting physical barcode added after a clean reduction
// must block retain-existing even if reduction was the earlier UI reason.
const lowerWithNewPrintedCode = preview([
  row(0, 1, { barcode: '99887766' }),
], withExcess);
assert.strictEqual(lowerWithNewPrintedCode.rows[0].canKeepExisting, false);
assert.strictEqual(preview([row(0, 1, { barcode: '99887766' })], withExcess,
  { resolutions: retainedChoice }).error, 'invalid_sync_resolution_reason');

// Resolving an excess in one edition must allow a different new ISBN to be
// synchronized within the SAME confirmed workbook.
const mixedReview = preview([
  row(0, 1),
  row(1, 2, { editionIsbn: OTHER, title: 'Tweede boek' }),
], [book('a'), book('b')], {
  resolutions: [{ isbn: ISBN, action: 'keep_existing' }],
});
assert.strictEqual(mixedReview.rows[0].action, 'kept_existing');
assert.strictEqual(mixedReview.rows[1].action, 'add_copies');
assert.strictEqual(mixedReview.summary.addCopies, 2);
assert.strictEqual(mixedReview.summary.readyToApply, true);


const missingEdition = preview([row(0, 1)], [
  book('a'),
  book('different-book', { metadataIsbn: OTHER, barcode: OTHER, title: 'Andere titel' }),
]);
assert.strictEqual(missingEdition.summary.omittedExistingCopies, 1);
assert.strictEqual(missingEdition.omittedEditions[0].title, 'Andere titel');
assert.deepStrictEqual(missingEdition.proposedAdds, [], 'Omitted editions remain untouched');

// All omitted physical books count, even if old records lack ISBN. An old
// book with two conflicting ISBN keys cannot be counted twice, and a record
// present through one of its identifiers must not be listed as omitted.
const omissionWithoutIsbn = preview([row(0, 1)], [
  book('first-existing'),
  book('legacy-unknown', { metadataIsbn: null, barcode: '55001122',
    title: 'Older legacy copy' }),
]);
assert.strictEqual(omissionWithoutIsbn.summary.omittedExistingCopies, 1);
assert.strictEqual(omissionWithoutIsbn.omittedEditions[0].editionIsbn, '');
assert.strictEqual(omissionWithoutIsbn.omittedEditions[0].title, 'Older legacy copy');
const aliasPresent = preview([row(0, 2)], [
  book('conflicting-alias', { editionIsbn: OTHER }),
]);
assert.strictEqual(aliasPresent.summary.omittedExistingCopies, 0,
  'An edition represented by its metadata ISBN must never be counted as omitted');

// Duplicated ISBN identifiers on the same physical record must not inflate
// the list of existing books absent from a DIFFERENT upload.
const omitAmbiguous = preview([row(0, 1, { editionIsbn: '9781234567101',
  title: 'Unrelated' })], [
  book('conflicting-alias', { editionIsbn: OTHER }),
]);
assert.strictEqual(omitAmbiguous.summary.omittedExistingCopies, 1);

const conflictingExistingIsbns = preview([row(0, 2)], [
  book('ambiguous', { editionIsbn: OTHER }),
]);
assert.strictEqual(conflictingExistingIsbns.rows[0].reason, 'ambiguous_existing_edition_isbn');

const mismatch = preview([row(0, 2)], [
  book('different-identity', { title: 'Een andere titel' }),
]);
assert.strictEqual(mismatch.rows[0].reason, 'edition_identity_mismatch');

const conflict = preview([row(0, 2, { barcode: '1234567' })], []);
assert.strictEqual(conflict.rows[0].reason, 'printed_barcode_requires_one_copy');

const alreadyElsewhere = preview([row(0, 2, { barcode: '' }), row(1, 1, { barcode: '111222' })], [
  book('other', { metadataIsbn: OTHER, barcode: '111222', title: 'Andere titel' }),
]);
assert.strictEqual(alreadyElsewhere.rows[0].reason, 'barcode_belongs_to_other_edition');

const duplicate = preview([row(0, 1, { barcode: '111222' }), row(1, 1, { barcode: '111222' })]);
assert.strictEqual(duplicate.rows[0].reason, 'duplicate_printed_barcode');

// A generated ISBN scan code may not be reused as another new edition's
// printed physical barcode inside the same workbook.
const crossEditionScanConflict = preview([
  row(0, 1),
  row(1, 1, { editionIsbn: OTHER, title: 'Andere titel', barcode: ISBN }),
]);
assert.strictEqual(crossEditionScanConflict.rows[0].reason, 'workbook_physical_barcode_conflict');
assert.strictEqual(crossEditionScanConflict.rows[1].reason, 'workbook_physical_barcode_conflict');
assert.strictEqual(crossEditionScanConflict.summary.readyToApply, false);
assert.deepStrictEqual(crossEditionScanConflict.proposedAdds, []);

const unknownLoan = preview([{ ...row(0, 1), context: { studentLoan: { id: 's1' } } }]);
assert.strictEqual(unknownLoan.rows[0].reason, 'loan_context_requires_followup');

const warning = preview([{ ...row(0, 1), status: 'warning' }]);
assert.strictEqual(warning.rows[0].reason, 'source_needs_review');
assert.strictEqual(preview([{ ...row(0, 1), status: 'warning' }], [], {
  acceptWarnings: true,
}).summary.addCopies, 1);

assert.strictEqual(buildInventorySyncPreview({ ok: false, rows: [] }).ok, false);

// Ordinary warning acknowledgement never permits an unnamed new book.
const missingIdentity = preview([
  row(0, 1, { title: '' }),
], [], { acceptWarnings: true });
assert.strictEqual(missingIdentity.rows[0].action, 'blocked');
assert.strictEqual(missingIdentity.rows[0].reason, 'missing_title_or_author');
assert.strictEqual(missingIdentity.summary.readyToApply, false);
const missingAuthor = preview([
  row(0, 1, { author: '' }),
], [], { acceptWarnings: true });
assert.strictEqual(missingAuthor.rows[0].reason, 'missing_title_or_author');

console.log('PR4 inventory reconciliation pure preview tests passed');
