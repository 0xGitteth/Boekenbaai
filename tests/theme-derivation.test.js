const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Kon blok niet vinden tussen ${startMarker} en ${endMarker}`);
  }
  return source.slice(start, end).trim();
}

const serverFactory = new Function(
  [
    extractBetween(serverSource, 'const CANONICAL_THEMES = [', 'const EMPTY_DB = {'),
    "function parseMultiValueField(value) { if (Array.isArray(value)) return value; if (value == null || value === '') return []; return String(value).split(/[;,\\n]/).map((entry) => entry.trim()).filter(Boolean); }",
    'return { CANONICAL_THEMES, normalizeRawThemeTag, isSuppressedThemeTag, mapExactTagToTheme, suggestThemesFromTag, deriveThemesFromTags, attachDerivedThemeFields };',
  ].join('\n\n')
);

const {
  CANONICAL_THEMES,
  normalizeRawThemeTag,
  isSuppressedThemeTag,
  mapExactTagToTheme,
  suggestThemesFromTag,
  deriveThemesFromTags,
  attachDerivedThemeFields,
} = serverFactory();

const appFactory = new Function(
  [
    extractBetween(appSource, 'const DEFAULT_THEMES = [', 'const bookDetailState = {'),
    extractBetween(appSource, 'function collectUniqueThemes(', 'const THEME_PILL_COLLAPSED_LIMIT = 5;'),
    extractBetween(appSource, 'function resolveBookLanguages(', 'function sortBooks('),
    'return { DEFAULT_THEMES, collectUniqueThemes, filterBooks };',
  ].join('\n\n')
);

const { DEFAULT_THEMES, collectUniqueThemes, filterBooks } = appFactory();

assert.deepStrictEqual(DEFAULT_THEMES, CANONICAL_THEMES, 'Frontend en backend moeten dezelfde canonieke thema-volgorde gebruiken');
assert.strictEqual(normalizeRawThemeTag('  Children\'s Stories  '), "children's stories");
assert.strictEqual(isSuppressedThemeTag('juvenile fiction'), true);
assert.strictEqual(mapExactTagToTheme('fantasy fiction'), 'Fantasy');
assert.deepStrictEqual(suggestThemesFromTag('social anxiety'), ['Identiteit', 'School & Opgroeien']);

assert.deepStrictEqual(deriveThemesFromTags(['fantasy fiction']).themes, ['Fantasy']);
assert.deepStrictEqual(deriveThemesFromTags(['adventure stories']).themes, ['Avontuur']);
assert.deepStrictEqual(deriveThemesFromTags(['authors, dutch']).themes, []);
assert.deepStrictEqual(deriveThemesFromTags(['dutch language']).themes, []);


const derived = deriveThemesFromTags([
  'juvenile fiction',
  'Fantasy Fiction',
  'magic',
  'friendship',
  'easy reading',
  'social anxiety',
  'unknown niche topic',
  'world war, 1939-1945',
  'friendship',
]);
assert.deepStrictEqual(derived.themes, ['Fantasy', 'Geschiedenis', 'Vriendschap']);
assert.deepStrictEqual(derived.suggestedThemes, ['Identiteit', 'School & Opgroeien']);
assert.deepStrictEqual(derived.unmappedTags, ['unknown niche topic']);
assert.ok(!derived.themes.includes('Makkelijk Lezen'));

const promoted = deriveThemesFromTags(['social anxiety', 'self image']);
assert.deepStrictEqual(promoted.themes, ['Identiteit']);
assert.deepStrictEqual(promoted.suggestedThemes, ['School & Opgroeien']);

const preserved = attachDerivedThemeFields({
  title: 'Testboek',
  easyReading: true,
  tags: ['easy readers', 'friendship', 'friendship', 'boys'],
});
assert.deepStrictEqual(preserved.tags, ['easy readers', 'friendship', 'friendship', 'boys']);
assert.deepStrictEqual(preserved.themes, ['Vriendschap']);
assert.deepStrictEqual(preserved.suggestedThemes, []);
assert.deepStrictEqual(preserved.unmappedTags, []);
assert.strictEqual(preserved.easyReading, true);
assert.ok(!preserved.themes.includes('Makkelijk Lezen'));


const manualOverride = attachDerivedThemeFields({
  tags: ['friendship'],
  manualThemes: ['Mysterie', 'Makkelijk Lezen'],
  easyReading: true,
});
assert.deepStrictEqual(manualOverride.tags, ['friendship']);
assert.deepStrictEqual(manualOverride.manualThemes, ['Mysterie']);
assert.deepStrictEqual(manualOverride.themes, ['Mysterie']);
assert.ok(!manualOverride.themes.includes('Makkelijk Lezen'));

const availableThemes = collectUniqueThemes([
  { tags: ['juvenile fiction', 'Mysterie'], themes: ['Mysterie'] },
  { tags: ['easy reading'], themes: [] },
  { tags: ['friendship'], themes: ['Vriendschap'] },
]);
assert.deepStrictEqual(
  availableThemes.map((theme) => theme.label),
  ['Mysterie', 'Vriendschap'],
  'Themafilter mag alleen afgeleide themes tonen in canonieke volgorde'
);

const filtered = filterBooks(
  [
    { title: 'Ruwe tags', tags: ['juvenile fiction'], themes: [], easyReading: false },
    { title: 'Mysterieboek', tags: ['juvenile fiction'], themes: ['Mysterie'], easyReading: false },
    { title: 'Leesboek', tags: ['easy reading'], themes: [], easyReading: true },
  ],
  { selectedThemes: new Set(['mysterie']) }
);
assert.deepStrictEqual(filtered.map((book) => book.title), ['Mysterieboek']);
assert.strictEqual(
  filterBooks(
    [
      { title: 'Leesboek', tags: ['easy reading'], themes: [], easyReading: true },
      { title: 'Ander boek', tags: ['friendship'], themes: ['Vriendschap'], easyReading: false },
    ],
    { onlyEasyReading: true }
  ).length,
  1,
  'Makkelijk Lezen moet apart op easyReading blijven filteren'
);

console.log('Theme derivation tests passed');
