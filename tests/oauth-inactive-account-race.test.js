'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-oauth-inactive-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31461;
const baseUrl = `http://127.0.0.1:${port}`;

const db = {
  books: [],
  students: [],
  users: [{
    id: 'teacher-1',
    name: 'Gitte van Bakel',
    username: 'gitte',
    passwordHash: 'teacher-x',
    role: 'teacher',
    classIds: ['class-a'],
    active: true,
  }],
  classes: [{ id: 'class-a', name: 'Structuur BB', studentIds: [], teacherIds: ['teacher-1'] }],
  folders: [],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

const linked = core.upsertLink(core.emptyAuthStore(), {
  accountType: 'staff',
  accountId: 'teacher-1',
  email: 'gitte.vanbakel@koraaledu.nl',
  sub: 'google-teacher-sub',
  linkedBy: 'test',
});
fs.writeFileSync(authPath, JSON.stringify(linked.store, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'response-safety-preload.js'),
  '--require', path.join(root, 'student-login-directory-preload.js'),
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'active-account-session-guard-preload.js'),
  '--require', path.join(root, 'local-password-auth-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'student-google-handoff-preload.js'),
  '--require', path.join(root, 'finalize-school-auth-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
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
    BOEKENBAAI_AUTH_SECRET: 'oauth-inactive-secret',
    BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
    BOEKENBAAI_PUBLIC_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

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
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

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

(async () => {
  try {
    await waitForServer();

    const tokenResponse = await fetch(
      `${baseUrl}/api/auth/google/start-token?type=staff&accountId=teacher-1`,
      { headers: { 'Sec-Fetch-Site': 'same-origin' } }
    );
    assert.strictEqual(tokenResponse.status, 200);
    const tokenPayload = await tokenResponse.json();
    const startIntent = cookieValue(tokenResponse, 'boekenbaai_google_start_intent');
    assert.ok(startIntent);

    const start = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&accountId=teacher-1&handoffToken=${encodeURIComponent(tokenPayload.token)}`,
      {
        redirect: 'manual',
        headers: { Cookie: cookieHeader({ boekenbaai_google_start_intent: startIntent }) },
      }
    );
    assert.strictEqual(start.status, 302);
    const authorize = new URL(start.headers.get('location'));
    const state = authorize.searchParams.get('state');
    const selected = cookieValue(start, 'boekenbaai_google_selected_account');
    const nonce = cookieValue(start, 'boekenbaai_oauth_nonce');
    assert.ok(state && selected && nonce);

    const changedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    changedDb.users.find((entry) => entry.id === 'teacher-1').active = false;
    fs.writeFileSync(dbPath, JSON.stringify(changedDb, null, 2));

    const callback = await fetch(
      `${baseUrl}/api/auth/google/callback?code=teacher-code&state=${encodeURIComponent(state)}`,
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
    assert.strictEqual(callback.status, 302);
    assert.strictEqual(
      new URL(callback.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'oauth-error',
      'Een docent die tijdens OAuth inactief wordt mag de login niet meer voltooien'
    );
    assert.strictEqual(cookieValue(callback, 'boekenbaai_session'), '');

    const store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(
      store.sessions.some((entry) => entry.type === 'staff' && entry.userId === 'teacher-1'),
      false,
      'De callback mag geen persistente sessie voor het inactieve account achterlaten'
    );

    console.log('OAuth inactive-account race test geslaagd.');
  } catch (error) {
    console.error(error);
    if (stderr.length) console.error(stderr.join(''));
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();