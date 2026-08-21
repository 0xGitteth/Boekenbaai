'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';

assert.strictEqual(packageJson.engines?.node, '>=24 <25', 'Production Node-major moet expliciet op ondersteunde Node 24 LTS staan');
assert.strictEqual(packageJson.dependencies?.xlsx, SHEETJS_URL, 'SheetJS moet naar de officiële gepatchte 0.20.3-tarball wijzen');
assert.strictEqual(lock.packages?.['']?.dependencies?.xlsx, SHEETJS_URL, 'Lockfile-root moet dezelfde SheetJS-bron vastleggen');

const lockedXlsx = lock.packages?.['node_modules/xlsx'];
assert.ok(lockedXlsx, 'Lockfile moet xlsx bevatten');
assert.strictEqual(lockedXlsx.version, '0.20.3');
assert.strictEqual(lockedXlsx.resolved, SHEETJS_URL);
assert.strictEqual(
  Object.hasOwn(lockedXlsx, 'dependencies'),
  false,
  'SheetJS 0.20.3 hoort niet terug te vallen op de oude npm-transitives'
);

const XLSX = require('xlsx');
assert.strictEqual(XLSX.version, '0.20.3', 'Geïnstalleerde SheetJS-versie moet exact 0.20.3 zijn');

// Gebruik exact dezelfde read + sheet_to_json API-combinatie als de productie-import.
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
