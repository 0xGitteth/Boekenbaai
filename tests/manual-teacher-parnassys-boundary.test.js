'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
require('../school-sync-new-account-preload');
const { runSchoolSync } = require('../school-sync-core');

function baseDb(source) {
  return {
    books: [],
    students: [],
    users: [{
      id: 'teacher-1',
      role: 'teacher',
      name: 'Anouk De Vries',
      username: 'anouk',
      passwordHash: 'x',
      active: true,
      source,
      classIds: ['class-a'],
    }],
    classes: [{
      id: 'class-a',
      name: 'Structuur BB',
      teacherIds: ['teacher-1'],
      studentIds: [],
    }],
    history: [],
    studentTransferRequests: [],
  };
}

const ungroupedRow = [{
  Roepnaam: 'Anouk',
  Achternaam: 'De Vries',
  'Gekoppelde groepen': '',
}];

{
  const result = runSchoolSync({
    kind: 'teacher',
    db: baseDb('manual'),
    store: core.emptyAuthStore(),
    rows: ungroupedRow,
    fullSchoolSync: true,
    applyDeactivations: true,
  });
  const teacher = result.db.users.find((entry) => entry.id === 'teacher-1');
  assert.strictEqual(teacher.active, true, 'Een handmatig beheerde docent mag niet door een naamsovereenkomst met een ongegroepeerde ParnasSys-rij worden uitgezet');
  assert.deepStrictEqual(teacher.classIds, ['class-a']);
  assert.deepStrictEqual(result.db.classes[0].teacherIds, ['teacher-1']);
}

{
  const result = runSchoolSync({
    kind: 'teacher',
    db: baseDb('parnassys'),
    store: core.emptyAuthStore(),
    rows: ungroupedRow,
    fullSchoolSync: true,
    applyDeactivations: true,
  });
  const teacher = result.db.users.find((entry) => entry.id === 'teacher-1');
  assert.strictEqual(teacher.active, false, 'Een reeds ParnasSys-beheerde docent zonder gekoppelde groepen moet wel worden gedeactiveerd');
  assert.deepStrictEqual(teacher.classIds, []);
  assert.deepStrictEqual(result.db.classes[0].teacherIds, []);
}

console.log('Manual/ParnasSys teacher boundary tests geslaagd.');