'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pr-tests.yml'), 'utf8');

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';

assert.strictEqual(
  packageJson.engines?.node,
  '>=24 <25',
  'Production Node-major moet expliciet op ondersteunde Node 24 LTS staan'
);
assert.strictEqual(
  packageJson.dependencies?.xlsx,
  SHEETJS_URL,
  'SheetJS moet naar de officiële gepatchte 0.20.3-tarball wijzen'
);
assert.strictEqual(
  lock.packages?.['']?.dependencies?.xlsx,
  SHEETJS_URL,
  'Lockfile-root moet dezelfde SheetJS-bron vastleggen'
);

const lockedXlsx = lock.packages?.['node_modules/xlsx'];
assert.ok(lockedXlsx, 'Lockfile moet xlsx bevatten');
assert.strictEqual(lockedXlsx.version, '0.20.3');
assert.strictEqual(lockedXlsx.resolved, SHEETJS_URL);
assert.strictEqual(
  Object.hasOwn(lockedXlsx, 'dependencies'),
  false,
  'SheetJS 0.20.3 hoort niet terug te vallen op de oude npm-transitives'
);

assert.match(dockerfile, /^FROM node:24-slim AS app$/m, 'Docker runtime moet dezelfde Node 24 major gebruiken');
assert.match(workflow, /^\s*node-version:\s*24\s*$/m, 'CI moet expliciet Node 24 gebruiken');
assert.match(workflow, /^\s*contents:\s*read\s*$/m, 'CI token moet read-only blijven');
assert.doesNotMatch(workflow, /^\s*contents:\s*write\s*$/m, 'CI mag geen contents write-permission houden');
assert.doesNotMatch(workflow, /git\s+push/i, 'CI mag de geteste branch niet zelf wijzigen');
assert.doesNotMatch(workflow, /package-lock-only/i, 'Lockfilegeneratie hoort niet in de definitieve CI-run');
assert.match(workflow, /^\s*push:\s*$/m, 'Main moet na merge opnieuw door CI worden gecontroleerd');
assert.match(workflow, /npm audit --omit=dev --audit-level=high/, 'High-severity productie-audit moet een CI-gate blijven');

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
