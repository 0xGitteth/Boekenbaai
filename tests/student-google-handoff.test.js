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

async function startSelection() {
  const tokenResponse = await fetch(
    `${baseUrl}/api/auth/google/start-token?type=student&accountId=student-1`
  );
  assert.strictEqual(tokenResponse.status, 200);
  const tokenPayload = await tokenResponse.json();
  const startIntent = core.verifySignedState(tokenPayload.token, secret, {
    maxAgeMs: 2 * 60 * 1000,
  });
  assert.strictEqual(startIntent?.purpose, 'google-start');
  assert.strictEqual(startIntent?.type, 'student');
  assert.strictEqual(startIntent?.accountId, 'student-1');

  const response = await fetch(
    `${baseUrl}/api/auth/google/start?type=student&accountId=student-1&handoffToken=${encodeURIComponent(tokenPayload.token)}`
  );
  assert.strictEqual(response.status, 200);
  const payload = await response.json();
  const oauthState = core.verifySignedState(payload.state, secret);
  assert.strictEqual(oauthState?.type, 'student', 'Fixture OAuth-state moet geldig blijven');

  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, /boekenbaai_google_selected_account=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const selectedCookie = extractCookieValue(setCookie, 'boekenbaai_google_selected_account');
  assert.ok(selectedCookie, 'Beveiligde leerlingselectiecookie ontbreekt');
  const selection = core.verifySignedState(selectedCookie, secret, {
    maxAgeMs: 15 * 60 * 1000,
  });
  assert.strictEqual(selection?.type, 'student');
  assert.strictEqual(
    selection?.accountId,
    'student-1',
    'De geselecteerde leerling moet cryptografisch in de HttpOnly handoff-cookie zitten'
  );
  return { payload, selectedCookie };
}

function cookiesForSelection(selectedCookie) {
  return (
    `boekenbaai_google_pending=${encodeURIComponent(pendingToken)}; ` +
    `boekenbaai_google_selected_account=${encodeURIComponent(selectedCookie)}`
  );
}

(async () => {
  try {
    await waitForServer();

    const untrustedStart = await fetch(
      `${baseUrl}/api/auth/google/start?type=student&accountId=student-1`
    );
    assert.strictEqual(
      untrustedStart.status,
      403,
      'Google-start zonder kortlevend same-origin handofftoken moet worden geblokkeerd'
    );
    assert.doesNotMatch(
      untrustedStart.headers.get('set-cookie') || '',
      /boekenbaai_google_selected_account=/,
      'Een geblokkeerde start mag geen leerlingselectiecookie zetten'
    );

    const first = await startSelection();
    const firstCookies = cookiesForSelection(first.selectedCookie);

    const raceSwitch = await fetch(`${baseUrl}/api/auth/google/link-request`, {
      method: 'POST',
      headers: {
        Cookie: firstCookies,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: 'student-2' }),
    });
    assert.strictEqual(
      raceSwitch.status,
      409,
      'De oude handmatige route mag de ondertekende selectie niet vóór auto-koppeling omzeilen'
    );

    // Een reeds geverifieerde koppeling met hetzelfde e-mailadres maar een andere
    // Google sub is geen geldige identiteit voor deze login. Maak dan niet eerst
    // een docentverzoek aan dat bij goedkeuren toch op een e-mailconflict strandt.
    let store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    store.links.push({
      accountType: 'student',
      accountId: 'student-2',
      email: 'leerling@koraaledu.nl',
      sub: 'andere-bestaande-sub',
      linkedBy: 'teacher-existing',
    });
    fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

    const reusedVerifiedEmail = await fetch(`${baseUrl}/api/auth/google/auto-link-request`, {
      method: 'POST',
      headers: { Cookie: firstCookies },
    });
    assert.strictEqual(reusedVerifiedEmail.status, 409);
    const reusedPayload = await reusedVerifiedEmail.json();
    assert.match(reusedPayload.message || '', /al aan een ander Boekenbaai-account gekoppeld/i);
    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(store.linkRequests.length, 0);
    assert.strictEqual(
      store.pendingIdentities[0].studentId,
      undefined,
      'Een geweigerde conflictcheck mag de pending identiteit niet half aan een leerling binden'
    );

    // Nieuwe echte login na het oplossen van dat conflict.
    store.links = store.links.filter((entry) => entry?.accountId !== 'student-2');
    fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

    const selected = await startSelection();
    const selectedCookies = cookiesForSelection(selected.selectedCookie);
    const auto = await fetch(`${baseUrl}/api/auth/google/auto-link-request`, {
      method: 'POST',
      headers: { Cookie: selectedCookies },
    });
    const autoPayload = await auto.json();
    assert.strictEqual(auto.status, 202);
    assert.strictEqual(autoPayload.automatic, true);
    assert.strictEqual(autoPayload.studentId, 'student-1');

    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
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

    // Leg vóór de callback een prelink voor het verkeerde account vast. De fixture
    // simuleert dat de runtime die link tijdens de callback van een sub voorziet.
    // De handoff moet zowel die wijziging als de fout aangemaakte sessie terugdraaien.
    store.links.push({
      accountType: 'student',
      accountId: 'student-2',
      email: 'gekoppeld@koraaledu.nl',
      sub: '',
      linkedBy: 'teacher-test',
    });
    fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

    const mismatch = await fetch(
      `${baseUrl}/api/auth/google/callback?state=${encodeURIComponent(selected.payload.state)}`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `boekenbaai_google_selected_account=${encodeURIComponent(selected.selectedCookie)}`,
        },
      }
    );
    assert.strictEqual(mismatch.status, 302);
    assert.strictEqual(
      new URL(mismatch.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'account-mismatch',
      'Een sessie voor een ander account moet vóór verzending worden ingetrokken'
    );
    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(
      store.sessions.some((entry) => entry?.userId === 'student-2'),
      false,
      'De fout aangemaakte persistente sessie moet direct uit de auth-store verdwijnen'
    );
    const restoredWrongLink = store.links.find(
      (entry) => entry?.accountType === 'student' && entry?.accountId === 'student-2'
    );
    assert.strictEqual(
      restoredWrongLink?.sub || '',
      '',
      'Een onbedoelde verificatie van de prelink van het verkeerde account moet worden teruggedraaid'
    );
    assert.strictEqual(restoredWrongLink?.linkedBy, 'teacher-test');

    // Dezelfde guard mag een correcte callback voor de geselecteerde leerling juist
    // niet aantasten.
    const correct = await startSelection();
    const correctCallback = await fetch(
      `${baseUrl}/api/auth/google/callback?as=student-1&state=${encodeURIComponent(correct.payload.state)}`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `boekenbaai_google_selected_account=${encodeURIComponent(correct.selectedCookie)}`,
        },
      }
    );
    assert.strictEqual(correctCallback.status, 302);
    assert.strictEqual(
      new URL(correctCallback.headers.get('location'), baseUrl).searchParams.get('googleAuth'),
      'success'
    );
    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(
      store.sessions.some((entry) => entry?.userId === 'student-1'),
      true,
      'Een correcte sessie voor de geselecteerde leerling moet blijven bestaan'
    );

    // Een docent kan een verzoek per ongeluk afwijzen. Een nieuwe Google-login moet
    // daarna opnieuw een verzoek mogen maken in plaats van permanent vast te lopen.
    store.linkRequests[0].status = 'denied';
    store.linkRequests[0].updatedAt = new Date().toISOString();
    delete store.pendingIdentities[0].studentId;
    fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

    const retry = await startSelection();
    const retryCookies = cookiesForSelection(retry.selectedCookie);

    const pendingBeforeRetry = await fetch(`${baseUrl}/api/auth/google/pending`, {
      headers: { Cookie: retryCookies },
    });
    assert.strictEqual(pendingBeforeRetry.status, 200);
    const pendingPayload = await pendingBeforeRetry.json();
    assert.strictEqual(
      pendingPayload.requestStatus,
      'not-requested',
      'Een verse beveiligde selectie moet een oude afwijzing niet als definitieve status overnemen'
    );

    const retryAuto = await fetch(`${baseUrl}/api/auth/google/auto-link-request`, {
      method: 'POST',
      headers: { Cookie: retryCookies },
    });
    assert.strictEqual(retryAuto.status, 202);
    const retryPayload = await retryAuto.json();
    assert.strictEqual(retryPayload.status, 'pending');

    store = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(store.linkRequests.length, 2);
    assert.strictEqual(store.linkRequests[0].status, 'denied');
    assert.strictEqual(store.linkRequests[1].status, 'pending');
    assert.strictEqual(store.linkRequests[1].studentId, 'student-1');
  } finally {
    await stop();
  }

  console.log('Student Google handoff tests geslaagd.');
})().catch(async (error) => {
  console.error(error);
  await stop();
  process.exit(1);
});
