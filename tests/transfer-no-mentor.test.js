'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-no-mentor-transfer-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31461;
const baseUrl = `http://127.0.0.1:${port}`;
const teacherToken = 'teacher-no-mentor-token';
const adminToken = 'admin-no-mentor-token';

const teacher = {
  id: 'teacher-a',
  name: 'Mentor A',
  username: 'mentor-a',
  passwordHash: 'teacher-x',
  role: 'teacher',
  classIds: ['class-a'],
  active: true,
};
const admin = {
  id: 'admin-1',
  name: 'Boekenbaai Beheer',
  username: 'admin',
  passwordHash: 'admin-x',
  role: 'admin',
  active: true,
};
const student = {
  id: 'student-a',
  name: 'Sanne Jansen',
  firstName: 'Sanne',
  lastName: 'Jansen',
  username: 'sanne',
  passwordHash: 'student-x',
  classIds: ['class-a'],
  borrowedBooks: [],
  active: true,
};
const db = {
  books: [],
  students: [student],
  users: [admin, teacher],
  classes: [
    { id: 'class-a', name: 'Klas A', studentIds: [student.id], teacherIds: [teacher.id] },
    { id: 'class-c', name: 'Klas Zonder Mentor', studentIds: [], teacherIds: [] },
  ],
  folders: [],
  history: [],
  studentTransferRequests: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

let store = core.emptyAuthStore();
for (const [token, user] of [[teacherToken, teacher], [adminToken, admin]]) {
  store = core.upsertSession(store, token, {
    userId: user.id,
    type: 'staff',
    remember: false,
    now: Date.now(),
  }).store;
  const session = store.sessions.find((entry) => entry.tokenHash === core.tokenHash(token));
  session.accountFingerprint = accountCredentialFingerprint(user);
  session.authMethod = user.role === 'admin' ? 'password' : 'google';
}
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const startParts = String(packageJson.scripts.start || '').trim().split(/\s+/).filter(Boolean);
assert.strictEqual(startParts.shift(), 'node');
const child = spawn(process.execPath, startParts, {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    BOEKENBAAI_GOOGLE_CLIENT_ID: 'test-client',
    BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-secret',
    BOEKENBAAI_AUTH_SECRET: 'test-auth-secret',
    BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
    BOEKENBAAI_PUBLIC_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte vroeg: ${stderr.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server start timeout: ${stderr.join('')}`);
}

function headers(token, extra = {}) {
  return {
    Cookie: `boekenbaai_session=${encodeURIComponent(token)}`,
    Origin: baseUrl,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  try {
    await waitForServer();

    const transferResponse = await fetch(`${baseUrl}/api/mentor/students/${student.id}/transfer`, {
      method: 'POST',
      headers: headers(teacherToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fromClassId: 'class-a', toClassId: 'class-c' }),
    });
    assert.strictEqual(transferResponse.status, 201);
    const transfer = (await transferResponse.json()).transfer;
    assert.strictEqual(transfer.status, 'pending');
    assert.strictEqual(transfer.escalatedToAdmin, true);
    assert.strictEqual(transfer.escalationReason, 'no-target-mentor');

    const afterRequest = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterRequest.classes.find((entry) => entry.id === 'class-a').studentIds.includes(student.id), true);
    assert.strictEqual(afterRequest.classes.find((entry) => entry.id === 'class-c').studentIds.includes(student.id), false);

    const adminStateResponse = await fetch(`${baseUrl}/api/mentor/student-management`, {
      headers: headers(adminToken),
    });
    assert.strictEqual(adminStateResponse.status, 200);
    const adminState = await adminStateResponse.json();
    assert.strictEqual(adminState.escalated.some((entry) => entry.id === transfer.id), true);

    const acceptResponse = await fetch(`${baseUrl}/api/admin/student-transfers/${transfer.id}/accept`, {
      method: 'POST',
      headers: headers(adminToken),
    });
    assert.strictEqual(acceptResponse.status, 200);

    const afterAccept = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterAccept.classes.find((entry) => entry.id === 'class-a').studentIds.includes(student.id), false);
    assert.strictEqual(afterAccept.classes.find((entry) => entry.id === 'class-c').studentIds.includes(student.id), true);

    console.log('Verplaatsing naar klas zonder mentor escaleert correct naar beheer.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  if (stderr.length) console.error(stderr.join(''));
  process.exitCode = 1;
});
