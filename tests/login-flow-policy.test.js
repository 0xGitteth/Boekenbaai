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
  students: [
    {
      id: 'student-1',
      name: 'Gitte van Bakel',
      firstName: 'Gitte',
      middleName: 'van',
      lastName: 'Bakel',
      username: 'gitte-secret',
      passwordHash: 'never-public',
      grade: '4',
    },
    {
      id: 'student-2',
      name: 'Gitte van Bakkers',
      firstName: 'Gitte',
      middleName: 'van',
      lastName: 'Bakkers',
      grade: '5',
    },
    { id: 'student-bo', name: 'Bo', firstName: 'Bo' },
    { id: 'student-mirsad', name: 'Mirsad Smit', firstName: 'Mirsad', lastName: 'Smit' },
  ],
  classes: [
    { id: 'class-a', name: 'Structuur A', studentIds: ['student-1'] },
    { id: 'class-b', name: 'Structuur B', studentIds: ['student-2'] },
  ],
  users: [
    {
      id: 'teacher-1',
      name: 'Docent Een',
      username: 'docent-secret',
      passwordHash: 'never-public',
      role: 'teacher',
    },
    {
      id: 'admin-1',
      name: 'Boekenbaai Beheer',
      username: 'beheer-secret',
      passwordHash: 'never-public',
      role: 'admin',
    },
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

async function readJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function assertMinimalDirectoryMatch(match, expectedType) {
  assert.deepStrictEqual(
    Object.keys(match).sort(),
    ['displayName', 'id', 'name', 'type'],
    'Publieke directory mag alleen minimale selectievelden teruggeven'
  );
  assert.strictEqual(match.type, expectedType);
  assert.strictEqual(match.name, match.displayName);
  for (const forbidden of ['class', 'grade', 'username', 'passwordHash', 'role', 'classIds']) {
    assert.strictEqual(Object.hasOwn(match, forbidden), false, `${forbidden} mag niet publiek terugkomen`);
  }
}

(async () => {
  try {
    await waitForServer();

    const directory = await readJson('/api/login-search?q=git&type=student', {
      headers: { 'X-Forwarded-For': '198.51.100.10' },
    });
    assert.strictEqual(directory.response.status, 200);
    assert.strictEqual(directory.payload.matches.length, 2);
    directory.payload.matches.forEach((entry) => assertMinimalDirectoryMatch(entry, 'student'));
    assert.strictEqual(directory.payload.matches[0].name.startsWith('Gitte '), true);
    assert.strictEqual(
      directory.payload.matches.some((entry) => entry.name === 'Gitte van Bakel'),
      false,
      'Volledige leerlingnaam mag niet onnodig worden teruggegeven'
    );
    const directoryCookie = directory.response.headers.get('set-cookie') || '';
    assert.match(directoryCookie, /boekenbaai_login_directory=/);
    assert.match(directoryCookie, /HttpOnly/i);
    assert.match(directoryCookie, /SameSite=Strict/i);
    assert.match(directory.response.headers.get('cache-control') || '', /no-store/i);
    assert.strictEqual(directory.response.headers.get('x-content-type-options'), 'nosniff');

    const substring = await readJson('/api/login-search?q=itte&type=student', {
      headers: { 'X-Forwarded-For': '198.51.100.11' },
    });
    assert.strictEqual(substring.response.status, 200);
    assert.deepStrictEqual(substring.payload.matches, []);

    const twoLetterPrefix = await readJson('/api/login-search?q=mi&type=student', {
      headers: { 'X-Forwarded-For': '198.51.100.12' },
    });
    assert.deepStrictEqual(twoLetterPrefix.payload.matches, []);

    const broadParticle = await readJson('/api/login-search?q=van&type=student', {
      headers: { 'X-Forwarded-For': '198.51.100.19' },
    });
    assert.strictEqual(broadParticle.response.status, 200);
    assert.deepStrictEqual(broadParticle.payload.matches, []);

    const exactTwoLetter = await readJson('/api/login-search?q=bo&type=student', {
      headers: { 'X-Forwarded-For': '198.51.100.13' },
    });
    assert.strictEqual(exactTwoLetter.payload.matches.length, 1);
    assert.strictEqual(exactTwoLetter.payload.matches[0].id, 'student-bo');
    assertMinimalDirectoryMatch(exactTwoLetter.payload.matches[0], 'student');

    const staffDirectory = await readJson('/api/login-search?q=doc&type=staff', {
      headers: { 'X-Forwarded-For': '198.51.100.14' },
    });
    assert.strictEqual(staffDirectory.payload.matches.length, 1);
    assert.strictEqual(staffDirectory.payload.matches[0].name, 'Docent Een');
    assertMinimalDirectoryMatch(staffDirectory.payload.matches[0], 'staff');

    const adminDirectory = await readJson('/api/login-search?q=boe&type=staff', {
      headers: { 'X-Forwarded-For': '198.51.100.15' },
    });
    assert.strictEqual(adminDirectory.payload.matches[0].id, 'admin-1');
    assert.strictEqual(adminDirectory.payload.matches[0].name, 'Boekenbaai Beheer');

    const invalidType = await readJson('/api/login-search?q=git&type=unknown', {
      headers: { 'X-Forwarded-For': '198.51.100.16' },
    });
    assert.strictEqual(invalidType.response.status, 400);

    const tooLong = await readJson(`/api/login-search?q=${'a'.repeat(81)}&type=student`, {
      headers: { 'X-Forwarded-For': '198.51.100.17' },
    });
    assert.strictEqual(tooLong.response.status, 400);

    const crossSite = await readJson('/api/login-search?q=git&type=student', {
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        'X-Forwarded-For': '198.51.100.18',
      },
    });
    assert.strictEqual(crossSite.response.status, 403);

    const limiterCookie = 'boekenbaai_login_directory=abcdefghijklmnopqrstuvwx12345678';
    for (let index = 0; index < 30; index += 1) {
      const allowed = await readJson('/api/login-search?q=git&type=student', {
        headers: {
          Cookie: limiterCookie,
          // De eerste XFF-hop varieert bewust alsof een client hem spoeft. De
          // laatste proxy-hop blijft gelijk en moet dus dezelfde limiet raken.
          'X-Forwarded-For': `203.0.113.${index + 1}, 198.51.100.77`,
        },
      });
      assert.strictEqual(
        allowed.response.status,
        200,
        `Directory request ${index + 1} hoort binnen de browserlimiet te vallen`
      );
    }
    const limited = await readJson('/api/login-search?q=git&type=student', {
      headers: {
        Cookie: limiterCookie,
        'X-Forwarded-For': '192.0.2.250, 198.51.100.77',
      },
    });
    assert.strictEqual(
      limited.response.status,
      429,
      'Een gespoofte eerste X-Forwarded-For-hop mag de browser/netwerklimiet niet omzeilen'
    );
    assert.ok(Number(limited.response.headers.get('retry-after')) > 0);

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
