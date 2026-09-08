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

assert.throws(
  () => runSchoolSync({
    kind: 'student',
    db: { books: [], students: [], users: [], classes: [], history: [] },
    store: core.emptyAuthStore(),
    rows: [
      { Leerlingnummer: '90001', 'Huidige groep': 'Klas A', Roepnaam: 'Sanne', Achternaam: 'Jansen' },
      { Leerlingnummer: '90001', 'Huidige groep': 'Klas B', Roepnaam: 'Sanne', Achternaam: 'Jansen' },
    ],
  }),
  /leerlingnummer 90001 meerdere keren/,
  'Een dubbel ParnasSys-leerlingnummer mag nooit stilletjes door de laatste rij worden overschreven'
);

assert.throws(
  () => runSchoolSync({
    kind: 'teacher',
    db: { books: [], students: [], users: [], classes: [], history: [] },
    store: core.emptyAuthStore(),
    rows: [
      { Roepnaam: 'Sam', Achternaam: 'De Vries', 'Gekoppelde groepen': 'Klas A' },
      { Roepnaam: 'Sam', Achternaam: 'De Vries', 'Gekoppelde groepen': 'Klas B' },
    ],
  }),
  /medewerkersbestand bevat Sam De Vries meerdere keren/i,
  'Zonder personeelsnummer mogen twee identieke docentnamen niet stilletjes worden samengevoegd'
);

assert.throws(
  () => runSchoolSync({
    kind: 'student',
    db: { books: [], students: [], users: [], classes: [], history: [] },
    store: core.emptyAuthStore(),
    rows: [{ Leerlingnummer: '91001', Roepnaam: 'Losse', Achternaam: 'Rij' }],
    manualMatches: { '91001': '__new__' },
  }),
  /niet herkend als ParnasSys-leerlingenexport/i,
  'De expliciet-nieuwkeuze mag de verplichte ParnasSys-bestandsvalidatie niet omzeilen'
);

const legacyTeacherDb = {
  books: [],
  students: [],
  users: [{
    id: 'legacy-teacher',
    role: 'teacher',
    name: 'Sam De Vries',
    username: 'sam',
    passwordHash: 'x',
    classIds: ['teacher-class-a'],
    active: true,
    source: 'legacy',
  }],
  classes: [{
    id: 'teacher-class-a',
    name: 'Klas A',
    studentIds: [],
    teacherIds: ['legacy-teacher'],
  }],
  history: [],
};
const promotedTeacher = runSchoolSync({
  kind: 'teacher',
  db: legacyTeacherDb,
  store: core.emptyAuthStore(),
  rows: [{ Roepnaam: 'Sam', Achternaam: 'De Vries', 'Gekoppelde groepen': 'Klas A' }],
  fullSchoolSync: true,
});
assert.strictEqual(
  promotedTeacher.db.users.find((entry) => entry.id === 'legacy-teacher').source,
  'parnassys',
  'Een bestaande docent die succesvol uit ParnasSys wordt gematcht moet voortaan door ParnasSys beheerd worden'
);
const teacherMissingLater = runSchoolSync({
  kind: 'teacher',
  db: promotedTeacher.db,
  store: promotedTeacher.store,
  rows: [{ Roepnaam: 'Andere', Achternaam: 'Docent', 'Gekoppelde groepen': 'Klas B' }],
  fullSchoolSync: true,
  applyDeactivations: true,
  actorId: 'admin',
});
assert.strictEqual(
  teacherMissingLater.db.users.find((entry) => entry.id === 'legacy-teacher').active,
  false,
  'Een later ontbrekende gematchte ParnasSys-docent moet bij een volledige sync wel kunnen worden gedeactiveerd'
);

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-sync-finalize.js'), 'utf8');
assert.match(uiSource, /Geen match, maak een nieuw leerlingaccount/);
assert.match(uiSource, /'__new__'/);

const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'school-sync-new-account-preload.js'), 'utf8');
assert.doesNotMatch(preloadSource, /MutationObserver|createServer/, 'De nieuw-accountkeuze hoort geen extra DOM- of HTTP-wrapper meer nodig te hebben');

console.log('School sync expliciet nieuw-account en bronidentiteit-tests geslaagd.');
