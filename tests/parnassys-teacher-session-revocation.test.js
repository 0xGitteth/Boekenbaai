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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-parnassys-session-revoke-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31462;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'parnassys-admin-token';
const teacherToken = 'parnassys-teacher-token';

const admin = {
  id: 'admin-1',
  name: 'Boekenbaai Beheer',
  username: 'admin',
  passwordHash: 'admin-password-hash',
  role: 'admin',
  active: true,
  mustChangePassword: false,
};
const teacher = {
  id: 'teacher-1',
  name: 'Docent Een',
  username: 'docent.een',
  passwordHash: 'teacher-internal-hash',
  role: 'teacher',
  classIds: ['class-a'],
  active: true,
  source: 'parnassys',
  mustChangePassword: false,
};
const db = {
  books: [],
  students: [],
  users: [admin, teacher],
  classes: [
    { id: 'class-a', name: 'Klas A', teacherIds: [teacher.id], studentIds: [] },
  ],
  folders: [],
  history: [],
  studentTransferRequests: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

let store = core.emptyAuthStore();
for (const [token, account, authMethod] of [
  [adminToken, admin, 'password'],
  [teacherToken, teacher, 'google'],
]) {
  store = core.upsertSession(store, token, {
    userId: account.id,
    type: 'staff',
    remember: true,
    now: Date.now(),
  }).store;
  const session = store.sessions.find((entry) => entry.tokenHash === core.tokenHash(token));
  session.accountFingerprint = accountCredentialFingerprint(account);
  session.authMethod = authMethod;
}
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

function workbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Medewerkers');
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

const teacherExport = workbookBase64([
  {
    Roepnaam: 'Docent',
    Achternaam: 'Een',
    Rollen: 'Leerkracht',
    'Gekoppelde groepen': '',
  },
]);

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

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function cookieHeaders(token) {
  return { Cookie: `boekenbaai_session=${encodeURIComponent(token)}` };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

(async () => {
  try {
    await waitForServer();

    // Vul de runtimecache bewust voordat de rechten veranderen.
    const cookieBefore = await fetch(`${baseUrl}/api/me`, { headers: cookieHeaders(teacherToken) });
    assert.strictEqual(cookieBefore.status, 200);
    const bearerBefore = await fetch(`${baseUrl}/api/me`, { headers: bearerHeaders(teacherToken) });
    assert.strictEqual(bearerBefore.status, 200);

    const apply = await fetch(`${baseUrl}/api/admin/school-sync/apply`, {
      method: 'POST',
      headers: {
        ...cookieHeaders(adminToken),
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'teacher',
        file: teacherExport,
        fullSchoolSync: true,
        manualMatches: {},
      }),
    });
    assert.strictEqual(apply.status, 200, await apply.text());

    const persistedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const persistedTeacher = persistedDb.users.find((entry) => entry.id === teacher.id);
    assert.strictEqual(persistedTeacher.active, false);
    assert.deepStrictEqual(persistedTeacher.classIds, []);
    assert.deepStrictEqual(
      persistedDb.classes.find((entry) => entry.id === 'class-a').teacherIds,
      []
    );

    const persistedStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(
      persistedStore.sessions.some((entry) => entry.tokenHash === core.tokenHash(teacherToken)),
      false,
      'De docentsessie moet uit de persistente auth-store verdwijnen'
    );
    assert.strictEqual(
      persistedStore.sessions.some((entry) => entry.tokenHash === core.tokenHash(adminToken)),
      true,
      'De beheersessie die de sync uitvoert moet blijven bestaan'
    );

    const cookieAfter = await fetch(`${baseUrl}/api/me`, { headers: cookieHeaders(teacherToken) });
    assert.strictEqual(
      cookieAfter.status,
      401,
      'Een reeds gecachte browsercookie mag na verlies van klasrechten niet meer werken'
    );

    const bearerAfter = await fetch(`${baseUrl}/api/me`, { headers: bearerHeaders(teacherToken) });
    assert.strictEqual(
      bearerAfter.status,
      401,
      'Een reeds gecachte bearer mag na verlies van klasrechten niet meer werken'
    );

    console.log('ParnasSys docent-sessie intrekking end-to-end geslaagd.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  if (stderr.length) console.error(stderr.join(''));
  process.exitCode = 1;
});
