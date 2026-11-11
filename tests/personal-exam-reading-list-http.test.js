'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = 4079;
const BASE = 'http://127.0.0.1:' + PORT;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function call(route, token, payload, method) {
  const response = await fetch(BASE + route, {
    method: method || (payload === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: BASE, 'Sec-Fetch-Site': 'same-origin',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-exam-'));
  const dbPath = path.join(tmp, 'db.json');
  fs.writeFileSync(dbPath, JSON.stringify({
    books: [
      { id: 'copy-a', title: 'Titel A', author: 'A Auteur',
        metadataIsbn: '9780306406157', suitableForExamList: true, status: 'available' },
      { id: 'copy-b', title: 'Titel A', author: 'A Auteur',
        metadataIsbn: '9780306406157', suitableForExamList: true, status: 'available' },
      { id: 'copy-c', title: 'Titel C', author: 'B Auteur',
        metadataIsbn: '9780140328721', suitableForExamList: true, status: 'available' },
      { id: 'copy-d', title: 'Titel A', author: 'A Auteur',
        metadataIsbn: '9780140328721', suitableForExamList: true, status: 'available' },
    ],
    students: [
      { id: 'stu-a', name: 'Student A', username: 'stu-a', passwordHash: hash('pass'),
        classIds: ['class-a'], borrowedBooks: [] },
      { id: 'stu-b', name: 'Student B', username: 'stu-b', passwordHash: hash('pass'),
        classIds: ['class-b'], borrowedBooks: [] },
    ],
    classes: [
      { id: 'class-a', name: 'Bovenbouw structuur', teacherIds: ['teacher-a'], studentIds: ['stu-a'] },
      { id: 'class-b', name: 'Onderbouw BKT', teacherIds: ['teacher-b'], studentIds: ['stu-b'] },
    ],
    users: [
      { id: 'teacher-a', name: 'Teacher A', role: 'teacher', username: 'teacher-a',
        passwordHash: hash('pass') },
      { id: 'teacher-b', name: 'Teacher B', role: 'teacher', username: 'teacher-b',
        passwordHash: hash('pass') },
    ],
    history: [], folders: [], importJobs: [],
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.resolve(__dirname, '..', 'public') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Exam list server timeout')), 8000);
      child.stdout.on('data', text => {
        if (!text.toString().includes('http://localhost:' + PORT)) return;
        clearTimeout(timer); resolve();
      });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited: ' + code)); });
    });
    const login = async name => {
      const result = await call('/api/login', null, { username: name, password: 'pass' });
      assert.equal(result.status, 200, name + JSON.stringify(result.body));
      return result.body.token;
    };
    const student = await login('stu-a');
    const other = await login('stu-b');
    const teacher = await login('teacher-a');
    const wrongTeacher = await login('teacher-b');
    assert.equal((await call('/api/exam-reading-list', null)).status, 401);
    assert.equal((await call('/api/exam-reading-list?studentId=stu-b', student)).status, 403);
    assert.equal((await call('/api/exam-reading-list?studentId=stu-a', other)).status, 403);
    assert.equal((await call('/api/exam-reading-list?studentId=stu-a', wrongTeacher)).status, 403);
    assert.equal((await call('/api/exam-reading-list?studentId=stu-a', teacher)).status, 200);
    const staffDirectory = await call('/api/staff/loans', teacher);
    assert.equal(staffDirectory.status, 200);
    assert.equal((await call('/api/me', student)).body.examReadingEligible, true);
    assert.equal((await call('/api/me', other)).body.examReadingEligible, false);
    assert.equal((await call('/api/exam-reading-list', other, { bookId: 'copy-a' })).status, 403);
    const firstEdition = staffDirectory.body.books.find(book => book.id === 'copy-a');
    const anotherEdition = staffDirectory.body.books.find(book => book.id === 'copy-d');
    assert.equal(firstEdition.metadataIsbn, '9780306406157');
    assert.equal(anotherEdition.metadataIsbn, '9780140328721');
    assert.notEqual(firstEdition.editionKey, anotherEdition.editionKey,
      'Staff selector must distinguish different editions of the same title');

    assert.equal((await call('/api/exam-reading-list', student)).body.entries.length, 0);
    assert.equal((await call('/api/exam-reading-list', student,
      { bookId: 'copy-a', studentId: 'stu-b' })).status, 403);
    assert.equal((await call('/api/exam-reading-list', wrongTeacher,
      { studentId: 'stu-a', bookId: 'copy-a' })).status, 403);
    assert.equal((await call('/api/exam-reading-list', student,
      { bookId: 'fake-copy' })).status, 404);
    const first = await call('/api/exam-reading-list', student, { bookId: 'copy-a' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const duplicate = await call('/api/exam-reading-list', student, { bookId: 'copy-b' });
    assert.equal(duplicate.status, 200);
    assert.equal((await call('/api/exam-reading-list', student)).body.entries.length, 1);
    const item = first.body.entry;
    const status = await call('/api/exam-reading-list/' + item.id, teacher,
      { revision: item.revision, status: 'aan_het_lezen' }, 'PATCH');
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal((await call('/api/exam-reading-list/' + item.id, student,
      { revision: item.revision, status: 'gelezen' }, 'PATCH')).status, 409);
    assert.equal((await call('/api/exam-reading-list/' + item.id, wrongTeacher,
      { revision: status.body.entry.revision }, 'DELETE')).status, 403);

    const loan = await call('/api/books/copy-c/check-out', teacher, { studentId: 'stu-a' });
    assert.equal(loan.status, 200, JSON.stringify(loan.body));
    const whileBorrowed = await call('/api/exam-reading-list', student);
    assert.equal(whileBorrowed.body.entries.find(e => e.bookId === 'copy-c').status,
      'aan_het_lezen', 'Exam books should appear immediately upon checkout');
    const returned = await call('/api/books/copy-c/check-in', student, { finished: true });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    const automatic = (await call('/api/exam-reading-list', student)).body;
    assert.equal(automatic.entries.length, 2, 'Return adds exam edition once');
    assert.equal(automatic.statistics.readBooks, 1);
    const autoEntry = automatic.entries.find(entry => entry.bookId === 'copy-c');
    assert.equal(autoEntry.readFromReturn, true);
    assert.equal(autoEntry.status, 'gelezen');
    assert.equal(autoEntry.addedManually, false);

    const correction = await call('/api/reading-records/' + returned.body.readingRecord.id,
      student, { revision: returned.body.readingRecord.revision, finished: false }, 'PATCH');
    assert.equal(correction.status, 200, JSON.stringify(correction.body));
    const corrected = (await call('/api/exam-reading-list', student)).body;
    assert.equal(corrected.statistics.readBooks, 0);
    assert.equal(corrected.entries.find(entry => entry.id === autoEntry.id).readFromReturn, false);
    assert.equal(corrected.entries.find(entry => entry.id === autoEntry.id).status, 'nog_lezen');
    const noStock = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(noStock.books.find(entry => entry.id === 'copy-c').status, 'available');
    assert.equal(noStock.readingRecords[0].changes.length, 1);
    const deleted = await call('/api/exam-reading-list/' + autoEntry.id,
      student, { revision: autoEntry.revision }, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal((await call('/api/exam-reading-list', student)).body.entries.length, 1);
    assert.equal((await call('/api/exam-reading-list?studentId=stu-b', other)).status, 403,
      'Lower-school students cannot open the personal exam list');
    const personal = await call('/api/exam-reading-list', student, {
      externalBook:{title:'Eigen boek',author:'Onbekende auteur',pageCount:147,genre:'Fantasy'},
    });
    assert.equal(personal.status,201,JSON.stringify(personal.body));
    assert.equal(personal.body.entry.externalSource,true);
    assert.equal(personal.body.entry.pageCount,147);
    const existing = await call('/api/exam-reading-list',student,{
      externalBook:{title:'Eigen boek',author:'Onbekende auteur'},
    });
    assert.equal(existing.status,200);
    assert.equal(existing.body.created,false);
    assert.equal((await call('/api/exam-reading-list',other,{
      externalBook:{title:'Verboden boek',author:'Test'},
    })).status,403);
    assert.equal((await call('/api/exam-reading-list',student,{
      externalBook:{title:'',author:'Test'},
    })).status,400);
    const mine = await call('/api/me/reading-profile',student);
    assert.equal(mine.status,200,JSON.stringify(mine.body));
    assert.equal(mine.body.statistics.readTitles,0,'Corrected unread return is not counted as read');
    assert.ok(mine.body.history.some(row=>row.recordId===returned.body.readingRecord.id));
    assert.equal((await call('/api/me/reading-profile',other)).status,200,
      'Underbouw keeps access to its own general reading history');
    assert.equal((await call('/api/me/reading-profile',null)).status,401);
    const persisted = JSON.parse(fs.readFileSync(dbPath,'utf8'));
    assert.equal(persisted.books.length,4,'Own books are never added to school inventory');
    assert.ok(persisted.examReadingLists.some(row=>row.externalSource&&row.studentId==='stu-a'));
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
run().then(() => console.log('Personal exam list HTTP and correction: OK'),
  error => { console.error(error); process.exitCode = 1; });
