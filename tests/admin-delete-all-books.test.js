const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4012;
const BASE_URL = `http://localhost:${PORT}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createDbFixture(filePath, { withBorrowed = false } = {}) {
  const db = {
    books: [
      {
        id: 'b1',
        title: 'Boek Een',
        author: 'Auteur',
        barcode: '9780000000001',
        status: withBorrowed ? 'borrowed' : 'available',
        description: '',
        tags: ['Fictie'],
        suitableForExamList: false,
        easyReading: false,
      },
      {
        id: 'b2',
        title: 'Boek Twee',
        author: 'Auteur',
        barcode: '9780000000002',
        status: 'available',
        description: '',
        tags: [],
        suitableForExamList: false,
        easyReading: false,
      },
    ],
    students: [
      {
        id: 's1',
        name: 'Student',
        username: 'student',
        passwordHash: hashPassword('student-pass'),
        classIds: [],
        borrowedBooks: withBorrowed ? [{ bookId: 'b1', borrowedAt: '2024-04-10T10:00:00.000Z' }] : [],
      },
    ],
    classes: [],
    folders: [],
    users: [
      {
        id: 'admin',
        name: 'Admin',
        username: 'admin',
        passwordHash: hashPassword('admin-pass'),
        role: 'admin',
      },
    ],
    history: [
      {
        id: 'hist-checkout',
        type: 'check_out',
        bookId: 'b1',
        studentId: 's1',
        timestamp: '2024-04-10T10:00:00.000Z',
        message: 'Boek Een is uitgeleend aan Student',
      },
    ],
  };

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

async function waitForServer(proc) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes(`http://localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

function startServer(dbPath) {
  return spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT,
      BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function loginAdmin() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass' }),
  });
  assert.strictEqual(response.status, 200);
  assert.ok(response.body.token, 'Admin token should be returned');
  return response.body.token;
}

async function getStudentStats(token, studentId) {
  return request(`/api/students/${studentId}/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function getSchoolStats(token) {
  return request('/api/stats/school', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function runDeleteAllSuccessTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-delete-all-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);
  const serverProcess = startServer(dbPath);

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const response = await request('/api/books', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.removedCount, 2);

    const studentStats = await getStudentStats(token, 's1');
    assert.strictEqual(studentStats.status, 200);
    assert.strictEqual(studentStats.body.borrowedTitles[0].title, 'Boek Een');
    assert.deepStrictEqual(studentStats.body.topGenres, [{ name: 'Fictie', count: 1 }]);

    const schoolStats = await getSchoolStats(token);
    assert.strictEqual(schoolStats.status, 200);
    assert.deepStrictEqual(schoolStats.body.topGenres, [{ name: 'Fictie', count: 1 }]);

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.deepStrictEqual(db.books, []);
    assert.deepStrictEqual(db.students[0].borrowedBooks, []);
    assert.strictEqual(db.history.at(0).type, 'books_deleted');
    assert.strictEqual(db.archivedBooks.length, 2);
    assert.strictEqual(db.archivedBooks.find((book) => book.id === 'b1').title, 'Boek Een');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runDeleteAllBorrowedGuardTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-delete-all-borrowed-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, { withBorrowed: true });
  const serverProcess = startServer(dbPath);

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const response = await request('/api/books', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /Lever eerst alle uitgeleende boeken in/i);

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(db.books.length, 2);
    assert.strictEqual(db.students[0].borrowedBooks.length, 1);
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runTests() {
  await runDeleteAllSuccessTest();
  await runDeleteAllBorrowedGuardTest();
  console.log('All admin delete-all-books tests passed');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
