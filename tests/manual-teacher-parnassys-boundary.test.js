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
  assert.strictEqual(teacher.active,true,
    'Een bestaande docent in de complete export blijft werkzaam zonder groep');
  assert.deepStrictEqual(teacher.classIds,[],
    'De vorige klasrechten worden niet gehandhaafd als de export geen groep noemt');
  assert.deepStrictEqual(result.db.classes[0].teacherIds,[]);
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
  assert.strictEqual(teacher.active,true,
    'Een ParnasSys-docent die wel op de medewerkerslijst staat blijft actief, ook zonder groep');
  assert.deepStrictEqual(teacher.classIds, []);
  assert.deepStrictEqual(result.db.classes[0].teacherIds, []);
}

console.log('Manual/ParnasSys teacher boundary tests geslaagd.');