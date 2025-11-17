const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4010;
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
  const body = await response.json();
  return { status: response.status, body };
}

function createDbFixture(filePath) {
  const db = {
    books: [],
    students: [
      {
        id: 's1',
        name: 'Student One',
        classIds: ['c1'],
        borrowedBooks: [],
        username: 's1',
        passwordHash: 'unused',
      },
      {
        id: 's2',
        name: 'Student Two',
        classIds: ['c2'],
        borrowedBooks: [],
        username: 's2',
        passwordHash: 'unused',
      },
      {
        id: 's3',
        name: 'Student Three',
        classIds: ['c3'],
        borrowedBooks: [],
        username: 's3',
        passwordHash: 'unused',
      },
    ],
    classes: [
      { id: 'c1', name: 'Klas 1', studentIds: ['s1'], teacherIds: ['t1'] },
      { id: 'c2', name: 'Klas 2', studentIds: ['s2'], teacherIds: [] },
    ],
    folders: [],
    users: [
      {
        id: 't1',
        name: 'Teacher With Class',
        username: 'teacher',
        passwordHash: 'acc81ae74727a21d046c2740efacac2ebbdc2e1de41c25da08758e246646d496',
        role: 'teacher',
        classIds: ['c1'],
      },
      {
        id: 't2',
        name: 'Teacher No Class',
        username: 'noclass',
        passwordHash: 'd56d4153049e321b8187525b88ae0c8ac351982a7db5c1ba9dff8c88188d5e34',
        role: 'teacher',
        classIds: [],
      },
      {
        id: 'admin',
        name: 'Admin',
        username: 'admin',
        passwordHash: '248492fae3bea4d587616021c3d873b1f758ced42136df9f9d9a8272d542a63f',
        role: 'admin',
      },
    ],
    history: [
      {
        id: 'h3',
        type: 'check_out',
        studentId: 's1',
        message: 's1 pakt boek',
        timestamp: '2024-04-10T10:00:00.000Z',
      },
      {
        id: 'h2',
        type: 'check_out',
        studentId: 's2',
        message: 's2 pakt boek',
        timestamp: '2024-04-09T09:00:00.000Z',
      },
      {
        id: 'h1',
        type: 'check_in',
        studentId: 's1',
        message: 's1 levert boek in',
        timestamp: '2024-04-08T08:00:00.000Z',
      },
    ],
  };

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-test-'));
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

    const { body: teacherLogin } = await request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'teacher-pass' }),
    });

    const teacherToken = teacherLogin.token;
    assert.ok(teacherToken, 'Teacher token should be returned');

    const teacherHistory = await request('/api/history?limit=5', {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    assert.strictEqual(teacherHistory.status, 200);
    assert.strictEqual(teacherHistory.body.length, 2);
    assert.deepStrictEqual(
      teacherHistory.body.map((entry) => entry.id),
      ['h3', 'h1'],
      'Teacher should see only history for their classes in descending order'
    );

    const limitedHistory = await request('/api/history?limit=1', {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    assert.strictEqual(limitedHistory.body.length, 1);
    assert.strictEqual(limitedHistory.body[0].id, 'h3');

    const { body: noClassLogin } = await request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'noclass', password: 'noclass-pass' }),
    });

    const noClassToken = noClassLogin.token;
    assert.ok(noClassToken, 'Token for teacher without class should be returned');

    const noClassHistory = await request('/api/history', {
      headers: { Authorization: `Bearer ${noClassToken}` },
    });

    assert.strictEqual(noClassHistory.status, 200);
    assert.deepStrictEqual(noClassHistory.body, []);

    console.log('All history tests passed');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
