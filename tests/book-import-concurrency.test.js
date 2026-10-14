'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeBookImportRows } = require('../book-import-analysis');

function isbnFor(index) {
  const firstTwelve = `97890599656${index}`;
  let sum = 0;
  for (let digit = 0; digit < 12; digit += 1) {
    sum += Number(firstTwelve[digit]) * (digit % 2 ? 3 : 1);
  }
  return firstTwelve + String((10 - sum % 10) % 10);
}

async function main() {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    Titel: `Boek ${index}`, Auteur: `Auteur ${index}`, ISBN: isbnFor(index), Aantal: 2,
  }));
  rows.splice(2, 0, { Titel: 'hh' });
  rows.splice(4, 0, {
    Titel: 'Docentboek', Auteur: 'A Auteur', ISBN: isbnFor(9), Aantal: 1,
    Klassen: 'eigen boek',
  });
  let active = 0;
  let highest = 0;
  let lookupCount = 0;
  const analyzed = await analyzeBookImportRows(rows, {
    maxCopies: 12,
    lookupIsbn: async () => {
      lookupCount += 1;
      active += 1;
      highest = Math.max(highest, active);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      active -= 1;
      return { found: false };
    },
  });
  assert.equal(analyzed.ok, true);
  assert.equal(highest, 3, 'at most three metadata requests run at a time');
  assert.equal(lookupCount, 8, 'excluded and junk rows must not trigger metadata requests');
  assert.equal(analyzed.summary.physicalCopies, 12);
  assert.equal(analyzed.summary.ready, 6);
  assert.equal(analyzed.summary.conflict, 2);
  assert.equal(analyzed.summary.skipped, 2);
  assert.deepEqual(analyzed.rows.map((row) => row.index), rows.map((_, index) => index));
  assert.deepEqual(analyzed.rows.slice(-2).map((row) => row.status), ['conflict', 'conflict']);
  assert.ok(analyzed.rows.slice(-2).every((row) => row.issues.some((issue) => issue.code === 'copy_limit_exceeded')));

  let sharedCalls = 0;
  const duplicated = await analyzeBookImportRows([
    { Titel: 'Zelfde titel', Auteur: 'A Auteur', ISBN: isbnFor(0), Aantal: 2 },
    { Titel: 'Zelfde titel', Auteur: 'A Auteur', ISBN: isbnFor(0), Aantal: 2 },
  ], {
    lookupIsbn: async () => {
      sharedCalls += 1;
      await Promise.resolve();
      return { found: false };
    },
  });
  assert.equal(duplicated.ok, true);
  assert.equal(sharedCalls, 1, 'identical concurrent requests must share a lookup');

  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const importUi = fs.readFileSync(path.join(__dirname, '../public/admin-book-import-review.js'), 'utf8');
  assert.match(app, /state\.coverImage\.onerror = \(\) =>/);
  assert.match(app, /coverImage\.onerror = \(\) =>/);
  assert.match(importUi, /metadata\.type = 'checkbox';\s*metadata\.checked = true;/);
  console.log('Book import concurrency and cover fallback checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
