'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const { applyPeopleImport } = require('../google-first-people-import');

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
  let store = core.upsertLink(core.emptyAuthStore(), {
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

console.log('Google-first people import tests geslaagd.');
