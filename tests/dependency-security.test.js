'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pr-tests.yml'), 'utf8');

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
const OLD_XLSX_TRANSITIVES = [
  'adler-32',
  'cfb',
  'codepage',
  'crc-32',
  'ssf',
  'wmf',
  'word',
];

assert.strictEqual(
  packageJson.engines?.node,
  '>=24 <25',
  'Package metadata moet dezelfde ondersteunde Node 24-major als productie vastleggen'
);
assert.strictEqual(
  packageJson.dependencies?.xlsx,
  SHEETJS_URL,
  'SheetJS moet exact naar de officiële 0.20.3-tarball wijzen'
);
assert.strictEqual(
  lock.packages?.['']?.dependencies?.xlsx,
  SHEETJS_URL,
  'Lockfile-root moet exact dezelfde SheetJS-bron vastleggen'
);
assert.strictEqual(
  lock.packages?.['']?.engines?.node,
  '>=24 <25',
  'Lockfile-root moet de Node 24-engineconstraint behouden'
);

const lockedXlsx = lock.packages?.['node_modules/xlsx'];
assert.ok(lockedXlsx, 'Lockfile moet xlsx bevatten');
assert.strictEqual(lockedXlsx.version, '0.20.3');
assert.strictEqual(lockedXlsx.resolved, SHEETJS_URL);
assert.match(lockedXlsx.integrity || '', /^sha512-/, 'SheetJS tarball moet met integrity-hash vastgelegd zijn');
assert.strictEqual(
  Object.hasOwn(lockedXlsx, 'dependencies'),
  false,
  'SheetJS 0.20.3 hoort niet terug te vallen op de oude npm-transitives'
);
for (const dependency of OLD_XLSX_TRANSITIVES) {
  assert.strictEqual(
    Object.hasOwn(lock.packages || {}, `node_modules/${dependency}`),
    false,
    `Oude xlsx-transitive ${dependency} hoort niet meer in de lockfile`
  );
}

assert.match(workflow, /node-version-file:\s*\.nvmrc/, 'CI moet Node uit .nvmrc halen');
assert.match(workflow, /^\s*contents:\s*read\s*$/m, 'CI-token moet read-only blijven');
assert.doesNotMatch(workflow, /^\s*contents:\s*write\s*$/m, 'CI mag geen contents-write permission krijgen');
assert.doesNotMatch(workflow, /git\s+push/i, 'CI mag de geteste branch niet zelf wijzigen');
assert.match(
  workflow,
  /npm audit --omit=dev --audit-level=high/,
  'High-severity productie-audit moet als CI-gate actief zijn'
);

const XLSX = require('xlsx');
assert.strictEqual(XLSX.version, '0.20.3', 'Geïnstalleerde SheetJS-versie moet exact 0.20.3 zijn');

// Gebruik dezelfde kern-API's als de echte Boekenbaai-import, zodat de
// security-upgrade meteen een read/write-compatibiliteitsregressie vangt.
const workbook = XLSX.utils.book_new();
const sourceSheet = XLSX.utils.aoa_to_sheet([
  ['Titel', 'Auteur', 'ISBN'],
  ['Testboek', 'Test Auteur', '9781234567890'],
]);
XLSX.utils.book_append_sheet(workbook, sourceSheet, 'Import');
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const parsedWorkbook = XLSX.read(buffer, { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(parsedWorkbook.Sheets[parsedWorkbook.SheetNames[0]], {
  defval: '',
});
assert.deepStrictEqual(rows, [
  { Titel: 'Testboek', Auteur: 'Test Auteur', ISBN: '9781234567890' },
]);

console.log('Dependency security en SheetJS compatibiliteitstests geslaagd.');
