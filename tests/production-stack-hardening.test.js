'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-production-stack-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31459;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'production-stack-admin-token';
const studentToken = 'production-stack-student-token';

const admin = {
  id: 'admin-stack',
  name: 'Boekenbaai Beheer',
  username: 'admin',
  passwordHash: 'test-password-hash',
  role: 'admin',
  mustChangePassword: false,
};
const sessionStudent = {
  id: 'student-session',
  name: 'Session Student',
  firstName: 'Session',
  lastName: 'Student',
  username: 'session-student',
  passwordHash: 'student-test-hash',
  mustChangePassword: false,
  borrowedBooks: [],
  classIds: ['class-a'],
  active: true,
};
const db = {
  books: [],
  students: [sessionStudent],
  folders: [],
  classes: [{ id: 'class-a', name: 'Klas A', teacherIds: [], studentIds: [sessionStudent.id] }],
  users: [admin],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
let store = core.upsertSession(core.emptyAuthStore(), adminToken, {
  userId: admin.id,
  type: 'staff',
  remember: false,
  now: Date.now(),
}).store;
store.sessions[0].authMethod = 'password';
store.sessions[0].accountFingerprint = accountCredentialFingerprint(admin);
store = core.upsertLink(store, {
  accountType: 'student',
  accountId: sessionStudent.id,
  email: 'old.student@koraaledu.nl',
  sub: 'student-google-sub',
  linkedBy: admin.id,
}).store;
store = core.upsertSession(store, studentToken, {
  userId: sessionStudent.id,
  type: 'student',
  remember: true,
  now: Date.now(),
}).store;
const studentSession = store.sessions.find((entry) => entry.userId === sessionStudent.id);
studentSession.authMethod = 'google';
studentSession.accountFingerprint = accountCredentialFingerprint(sessionStudent);
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

function workbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Import');
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const startParts = String(packageJson.scripts?.start || '').trim().split(/\s+/).filter(Boolean);
assert.strictEqual(startParts.shift(), 'node', 'Production smoke test moet exact het package start-script gebruiken');
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
    if (child.exitCode !== null) throw new Error(`Production stack stopte vroeg: ${stderr.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Production stack timeout: ${stderr.join('')}`);
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

    const staffPage = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(staffPage.status, 200);
    const html = await staffPage.text();
    const hardeningIndex = html.indexOf('/release-ui-hardening.js');
    const adminModernIndex = html.indexOf('/admin-modern.js');
    assert.ok(hardeningIndex >= 0, 'UI-hardening asset ontbreekt in echte productiestack');
    assert.ok(adminModernIndex >= 0, 'Admin-modern asset ontbreekt in echte productiestack');
    assert.ok(hardeningIndex < adminModernIndex, 'UI-hardening moet vóór admin-modern uitgevoerd worden');

    const hardeningAsset = await fetch(`${baseUrl}/release-ui-hardening.js`);
    assert.strictEqual(hardeningAsset.status, 200);
    assert.match(await hardeningAsset.text(), /googleFirstPasswordShim/);

    const blocked = await fetch(`${baseUrl}/api/mentor/students`, {
      method: 'POST',
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(adminToken)}`,
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Mag Niet', classId: 'class-a' }),
    });
    assert.strictEqual(blocked.status, 403, 'Mentorbeheer moet achter de same-origin security wrapper zitten');

    const allowed = await fetch(`${baseUrl}/api/mentor/students`, {
      method: 'POST',
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(adminToken)}`,
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Nieuwe Leerling', classId: 'class-a' }),
    });
    assert.ok([200, 201].includes(allowed.status), `Geldige mentoractie faalde (${allowed.status})`);

    const warmBearer = await fetch(`${baseUrl}/api/auth/session/status`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(warmBearer.status, 200);
    assert.strictEqual((await warmBearer.json()).authenticated, true);

    const importResponse = await fetch(`${baseUrl}/api/admin/google-first/import`, {
      method: 'POST',
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(adminToken)}`,
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'student',
        preview: false,
        file: workbookBase64([{
          Naam: 'Session Student',
          Gebruikersnaam: 'session-student',
          Schoolmail: 'new.student@koraaledu.nl',
          Klas: 'Klas A',
        }]),
      }),
    });
    assert.strictEqual(importResponse.status, 200);

    const staleBearer = await fetch(`${baseUrl}/api/auth/session/status`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(staleBearer.status, 401, 'Een in RAM gecachete bearer moet na accountwijziging direct ongeldig zijn');

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(persisted.students.some((entry) => entry.name === 'Nieuwe Leerling'), true);

    console.log('Echte production-stack hardening test geslaagd.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  if (stderr.length) console.error(stderr.join(''));
  process.exitCode = 1;
});
