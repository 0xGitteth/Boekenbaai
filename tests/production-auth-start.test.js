'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');
const { isScryptHash } = require('../local-password-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-production-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31423;
const baseUrl = `http://127.0.0.1:${port}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function extractCookieValue(setCookieHeader, name) {
  const match = String(setCookieHeader || '').match(new RegExp(`${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

fs.writeFileSync(dbPath, JSON.stringify({
  books: [],
  students: [{
    id: 'student-smoke',
    name: 'Smoke Leerling',
    firstName: 'Smoke',
    lastName: 'Leerling',
    username: 'smoke-student',
    passwordHash: hashPassword('unused-student-password'),
    grade: '4',
    borrowedBooks: [],
    classIds: ['class-smoke'],
  }],
  folders: [],
  classes: [{
    id: 'class-smoke',
    name: 'Geheime Klas',
    studentIds: ['student-smoke'],
  }],
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
  '--require', path.join(root, 'local-password-auth-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'student-google-handoff-preload.js'),
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

async function googleStartIntent(type, accountId) {
  const response = await fetch(
    `${baseUrl}/api/auth/google/start-token?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`
  );
  assert.strictEqual(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.token);
  const state = core.verifySignedState(payload.token, 'test-auth-secret', {
    maxAgeMs: 2 * 60 * 1000,
  });
  assert.strictEqual(state?.purpose, 'google-start');
  assert.strictEqual(state?.type, type);
  assert.strictEqual(state?.accountId, accountId);
  assert.ok(state?.nonce);

  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, /boekenbaai_google_start_intent=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const intentCookie = extractCookieValue(setCookie, 'boekenbaai_google_start_intent');
  assert.strictEqual(intentCookie, state.nonce);
  return { token: payload.token, intentCookie };
}

(async () => {
  try {
    const configResponse = await waitForServer();
    const config = await configResponse.json();
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.domain, 'koraaledu.nl');

    // Bewijs op de echte production startvolgorde dat de privacy-policy de oude
    // ruimere /api/login-search-route vóór server.js onderschept.
    const publicDirectory = await fetch(`${baseUrl}/api/login-search?q=smo&type=student`, {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        'X-Forwarded-For': '198.51.100.200',
      },
    });
    const publicDirectoryPayload = await publicDirectory.json();
    assert.strictEqual(publicDirectory.status, 200);
    assert.strictEqual(publicDirectoryPayload.matches.length, 1);
    assert.deepStrictEqual(
      Object.keys(publicDirectoryPayload.matches[0]).sort(),
      ['displayName', 'id', 'name', 'type']
    );
    assert.strictEqual(publicDirectoryPayload.matches[0].id, 'student-smoke');
    assert.strictEqual(publicDirectoryPayload.matches[0].name, 'Smoke L.');
    const serializedDirectory = JSON.stringify(publicDirectoryPayload);
    assert.doesNotMatch(serializedDirectory, /Geheime Klas/);
    assert.doesNotMatch(serializedDirectory, /smoke-student/);
    assert.doesNotMatch(serializedDirectory, /passwordHash/);
    assert.doesNotMatch(serializedDirectory, /"grade"/);
    assert.match(publicDirectory.headers.get('cache-control') || '', /no-store/i);

    assert.strictEqual((await loginMode('staff', 'admin-smoke')).authMode, 'password');
    assert.strictEqual((await loginMode('staff', 'teacher-smoke')).authMode, 'google');
    assert.strictEqual((await loginMode('student', 'student-smoke')).authMode, 'google');

    const blockedStudentPassword = await fetch(`${baseUrl}/api/login-by-name`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.30',
      },
      body: JSON.stringify({
        name: 'Smoke Leerling',
        password: 'unused-student-password',
        type: 'student',
      }),
    });
    assert.strictEqual(blockedStudentPassword.status, 401);

    const blockedTeacherPassword = await fetch(`${baseUrl}/api/login-by-name`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.31',
      },
      body: JSON.stringify({
        name: 'Smoke Docent',
        password: 'unused-teacher-password',
        type: 'staff',
      }),
    });
    assert.strictEqual(blockedTeacherPassword.status, 401);

    const adminGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=admin-smoke`,
      { redirect: 'manual' }
    );
    assert.strictEqual(adminGoogle.status, 302);
    assert.strictEqual(
      new URL(adminGoogle.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'local-only'
    );

    const untrustedTeacherStart = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=teacher-smoke`,
      { redirect: 'manual' }
    );
    assert.strictEqual(
      untrustedTeacherStart.status,
      403,
      'Een directe OAuth-start buiten de Boekenbaai-UI moet worden geweigerd'
    );

    const teacherIntent = await googleStartIntent('staff', 'teacher-smoke');
    const teacherGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=teacher-smoke&handoffToken=${encodeURIComponent(teacherIntent.token)}`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `boekenbaai_google_start_intent=${encodeURIComponent(teacherIntent.intentCookie)}`,
        },
      }
    );
    assert.strictEqual(teacherGoogle.status, 302);
    assert.strictEqual(new URL(teacherGoogle.headers.get('location')).hostname, 'accounts.google.com');

    const studentIntent = await googleStartIntent('student', 'student-smoke');
    const studentGoogle = await fetch(
      `${baseUrl}/api/auth/google/start?type=student&accountId=student-smoke&handoffToken=${encodeURIComponent(studentIntent.token)}`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `boekenbaai_google_start_intent=${encodeURIComponent(studentIntent.intentCookie)}`,
        },
      }
    );
    assert.strictEqual(studentGoogle.status, 302);
    const studentGoogleLocation = new URL(studentGoogle.headers.get('location'));
    assert.strictEqual(studentGoogleLocation.hostname, 'accounts.google.com');
    const studentOauthState = core.verifySignedState(
      studentGoogleLocation.searchParams.get('state'),
      'test-auth-secret'
    );
    assert.strictEqual(studentOauthState?.type, 'student');
    assert.ok(studentOauthState?.nonce, 'Production OAuth-state moet de nonce behouden');

    const studentSetCookie = studentGoogle.headers.get('set-cookie') || '';
    assert.match(
      studentSetCookie,
      /boekenbaai_google_selected_account=/,
      'Production Google-start moet de beveiligde leerlingselectiecookie zetten'
    );
    assert.match(
      studentSetCookie,
      /boekenbaai_google_start_intent=;[^,]*Max-Age=0/,
      'Production Google-start moet de browsergebonden startintent na gebruik wissen'
    );
    const selectedCookie = extractCookieValue(
      studentSetCookie,
      'boekenbaai_google_selected_account'
    );
    const selectedState = core.verifySignedState(selectedCookie, 'test-auth-secret', {
      maxAgeMs: 15 * 60 * 1000,
    });
    assert.strictEqual(selectedState?.type, 'student');
    assert.strictEqual(
      selectedState?.accountId,
      'student-smoke',
      'Production handoff-cookie moet de geselecteerde leerling ondertekend meenemen'
    );

    const legacyAdminHash = JSON.parse(fs.readFileSync(dbPath, 'utf8')).users.find(
      (entry) => entry.id === 'admin-smoke'
    ).passwordHash;
    assert.match(legacyAdminHash, /^[a-f0-9]{64}$/);

    const login = await fetch(`${baseUrl}/api/login-by-name`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.40',
      },
      body: JSON.stringify({ name: 'Smoke Beheer', password: 'smoke-password', type: 'staff' }),
    });
    const loginText = await login.text();
    assert.strictEqual(login.status, 200, `Production password login faalde: ${loginText}`);
    const loginPayload = JSON.parse(loginText);
    assert.strictEqual(loginPayload.token, 'cookie');
    assert.strictEqual(loginPayload.user.role, 'admin');
    const adminSession = extractCookieValue(
      login.headers.get('set-cookie') || '',
      'boekenbaai_session'
    );
    assert.ok(adminSession, 'Production adminlogin moet een HttpOnly sessiecookie zetten');
    assert.match(login.headers.get('set-cookie') || '', /boekenbaai_session=[^;]+;[^,]*HttpOnly/i);

    const migratedAdmin = JSON.parse(fs.readFileSync(dbPath, 'utf8')).users.find(
      (entry) => entry.id === 'admin-smoke'
    );
    assert.ok(isScryptHash(migratedAdmin.passwordHash));
    assert.notStrictEqual(migratedAdmin.passwordHash, legacyAdminHash);

    const me = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(adminSession)}`,
        Authorization: 'Bearer cookie',
      },
    });
    const mePayload = await me.json();
    assert.strictEqual(me.status, 200);
    assert.strictEqual(mePayload.role, 'admin');

    const forbiddenLink = await fetch(`${baseUrl}/api/auth/google/staff-email`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cookie',
        Cookie: `boekenbaai_session=${encodeURIComponent(adminSession)}`,
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
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

    const store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(store.sessions.length, 1, 'Production adminlogin moet direct persistent beschermd zijn');
    assert.strictEqual(store.sessions[0].userId, 'admin-smoke');
    assert.strictEqual(store.sessions[0].authMethod, 'password');
    assert.strictEqual(store.sessions[0].remember, false);
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
