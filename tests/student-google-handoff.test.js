'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-student-handoff-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31441;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = 'handoff-test-secret';
const pendingToken = 'pending-token';

fs.writeFileSync(dbPath, JSON.stringify({
  books: [],
  students: [
    { id: 'student-1', name: 'Leerling Een', borrowedBooks: [], classIds: [] },
    { id: 'student-2', name: 'Leerling Twee', borrowedBooks: [], classIds: [] },
  ],
  users: [],
  classes: [],
  folders: [],
  history: [],
}, null, 2));

fs.writeFileSync(authPath, JSON.stringify({
  version: 1,
  links: [],
  sessions: [],
  pendingIdentities: [{
    tokenHash: core.tokenHash(pendingToken),
    sub: 'pending-sub',
    email: 'leerling@koraaledu.nl',
    name: 'Leerling Google',
    givenName: 'Leerling',
    createdAt: Date.now(),
    expiresAt: Date.now() + 20 * 60 * 1000,
  }],
  linkRequests: [],
}, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'student-google-handoff-preload.js'),
  path.join(__dirname, 'student-google-handoff-fixture.js'),
], {
  env: {
    ...process.env,
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_AUTH_SECRET: secret,
    BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-client-secret',
    BOEKENBAAI_PUBLIC_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Student handoff fixture stopte vroeg: ${stderr.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Student handoff fixture start timeout: ${stderr.join('')}`);
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function extractCookieValue(setCookieHeader, name) {
  const match = String(setCookieHeader || '').match(new RegExp(`${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

(async () => {
  try {
    await waitForServer();

    const start = await fetch(
      `${baseUrl}/api/auth/google/start?type=student&accountId=student-1`
    );
    assert.strictEqual(start.status, 200);
    const startPayload = await start.json();
    const signedState = core.verifySignedState(startPayload.state, secret);
    assert.strictEqual(
      signedState?.accountId,
      'student-1',
      'OAuth-state moet de geselecteerde leerling cryptografisch meenemen'
    );

    const setCookie = start.headers.get('set-cookie') || '';
    assert.match(setCookie, /boekenbaai_google_selected_account=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const selectedCookie = extractCookieValue(
      setCookie,
      'boekenbaai_google_selected_account'
    );
    assert.ok(selectedCookie, 'Beveiligde leerlingselectiecookie ontbreekt');

    const selectedCookies =
      `boekenbaai_google_pending=${encodeURIComponent(pendingToken)}; ` +
      `boekenbaai_google_selected_account=${encodeURIComponent(selectedCookie)}`;

    const raceSwitch = await fetch(`${baseUrl}/api/auth/google/link-request`, {
      method: 'POST',
      headers: {
        Cookie: selectedCookies,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 'student-2' }),
    });
    assert.strictEqual(
      raceSwitch.status,
      409,
      'De oude handmatige route mag de ondertekende selectie niet vóór auto-koppeling omzeilen'
    );

    const auto = await fetch(`${baseUrl}/api/auth/google/auto-link-request`, {
      method: 'POST',
      headers: { Cookie: selectedCookies },
    });
    const autoPayload = await auto.json();
    assert.strictEqual(auto.status, 202);
    assert.strictEqual(autoPayload.automatic, true);
    assert.strictEqual(autoPayload.studentId, 'student-1');

    const store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(store.pendingIdentities[0].studentId, 'student-1');
    assert.strictEqual(store.linkRequests.length, 1);
    assert.strictEqual(store.linkRequests[0].studentId, 'student-1');
    assert.strictEqual(store.linkRequests[0].status, 'pending');

    const manualSwitch = await fetch(`${baseUrl}/api/auth/google/link-request`, {
      method: 'POST',
      headers: {
        Cookie: `boekenbaai_google_pending=${encodeURIComponent(pendingToken)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 'student-2' }),
    });
    assert.strictEqual(
      manualSwitch.status,
      409,
      'Een gebonden Google-identiteit mag niet via de oude route van leerling wisselen'
    );

    const mismatch = await fetch(
      `${baseUrl}/api/auth/google/callback?state=${encodeURIComponent(startPayload.state)}`,
      { redirect: 'manual' }
    );
    assert.strictEqual(mismatch.status, 302);
    assert.strictEqual(
      new URL(mismatch.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'account-mismatch',
      'Een Google-identiteit die al bij een ander account hoort moet worden gestopt'
    );
  } finally {
    await stop();
  }

  console.log('Student Google handoff tests geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
