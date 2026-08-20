'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-production-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31423;
const baseUrl = `http://127.0.0.1:${port}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

fs.writeFileSync(dbPath, JSON.stringify({
  books: [],
  students: [{
    id: 'student-smoke',
    name: 'Smoke Leerling',
    username: 'smoke-student',
    passwordHash: hashPassword('unused-student-password'),
    borrowedBooks: [],
    classIds: [],
  }],
  folders: [],
  classes: [],
  users: [
    {
      id: 'admin-smoke',
      name: 'Smoke Beheer',
      username: 'smoke-admin',
      passwordHash: hashPassword('smoke-password'),
      role: 'admin',
      mustChangePassword: false,
    },
    {
      id: 'teacher-smoke',
      name: 'Smoke Docent',
      username: 'smoke-teacher',
      passwordHash: hashPassword('unused-teacher-password'),
      role: 'teacher',
      classIds: [],
    },
  ],
  history: [],
}, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
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
    if (child.exitCode !== null) {
      throw new Error(`Production server stopte tijdens start: ${stderr.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/google/config`);
      if (response.ok) return response;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Production server start timeout: ${stderr.join('')}`);
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function loginMode(type, accountId) {
  const response = await fetch(
    `${baseUrl}/api/auth/login-mode?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`
  );
  assert.strictEqual(response.status, 200);
  return response.json();
}

(async () => {
  try {
    const configResponse = await waitForServer();
    const config = await configResponse.json();
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.domain, 'koraaledu.nl');

    assert.strictEqual((await loginMode('staff', 'admin-smoke')).authMode, 'password');
    assert.strictEqual((await loginMode('staff', 'teacher-smoke')).authMode, 'google');
    assert.strictEqual((await loginMode('student', 'student-smoke')).authMode, 'google');

    const adminGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=admin-smoke`,
      { redirect: 'manual' }
    );
    assert.strictEqual(adminGoogle.status, 302);
    assert.strictEqual(
      new URL(adminGoogle.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'local-only'
    );

    const teacherGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=teacher-smoke`,
      { redirect: 'manual' }
    );
    assert.strictEqual(teacherGoogle.status, 302);
    assert.strictEqual(new URL(teacherGoogle.headers.get('location')).hostname, 'accounts.google.com');

    const login = await fetch(`${baseUrl}/api/login-by-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Beheer', password: 'smoke-password', type: 'staff' }),
    });
    const loginText = await login.text();
    assert.strictEqual(login.status, 200, `Production password login faalde: ${loginText}`);
    const loginPayload = JSON.parse(loginText);
    assert.ok(loginPayload.token, 'Production login leverde geen bearer-token op');
    assert.strictEqual(loginPayload.user.role, 'admin');

    const forbiddenLink = await fetch(`${baseUrl}/api/auth/google/staff-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginPayload.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        staffId: 'admin-smoke',
        email: 'beheer@koraaledu.nl',
      }),
    });
    const forbiddenLinkPayload = await forbiddenLink.json().catch(() => ({}));
    assert.strictEqual(forbiddenLink.status, 409);
    assert.match(forbiddenLinkPayload.message || '', /alleen lokale wachtwoordlogin/i);

    const persist = await fetch(`${baseUrl}/api/auth/session/persist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginPayload.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remember: true }),
    });
    const persistText = await persist.text();
    assert.strictEqual(persist.status, 200, `Production session persist faalde: ${persistText}`);
    assert.match(persist.headers.get('set-cookie') || '', /boekenbaai_session=/);

    const store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(store.sessions.length, 1, 'Production persistente sessie ontbreekt');
    assert.strictEqual(store.sessions[0].authMethod, 'password');
    assert.match(store.sessions[0].accountFingerprint || '', /^[a-f0-9]{64}$/);
    assert.strictEqual(
      store.links.some((link) => link.accountId === 'admin-smoke'),
      false,
      'Beheeraccount mag niet in de Google-linkstore terechtkomen'
    );
  } finally {
    await stop();
  }

  console.log('Production auth start smoke test geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
