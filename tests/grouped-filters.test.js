const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Kon blok niet vinden tussen ${startMarker} en ${endMarker}`);
  }
  return source.slice(start, end).trim();
}

const factory = new Function(
  [
    "function normalizeThemeKey(theme) { return typeof theme === 'string' ? theme.trim().toLowerCase() : ''; }",
    extractBetween('function resolveBookLanguages(', 'function filterBooks('),
    extractBetween('function filterBooks(', 'function sortBooks('),
    'return { resolveBookLanguages, resolveBookPageCounts, matchesCopyFilters, filterBooks };',
  ].join('\n\n')
);

const { resolveBookLanguages, resolveBookPageCounts, matchesCopyFilters, filterBooks } = factory();

const groupedBook = {
  id: 'groep-1',
  title: 'Dubbele uitgave',
  author: 'Auteur',
  representativeBook: { language: 'nl', pageCount: 120 },
  copies: [
    { language: 'nl', pageCount: 120, status: 'borrowed', barcode: 'A' },
    { language: 'en', pageCount: 420, status: 'available', barcode: 'B' },
  ],
  tags: ['Avontuur'],
  availableCopies: 1,
};

assert.deepStrictEqual(resolveBookLanguages(groupedBook), ['nl', 'en']);
assert.deepStrictEqual(resolveBookPageCounts(groupedBook), [120, 420]);
assert.strictEqual(matchesCopyFilters(groupedBook, { language: 'en' }), true);
assert.strictEqual(matchesCopyFilters(groupedBook, { pageLimit: 150 }), true);
assert.strictEqual(matchesCopyFilters(groupedBook, { language: 'en', pageLimit: 150 }), false);
assert.strictEqual(filterBooks([groupedBook], { language: 'en' }).length, 1);
assert.strictEqual(filterBooks([groupedBook], { pageLimit: 450 }).length, 1);
assert.strictEqual(filterBooks([groupedBook], { pageLimit: 150 }).length, 1);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'en', pageLimit: 150 }).length,
  0,
  'Groep mag niet matchen wanneer taal en lengte op verschillende kopieën zitten'
);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'nl', availability: 'available' }).length,
  0,
  'Groep mag niet matchen wanneer taal en beschikbaarheid op verschillende kopieën zitten'
);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'en', pageLimit: 450, availability: 'available' }).length,
  1,
  'Groep moet blijven staan wanneer één kopie alle filters tegelijk haalt'
);

console.log('Grouped filter tests passed');
