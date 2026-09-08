'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../google-auth-core');
const { applyPeopleImport } = require('../google-first-people-import');
require('../school-sync-new-account-preload');
const { runSchoolSync } = require('../school-sync-core');

{
  const db = {
    books: [],
    students: [],
    users: [],
    classes: [],
    history: [],
    studentTransferRequests: [],
  };
  const result = runSchoolSync({
    kind: 'teacher',
    db,
    store: core.emptyAuthStore(),
    rows: [{ Roepnaam: 'Hanneke', Achternaam: 'Administratie', 'Gekoppelde groepen': '' }],
  });
  assert.strictEqual(result.db.users.length, 0, 'Een ongegroepeerde medewerker zonder bestaand docentaccount moet worden genegeerd');
  assert.strictEqual(result.summary.teachersWithoutGroups, 0);
}

{
  const db = {
    books: [],
    students: [{
      id: 'old-student',
      name: 'Sanne Jansen',
      firstName: 'Sanne',
      lastName: 'Jansen',
      username: 'sanne.oud',
      passwordHash: 'x',
      classIds: [],
      borrowedBooks: [],
      active: false,
      source: 'manual',
    }],
    users: [],
    classes: [],
    history: [],
  };
  const oldStore = core.upsertLink(core.emptyAuthStore(), {
    accountType: 'student',
    accountId: 'old-student',
    email: 'oude.sanne@koraaledu.nl',
    sub: 'google-old-sanne',
    linkedBy: 'test',
  }).store;
  const result = applyPeopleImport({
    kind: 'student',
    db,
    store: oldStore,
    rows: [{
      Leerlingnummer: '99001',
      'Huidige groep': 'Nieuwe klas',
      Roepnaam: 'Sanne',
      Achternaam: 'Jansen',
    }],
  });
  const created = result.db.students.find((entry) => entry.parnassysStudentNumber === '99001');
  assert.ok(created, 'De nieuwe leerling moet een eigen ParnasSys-account krijgen');
  assert.notStrictEqual(created.id, 'old-student');
  assert.strictEqual(result.db.students.find((entry) => entry.id === 'old-student').active, false);
  const oldLink = core.findLinkByAccount(result.store, 'student', 'old-student');
  assert.strictEqual(oldLink.sub, 'google-old-sanne', 'De Google-link van de uitgestroomde leerling mag niet naar de nieuwe leerling verschuiven');
}

{
  const db = {
    books: [],
    students: [],
    users: [{
      id: 'teacher-manual',
      role: 'teacher',
      name: 'Anouk De Vries',
      username: 'anouk',
      passwordHash: 'x',
      classIds: [],
      active: true,
      source: 'manual',
    }],
    classes: [],
    history: [],
  };
  const result = runSchoolSync({
    kind: 'teacher',
    db,
    store: core.emptyAuthStore(),
    rows: [{ Roepnaam: 'Anouk', Achternaam: 'De Vries', 'Gekoppelde groepen': 'Structuur BB' }],
    fullSchoolSync: true,
  });
  const teacher = result.db.users.find((entry) => entry.id === 'teacher-manual');
  assert.strictEqual(teacher.source, 'parnassys', 'Een bestaande docent die door ParnasSys wordt gematcht moet voortaan door de school-sync gevolgd worden');
  assert.strictEqual(teacher.active, true);
  assert.strictEqual(teacher.classIds.length, 1);
}

{
  const db = {
    books: [],
    students: [{
      id: 'manual-similar',
      name: 'Mohammed El Amrani',
      username: 'mohammed',
      passwordHash: 'x',
      classIds: ['class-a'],
      borrowedBooks: [],
      active: true,
      source: 'manual',
    }],
    users: [],
    classes: [{ id: 'class-a', name: 'Klas A', studentIds: ['manual-similar'], teacherIds: [] }],
    history: [],
    studentTransferRequests: [],
  };
  assert.throws(
    () => runSchoolSync({
      kind: 'student',
      db,
      store: core.emptyAuthStore(),
      rows: [{
        Leerlingnummer: '88001',
        'Huidige groep': 'Klas A',
        Roepnaam: 'Mohamed',
        Voorvoegsel: 'El',
        Achternaam: 'Amrani',
      }],
      fullSchoolSync: true,
      applyDeactivations: true,
    }),
    (error) => error?.code === 'SCHOOL_SYNC_REVIEW_REQUIRED',
    'Een apply mag niet doorgaan als de actuele database nieuwe twijfelgevallen oplevert'
  );
}

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-sync-finalize.js'), 'utf8');
assert.match(uiSource, /requestRevision !== syncState\[kind\]\.revision/);
assert.match(uiSource, /syncState\[kind\]\.revision \+= 1/);
assert.match(uiSource, /Voer eerst een actuele voorcontrole uit/);

console.log('Final review regressions tests geslaagd.');