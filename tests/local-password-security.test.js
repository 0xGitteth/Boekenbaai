'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { isScryptHash } = require('../local-password-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-local-password-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31451;
const baseUrl = `http://127.0.0.1:${port}`;

function legacyHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

fs.writeFileSync(dbPath, JSON.stringify({
  books: [],
  students: [{
    id: 'student-1',
    name: 'Leerling Test',
    username: 'leerling-test',
    passwordHash: legacyHash('student-password'),
    mustChangePassword: true,
    borrowedBooks: [],
    classIds: [],
  }],
  users: [
    {
      id: 'admin-1',
      name: 'Boekenbaai Beheer',
      username: 'boekenbaai-beheer',
      passwordHash: legacyHash('legacy-admin-password'),
      mustChangePassword: false,
      role: 'admin',
    },
    {
      id: 'teacher-1',
      name: 'Docent Test',
      username: 'docent-test',
      passwordHash: legacyHash('teacher-password'),
      mustChangePassword: true,
      role: 'teacher',
      classIds: [],
    },
  ],
  classes: [],
  folders: [],
  history: [],
}, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'local-password-security-preload.js'),
  path.join(__dirname, 'local-password-security-fixture.js'),
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
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
      throw new Error(`Local password fixture stopte vroeg: ${stderr.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Local password fixture start timeout: ${stderr.join('')}`);
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function extractCookie(response, name) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(new RegExp(`(?:^|,?\\s*)${name}=([^;,]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function loginByName(name, password, type, forwardedFor) {
  return fetch(`${baseUrl}/api/login-by-name`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    },
    body: JSON.stringify({ name, password, type }),
  });
}

(async () => {
  try {
    await waitForServer();

    const student = await loginByName(
      'Leerling Test',
      'student-password',
      'student',
      '203.0.113.10'
    );
    assert.strictEqual(student.status, 401, 'Leerlingen mogen niet meer met lokaal wachtwoord inloggen');

    const teacher = await loginByName(
      'Docent Test',
      'teacher-password',
      'staff',
      '203.0.113.11'
    );
    assert.strictEqual(teacher.status, 401, 'Docenten mogen niet meer met lokaal wachtwoord inloggen');

    const legacyBefore = JSON.parse(fs.readFileSync(dbPath, 'utf8')).users.find(
      (entry) => entry.id === 'admin-1'
    ).passwordHash;
    assert.match(legacyBefore, /^[a-f0-9]{64}$/);

    const wrong = await loginByName(
      'Boekenbaai Beheer',
      'wrong-password',
      'staff',
      '203.0.113.12'
    );
    assert.strictEqual(wrong.status, 401);

    const firstLogin = await loginByName(
      'Boekenbaai Beheer',
      'legacy-admin-password',
      'staff',
      '203.0.113.12'
    );
    const firstPayload = await firstLogin.json();
    assert.strictEqual(firstLogin.status, 200);
    assert.strictEqual(firstPayload.token, 'cookie', 'Raw admin-sessietoken mag niet in JSON/localStorage terechtkomen');
    assert.strictEqual(firstPayload.user.role, 'admin');
    const sessionA = extractCookie(firstLogin, 'boekenbaai_session');
    assert.ok(sessionA, 'HttpOnly admin-sessiecookie ontbreekt');
    assert.match(firstLogin.headers.get('set-cookie') || '', /boekenbaai_session=[^;]+;[^,]*HttpOnly/i);

    const migratedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const migratedAdmin = migratedDb.users.find((entry) => entry.id === 'admin-1');
    assert.ok(isScryptHash(migratedAdmin.passwordHash), 'Eerste succesvolle legacy-login moet naar scrypt migreren');
    assert.notStrictEqual(migratedAdmin.passwordHash, legacyBefore);
    assert.match(
      migratedDb.students[0].passwordHash,
      /^[a-f0-9]{64}$/,
      'Historische leerlinghash mag niet stil herschreven worden; lokale leerlinglogin is server-side geblokkeerd'
    );

    const authAfterFirst = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(authAfterFirst.sessions.length, 1);
    assert.strictEqual(authAfterFirst.sessions[0].userId, 'admin-1');
    assert.strictEqual(authAfterFirst.sessions[0].authMethod, 'password');
    assert.match(authAfterFirst.sessions[0].accountFingerprint || '', /^[a-f0-9]{64}$/);

    const migratedHashBeforeSecond = migratedAdmin.passwordHash;
    const secondLogin = await loginByName(
      'Boekenbaai Beheer',
      'legacy-admin-password',
      'staff',
      '203.0.113.13'
    );
    assert.strictEqual(secondLogin.status, 200);
    const sessionB = extractCookie(secondLogin, 'boekenbaai_session');
    assert.ok(sessionB && sessionB !== sessionA);
    const afterSecondDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(
      afterSecondDb.users.find((entry) => entry.id === 'admin-1').passwordHash,
      migratedHashBeforeSecond,
      'Een bestaande scrypt-hash mag niet bij iedere login opnieuw worden gesalt'
    );

    const change = await fetch(`${baseUrl}/api/account/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: `boekenbaai_session=${encodeURIComponent(sessionA)}`,
        Authorization: 'Bearer cookie',
      },
      body: JSON.stringify({
        currentPassword: 'legacy-admin-password',
        newPassword: 'nieuwe sterke beheerpassphrase',
        clearMustChange: true,
      }),
    });
    const changePayload = await change.json();
    assert.strictEqual(change.status, 200, changePayload.message || 'Wachtwoordwijziging faalde');

    const changedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const changedAdmin = changedDb.users.find((entry) => entry.id === 'admin-1');
    assert.ok(isScryptHash(changedAdmin.passwordHash));
    assert.notStrictEqual(changedAdmin.passwordHash, migratedHashBeforeSecond);
    assert.strictEqual(changedAdmin.mustChangePassword, false);

    const currentSessionStillWorks = await fetch(`${baseUrl}/api/test`, {
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(sessionA)}`,
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(
      currentSessionStillWorks.status,
      418,
      'De sessie waarmee het wachtwoord is gewijzigd moet de nieuwe fingerprint krijgen'
    );

    const otherOldSession = await fetch(`${baseUrl}/api/test`, {
      headers: {
        Cookie: `boekenbaai_session=${encodeURIComponent(sessionB)}`,
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(
      otherOldSession.status,
      401,
      'Een tweede apparaat met de oude credential fingerprint moet worden ingetrokken'
    );

    const oldPassword = await loginByName(
      'Boekenbaai Beheer',
      'legacy-admin-password',
      'staff',
      '203.0.113.14'
    );
    assert.strictEqual(oldPassword.status, 401);

    const newPassword = await loginByName(
      'Boekenbaai Beheer',
      'nieuwe sterke beheerpassphrase',
      'staff',
      '203.0.113.14'
    );
    assert.strictEqual(newPassword.status, 200);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const failed = await loginByName(
        'Boekenbaai Beheer',
        `fout-${attempt}`,
        'staff',
        '203.0.113.99'
      );
      assert.strictEqual(failed.status, 401, `Poging ${attempt + 1} moet nog als mislukte login tellen`);
    }
    const limited = await loginByName(
      'Boekenbaai Beheer',
      'nog-een-fout',
      'staff',
      '203.0.113.99'
    );
    assert.strictEqual(limited.status, 429, 'Negende mislukte poging vanaf dezelfde client moet worden afgeremd');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  } finally {
    await stop();
  }

  console.log('Local password security integration tests geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
