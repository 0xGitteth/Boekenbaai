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
    extractBetween(appSource, 'const THEME_COLOR_MAP = {', 'const bookDetailState = {'),
    extractBetween(appSource, 'function collectUniqueThemes(', 'const THEME_PILL_COLLAPSED_LIMIT = 5;'),
    extractBetween(appSource, 'function resolveBookLanguages(', 'function sortBooks('),
    'return { THEME_COLOR_MAP, DEFAULT_THEMES, collectUniqueThemes, filterBooks };',
  ].join('\n\n')
);

const { THEME_COLOR_MAP, DEFAULT_THEMES, collectUniqueThemes, filterBooks } = appFactory();

assert.deepStrictEqual(DEFAULT_THEMES, CANONICAL_THEMES, 'Frontend en backend moeten dezelfde canonieke thema-volgorde gebruiken');
assert.strictEqual(THEME_COLOR_MAP['psychische gezondheid'], '#b39ddb');
assert.strictEqual(THEME_COLOR_MAP.verslaving, '#ffab91');
assert.strictEqual(THEME_COLOR_MAP['media & invloed'], '#90caf9');
assert.strictEqual(THEME_COLOR_MAP['ziekte & verlies'], '#bcaaa4');
assert.strictEqual(THEME_COLOR_MAP.pesten, '#ef9a9a');
assert.strictEqual(THEME_COLOR_MAP['adoptie & afkomst'], '#80cbc4');
assert.strictEqual(THEME_COLOR_MAP['macht & hiërarchie'], '#ce93d8');
assert.strictEqual(THEME_COLOR_MAP.isolatie, '#9fa8da');
assert.strictEqual(THEME_COLOR_MAP.overleven, '#aed581');
assert.deepStrictEqual(
  CANONICAL_THEMES.slice(0, 10),
  [
    'Avontuur',
    'Psychische gezondheid',
    'Verslaving',
    'Media & Invloed',
    'Ziekte & verlies',
    'Pesten',
    'Adoptie & afkomst',
    'Macht & hiërarchie',
    'Isolatie',
    'Overleven',
  ],
  'Canonieke lijst moet de nieuwe zichtbare thema\'s bevatten in vaste volgorde'
);
assert.strictEqual(normalizeRawThemeTag('  Children\'s Stories  '), "children's stories");
assert.strictEqual(isSuppressedThemeTag('juvenile fiction'), true);
assert.strictEqual(mapExactTagToTheme('fantasy fiction'), 'Fantasy');
assert.deepStrictEqual(suggestThemesFromTag('social anxiety'), []);
assert.strictEqual(mapExactTagToTheme('psychosis'), 'Psychische gezondheid');
assert.strictEqual(mapExactTagToTheme('adventure stories'), 'Avontuur');
assert.strictEqual(mapExactTagToTheme('bullying'), 'Pesten');
assert.strictEqual(mapExactTagToTheme('survival'), 'Overleven');

assert.deepStrictEqual(deriveThemesFromTags(['psychological problems']).themes, ['Psychische gezondheid']);
assert.deepStrictEqual(deriveThemesFromTags(['social media pressure']).themes, ['Media & Invloed']);
assert.deepStrictEqual(deriveThemesFromTags(['terminal illness']).themes, ['Ziekte & verlies']);
assert.deepStrictEqual(deriveThemesFromTags(['adopted']).themes, ['Adoptie & afkomst']);
assert.deepStrictEqual(deriveThemesFromTags(['status struggle']).themes, ['Macht & hiërarchie']);
assert.deepStrictEqual(deriveThemesFromTags(['isolated']).themes, ['Isolatie']);
assert.deepStrictEqual(deriveThemesFromTags(['extreme conditions']).themes, ['Overleven']);
assert.deepStrictEqual(deriveThemesFromTags(['school harassment']).themes, ['Pesten']);
assert.deepStrictEqual(deriveThemesFromTags(['obsessief gamen']).themes, ['Verslaving']);

assert.deepStrictEqual(deriveThemesFromTags(['fantasy fiction']).themes, ['Fantasy']);
assert.deepStrictEqual(deriveThemesFromTags(['adventure stories']).themes, ['Avontuur']);
assert.deepStrictEqual(deriveThemesFromTags(['friendship']).themes, ['Vriendschap']);
assert.deepStrictEqual(deriveThemesFromTags(['world war, 1939-1945']).themes, ['Geschiedenis']);
assert.deepStrictEqual(deriveThemesFromTags(['authors, dutch']).themes, []);
assert.deepStrictEqual(deriveThemesFromTags(['dutch language']).themes, []);


const derived = deriveThemesFromTags([
  'juvenile fiction',
  'Fantasy Fiction',
  'magic',
  'friendship',
  'easy reading',
  'social anxiety',
  'psychosis',
  'game addiction',
  'unknown niche topic',
  'world war, 1939-1945',
  'friendship',
]);
assert.deepStrictEqual(derived.themes, ['Psychische gezondheid', 'Verslaving', 'Fantasy', 'Geschiedenis', 'Vriendschap']);
assert.deepStrictEqual(derived.suggestedThemes, []);
assert.deepStrictEqual(derived.unmappedTags, ['unknown niche topic']);
assert.ok(!derived.themes.includes('Makkelijk Lezen'));

const promoted = deriveThemesFromTags(['identity', 'insecurities']);
assert.deepStrictEqual(promoted.themes, ['Identiteit']);
assert.deepStrictEqual(promoted.suggestedThemes, []);

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
  manualThemes: ['Mysterie', 'Makkelijk Lezen', 'Psychische gezondheid', 'Pesten'],
  easyReading: true,
});
assert.deepStrictEqual(manualOverride.tags, ['friendship']);
assert.deepStrictEqual(manualOverride.manualThemes, ['Psychische gezondheid', 'Pesten', 'Mysterie']);
assert.deepStrictEqual(manualOverride.themes, ['Psychische gezondheid', 'Pesten', 'Mysterie']);
assert.ok(!manualOverride.themes.includes('Makkelijk Lezen'));

const oldManualThemes = attachDerivedThemeFields({
  tags: ['adventure stories'],
  manualThemes: ['Fantasy', 'Spanning', 'Identiteit'],
});
assert.deepStrictEqual(oldManualThemes.manualThemes, ['Fantasy', 'Identiteit', 'Spanning']);
assert.deepStrictEqual(oldManualThemes.themes, ['Fantasy', 'Identiteit', 'Spanning']);

const newManualThemes = attachDerivedThemeFields({
  tags: ['friendship'],
  manualThemes: ['Psychische gezondheid', 'Pesten', 'Overleven'],
});
assert.deepStrictEqual(newManualThemes.manualThemes, ['Psychische gezondheid', 'Pesten', 'Overleven']);
assert.deepStrictEqual(newManualThemes.themes, ['Psychische gezondheid', 'Pesten', 'Overleven']);

const mixedManualThemes = attachDerivedThemeFields({
  tags: ['adventure stories'],
  manualThemes: ['Fantasy', 'Psychische gezondheid', 'Spanning'],
});
assert.deepStrictEqual(mixedManualThemes.manualThemes, ['Psychische gezondheid', 'Fantasy', 'Spanning']);
assert.deepStrictEqual(mixedManualThemes.themes, ['Psychische gezondheid', 'Fantasy', 'Spanning']);

const easyReadingExcludedFromManualThemes = attachDerivedThemeFields({
  tags: ['friendship'],
  manualThemes: ['Fantasy', 'Makkelijk Lezen'],
});
assert.deepStrictEqual(easyReadingExcludedFromManualThemes.manualThemes, ['Fantasy']);
assert.deepStrictEqual(easyReadingExcludedFromManualThemes.themes, ['Fantasy']);

const manualThemesOverrideDerivedThemes = attachDerivedThemeFields({
  tags: ['adventure stories'],
  manualThemes: ['Isolatie'],
});
assert.deepStrictEqual(manualThemesOverrideDerivedThemes.themes, ['Isolatie']);

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
  { title: 'Pestboek', tags: ['bullying'], themes: ['Pesten'], easyReading: false },
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
