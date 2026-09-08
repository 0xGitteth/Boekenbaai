'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { applyPeopleImport, getParnassysStudentNumber } = require('../google-first-people-import');

function baseDb() {
  return {
    books: [],
    students: [],
    users: [
      {
        id: 'u-admin',
        role: 'admin',
        name: 'Boekenbaai Beheer',
        username: 'admin',
        passwordHash: 'x',
      },
    ],
    classes: [],
    history: [],
  };
}

(function testStudentGoogleFirstImportNeedsNoUsernameOrPassword() {
  const result = applyPeopleImport({
    kind: 'student',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [
      {
        Voornaam: 'Sanne',
        Achternaam: 'Jansen',
        Schoolmail: 's.jansen@koraaledu.nl',
        Klassen: 'SK BB',
        Leerjaar: '4',
      },
    ],
  });

  assert.strictEqual(result.summary.created, 1);
  assert.strictEqual(result.summary.linked, 1);
  const student = result.db.students[0];
  assert.ok(student.id);
  assert.ok(student.username, 'Interne gebruikersnaam moet automatisch worden aangemaakt');
  assert.strictEqual(student.mustChangePassword, false);
  assert.strictEqual(student.grade, '4');
  assert.strictEqual(result.db.classes[0].name, 'SK BB');
  assert.ok(result.db.classes[0].studentIds.includes(student.id));
  const link = core.findLinkByAccount(result.store, 'student', student.id);
  assert.strictEqual(link.email, 's.jansen@koraaledu.nl');
  assert.strictEqual(link.sub, '');
})();

(function testTeacherImportCreatesPrelinkAndClass() {
  const result = applyPeopleImport({
    kind: 'teacher',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [
      {
        Naam: 'Gitte van Bakel',
        Schoolmail: 'g.vanbakel@koraaledu.nl',
        Klassen: 'Structuurklas Bovenbouw',
      },
    ],
  });

  const teacher = result.db.users.find((entry) => entry.role === 'teacher');
  assert.ok(teacher);
  assert.strictEqual(teacher.mustChangePassword, false);
  assert.ok(result.db.classes[0].teacherIds.includes(teacher.id));
  const link = core.findLinkByAccount(result.store, 'staff', teacher.id);
  assert.strictEqual(link.email, 'g.vanbakel@koraaledu.nl');
})();

(function testExistingVerifiedLinkIsPreservedOnSameEmail() {
  const db = baseDb();
  db.students.push({
    id: 's1',
    name: 'Sanne Jansen',
    username: 'legacy-sanne',
    passwordHash: 'legacy',
    mustChangePassword: true,
    borrowedBooks: ['b1'],
    classIds: [],
  });
  const store = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'student',
    accountId: 's1',
    email: 's.jansen@koraaledu.nl',
    sub: 'google-sub-sanne',
    linkedBy: 'u-admin',
  }).store;

  const result = applyPeopleImport({
    kind: 'student',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db,
    store,
    rows: [{ Naam: 'Sanne Jansen', Schoolmail: 's.jansen@koraaledu.nl', Leerjaar: '5' }],
  });

  assert.strictEqual(result.summary.created, 0);
  assert.strictEqual(result.summary.updated, 1);
  assert.strictEqual(result.db.students.length, 1);
  assert.deepStrictEqual(result.db.students[0].borrowedBooks, ['b1']);
  assert.strictEqual(result.db.students[0].grade, '5');
  const link = core.findLinkByAccount(result.store, 'student', 's1');
  assert.strictEqual(link.sub, 'google-sub-sanne');
})();

(function testChangingEmailClearsVerifiedSubAndRevokesSessions() {
  const db = baseDb();
  db.users.push({
    id: 't1',
    role: 'teacher',
    name: 'Docent Een',
    username: 'docent.een',
    passwordHash: 'legacy',
    classIds: [],
  });
  let store = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'staff',
    accountId: 't1',
    email: 'oud@koraaledu.nl',
    sub: 'sub-old',
    linkedBy: 'u-admin',
  }).store;
  store = core.upsertSession(store, 'session-token', {
    userId: 't1',
    type: 'staff',
    remember: true,
    now: Date.now(),
  }).store;

  const result = applyPeopleImport({
    kind: 'teacher',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db,
    store,
    rows: [{ Naam: 'Docent Een', Gebruikersnaam: 'docent.een', Schoolmail: 'nieuw@koraaledu.nl' }],
  });

  const link = core.findLinkByAccount(result.store, 'staff', 't1');
  assert.strictEqual(link.email, 'nieuw@koraaledu.nl');
  assert.strictEqual(link.sub, '');
  assert.strictEqual(core.resolveSession(result.store, 'session-token'), null);
})();

(function testAmbiguousNameDoesNotGuess() {
  const db = baseDb();
  db.students.push(
    { id: 's1', name: 'Sam de Vries', username: 'sam1', passwordHash: 'x', borrowedBooks: [], classIds: [] },
    { id: 's2', name: 'Sam de Vries', username: 'sam2', passwordHash: 'x', borrowedBooks: [], classIds: [] }
  );
  const result = applyPeopleImport({
    kind: 'student',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db,
    store: core.emptyAuthStore(),
    rows: [{ Naam: 'Sam de Vries', Klas: 'Klas 1' }],
  });
  assert.strictEqual(result.summary.skipped, 1);
  assert.strictEqual(result.summary.ambiguous, 1);
  assert.strictEqual(result.db.students.length, 2);
})();

(function testInvalidExternalEmailDoesNotCreateGoogleLink() {
  const result = applyPeopleImport({
    kind: 'student',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [{ Naam: 'Test Leerling', Schoolmail: 'test@gmail.com' }],
  });
  assert.strictEqual(result.summary.created, 1);
  assert.strictEqual(result.summary.invalidEmail, 1);
  assert.strictEqual(result.store.links.length, 0);
})();

(function testParnassysStudentExportWorksWithoutEditingOrEmail() {
  const result = applyPeopleImport({
    kind: 'student',
    domain: 'koraaledu.nl',
    actorId: 'u-admin',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [
      {
        Leerlingnummer: '10482',
        'Huidige groep': 'Structuurklas Bovenbouw',
        Roepnaam: 'Mirsad',
        Voorvoegsel: '',
        Achternaam: 'Yilmaz',
        'Huidige status': 'Volgt onderwijs',
      },
    ],
  });

  assert.strictEqual(result.summary.parnassysRows, 1);
  assert.strictEqual(result.summary.created, 1);
  assert.strictEqual(result.summary.studentNumbersStored, 1);
  assert.strictEqual(result.db.students[0].name, 'Mirsad Yilmaz');
  assert.strictEqual(getParnassysStudentNumber(result.db.students[0]), '10482');
  assert.strictEqual(result.db.classes[0].name, 'Structuurklas Bovenbouw');
  assert.strictEqual(result.store.links.length, 0, 'Leerlingmail hoeft niet vooraf bekend te zijn');
})();

(function testParnassysNumberKeepsIdentityAcrossClassMove() {
  const first = applyPeopleImport({
    kind: 'student',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [{
      Leerlingnummer: '20001',
      'Huidige groep': 'Klas A',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
      'Huidige status': 'Volgt onderwijs',
    }],
  });
  const studentId = first.db.students[0].id;

  const second = applyPeopleImport({
    kind: 'student',
    db: first.db,
    store: first.store,
    rows: [{
      Leerlingnummer: '20001',
      'Huidige groep': 'Klas B',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
      'Huidige status': 'Volgt onderwijs',
    }],
  });

  assert.strictEqual(second.db.students.length, 1);
  assert.strictEqual(second.db.students[0].id, studentId);
  assert.strictEqual(second.summary.matchedByStudentNumber, 1);
  assert.deepStrictEqual(
    second.db.classes.filter((entry) => entry.studentIds.includes(studentId)).map((entry) => entry.name),
    ['Klas B']
  );
})();

(function testParnassysSyncBindsNumberToUniqueManualStudent() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', studentIds: ['manual-1'], teacherIds: [] });
  db.students.push({
    id: 'manual-1',
    name: 'Nieuwe Leerling',
    firstName: 'Nieuwe',
    lastName: 'Leerling',
    username: 'nieuwe.leerling',
    passwordHash: 'x',
    borrowedBooks: [],
    classIds: ['class-a'],
    active: true,
    source: 'manual',
  });

  const result = applyPeopleImport({
    kind: 'student',
    db,
    store: core.emptyAuthStore(),
    rows: [{
      Leerlingnummer: '30003',
      'Huidige groep': 'Klas A',
      Roepnaam: 'Nieuwe',
      Achternaam: 'Leerling',
      'Huidige status': 'Volgt onderwijs',
    }],
  });

  assert.strictEqual(result.db.students.length, 1);
  assert.strictEqual(result.db.students[0].id, 'manual-1');
  assert.strictEqual(getParnassysStudentNumber(result.db.students[0]), '30003');
})();

(function testParnassysStaffExportOnlyCreatesPeopleWithLinkedGroups() {
  const result = applyPeopleImport({
    kind: 'teacher',
    db: baseDb(),
    store: core.emptyAuthStore(),
    rows: [
      {
        Roepnaam: 'Gitte',
        Voorvoegsel: 'van',
        Achternaam: 'Bakel',
        Rollen: 'Leerkracht',
        'Gekoppelde groepen': 'Structuurklas Bovenbouw',
      },
      {
        Roepnaam: 'Piet',
        Achternaam: 'Beleid',
        Rollen: 'Beleidsmedewerker',
        'Gekoppelde groepen': '',
      },
    ],
  });

  const teachers = result.db.users.filter((entry) => entry.role === 'teacher');
  assert.strictEqual(teachers.length, 1);
  assert.strictEqual(teachers[0].name, 'Gitte van Bakel');
  assert.strictEqual(result.summary.ignored, 1);
  assert.strictEqual(result.db.classes[0].name, 'Structuurklas Bovenbouw');
})();

console.log('Google-first people import tests geslaagd.');
