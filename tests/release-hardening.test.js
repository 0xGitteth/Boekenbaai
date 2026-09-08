'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
require('../release-hardening-preload');
const people = require('../google-first-people-import');
const hardening = require('../release-hardening-preload').__test;

function baseDb() {
  return {
    books: [],
    students: [],
    users: [{ id: 'admin', role: 'admin', name: 'Boekenbaai Beheer', username: 'admin' }],
    classes: [],
    history: [],
  };
}

(function testVerifiedSchoolmailMatchesExistingAccountAndDerivesFullName() {
  const db = baseDb();
  db.students.push({
    id: 's1',
    name: 'Sanne Oude',
    firstName: 'Sanne',
    lastName: 'Oude',
    username: 'sanne.oud',
    passwordHash: 'x',
    borrowedBooks: [],
    classIds: [],
    active: true,
  });
  const store = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'student',
    accountId: 's1',
    email: 'sanne@koraaledu.nl',
    sub: 'google-sub-sanne',
    linkedBy: 'admin',
  }).store;

  const result = people.applyPeopleImport({
    kind: 'student',
    db,
    store,
    domain: 'koraaledu.nl',
    rows: [{ Naam: 'Sanne van Dijk', Schoolmail: 'sanne@koraaledu.nl' }],
  });

  assert.strictEqual(result.db.students.length, 1, 'Geverifieerde schoolmail mag geen duplicaat maken');
  assert.strictEqual(result.db.students[0].id, 's1');
  assert.strictEqual(result.db.students[0].name, 'Sanne van Dijk');
  assert.strictEqual(result.db.students[0].firstName, 'Sanne');
  assert.strictEqual(result.db.students[0].middleName, 'van');
  assert.strictEqual(result.db.students[0].lastName, 'Dijk');
  assert.strictEqual(core.findLinkByAccount(result.store, 'student', 's1').sub, 'google-sub-sanne');
})();

(function testEmailChangeSupersedesPendingIdentityAndRevokesRuntimeHash() {
  const db = baseDb();
  db.students.push({
    id: 's2',
    name: 'Mirsad Yilmaz',
    username: 'mirsad',
    passwordHash: 'x',
    borrowedBooks: [],
    classIds: [],
    active: true,
  });
  let store = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'student',
    accountId: 's2',
    email: 'oud@koraaledu.nl',
    sub: 'old-sub',
    linkedBy: 'admin',
  }).store;
  store = core.upsertSession(store, 'old-session-token', {
    userId: 's2',
    type: 'student',
    remember: true,
    now: Date.now(),
  }).store;
  store.linkRequests.push({
    id: 'request-old',
    studentId: 's2',
    email: 'fout@koraaledu.nl',
    sub: 'wrong-sub',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const result = people.applyPeopleImport({
    kind: 'student',
    db,
    store,
    domain: 'koraaledu.nl',
    rows: [{ Naam: 'Mirsad Yilmaz', Gebruikersnaam: 'mirsad', Schoolmail: 'nieuw@koraaledu.nl' }],
  });

  assert.strictEqual(result.store.linkRequests[0].status, 'superseded');
  assert.strictEqual(result.store.sessions.length, 0);
  assert.strictEqual(
    hardening.revokedRuntimeTokenHashes.has(core.tokenHash('old-session-token')),
    true,
    'Ook een reeds in RAM gecachete bearer moet als ingetrokken gemarkeerd worden'
  );
})();

(function testExistingUngroupedParnassysTeacherLosesAccess() {
  const db = baseDb();
  db.classes.push({ id: 'class-a', name: 'Klas A', teacherIds: ['t1'], studentIds: [] });
  db.users.push({
    id: 't1',
    role: 'teacher',
    name: 'Docent Een',
    username: 'docent.een',
    passwordHash: 'x',
    classIds: ['class-a'],
    active: true,
    source: 'parnassys',
  });
  let store = core.emptyAuthStore();
  store = core.upsertSession(store, 'teacher-session', {
    userId: 't1',
    type: 'staff',
    remember: true,
    now: Date.now(),
  }).store;

  const result = people.applyPeopleImport({
    kind: 'teacher',
    db,
    store,
    rows: [{
      Roepnaam: 'Docent',
      Achternaam: 'Een',
      Rollen: 'Leerkracht',
      'Gekoppelde groepen': '',
    }],
  });

  const teacher = result.db.users.find((entry) => entry.id === 't1');
  assert.strictEqual(teacher.active, false);
  assert.deepStrictEqual(teacher.classIds, []);
  assert.deepStrictEqual(result.db.classes[0].teacherIds, []);
  assert.strictEqual(result.store.sessions.length, 0);
})();

(function testTransferTargetWithoutMentorIsInvalidData() {
  const db = baseDb();
  db.classes.push(
    { id: 'class-a', name: 'Klas A', teacherIds: ['teacher-a'], studentIds: [] },
    { id: 'class-b', name: 'Klas B', teacherIds: [], studentIds: [] }
  );
  assert.strictEqual(hardening.transferTargetIssue(db, 'class-a'), null);
  assert.strictEqual(hardening.transferTargetIssue(db, 'class-b'), 'class-without-mentor');
  assert.strictEqual(hardening.transferTargetIssue(db, 'missing-class'), null);
})();

(function testPreloadOrderKeepsMentorRoutesBehindSecurity() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const start = packageJson.scripts.start;
  const security = start.indexOf('--require ./google-auth-security-preload.js');
  const hardeningIndex = start.indexOf('--require ./release-hardening-preload.js');
  const management = start.indexOf('--require ./student-management-preload.js');
  assert.ok(security >= 0 && hardeningIndex >= 0 && management >= 0);
  assert.ok(security < hardeningIndex, 'Security wrapper moet buiten de release-hardening zitten');
  assert.ok(hardeningIndex < management, 'Body/sessie-hardening moet vóór leerlingbeheer geladen zijn');
})();

(function testMutationBodiesArePrebufferedBeforeStateSnapshots() {
  assert.strictEqual(hardening.shouldBufferBody({ method: 'POST' }, '/api/mentor/students'), true);
  assert.strictEqual(hardening.shouldBufferBody({ method: 'POST' }, '/api/mentor/students/s1/transfer'), true);
  assert.strictEqual(hardening.shouldBufferBody({ method: 'POST' }, '/api/admin/school-sync/apply'), true);
  assert.strictEqual(hardening.shouldBufferBody({ method: 'GET' }, '/api/admin/school-sync/apply'), false);
})();

console.log('Release hardening regressietests geslaagd.');
