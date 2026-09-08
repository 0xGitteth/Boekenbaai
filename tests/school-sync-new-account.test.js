'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../google-auth-core');
require('../school-sync-new-account-preload');
const { runSchoolSync } = require('../school-sync-core');

const db = {
  books: [],
  students: [
    {
      id: 'manual-1',
      name: 'Mohammed El Amrani',
      username: 'mohammed',
      passwordHash: 'x',
      classIds: ['class-a'],
      borrowedBooks: [],
      active: true,
      source: 'manual',
    },
  ],
  users: [],
  classes: [
    { id: 'class-a', name: 'Klas A', studentIds: ['manual-1'], teacherIds: [] },
  ],
  history: [],
  studentTransferRequests: [],
};

const result = runSchoolSync({
  kind: 'student',
  db,
  store: core.emptyAuthStore(),
  rows: [{
    Leerlingnummer: '80001',
    'Huidige groep': 'Klas A',
    Roepnaam: 'Mohamed',
    Voorvoegsel: 'El',
    Achternaam: 'Amrani',
    'Huidige status': 'Volgt onderwijs',
  }],
  fullSchoolSync: true,
  manualMatches: { '80001': '__new__' },
});

assert.strictEqual(result.summary.needsReview, 0);
assert.strictEqual(result.summary.created, 1);
assert.strictEqual(result.db.students.length, 2);
const created = result.db.students.find((entry) => entry.parnassysStudentNumber === '80001');
assert.ok(created);
assert.notStrictEqual(created.id, 'manual-1');
assert.strictEqual(result.db.students.find((entry) => entry.id === 'manual-1').parnassysStudentNumber, undefined);

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-sync-finalize.js'), 'utf8');
assert.match(uiSource, /Geen match, maak een nieuw leerlingaccount/);
assert.match(uiSource, /'__new__'/);

const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'school-sync-new-account-preload.js'), 'utf8');
assert.doesNotMatch(preloadSource, /MutationObserver|createServer/, 'De nieuw-accountkeuze hoort geen extra DOM- of HTTP-wrapper meer nodig te hebben');

console.log('School sync expliciet nieuw-account test geslaagd.');
