const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4011;
const BASE_URL = `http://localhost:${PORT}`;

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
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function login(username, password) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.strictEqual(response.status, 200, body.message || 'Login mislukt');
  assert.ok(body.token, 'Ontbrekende token na login');
  return body.token;
}

function createDbFixture(filePath) {
  const db = {
    books: [
      {
        id: 'copy-a1',
        title: 'De avonturen',
        author: 'Auteur A',
        barcode: '12345',
        metadataIsbn: '9780000000001',
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        tags: [],
      },
      {
        id: 'copy-a2',
        title: 'De avonturen',
        author: 'Auteur A',
        barcode: '12345',
        metadataIsbn: '9780000000001',
        status: 'borrowed',
        borrowedBy: 's1',
        dueDate: null,
        tags: [],
      },
      {
        id: 'copy-b1',
        title: 'Het mysterie',
        author: 'Auteur B',
        barcode: '12345',
        metadataIsbn: '9780000000002',
        status: 'borrowed',
        borrowedBy: 's2',
        dueDate: null,
        tags: [],
      },
      {
        id: 'copy-b2',
        title: 'Het mysterie',
        author: 'Auteur B',
        barcode: '12345',
        metadataIsbn: '9780000000002',
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        tags: [],
      },
    ],
    students: [
      {
        id: 's1',
        name: 'Student One',
        username: 'student1',
        passwordHash: 'unused',
        borrowedBooks: [{ bookId: 'copy-a2', borrowedAt: '2024-01-01T00:00:00.000Z' }],
        classIds: [],
      },
      {
        id: 's2',
        name: 'Student Two',
        username: 'student2',
        passwordHash: 'unused',
        borrowedBooks: [{ bookId: 'copy-b1', borrowedAt: '2024-02-01T00:00:00.000Z' }],
        classIds: [],
      },
    ],
    folders: [],
    classes: [],
    users: [
      {
        id: 't1',
        name: 'Docent',
        username: 'teacher',
        passwordHash: 'acc81ae74727a21d046c2740efacac2ebbdc2e1de41c25da08758e246646d496',
        role: 'teacher',
        classIds: [],
      },
    ],
    history: [],
  };
  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-barcode-test-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT,
      BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(serverProcess);
    const teacherToken = await login('teacher', 'teacher-pass');

    const barcodeLookup = await request('/api/books/barcode/12345');
    assert.strictEqual(barcodeLookup.status, 200);
    assert.ok(Array.isArray(barcodeLookup.body.groups));
    assert.strictEqual(barcodeLookup.body.groups.length, 2);
    const adventuresGroup = barcodeLookup.body.groups.find((group) => group.title === 'De avonturen');
    const mysteryGroup = barcodeLookup.body.groups.find((group) => group.title === 'Het mysterie');
    assert.ok(adventuresGroup, 'Groep De avonturen ontbreekt');
    assert.strictEqual(adventuresGroup.totalCopies, 2);
    assert.strictEqual(adventuresGroup.availableCopies, 1);
    assert.ok(mysteryGroup, 'Groep Het mysterie ontbreekt');
    assert.strictEqual(mysteryGroup.borrowed, 1);

    const duplicateCheckout = await request(`/api/books/${adventuresGroup.id}/check-out`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 's1' }),
    });
    assert.strictEqual(duplicateCheckout.status, 400);
    assert.match(duplicateCheckout.body.message || '', /al een exemplaar/i);

    const successfulCheckout = await request(`/api/books/${adventuresGroup.id}/check-out`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 's2' }),
    });
    assert.strictEqual(successfulCheckout.status, 200);
    assert.strictEqual(successfulCheckout.body.book.id, 'copy-a1');
    assert.strictEqual(successfulCheckout.body.book.borrowedBy, 's2');

    const checkinByBarcode = await request(`/api/books/12345/check-in`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 's2', title: 'Het mysterie' }),
    });
    assert.strictEqual(checkinByBarcode.status, 200);
    assert.strictEqual(checkinByBarcode.body.book.id, 'copy-b1');
    assert.strictEqual(checkinByBarcode.body.book.status, 'available');

    const checkoutByBarcode = await request(`/api/books/12345/check-out`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 's2', title: 'Het mysterie' }),
    });
    assert.strictEqual(checkoutByBarcode.status, 200);
    assert.strictEqual(checkoutByBarcode.body.book.title, 'Het mysterie');
    assert.strictEqual(checkoutByBarcode.body.book.borrowedBy, 's2');

    console.log('Barcode grouping tests passed');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
