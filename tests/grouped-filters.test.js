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
  tags: ['juvenile fiction'],
  themes: ['Avontuur'],
  availableCopies: 1,
};

assert.deepStrictEqual(resolveBookLanguages(groupedBook), ['nl', 'en']);
assert.deepStrictEqual(resolveBookPageCounts(groupedBook), [120, 420]);
assert.strictEqual(matchesCopyFilters(groupedBook, { language: 'en' }), true);
assert.strictEqual(filterBooks([groupedBook], { language: 'en' }).length, 1);
assert.strictEqual(filterBooks([groupedBook], { pageRange: '400-9999' }).length, 1);
assert.strictEqual(filterBooks([groupedBook], { pageRange: '200-399' }).length, 0);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'en', pageRange: '0-199' }).length,
  0,
  'Groep mag niet matchen wanneer taal en lengte op verschillende kopieën zitten'
);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'nl', availability: 'available' }).length,
  0,
  'Groep mag niet matchen wanneer taal en beschikbaarheid op verschillende kopieën zitten'
);
assert.strictEqual(
  filterBooks([groupedBook], { language: 'en', pageRange: '400-9999', availability: 'available' }).length,
  1,
  'Groep moet blijven staan wanneer één kopie alle filters tegelijk haalt'
);


assert.strictEqual(
  filterBooks([groupedBook], { selectedThemes: new Set(['avontuur']) }).length,
  1,
  'Themafilter moet op afgeleide themes werken'
);
assert.strictEqual(
  filterBooks([{ ...groupedBook, themes: [], tags: ['Avontuur'] }], { selectedThemes: new Set(['avontuur']) }).length,
  0,
  'Ruwe tags mogen het zichtbare themafilter niet meer voeden'
);

console.log('Grouped filter tests passed');
