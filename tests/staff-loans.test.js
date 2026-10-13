'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const PORT = 4061;
const BASE = 'http://127.0.0.1:' + PORT;
const hash = (password) => crypto.createHash('sha256').update(password).digest('hex');

async function call(route, token, payload, method) {
  const response = await fetch(BASE + route, {
    method: method || (payload === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}
function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('PR5 server start timeout')), 8000);
    const ready = (data) => {
      if (!data.toString().includes('http://localhost:' + PORT)) return;
      clearTimeout(timeout);
      child.stdout.off('data', ready);
      resolve();
    };
    child.stdout.on('data', ready);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(Error('PR5 server stopped: ' + code));
    });
  });
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pr5-'));
  const dbPath = path.join(tmp, 'db.json');
  const makeBook = (id, barcode, extra = {}) => ({
    id, title: 'Een veilig boek', author: 'A Auteur', barcode,
    status: 'available', metadataIsbn: '9780306406157',
    ...extra,
  });
  const db = {
    books: [
      makeBook('book-student', '55220011', { loanId: 'legacy-active-loan-secret' }),
      makeBook('book-class', '55220012', { fixedLocation: 'SK BB' }),
      makeBook('book-other', '55220013'),
    ],
    students: [
      { id: 'stu-a', name: 'Leerling A', username: 'leerling-a', passwordHash: hash('pass'), classIds: ['class-a'], borrowedBooks: [] },
      { id: 'stu-b', name: 'Leerling B', username: 'leerling-b', passwordHash: hash('pass'), classIds: ['class-b'], borrowedBooks: [] },
    ],
    classes: [
      { id: 'class-a', name: 'Structuurklas', teacherIds: ['teacher-a'],
        studentIds: ['stu-a'] },
      { id: 'class-b', name: 'Andere klas', teacherIds: ['teacher-b'],
        studentIds: ['stu-b'] },
    ],
    users: [
      { id: 'teacher-a', name: 'Docent A', username: 'docent-a', role: 'teacher',
        classIds: ['class-a'], passwordHash: hash('pass') },
      { id: 'teacher-b', name: 'Docent B', username: 'docent-b', role: 'teacher',
        classIds: ['class-b'], passwordHash: hash('pass') },
      { id: 'admin', name: 'Beheerder', username: 'beheerder', role: 'admin', passwordHash: hash('pass') },
    ],
    history: [], folders: [], importJobs: [],
  };
  fs.writeFileSync(dbPath, JSON.stringify(db));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.resolve(__dirname, '..', 'public') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child);
    const login = async (username) => {
      const result = await call('/api/login', null, { username, password: 'pass' });
      assert.strictEqual(result.status, 200, username + ': ' + JSON.stringify(result.body));
      return result.body.token;
    };
    const teacherA = await login('docent-a');
    const teacherB = await login('docent-b');
    const admin = await login('beheerder');
    const studentA = await login('leerling-a');

    assert.strictEqual((await call('/api/staff/loans', studentA)).status, 403);
    assert.strictEqual((await call('/api/staff/loans', null)).status, 401);
    const teacherOverview = await call('/api/staff/loans', teacherA);
    assert.strictEqual(teacherOverview.status, 200);
    assert.deepStrictEqual(teacherOverview.body.classes.map((x) => x.id), ['class-a']);
    assert.deepStrictEqual(teacherOverview.body.students.map((x) => x.id), ['stu-a']);
    assert.strictEqual(teacherOverview.body.loans.length, 0);
    assert.strictEqual(teacherOverview.body.books.length, 3);

    const wrongStudent = await call('/api/books/book-student/check-out', teacherA,
      { studentId: 'stu-b' });
    assert.strictEqual(wrongStudent.status, 403);
    const wrongClass = await call('/api/books/book-class/check-out', teacherA,
      { classId: 'class-b' });
    assert.strictEqual(wrongClass.status, 403);
    assert.strictEqual((await call('/api/books/book-class/check-out', studentA,
      { classId: 'class-a' })).status, 403);
    assert.strictEqual((await call('/api/books/book-student/check-out', teacherA,
      { studentId: 'stu-a', classId: 'class-a' })).status, 400);
    assert.strictEqual((await call('/api/books/book-student/check-out', teacherA,
      { studentId: 'stu-a', dueDate: '2026-02-30' })).status, 400);

    const studentLoan = await call('/api/books/book-student/check-out', teacherA,
      { studentId: 'stu-a', dueDate: '2027-01-15' });
    assert.strictEqual(studentLoan.status, 200, JSON.stringify(studentLoan.body));
    const classLoan = await call('/api/books/book-class/check-out', teacherA,
      { classId: 'class-a' });
    assert.strictEqual(classLoan.status, 200, JSON.stringify(classLoan.body));
    assert.strictEqual(classLoan.body.borrowerType, 'class');
    const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const physicalStudent = stored.books.find((x) => x.id === 'book-student');
    const physicalClass = stored.books.find((x) => x.id === 'book-class');
    assert.strictEqual(physicalStudent.borrowedBy, 'stu-a');
    assert.strictEqual(physicalStudent.borrowedByClassId, null);
    assert.strictEqual(physicalStudent.dueDate, '2027-01-15');
    assert.strictEqual(physicalClass.borrowedBy, null);
    assert.strictEqual(physicalClass.borrowedByClassId, 'class-a');
    assert.strictEqual(physicalClass.fixedLocation, 'SK BB',
      'A class loan must never erase a fixed school location');
    assert.strictEqual(stored.students[0].borrowedBooks.length, 1);
    assert.strictEqual(stored.students[1].borrowedBooks.length, 0);
    assert.ok(stored.history.some((event) => event.type === 'check_out_class'
      && event.classId === 'class-a'));

    // An anonymous or student client can see availability, but no identifiers,
    // borrower classes, loan timestamps or return dates, even by exact ID.
    for (const route of ['/api/books', '/api/books/book-class',
      '/api/books/barcode/55220012']) {
      const response = await call(route, studentA);
      assert.strictEqual(response.status, 200, route);
      const text = JSON.stringify(response.body);
      for (const secret of ['borrowedBy', 'borrowedByClassId', 'stu-a', 'class-a',
        '2027-01-15', 'borrowedAt', 'loanId', 'legacy-active-loan-secret']) {
        assert.ok(!text.includes(secret), 'Leaked ' + secret + ' in ' + route);
      }
    }
    const selfLoans = await call('/api/staff/loans', teacherA);
    assert.deepStrictEqual(selfLoans.body.loans.map((entry) => entry.borrowerType).sort(),
      ['class', 'student']);
    assert.ok(selfLoans.body.loans.some((entry) => entry.borrowerName === 'Leerling A'));
    assert.ok(selfLoans.body.loans.some((entry) => entry.borrowerName === 'Structuurklas'));
    const otherTeacher = await call('/api/staff/loans', teacherB);
    assert.strictEqual(otherTeacher.body.loans.length, 0);
    assert.strictEqual((await call('/api/students/stu-a/loans', teacherB)).status, 403);
    assert.strictEqual((await call('/api/students/stu-a/stats', teacherB)).status, 403);
    assert.strictEqual((await call('/api/students/stu-a/loans', teacherA)).status, 200);
    assert.strictEqual((await call('/api/books/book-class/check-in', teacherB,
      { classId: 'class-a' })).status, 403);
    assert.strictEqual((await call('/api/books/book-class/check-in', teacherA,
      { studentId: 'stu-a' })).status, 409);
    assert.strictEqual((await call('/api/books/book-student/check-in', teacherA,
      { classId: 'class-a' })).status, 409);
    assert.strictEqual((await call('/api/books/book-class/check-out', teacherA,
      { classId: 'class-a' })).status, 400);
    const stats = await call('/api/classes/class-a/stats', teacherA);
    assert.strictEqual(stats.status, 200);
    assert.strictEqual(stats.body.activeLoans, 2);
    assert.strictEqual(stats.body.classLoanCount, 1);
    assert.strictEqual(stats.body.totalBorrowedBooks, 2,
      'Class totals must include BOTH the student and the class checkout');
    assert.strictEqual(stats.body.borrowedThisSchoolYear, 2);
    assert.strictEqual(stats.body.borrowedLastMonth, 2);
    assert.ok(stats.body.topReaders.every((entry) => entry.id !== 'class-a'),
      'Class checkouts must never become a fictitious student reader');
    assert.strictEqual((await call('/api/classes/class-a', admin, undefined, 'DELETE')).status, 409,
      'Active class-owned copies must prevent class deletion');
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).classes.length, 2);

    // Barcodes and group IDs may resolve several physical copies of the same
    // edition. Returning a class checkout must pick the copy belonging to
    // THAT CLASS, not an unrelated student's earlier loan.
    const withSharedBarcode = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    withSharedBarcode.books.find((copy) => copy.id === 'book-class').barcode = '55220011';
    fs.writeFileSync(dbPath, JSON.stringify(withSharedBarcode));
    const classBarcodeReturn = await call('/api/books/55220011/check-in', teacherA,
      { classId: 'class-a' });
    assert.strictEqual(classBarcodeReturn.status, 200,
      'A grouped return must find the class-owned copy');
    assert.strictEqual(classBarcodeReturn.body.book.id, 'book-class');
    const studentBarcodeStillOut = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((copy) => copy.id === 'book-student');
    assert.strictEqual(studentBarcodeStillOut.borrowedBy, 'stu-a');
    assert.strictEqual((await call('/api/books/book-class/check-out', teacherA,
      { classId: 'class-a' })).status, 200);
    // A class cannot claim the student's copy by matching only its barcode.
    assert.strictEqual((await call('/api/books/55220011/check-in', teacherB,
      { classId: 'class-b' })).status, 404);

    // Revocation must take effect without a fresh login. A cached teacher
    // user.classIds entry is NOT proof of current membership or authority.
    const beforeRevocation = await call('/api/history?limit=20', teacherA);
    assert.strictEqual(beforeRevocation.status, 200);
    assert.ok(beforeRevocation.body.some((event) => event.classId === 'class-a'));
    const revokedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    revokedDb.classes.find((klass) => klass.id === 'class-a').teacherIds = [];
    fs.writeFileSync(dbPath, JSON.stringify(revokedDb));
    const revokedOverview = await call('/api/staff/loans', teacherA);
    assert.deepStrictEqual(revokedOverview.body.classes, []);
    assert.deepStrictEqual(revokedOverview.body.students, []);
    assert.deepStrictEqual(revokedOverview.body.loans, []);
    assert.deepStrictEqual((await call('/api/history?limit=20', teacherA)).body, []);
    assert.strictEqual((await call('/api/students/stu-a/loans', teacherA)).status, 403);
    assert.strictEqual((await call('/api/books/book-class/check-in', teacherA,
      { classId: 'class-a' })).status, 403);
    const reinstatedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    reinstatedDb.classes.find((klass) => klass.id === 'class-a').teacherIds = ['teacher-a'];
    fs.writeFileSync(dbPath, JSON.stringify(reinstatedDb));

    const returnedClass = await call('/api/books/book-class/check-in', teacherA,
      { classId: 'class-a' });
    assert.strictEqual(returnedClass.status, 200);
    assert.strictEqual((await call('/api/books/book-class/check-in', teacherA,
      { classId: 'class-a' })).status, 400);
    const returnedStudent = await call('/api/books/book-student/check-in', teacherA,
      { studentId: 'stu-a' });
    assert.strictEqual(returnedStudent.status, 200);
    const after = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.deepStrictEqual(after.students[0].borrowedBooks, []);
    assert.ok(after.books.every((copy) => copy.status === 'available'));
    assert.strictEqual(after.books.find((item) => item.id === 'book-class').fixedLocation, 'SK BB');
    assert.ok(after.history.some((event) => event.type === 'check_in_class'));
    assert.strictEqual((await call('/api/staff/loans', admin)).status, 200);
    const deletedClass = await call('/api/classes/class-a', admin, undefined, 'DELETE');
    assert.strictEqual(deletedClass.status, 200,
      'The admin can delete a class AFTER its active loans have been returned');
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).classes.length, 1);
    console.log('PR5 staff loans: role-scoped student and class actions and privacy passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
