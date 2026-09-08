'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { applyPeopleImport } = require('../google-first-people-import');

function baseDb() {
  return {
    books: [],
    students: [],
    users: [{ id: 'admin', role: 'admin', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x' }],
    classes: [],
    history: [],
  };
}

(function verifiedStoredEmailFindsExistingAccountWithoutGoogleSubLookupGuessing() {
  const db = baseDb();
  db.students.push({
    id: 'student-1',
    name: 'Oude Naam',
    firstName: 'Oude',
    middleName: '',
    lastName: 'Naam',
    username: 'oude.naam',
    passwordHash: 'x',
    mustChangePassword: false,
    borrowedBooks: [],
    classIds: [],
    active: true,
  });
  const store = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'student',
    accountId: 'student-1',
    email: 'leerling@koraaledu.nl',
    sub: 'verified-google-sub',
    linkedBy: 'admin',
  }).store;

  const result = applyPeopleImport({
    kind: 'student',
    db,
    store,
    domain: 'koraaledu.nl',
    rows: [{ Naam: 'Nieuwe van Naam', Schoolmail: 'leerling@koraaledu.nl' }],
  });

  assert.strictEqual(result.db.students.length, 1);
  assert.strictEqual(result.db.students[0].id, 'student-1');
  assert.strictEqual(result.db.students[0].firstName, 'Nieuwe');
  assert.strictEqual(result.db.students[0].middleName, 'van');
  assert.strictEqual(result.db.students[0].lastName, 'Naam');
  assert.strictEqual(core.findLinkByAccount(result.store, 'student', 'student-1').sub, 'verified-google-sub');
})();

(function noOpImportIsNotRecordedAsUpdated() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['student-1'], teacherIds: [] });
  db.students.push({
    id: 'student-1',
    name: 'Sanne Jansen',
    firstName: 'Sanne',
    middleName: '',
    lastName: 'Jansen',
    username: 'sanne',
    passwordHash: 'x',
    mustChangePassword: false,
    borrowedBooks: [],
    classIds: ['class-a'],
    active: true,
    grade: '',
    source: 'parnassys',
    parnassysStudentNumber: '10001',
    externalIds: { parnassys: '10001' },
    inactiveAt: null,
    inactiveReason: null,
  });

  const result = applyPeopleImport({
    kind: 'student',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Leerlingnummer: '10001',
      'Huidige groep': 'Klas A',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
    }],
  });

  assert.strictEqual(result.summary.created, 0);
  assert.strictEqual(result.summary.updated, 0);
  assert.strictEqual(result.results[0].status, 'unchanged');
  assert.strictEqual(result.db.history.length, 0, 'Een volledig ongewijzigde import hoort geen misleidende updatehistorie te schrijven');
})();

(function changedGoogleMailCountsAsUpdate() {
  const db = baseDb();
  db.students.push({
    id: 'student-1',
    name: 'Sanne Jansen',
    firstName: 'Sanne',
    middleName: '',
    lastName: 'Jansen',
    username: 'sanne',
    passwordHash: 'x',
    mustChangePassword: false,
    borrowedBooks: [],
    classIds: [],
    active: true,
  });

  const result = applyPeopleImport({
    kind: 'student',
    db,
    store: core.emptyAuthStore(),
    domain: 'koraaledu.nl',
    rows: [{ Naam: 'Sanne Jansen', Gebruikersnaam: 'sanne', Schoolmail: 'sanne@koraaledu.nl' }],
  });

  assert.strictEqual(result.summary.updated, 1);
  assert.strictEqual(result.results[0].status, 'updated');
  assert.match(result.db.history[0].message, /1 bijgewerkt/);
})();

(function duplicateStudentNumberIsRejectedBeforeMutation() {
  const db = baseDb();
  assert.throws(
    () => applyPeopleImport({
      kind: 'student',
      db,
      store: core.emptyAuthStore(),
      rows: [
        { Leerlingnummer: '555', 'Huidige groep': 'Klas A', Roepnaam: 'Een', Achternaam: 'Leerling' },
        { Leerlingnummer: '555', 'Huidige groep': 'Klas B', Roepnaam: 'Andere', Achternaam: 'Leerling' },
      ],
    }),
    /leerlingnummer 555 meerdere keren/i
  );
  assert.strictEqual(db.students.length, 0);
})();

console.log('People import integriteitstests geslaagd.');
