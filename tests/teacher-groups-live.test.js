'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-teacher-groups-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31462;
const baseUrl = `http://127.0.0.1:${port}`;

const db = {
  books: [],
  students: [],
  history: [],
  folders: [],
  classes: [
    { id: 'class-a', name: 'Arbeid', studentIds: [], teacherIds: ['teacher-1', 'teacher-2'] },
    { id: 'class-b', name: 'Bovenbouw structuur', studentIds: [], teacherIds: ['teacher-1'] },
    { id: 'class-c', name: 'OZA', studentIds: [], teacherIds: [] },
  ],
  users: [
    { id: 'admin-1', name: 'Boekenbaai Beheer', username: 'admin', role: 'admin', active: true },
    { id: 'teacher-1', name: 'Anouk', username: 'anouk', role: 'teacher', active: true, classIds: ['class-a', 'class-b'] },
    { id: 'teacher-2', name: 'Luuk', username: 'luuk', role: 'teacher', active: true, classIds: ['class-a'] },
    { id: 'teacher-3', name: 'Sanne', username: 'sanne', role: 'teacher', active: true, classIds: [] },
    { id: 'teacher-old', name: 'Inactief', username: 'inactief', role: 'teacher', active: false, classIds: ['class-a'] },
  ],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

let store = core.emptyAuthStore();
store = core.upsertSession(store, 'admin-token', {
  userId: 'admin-1',
  type: 'staff',
  remember: false,
  now: Date.now(),
}).store;
store = core.upsertSession(store, 'teacher-token', {
  userId: 'teacher-1',
  type: 'staff',
  remember: false,
  now: Date.now(),
}).store;
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'teacher-groups-admin-preload.js'),
  path.join(root, 'server.js'),
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
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

async function request(pathname, token = '') {
  return fetch(`${baseUrl}${pathname}`, {
    headers: token ? { Cookie: `boekenbaai_session=${encodeURIComponent(token)}` } : {},
  });
}

(async () => {
  try {
    await waitForServer();

    const response = await request('/api/admin/teacher-groups', 'admin-token');
    assert.strictEqual(response.status, 200);
    const payload = await response.json();

    assert.deepStrictEqual(payload.classes.map((entry) => entry.name), [
      'Arbeid',
      'Bovenbouw structuur',
      'OZA',
    ]);

    const arbeid = payload.classes.find((entry) => entry.id === 'class-a');
    const bovenbouw = payload.classes.find((entry) => entry.id === 'class-b');
    const oza = payload.classes.find((entry) => entry.id === 'class-c');

    assert.deepStrictEqual(arbeid.teachers.map((entry) => entry.id), ['teacher-1', 'teacher-2']);
    assert.deepStrictEqual(bovenbouw.teachers.map((entry) => entry.id), ['teacher-1']);
    assert.deepStrictEqual(oza.teachers, [], 'Lege klassen moeten zichtbaar blijven');
    assert.deepStrictEqual(payload.unassigned.map((entry) => entry.id), ['teacher-3']);
    assert.ok(!JSON.stringify(payload).includes('teacher-old'), 'Inactieve docenten mogen niet zichtbaar zijn');

    const sameTeacherA = arbeid.teachers.find((entry) => entry.id === 'teacher-1');
    const sameTeacherB = bovenbouw.teachers.find((entry) => entry.id === 'teacher-1');
    assert.strictEqual(sameTeacherA.id, sameTeacherB.id, 'Dezelfde docent moet in meerdere klassen hetzelfde account-ID houden');

    const teacherDenied = await request('/api/admin/teacher-groups', 'teacher-token');
    assert.strictEqual(teacherDenied.status, 403, 'Een gewone docent mag geen schoolbreed docentoverzicht ophalen');

    const script = await request('/teacher-groups.js');
    assert.strictEqual(script.status, 200);
    const scriptText = await script.text();

    assert.match(scriptText, /teacher-groups-live/);
    assert.match(scriptText, /data-teacher-groups-teacher/);
    assert.match(
      scriptText,
      /function handleGroupedTeacherClick[\s\S]*preventDefault\(\)[\s\S]*stopImmediatePropagation\(\)[\s\S]*selectedTeacherId = teacherId/,
      'De nieuwe per-klaslaag moet de docentklik zelf afhandelen in plaats van terugvallen op de oude zoekrenderer'
    );
    assert.match(
      scriptText,
      /hideLegacyTeacherDetail[\s\S]*admin-teacher-detail[\s\S]*legacy\.hidden = true/,
      'De oude halfgevulde docentdetailkaart moet in de nieuwe Beheerflow verborgen zijn'
    );
    assert.match(scriptText, /teacher-groups-live-editor/, 'Er moet één eigen docenteditor zijn');
    assert.match(scriptText, /teacher-groups-profile-name/, 'De docentnaam moet bewerkbaar zijn');
    assert.match(scriptText, /data-teacher-group-class/, 'Klassen moeten in hetzelfde detail bewerkbaar zijn');
    assert.match(
      scriptText,
      /method: 'PATCH'[\s\S]*body: \{ name, classIds \}/,
      'Naam en klassen moeten samen via de bestaande docent-PATCH opgeslagen worden'
    );
    assert.match(scriptText, /Google-schoolaccount/, 'Google-schoolaccount moet onderdeel zijn van hetzelfde detail');
    assert.match(scriptText, /\/api\/auth\/google\/manage/, 'Google-status moet vanuit de bestaande beheerroute worden geladen');
    assert.match(scriptText, /\/api\/auth\/google\/staff-email/, 'Schoolmail moet via de bestaande beveiligde Google-route worden opgeslagen');
    assert.match(scriptText, /Docent verwijderen/, 'De verwijderactie moet onderaan hetzelfde detail staan');
    assert.match(
      scriptText,
      /method: 'DELETE'/,
      'Docent verwijderen moet de bestaande DELETE-route blijven gebruiken'
    );
    assert.match(
      scriptText,
      /scrollEditorIntoView[\s\S]*scrollIntoView/,
      'Op smallere schermen moet de nieuwe editor in beeld worden gebracht'
    );

    const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(
      serverSource,
      /teacherMatch[\s\S]*req\.method === 'PATCH'[\s\S]*typeof body\.name === 'string'/,
      'De bestaande docent-PATCH moet naamwijzigingen blijven ondersteunen'
    );
    assert.match(
      serverSource,
      /teacherMatch[\s\S]*req\.method === 'PATCH'[\s\S]*Array\.isArray\(body\.classIds\)/,
      'De bestaande docent-PATCH moet klaskoppelingen blijven ondersteunen'
    );

    const page = await request('/staff.html');
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script src="\/teacher-groups\.js"><\/script>/);

    console.log('Complete docenteditor en klasgroepering regressietest geslaagd.');
  } finally {
    await stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
