'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-finalize-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31452;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = 'finalize-auth-secret';
const adminToken = 'admin-finalize-session';
const legacyTeacherToken = 'teacher-legacy-session';

const db = {
  books: [],
  students: [
    {
      id: 'student-1',
      name: 'Sanne Jansen',
      firstName: 'Sanne',
      lastName: 'Jansen',
      username: 'sanne',
      passwordHash: 'student-x',
      classIds: ['class-a'],
      borrowedBooks: [],
      active: true,
    },
  ],
  users: [
    {
      id: 'admin-1',
      name: 'Boekenbaai Beheer',
      username: 'admin',
      passwordHash: 'admin-x',
      role: 'admin',
      active: true,
    },
    {
      id: 'teacher-1',
      name: 'Gitte van Bakel',
      username: 'gitte',
      passwordHash: 'teacher-x',
      role: 'teacher',
      classIds: ['class-a'],
      active: true,
    },
  ],
  classes: [
    { id: 'class-a', name: 'Structuur BB', studentIds: ['student-1'], teacherIds: ['teacher-1'] },
  ],
  folders: [],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

let auth = core.upsertSession(core.emptyAuthStore(), adminToken, {
  userId: 'admin-1',
  type: 'staff',
  remember: false,
  now: Date.now(),
}).store;
auth.sessions[0].authMethod = 'password';
auth.sessions[0].accountFingerprint = accountCredentialFingerprint(db.users[0]);
auth = core.upsertSession(auth, legacyTeacherToken, {
  userId: 'teacher-1',
  type: 'staff',
  remember: true,
  now: Date.now(),
}).store;
const legacyTeacherSession = auth.sessions.find(
  (entry) => entry.tokenHash === core.tokenHash(legacyTeacherToken)
);
legacyTeacherSession.authMethod = 'password';
legacyTeacherSession.accountFingerprint = accountCredentialFingerprint(db.users[1]);
fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'response-safety-preload.js'),
  '--require', path.join(root, 'student-login-directory-preload.js'),
  '--require', path.join(root, 'student-management-preload.js'),
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'local-password-auth-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'student-google-handoff-preload.js'),
  '--require', path.join(root, 'finalize-school-auth-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
  '--require', path.join(root, 'google-first-admin-preload.js'),
  path.join(root, 'tests', 'finalize-school-auth-fixture.js'),
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    BOEKENBAAI_GOOGLE_CLIENT_ID: 'fixture-client',
    BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    BOEKENBAAI_AUTH_SECRET: secret,
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
  await new Promise((resolve) => child.once('exit', resolve));
}

function setCookieLines(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
  const raw = response.headers.get('set-cookie') || '';
  return raw ? [raw] : [];
}

function cookieValue(response, name) {
  for (const line of setCookieLines(response)) {
    const match = String(line).match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
    if (match) return decodeURIComponent(match[1]);
  }
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(new RegExp(`${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function cookieHeader(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

async function prepareGoogleStart(type, accountId) {
  const tokenResponse = await fetch(
    `${baseUrl}/api/auth/google/start-token?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}`,
    { headers: { 'Sec-Fetch-Site': 'same-origin' } }
  );
  assert.strictEqual(tokenResponse.status, 200);
  const tokenPayload = await tokenResponse.json();
  const startIntentCookie = cookieValue(tokenResponse, 'boekenbaai_google_start_intent');
  assert.ok(startIntentCookie);

  const start = await fetch(
    `${baseUrl}/api/auth/google/start?type=${encodeURIComponent(type)}&accountId=${encodeURIComponent(accountId)}&handoffToken=${encodeURIComponent(tokenPayload.token)}`,
    {
      redirect: 'manual',
      headers: { Cookie: cookieHeader({ boekenbaai_google_start_intent: startIntentCookie }) },
    }
  );
  assert.strictEqual(start.status, 302);
  const location = new URL(start.headers.get('location'));
  const state = location.searchParams.get('state');
  assert.ok(state);
  const selected = cookieValue(start, 'boekenbaai_google_selected_account');
  const nonce = cookieValue(start, 'boekenbaai_oauth_nonce');
  assert.ok(selected);
  assert.ok(nonce);
  return { state, selected, nonce };
}

async function callback({ code, state, selected, nonce }) {
  return fetch(
    `${baseUrl}/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    {
      redirect: 'manual',
      headers: {
        Cookie: cookieHeader({
          boekenbaai_google_selected_account: selected,
          boekenbaai_oauth_nonce: nonce,
        }),
      },
    }
  );
}

function sameOriginHeaders(cookie, extra = {}) {
  return {
    Cookie: cookie,
    Origin: baseUrl,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

(async () => {
  try {
    await waitForServer();

    const staffPage = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(staffPage.status, 200);
    const html = await staffPage.text();
    assert.match(html, /staff-google-link\.js/);
    assert.match(html, /school-sync-finalize\.js/);

    const studentStart = await prepareGoogleStart('student', 'student-1');
    const studentCallback = await callback({ ...studentStart, code: 'student-code' });
    assert.strictEqual(studentCallback.status, 302);
    assert.strictEqual(
      new URL(studentCallback.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'link-required'
    );
    const studentPending = cookieValue(studentCallback, 'boekenbaai_google_pending');
    assert.ok(studentPending);

    const studentAuto = await fetch(`${baseUrl}/api/auth/google/auto-link-request`, {
      method: 'POST',
      headers: sameOriginHeaders(cookieHeader({
        boekenbaai_google_pending: studentPending,
        boekenbaai_google_selected_account: studentStart.selected,
      })),
    });
    assert.strictEqual(studentAuto.status, 202);
    let store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const studentRequest = store.linkRequests.find((entry) => entry.studentId === 'student-1');
    assert.ok(studentRequest);
    assert.strictEqual(
      studentRequest.googleName,
      'Sanne Google',
      'De mentorwaarschuwing moet de profielnaam uit de echt geverifieerde Google-login krijgen'
    );

    const legacyTeacherMe = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${legacyTeacherToken}` },
    });
    assert.strictEqual(
      legacyTeacherMe.status,
      200,
      'De test moet de oude docentsessie eerst bewust in de runtimecache laden'
    );

    const teacherStart = await prepareGoogleStart('staff', 'teacher-1');
    const teacherCallback = await callback({ ...teacherStart, code: 'teacher-code' });
    assert.strictEqual(teacherCallback.status, 302);
    assert.strictEqual(
      new URL(teacherCallback.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'link-required',
      'Een nog niet gekoppelde docent moet naar de goedkeuringsflow gaan in plaats van naar staff-unlinked'
    );
    const teacherPending = cookieValue(teacherCallback, 'boekenbaai_google_pending');
    assert.ok(teacherPending);

    const teacherAuto = await fetch(`${baseUrl}/api/auth/google/staff-auto-link-request`, {
      method: 'POST',
      headers: sameOriginHeaders(cookieHeader({
        boekenbaai_google_pending: teacherPending,
        boekenbaai_google_selected_account: teacherStart.selected,
      })),
    });
    assert.strictEqual(teacherAuto.status, 202);

    const adminCookie = cookieHeader({ boekenbaai_session: adminToken });
    const requestsResponse = await fetch(`${baseUrl}/api/auth/google/staff-link-requests`, {
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(requestsResponse.status, 200);
    const requestsPayload = await requestsResponse.json();
    assert.strictEqual(requestsPayload.requests.length, 1);
    assert.strictEqual(requestsPayload.requests[0].staffId, 'teacher-1');
    assert.strictEqual(requestsPayload.requests[0].googleName, 'Gitte van Bakel');
    assert.strictEqual(requestsPayload.requests[0].nameMatch, 'match');

    const requestId = requestsPayload.requests[0].id;
    const approve = await fetch(
      `${baseUrl}/api/auth/google/staff-link-requests/${encodeURIComponent(requestId)}/approve`,
      {
        method: 'POST',
        headers: sameOriginHeaders(adminCookie),
      }
    );
    assert.strictEqual(approve.status, 200);

    const legacyTeacherAfterApproval = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${legacyTeacherToken}` },
    });
    assert.strictEqual(
      legacyTeacherAfterApproval.status,
      401,
      'Eerste Google-goedkeuring moet ook een reeds gecachete oude docentsessie direct intrekken'
    );

    const pendingStatus = await fetch(`${baseUrl}/api/auth/google/staff-pending`, {
      headers: { Cookie: cookieHeader({ boekenbaai_google_pending: teacherPending }) },
    });
    assert.strictEqual(pendingStatus.status, 200);
    const pendingPayload = await pendingStatus.json();
    assert.strictEqual(pendingPayload.canComplete, true);

    const complete = await fetch(`${baseUrl}/api/auth/google/staff-pending/complete`, {
      method: 'POST',
      headers: sameOriginHeaders(cookieHeader({ boekenbaai_google_pending: teacherPending })),
    });
    assert.strictEqual(complete.status, 200);
    assert.ok(cookieValue(complete, 'boekenbaai_session'));

    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const teacherLink = store.links.find(
      (entry) => entry.accountType === 'staff' && entry.accountId === 'teacher-1'
    );
    assert.ok(teacherLink);
    assert.strictEqual(teacherLink.email, 'gitte.vanbakel@koraaledu.nl');
    assert.strictEqual(teacherLink.sub, 'google-teacher-sub');
    const teacherSession = store.sessions.find((entry) => entry.userId === 'teacher-1' && entry.type === 'staff');
    assert.ok(teacherSession);
    assert.strictEqual(teacherSession.authMethod, 'google');
    assert.match(teacherSession.accountFingerprint || '', /^[a-f0-9]{64}$/);

    console.log('Final Google staff/student link flow tests geslaagd.');
  } catch (error) {
    console.error(error);
    if (stderr.length) console.error(stderr.join(''));
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
