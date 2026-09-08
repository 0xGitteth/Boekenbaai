'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../google-auth-core');
const { applyPeopleImport } = require('../google-first-people-import');

function baseDb() {
  return {
    books: [],
    students: [],
    users: [
      {
        id: 'admin',
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

(function testParnassysTeacherCanOwnMultipleGroups() {
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
        'Gekoppelde groepen': 'Structuur BB; T4',
      },
    ],
  });

  const teacher = result.db.users.find((entry) => entry.role === 'teacher');
  assert.ok(teacher, 'Docent met gekoppelde groepen moet worden aangemaakt');
  assert.strictEqual(teacher.classIds.length, 2);
  assert.deepStrictEqual(
    result.db.classes.map((entry) => entry.name).sort(),
    ['Structuur BB', 'T4']
  );
  for (const klass of result.db.classes) {
    assert.ok(klass.teacherIds.includes(teacher.id), `${klass.name} moet rechten geven aan dezelfde docent`);
  }

  const [classA, classB] = result.db.classes;
  const studentA = { id: 'student-a', name: 'Leerling A', classIds: [classA.id] };
  const studentB = { id: 'student-b', name: 'Leerling B', classIds: [classB.id] };
  result.db.students.push(studentA, studentB);
  classA.studentIds.push(studentA.id);
  classB.studentIds.push(studentB.id);

  assert.strictEqual(core.canStaffManageStudent(result.db, teacher, studentA.id), true);
  assert.strictEqual(core.canStaffManageStudent(result.db, teacher, studentB.id), true);
})();

(function testMentorUiUsesActiveClassInsteadOfAskingEveryTime() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'student-management.js'), 'utf8');
  assert.match(source, /SESSION_CLASS_KEY\s*=\s*'boekenbaai_active_mentor_class'/);
  assert.match(source, /select\.addEventListener\('change', \(\) => setActiveClass\(select\.value\)\)/);
  assert.match(source, /Deze leerling wordt automatisch toegevoegd aan \$\{teacherClass\.name\}/);
  assert.match(source, /state\.role === 'admin' \? classSelect\.value : activeClass\(\)\?\.id/);
  assert.match(source, /if \(classSelect\) form\.append\(field\('Klas', classSelect\)\)/);
})();

console.log('Multi-class mentor tests geslaagd.');
