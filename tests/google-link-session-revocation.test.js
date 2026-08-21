'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-google-link-revoke-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31424;
const baseUrl = `http://127.0.0.1:${port}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const admin = {
  id: 'admin-revoke',
  name: 'Beheer Revoke',
  username: 'admin-revoke',
  passwordHash: hashPassword('admin-password'),
  role: 'admin',
  mustChangePassword: false,
};
const teacher = {
  id: 'teacher-revoke',
  name: 'Docent Revoke',
  username: 'teacher-revoke',
  passwordHash: hashPassword('unused-teacher-password'),
  role: 'teacher',
  classIds: ['class-revoke'],
};
const student = {
  id: 'student-revoke',
  name: 'Leerling Revoke',
  username: 'student-revoke',
  passwordHash: hashPassword('unused-student-password'),
  role: 'student',
  classIds: ['class-revoke'],
  borrowedBooks: [],
};

const db = {
  books: [],
  students: [student],
  folders: [],
  classes: [{
    id: 'class-revoke',
    name: 'Revoke Klas',
    studentIds: [student.id],
    teacherIds: [teacher.id],
  }],
  users: [admin, teacher],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

const now = Date.now();
const adminToken = 'admin-revoke-token';
const teacherToken = 'teacher-old-token';
const studentToken = 'student-old-token';

function sessionRecord(token, account, type, authMethod = 'google') {
  return {
    tokenHash: core.tokenHash(token),
    userId: account.id,
    type,
    remember: false,
    createdAt: now,
    expiresAt: now + core.SESSION_WINDOW_MS,
    accountFingerprint: accountCredentialFingerprint(account),
    authMethod,
  };
}

fs.writeFileSync(authPath, JSON.stringify({
  ...core.emptyAuthStore(),
  links: [
    {
      accountType: 'staff',
      accountId: teacher.id,
      email: 'docent.oud@koraaledu.nl',
      sub: 'teacher-sub-old',
      createdAt: new Date(now - 1000).toISOString(),
      updatedAt: new Date(now - 1000).toISOString(),
      linkedBy: admin.id,
    },
    {
      accountType: 'student',
      accountId: student.id,
      email: 'leerling.oud@koraaledu.nl',
      sub: 'student-sub-old',
      createdAt: new Date(now - 1000).toISOString(),
      updatedAt: new Date(now - 1000).toISOString(),
      linkedBy: admin.id,
    },
  ],
  sessions: [
    sessionRecord(adminToken, admin, 'staff', 'password'),
    sessionRecord(teacherToken, teacher, 'staff'),
    sessionRecord(studentToken, student, 'student'),
  ],
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
      throw new Error(`Server stopte tijdens start: ${stderr.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/google/config`);
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

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `boekenbaai_session=${encodeURIComponent(token)}`,
  };
}

async function me(token) {
  return fetch(`${baseUrl}/api/me`, { headers: authHeaders(token) });
}

async function adminPost(pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      ...authHeaders(adminToken),
      Origin: baseUrl,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function readStore() {
  return JSON.parse(fs.readFileSync(authPath, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(authPath, JSON.stringify(store, null, 2));
}

function addFreshSession(token, account, type) {
  const store = readStore();
  store.sessions.push({
    ...sessionRecord(token, account, type),
    createdAt: Date.now(),
    expiresAt: Date.now() + core.SESSION_WINDOW_MS,
  });
  writeStore(store);
}

(async () => {
  try {
    await waitForServer();

    // Vul de runtime-RAMcache bewust vóór de mappingwijzigingen.
    assert.strictEqual((await me(teacherToken)).status, 200);
    assert.strictEqual((await me(studentToken)).status, 200);

    // Een mislukte wijziging mag geen bestaande sessie intrekken.
    const conflict = await adminPost('/api/auth/google/staff-email', {
      staffId: teacher.id,
      email: 'leerling.oud@koraaledu.nl',
    });
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual((await me(teacherToken)).status, 200);

    // Een echte medewerker-mappingwijziging trekt ook een al gecachte sessie direct in.
    const teacherChange = await adminPost('/api/auth/google/staff-email', {
      staffId: teacher.id,
      email: 'docent.nieuw@koraaledu.nl',
    });
    assert.strictEqual(teacherChange.status, 200);
    assert.strictEqual((await me(teacherToken)).status, 401);
    assert.strictEqual((await me(studentToken)).status, 200, 'Andere accounts mogen niet worden uitgelogd');

    let store = readStore();
    assert.strictEqual(
      store.sessions.some((entry) => entry.tokenHash === core.tokenHash(teacherToken)),
      false,
      'Oude docentsessie moet uit de persistente store verdwijnen'
    );
    const teacherLink = store.links.find((entry) => entry.accountId === teacher.id);
    assert.strictEqual(teacherLink.email, 'docent.nieuw@koraaledu.nl');
    assert.strictEqual(teacherLink.sub, '');

    // Het opnieuw opslaan van exact dezelfde identiteit is een no-op en mag niet uitloggen.
    const teacherNoopToken = 'teacher-noop-token';
    addFreshSession(teacherNoopToken, teacher, 'staff');
    assert.strictEqual((await me(teacherNoopToken)).status, 200);
    const teacherNoop = await adminPost('/api/auth/google/staff-email', {
      staffId: teacher.id,
      email: 'docent.nieuw@koraaledu.nl',
    });
    assert.strictEqual(teacherNoop.status, 200);
    assert.strictEqual((await me(teacherNoopToken)).status, 200);

    // Dezelfde regel geldt voor een handmatig gewijzigd leerlingadres.
    const studentChange = await adminPost('/api/auth/google/student-email', {
      studentId: student.id,
      email: 'leerling.nieuw@koraaledu.nl',
    });
    assert.strictEqual(studentChange.status, 200);
    assert.strictEqual((await me(studentToken)).status, 401);
    assert.strictEqual((await me(teacherNoopToken)).status, 200);

    // Ook het verifiëren van een bestaande prelink (sub: '' -> echte sub) is een
    // identiteitsovergang. Een eventuele oude sessie moet vóór goedkeuring verdwijnen.
    const studentApprovalToken = 'student-approval-token';
    addFreshSession(studentApprovalToken, student, 'student');
    assert.strictEqual((await me(studentApprovalToken)).status, 200);

    store = readStore();
    store.linkRequests.push({
      id: 'request-revoke-1',
      studentId: student.id,
      email: 'leerling.nieuw@koraaledu.nl',
      sub: 'student-sub-new',
      googleName: 'Leerling Revoke',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    writeStore(store);

    const approve = await adminPost(
      '/api/auth/google/link-requests/request-revoke-1/approve',
      {}
    );
    assert.strictEqual(approve.status, 200);
    assert.strictEqual((await me(studentApprovalToken)).status, 401);

    store = readStore();
    const studentLink = store.links.find((entry) => entry.accountId === student.id);
    assert.strictEqual(studentLink.email, 'leerling.nieuw@koraaledu.nl');
    assert.strictEqual(studentLink.sub, 'student-sub-new');
    assert.strictEqual(
      store.sessions.some((entry) => entry.userId === student.id),
      false,
      'Na verificatie mogen geen oudere leerlingensessies blijven bestaan'
    );
    assert.strictEqual(
      store.sessions.some((entry) => entry.tokenHash === core.tokenHash(adminToken)),
      true,
      'De beheersessie die de wijziging uitvoert moet blijven bestaan'
    );
  } finally {
    await stop();
  }

  console.log('Google link session revocation integration tests geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
