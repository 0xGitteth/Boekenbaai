'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Execute the actual field-display function without a browser or mocking the
// rest of the admin page. Corrections shown to a teacher must correspond to
// the values that the server will actually import.
const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-book-import-review.js'), 'utf8');
const start = script.indexOf('    function fieldValue(row, field) {');
const end = script.indexOf('    function updateCorrection(', start);
assert.ok(start >= 0 && end > start, 'Could not locate review field rendering');
const fieldValue = new Function(script.slice(start, end) + '\nreturn fieldValue;')();

const metadataOnly = {
  book: { editionIsbn: '9780306406157', manualThemes: [], themes: ['Pesten', 'Natuur'] },
  identifierAnalysis: {},
};
assert.strictEqual(fieldValue(metadataOnly, 'themes'), 'Pesten; Natuur',
  'Metadata-only theme selection must be visible to administrators');
assert.strictEqual(fieldValue({
  ...metadataOnly, book: { ...metadataOnly.book, manualThemes: ['Mysterie'] },
}, 'themes'), 'Mysterie',
'Teacher-selected themes must override metadata themes');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  legacy: { raw: '978123X-invalid' },
}}, 'editionIsbn'), '978123X-invalid');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  ambiguous: { raw: '9780987-invalid' },
}}, 'editionIsbn'), '9780987-invalid');
assert.strictEqual(fieldValue({ book: {}, identifierAnalysis: {
  explicit: { raw: '978wrong' }, legacy: { raw: 'other' },
}}, 'editionIsbn'), '978wrong');
assert.ok(script.includes('const known = remotePending?.id === current.id ? remotePending : stage;'),
  'Pending same-revision drafts must use their cached full response instead of refetching every poll');
assert.ok(script.includes('Ongeldig ISBN: ') && script.includes('Thema’s: '),
  'The displayed review cards must include previously hidden identifiers and themes');
console.log('Review UI metadata themes, ISBN sources and remote cache regressions passed');
