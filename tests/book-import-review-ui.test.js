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
// Execute the real existing-book theme submission guard: changing title,
// barcode or description without touching the theme pills must not overwrite
// metadata-imported (possibly freeform) themes.
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const changedStart = appSource.indexOf('    const themeSelectionChanged = ');
const changedEnd = appSource.indexOf('    if (bookId) {', changedStart);
assert.ok(changedStart >= 0 && changedEnd > changedStart);
const getSentManualThemes = new Function(
  'bookId', 'adminBookInitialThemeKeys', 'adminSelectedThemeKeys', 'selectedThemes', 'payload',
  appSource.slice(changedStart, changedEnd) + '\nreturn payload.manualThemes;'
);
assert.strictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(['pesten']), ['Pesten'], {}
), undefined, 'An unrelated edit should preserve original imported metadata');
assert.deepStrictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(), [], {}
), [], 'Explicitly clearing the last selected pill must send an empty theme override');
assert.deepStrictEqual(getSentManualThemes(
  'book-1', new Set(['pesten']), new Set(['mysterie']), ['Mysterie'], {}
), ['Mysterie'], 'A changed theme selection should replace the imported themes');
assert.deepStrictEqual(getSentManualThemes(
  '', null, new Set(), [], {}
), [], 'Creating a book should still send the selected theme values');


assert.strictEqual(fieldValue({ book: { easyReading: true }, provenance: {
  easyReading: { source: 'excel', raw: 'nee' },
}}, 'easyReading'), 'nee', 'Show raw Excel ML input instead of disguising it as ja');
assert.strictEqual(fieldValue({ book: { easyReading: true }, provenance: {} }, 'easyReading'), 'ja');
assert.ok(script.includes("'Makkelijk lezen: ' + (row.book?.easyReading ? 'ja' : 'nee')"),
  'Show the effective ML value alongside its original Excel value');

console.log('Review UI metadata themes, ISBN sources and remote cache regressions passed');
