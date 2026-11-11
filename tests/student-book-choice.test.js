'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const js = read('public/student-book-choice.js');
const html = read('public/index.html');
const vite = read('vite.config.js');
execFileSync(process.execPath,
  ['--check', path.join(root, 'public', 'student-book-choice.js')]);

const between = (from, until) => {
  const start = js.indexOf(from);
  const end = js.indexOf(until, start + from.length);
  assert.ok(start >= 0 && end > start,
    'Cannot find production recommendation helper fragment ' + from);
  return js.slice(start, end);
};
// Run the actual catalog grouping/matching functions from the browser script
// against fixed realistic catalog fixtures, without a fake recommendation API.
const helpers = vm.runInNewContext(`(() => {
  let editions = [];
  const themeArea = { querySelectorAll() { return []; } };
  ${between('  const normalized = ', '  function renderThemes()')}
  ${between('  function matches(', '  function renderSuggestions()')}
  return {
    mergeCopies, matches, explanation, availableThemes, coverUrl,
    setEditions(value) { editions = value; }
  };
})()`, { window: { BOEKENBAAI_API_BASE: 'https://api.example.nl' },
  document: { querySelector() { return null; } } });
const sourceBooks = [
  { id: 'copy-1', title: 'Reis door het bos', author: 'Auteur A',
    metadataIsbn: '9780306406157', themes: ['Avontuur'],
    status: 'available', pageCount: 110 },
  { id: 'copy-2', title: 'Reis door het bos', author: 'Auteur A',
    metadataIsbn: '9780306406157', themes: ['Avontuur'],
    status: 'borrowed', pageCount: 110 },
  { id: 'copy-3', title: 'Een moeilijk mysterie', author: 'Auteur B',
    metadataIsbn: '9780140328721', themes: ['Mysterie'],
    status: 'borrowed', suitableForExamList: true, pageCount: 420 },
  { id: 'copy-4', title: 'Een ander boek', author: 'Auteur C',
    metadataIsbn: '9780306406157', themes: ['Avontuur'],
    status: 'available', easyReading: true },
  { id: 'copy-5', title: 'Gecorrigeerde thema’s', author: 'Auteur D',
    themes: [], themesCleared: true, tags: ['Pesten'],
    status: 'available' },
];
const grouped = helpers.mergeCopies(sourceBooks);
assert.equal(grouped.length, 4, 'Physical copies group into real catalog titles');
const travel = grouped.find(item => item.title === 'Reis door het bos');
const mystery = grouped.find(item => item.title === 'Een moeilijk mysterie');
const easy = grouped.find(item => item.title === 'Een ander boek');
assert.equal(travel.total, 2);
assert.equal(travel.available, 1);
assert.equal(travel.borrowed, 1);
assert.equal(mystery.available, 0);
assert.equal(helpers.matches(travel, ['avontuur'], 150, false, false, true), true);
assert.equal(helpers.matches(mystery, ['mysterie'], 150, false, true, true), false);
assert.equal(helpers.matches(mystery, ['mysterie'], 0, false, true, false), true);
assert.equal(helpers.matches(easy, [], 150, true, false, true), false,
  'Unknown page count cannot be presented as a short book');
assert.equal(helpers.matches(easy, [], 0, true, false, true), true);
assert.equal(helpers.matches(travel, [], 0, true, false, true), false);
assert.equal(helpers.explanation(travel, {
  themes: ['avontuur'], maxPages: 150, easy: false, exam: false,
}), 'Thema: Avontuur · 110 pagina’s');
helpers.setEditions(grouped);
assert.ok(helpers.availableThemes().some(item => item.label === 'Avontuur'));
assert.ok(!helpers.availableThemes().some(item => item.label === 'Pesten'),
  'Raw tags must not restore manually cleared themes');
assert.equal(helpers.matches(grouped.find(book => book.title === 'Gecorrigeerde thema’s'),
  ['pesten'], 0, false, false, false), false);
const localCover = '/api/covers/' + 'a'.repeat(64) + '.jpg';
assert.equal(helpers.coverUrl(localCover), 'https://api.example.nl' + localCover,
  'Cached cover must be served from configured API host');
assert.equal(helpers.coverUrl('https://covers.openlibrary.org/b/id/22-M.jpg'),
  'https://covers.openlibrary.org/b/id/22-M.jpg');
assert.match(js, /representativeBook: copy, copies: current\.copies/,
  'Fresh grouped details must bypass stale availability in main catalogue');
assert.match(js, /close\(true\)/, 'Focus handoff bypasses stale focus restoration');
assert.ok(js.includes('const selection = ++selectionVersion;'));
assert.ok(js.includes('if (!active || selection !== selectionVersion) return;'),
  'Late book-detail responses cannot reopen the chooser or its details');
assert.match(html, /id="student-help-choose"[^>]*aria-haspopup="dialog"/);
assert.doesNotMatch(html, /id="student-help-choose"[^>]*disabled/);
assert.match(html, /id="student-choice-dialog"/);
assert.match(html, /id="student-choice-search"/);
assert.match(html, /id="student-choice-results"/);
assert.match(html, /student-book-choice\.js/);
assert.match(vite, /'student-book-choice\.js'/);
assert.match(vite, /'student-book-choice\.css'/);
assert.match(read('public/app.js'), /window\.BoekenbaaiOpenBookDetail = openBookDetail/);
assert.match(js, /fetch\(apiUrl\('\/api\/books'\)/,
  'Recommendations must use current catalog API');
console.log('Student choice helper grouping, filters, accessibility and assets: OK');
