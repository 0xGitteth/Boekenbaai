'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-login-policy-'));
const dbPath = path.join(tmp, 'db.json');
const port = 31431;
const baseUrl = `http://127.0.0.1:${port}`;

fs.writeFileSync(dbPath, JSON.stringify({
  students: [{ id: 'student-1', name: 'Leerling Een' }],
  users: [
    { id: 'teacher-1', name: 'Docent Een', role: 'teacher' },
    { id: 'admin-1', name: 'Boekenbaai Beheer', role: 'admin' },
  ],
}, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  path.join(__dirname, 'login-flow-policy-fixture.js'),
], {
  env: {
    ...process.env,
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Login-policy fixture stopte vroeg: ${stderr.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Login-policy fixture start timeout: ${stderr.join('')}`);
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function readJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

(async () => {
  try {
    await waitForServer();

    const student = await readJson('/api/auth/login-mode?type=student&accountId=student-1');
    assert.strictEqual(student.response.status, 200);
    assert.strictEqual(student.payload.authMode, 'google');

    const teacher = await readJson('/api/auth/login-mode?type=staff&accountId=teacher-1');
    assert.strictEqual(teacher.response.status, 200);
    assert.strictEqual(teacher.payload.authMode, 'google');

    const admin = await readJson('/api/auth/login-mode?type=staff&accountId=admin-1');
    assert.strictEqual(admin.response.status, 200);
    assert.strictEqual(admin.payload.authMode, 'password');

    const invalid = await readJson('/api/auth/login-mode?type=staff&accountId=missing');
    assert.strictEqual(invalid.response.status, 404);

    const missingSelection = await fetch(`${baseUrl}/api/auth/google/start?type=staff`, {
      redirect: 'manual',
    });
    assert.strictEqual(missingSelection.status, 302);
    assert.strictEqual(
      new URL(missingSelection.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'select-account'
    );

    const adminGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=admin-1`,
      { redirect: 'manual' }
    );
    assert.strictEqual(adminGoogle.status, 302);
    assert.strictEqual(
      new URL(adminGoogle.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'local-only'
    );

    const delegatedTeacher = await readJson(
      '/api/auth/google/start?type=staff&accountId=teacher-1'
    );
    assert.strictEqual(delegatedTeacher.response.status, 200);
    assert.strictEqual(delegatedTeacher.payload.delegated, true);

    const delegatedStudent = await readJson(
      '/api/auth/google/start?type=student&accountId=student-1'
    );
    assert.strictEqual(delegatedStudent.response.status, 200);
    assert.strictEqual(delegatedStudent.payload.delegated, true);
  } finally {
    await stop();
  }

  console.log('Login-flow policytests geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
