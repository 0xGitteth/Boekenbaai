'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { runSchoolSync } = require('../school-sync-core');

function baseDb() {
  return {
    books: [],
    students: [],
    users: [
      { id: 'admin', role: 'admin', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x' },
    ],
    classes: [],
    history: [],
    studentTransferRequests: [],
  };
}

(function testFuzzyManualStudentNeedsExplicitReviewAndThenBinds() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['manual-1'], teacherIds: [] });
  db.students.push({
    id: 'manual-1',
    name: 'Mohammed El Amrani',
    username: 'mohammed',
    passwordHash: 'x',
    classIds: ['class-a'],
    borrowedBooks: [],
    active: true,
    source: 'manual',
  });
  const rows = [{
    Leerlingnummer: '70001',
    'Huidige groep': 'Klas A',
    Roepnaam: 'Mohamed',
    Voorvoegsel: 'El',
    Achternaam: 'Amrani',
    'Huidige status': 'Volgt onderwijs',
  }];

  const preview = runSchoolSync({
    kind: 'student',
    db: JSON.parse(JSON.stringify(db)),
    store: core.emptyAuthStore(),
    rows,
    fullSchoolSync: true,
  });
  assert.strictEqual(preview.summary.needsReview, 1);
  assert.strictEqual(preview.summary.created, 0, 'Twijfelgeval mag niet stilletjes een tweede account maken');
  const review = preview.results.find((entry) => entry.status === 'needs-review');
  assert.strictEqual(review.studentNumber, '70001');
  assert.strictEqual(review.candidates[0].id, 'manual-1');

  const matched = runSchoolSync({
    kind: 'student',
    db: JSON.parse(JSON.stringify(db)),
    store: core.emptyAuthStore(),
    rows,
    fullSchoolSync: true,
    manualMatches: { '70001': 'manual-1' },
  });
  assert.strictEqual(matched.summary.needsReview, 0);
  assert.strictEqual(matched.db.students.length, 1);
  assert.strictEqual(matched.db.students[0].id, 'manual-1');
  assert.strictEqual(matched.db.students[0].parnassysStudentNumber, '70001');
})();

(function testUnchangedIsNotReportedAsUpdated() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['student-1'], teacherIds: [] });
  db.students.push({
    id: 'student-1',
    name: 'Sanne Jansen',
    firstName: 'Sanne',
    middleName: '',
    lastName: 'Jansen',
    username: '70002',
    passwordHash: 'x',
    classIds: ['class-a'],
    borrowedBooks: [],
    active: true,
    source: 'parnassys',
    parnassysStudentNumber: '70002',
    externalIds: { parnassys: '70002' },
  });
  const result = runSchoolSync({
    kind: 'student',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Leerlingnummer: '70002',
      'Huidige groep': 'Klas A',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
      'Huidige status': 'Volgt onderwijs',
    }],
    fullSchoolSync: true,
  });
  assert.strictEqual(result.summary.updated, 0);
  assert.strictEqual(result.summary.unchanged, 1);
})();

(function testMissingStudentBecomesInactiveOnlyOnConfirmedApply() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['keep', 'leave'], teacherIds: [] });
  db.students.push(
    {
      id: 'keep', name: 'Blijft Leerling', firstName: 'Blijft', lastName: 'Leerling', username: '1', passwordHash: 'x',
      classIds: ['class-a'], borrowedBooks: [], active: true, source: 'parnassys',
      parnassysStudentNumber: '1', externalIds: { parnassys: '1' },
    },
    {
      id: 'leave', name: 'Vertrekt Leerling', firstName: 'Vertrekt', lastName: 'Leerling', username: '2', passwordHash: 'x',
      classIds: ['class-a'], borrowedBooks: [], active: true, source: 'parnassys',
      parnassysStudentNumber: '2', externalIds: { parnassys: '2' },
    }
  );
  const rows = [{
    Leerlingnummer: '1', 'Huidige groep': 'Klas A', Roepnaam: 'Blijft', Achternaam: 'Leerling', 'Huidige status': 'Volgt onderwijs',
  }];

  const preview = runSchoolSync({ kind: 'student', db: JSON.parse(JSON.stringify(db)), store: core.emptyAuthStore(), rows, fullSchoolSync: true });
  assert.strictEqual(preview.summary.missingFromImport, 1);
  assert.strictEqual(preview.db.students.find((entry) => entry.id === 'leave').active, true);

  const applied = runSchoolSync({
    kind: 'student', db: JSON.parse(JSON.stringify(db)), store: core.emptyAuthStore(), rows,
    fullSchoolSync: true, applyDeactivations: true, actorId: 'admin',
  });
  const inactive = applied.db.students.find((entry) => entry.id === 'leave');
  assert.strictEqual(inactive.active, false);
  assert.deepStrictEqual(inactive.classIds, []);
  assert.strictEqual(applied.summary.deactivated, 1);
})();

(function testMissingStudentWithBorrowedBookIsNotDeactivated() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['leave'], teacherIds: [] });
  db.students.push({
    id: 'leave', name: 'Boek Leerling', username: '2', passwordHash: 'x', classIds: ['class-a'],
    borrowedBooks: ['book-1'], active: true, source: 'parnassys', parnassysStudentNumber: '2', externalIds: { parnassys: '2' },
  });
  db.books.push({ id: 'book-1', title: 'Nog thuis', status: 'borrowed', borrowedBy: 'leave' });
  const result = runSchoolSync({
    kind: 'student', db, store: core.emptyAuthStore(), rows: [], fullSchoolSync: true,
    applyDeactivations: true, actorId: 'admin',
  });
  assert.strictEqual(result.db.students[0].active, true);
  assert.strictEqual(result.summary.deactivationBlockedBorrowed, 1);
})();

(function testTeacherMultipleGroupsAndNoGroupDeactivation() {
  const db = baseDb();
  db.classes.push({ id: 'old-class', name: 'Oude klas', studentIds: [], teacherIds: ['old-teacher'] });
  db.users.push({
    id: 'old-teacher', role: 'teacher', name: 'Praktijk Docent', username: 'praktijk', passwordHash: 'x',
    classIds: ['old-class'], active: true, source: 'parnassys',
  });
  const rows = [
    { Roepnaam: 'Gitte', Voorvoegsel: 'van', Achternaam: 'Bakel', Rollen: 'Leerkracht', 'Gekoppelde groepen': 'Klas A; Klas B' },
    { Roepnaam: 'Praktijk', Achternaam: 'Docent', Rollen: 'Vakdocent', 'Gekoppelde groepen': '' },
  ];
  const result = runSchoolSync({
    kind: 'teacher', db, store: core.emptyAuthStore(), rows, fullSchoolSync: true,
    applyDeactivations: true, actorId: 'admin',
  });
  const gitte = result.db.users.find((entry) => entry.name === 'Gitte van Bakel');
  assert.ok(gitte);
  assert.strictEqual(gitte.classIds.length, 2);
  const old = result.db.users.find((entry) => entry.id === 'old-teacher');
  assert.strictEqual(old.active, false);
  assert.deepStrictEqual(old.classIds, []);
})();

(function testRenamedTeacherMatchedByUsernameStaysActive() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: [], teacherIds: ['teacher-1'] });
  db.users.push({
    id: 'teacher-1', role: 'teacher', name: 'Sanne Jansen', username: 's.jansen', passwordHash: 'x',
    classIds: ['class-a'], active: true, source: 'parnassys',
  });

  const result = runSchoolSync({
    kind: 'teacher',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Roepnaam: 'Sanne',
      Achternaam: 'De Vries',
      Gebruikersnaam: 's.jansen',
      'Gekoppelde groepen': 'Klas A',
    }],
    fullSchoolSync: true,
    applyDeactivations: true,
    actorId: 'admin',
  });

  const teacher = result.db.users.find((entry) => entry.id === 'teacher-1');
  assert.ok(teacher);
  assert.strictEqual(teacher.name, 'Sanne De Vries');
  assert.strictEqual(teacher.active, true, 'Een gematchte docent met alleen een naamswijziging mag niet als verdwenen worden gedeactiveerd');
  assert.deepStrictEqual(teacher.classIds, ['class-a']);
})();

(function testWrongParnassysExportTypeIsRejectedBeforeMutation() {
  assert.throws(
    () => runSchoolSync({
      kind: 'teacher',
      db: baseDb(),
      store: core.emptyAuthStore(),
      rows: [{ Leerlingnummer: '123', 'Huidige groep': 'Klas A', Roepnaam: 'Pupil', Achternaam: 'Een' }],
      fullSchoolSync: true,
      applyDeactivations: true,
    }),
    /leerlingenbestand/i,
    'Een leerlingenexport mag nooit als medewerkersexport worden verwerkt'
  );

  assert.throws(
    () => runSchoolSync({
      kind: 'student',
      db: baseDb(),
      store: core.emptyAuthStore(),
      rows: [{ Roepnaam: 'Docent', Achternaam: 'Een', 'Gekoppelde groepen': 'Klas A' }],
      fullSchoolSync: true,
      applyDeactivations: true,
    }),
    /medewerkersbestand/i,
    'Een medewerkersexport mag nooit als leerlingenexport worden verwerkt'
  );
})();

console.log('School sync core tests geslaagd.');
