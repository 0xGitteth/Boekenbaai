'use strict';

const assert = require('assert');
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

console.log('School sync expliciet nieuw-account test geslaagd.');
