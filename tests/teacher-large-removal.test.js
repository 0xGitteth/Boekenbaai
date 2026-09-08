'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { runSchoolSync } = require('../school-sync-core');

function makeDb() {
  const teachers = Array.from({ length: 20 }, (_, index) => ({
    id: `teacher-${index + 1}`,
    role: 'teacher',
    name: `Docent ${index + 1}`,
    username: `docent-${index + 1}`,
    passwordHash: 'x',
    classIds: ['class-a'],
    active: true,
    source: 'parnassys',
  }));
  return {
    books: [],
    students: [],
    users: [
      { id: 'admin', role: 'admin', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x' },
      ...teachers,
    ],
    classes: [{
      id: 'class-a',
      name: 'Klas A',
      studentIds: [],
      teacherIds: teachers.map((entry) => entry.id),
    }],
    history: [],
    studentTransferRequests: [],
  };
}

const rows = [{
  Roepnaam: 'Docent',
  Achternaam: '1',
  Gebruikersnaam: 'docent-1',
  'Gekoppelde groepen': 'Klas A',
}];

const preview = runSchoolSync({
  kind: 'teacher',
  db: makeDb(),
  store: core.emptyAuthStore(),
  rows,
  fullSchoolSync: true,
});

assert.strictEqual(preview.summary.missingTeachersFromImport, 19);
assert.strictEqual(
  preview.summary.largeRemovalWarning,
  true,
  'Een opvallend grote afname in een volledige medewerkerslijst moet extra bevestiging vereisen'
);
assert.strictEqual(
  preview.db.users.filter((entry) => entry.role === 'teacher' && entry.active === false).length,
  0,
  'De voorcontrole mag nog niemand inactief maken'
);

const partial = runSchoolSync({
  kind: 'teacher',
  db: makeDb(),
  store: core.emptyAuthStore(),
  rows,
  fullSchoolSync: false,
});
assert.strictEqual(partial.summary.missingTeachersFromImport, 0);
assert.strictEqual(partial.summary.largeRemovalWarning, false);

console.log('Teacher large-removal safeguard tests geslaagd.');
