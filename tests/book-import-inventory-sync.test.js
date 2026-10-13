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
assert.strictEqual(unchanged.summary.readyToApply, false);
assert.strictEqual(unchanged.rows[0].action, 'unchanged');

const repeat = preview([row(0, 1), row(1, 1)], [book('a')]);
assert.strictEqual(repeat.rows[0].targetCopies, 2);
assert.strictEqual(repeat.rows[1].action, 'combined');
assert.strictEqual(repeat.summary.addCopies, 1);
assert.deepStrictEqual(repeat.proposedAdds.map(({ barcode, quantity }) => [barcode, quantity]),
  [[ISBN, 1]], 'A repeat upload must increase the total, not double it');

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

const missingEdition = preview([row(0, 1)], [
  book('a'),
  book('different-book', { metadataIsbn: OTHER, barcode: OTHER, title: 'Andere titel' }),
]);
assert.strictEqual(missingEdition.summary.omittedExistingCopies, 1);
assert.deepStrictEqual(missingEdition.proposedAdds, [], 'Omitted editions remain untouched');

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

console.log('PR4 inventory reconciliation pure preview tests passed');
