'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-google-first-admin-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31428;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'google-first-admin-session';

const db = {
  books: [],
  students: [],
  folders: [],
  classes: [],
  users: [
    {
      id: 'admin-1',
      name: 'Boekenbaai Beheer',
      username: 'admin',
      passwordHash: 'x',
      role: 'admin',
      mustChangePassword: false,
    },
  ],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
let store = core.upsertSession(core.emptyAuthStore(), adminToken, {
  userId: 'admin-1',
  type: 'staff',
  remember: false,
  now: Date.now(),
}).store;
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

function makeWorkbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Import');
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

const child = spawn(process.execPath, [
  '--require', path.join(root, 'student-management-preload.js'),
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'local-password-auth-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'student-google-handoff-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
  '--require', path.join(root, 'google-first-admin-preload.js'),
  path.join(root, 'server.js'),
], {
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte: ${stderr.join('')}`);
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
  await new Promise((resolve) => child.once('exit', resolve));
}

function adminHeaders(extra = {}) {
  return {
    Cookie: `boekenbaai_session=${encodeURIComponent(adminToken)}`,
    ...extra,
  };
}

(async () => {
  try {
    await waitForServer();

    const staffPage = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(staffPage.status, 200);
    const html = await staffPage.text();
    assert.match(html, /admin-modern\.css/);
    assert.match(html, /admin-modern\.js/);
    assert.match(html, /admin-google-links\.js/);
    assert.match(html, /student-management\.css/);
    assert.match(html, /student-management\.js/);
    assert.match(html, /google-auth\.js/);

    const denied = await fetch(`${baseUrl}/api/admin/google-first/summary`);
    assert.strictEqual(denied.status, 403);

    const summary = await fetch(`${baseUrl}/api/admin/google-first/summary`, {
      headers: adminHeaders(),
    });
    assert.strictEqual(summary.status, 200);
    const summaryPayload = await summary.json();
    assert.strictEqual(summaryPayload.students, 0);
    assert.strictEqual(summaryPayload.teachers, 0);

    const file = makeWorkbookBase64([
      {
        Leerlingnummer: '50001',
        'Huidige groep': 'SK BB',
        Roepnaam: 'Sanne',
        Voorvoegsel: '',
        Achternaam: 'Jansen',
        'Huidige status': 'Volgt onderwijs',
      },
    ]);

    const preview = await fetch(`${baseUrl}/api/admin/google-first/import`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kind: 'student', file, preview: true }),
    });
    assert.strictEqual(preview.status, 200);
    const previewPayload = await preview.json();
    assert.strictEqual(previewPayload.preview, true);
    assert.strictEqual(previewPayload.summary.created, 1);
    assert.strictEqual(previewPayload.summary.parnassysRows, 1);
    assert.strictEqual(previewPayload.summary.linked, 0, 'Leerlingmail is niet nodig voor de ParnasSys-import');
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).students.length, 0);

    const imported = await fetch(`${baseUrl}/api/admin/google-first/import`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kind: 'student', file, preview: false }),
    });
    assert.strictEqual(imported.status, 200);
    const importPayload = await imported.json();
    assert.strictEqual(importPayload.summary.created, 1);
    assert.strictEqual(importPayload.summary.linked, 0);

    const persistedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(persistedDb.students.length, 1);
    assert.strictEqual(persistedDb.students[0].parnassysStudentNumber, '50001');
    assert.strictEqual(persistedDb.students[0].name, 'Sanne Jansen');
    assert.strictEqual(persistedDb.classes.length, 1);
    assert.strictEqual(persistedDb.classes[0].name, 'SK BB');
    assert.strictEqual(persistedDb.classes[0].studentIds.includes(persistedDb.students[0].id), true);

    const persistedStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(persistedStore.links.length, 0, 'Google-koppeling gebeurt pas bij de eerste login van de leerling');

    console.log('Google-first admin preload integration test geslaagd.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
