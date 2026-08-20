'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const fixturePath = path.join(__dirname, 'preload-fixture.js');
const port = 31421;
const baseUrl = `http://127.0.0.1:${port}`;

function writeDb(passwordHash = 'hash-1') {
  fs.writeFileSync(
    dbPath,
    JSON.stringify(
      {
        users: [
          {
            id: 'teacher-1',
            role: 'teacher',
            name: 'Docent',
            classIds: [],
            passwordHash,
            mustChangePassword: true,
          },
        ],
        students: [],
        classes: [],
      },
      null,
      2
    )
  );
}

function emptyStore() {
  return {
    version: 1,
    links: [
      {
        accountType: 'staff',
        accountId: 'teacher-1',
        email: 'docent@koraaledu.nl',
        sub: '',
        linkedBy: 'test',
      },
    ],
    sessions: [],
    pendingIdentities: [],
    linkRequests: [],
  };
}

writeDb();
fs.writeFileSync(authPath, JSON.stringify(emptyStore(), null, 2));

function start(seed, { googleTestIdentity = false } = {}) {
  const child = spawn(
    process.execPath,
    [
      '--require',
      path.join(root, 'google-auth-security-preload.js'),
      '--require',
      path.join(root, 'google-auth-runtime-preload.js'),
      fixturePath,
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        SEED_LEGACY: seed ? '1' : '0',
        GOOGLE_TEST_IDENTITY: googleTestIdentity ? '1' : '0',
        BOEKENBAAI_SERVER_ENTRY: fixturePath,
        BOEKENBAAI_DATA_PATH: dbPath,
        BOEKENBAAI_AUTH_DATA_PATH: authPath,
        BOEKENBAAI_GOOGLE_CLIENT_ID: 'test-client',
        BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-secret',
        BOEKENBAAI_AUTH_SECRET: 'test-auth-secret',
        BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
        BOEKENBAAI_PUBLIC_URL: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return new Promise((resolve, reject) => {
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    const timer = setTimeout(
      () => reject(new Error(`fixture start timeout: ${stderr.join('')}`)),
      3000
    );
    child.on('error', reject);
    child.stdout.on('data', () => {});
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`fixture exited ${code}: ${stderr.join('')}`));
    });
    const check = async () => {
      try {
        const response = await fetch(`${baseUrl}/`);
        if (response.ok) {
          clearTimeout(timer);
          resolve(child);
          return;
        }
      } catch (error) {
        // Server is nog aan het starten.
      }
      setTimeout(check, 40);
    };
    check();
  });
}

async function stop(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function sessionCookie(token) {
  return `boekenbaai_session=${encodeURIComponent(token)}; boekenbaai_auth_hint=1`;
}

function cookieValue(setCookieHeader, name) {
  const match = String(setCookieHeader || '').match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

(async () => {
  let child = await start(true, { googleTestIdentity: true });
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    assert.match(html, /google-auth\.css/);
    assert.match(html, /google-auth\.js/);
    assert.match(html, /google-login-hint\.js/);

    const hintedStart = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&name=Docent`,
      { redirect: 'manual' }
    );
    assert.strictEqual(hintedStart.status, 302);
    const hintedLocation = new URL(hintedStart.headers.get('location'));
    assert.strictEqual(hintedLocation.searchParams.get('login_hint'), 'docent@koraaledu.nl');
    assert.strictEqual(hintedLocation.searchParams.has('prompt'), false);

    const oauthNonce = cookieValue(hintedStart.headers.get('set-cookie'), 'boekenbaai_oauth_nonce');
    const oauthState = hintedLocation.searchParams.get('state');
    assert.ok(oauthNonce, 'OAuth nonce-cookie ontbreekt');
    assert.ok(oauthState, 'OAuth state ontbreekt');

    const callback = await fetch(
      `${baseUrl}/api/auth/google/callback?code=fixture-code&state=${encodeURIComponent(oauthState)}`,
      {
        redirect: 'manual',
        headers: { Cookie: `boekenbaai_oauth_nonce=${encodeURIComponent(oauthNonce)}` },
      }
    );
    assert.strictEqual(callback.status, 302);
    assert.strictEqual(callback.headers.get('location'), '/staff.html?googleAuth=success');
    const callbackCookies = callback.headers.get('set-cookie') || '';
    const googleSessionToken = cookieValue(callbackCookies, 'boekenbaai_session');
    assert.ok(googleSessionToken, 'Google callback zette geen sessiecookie');

    const afterCallbackStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const linkedStaff = afterCallbackStore.links.find((entry) => entry.accountId === 'teacher-1');
    assert.strictEqual(linkedStaff.sub, 'fixture-google-sub');
    const callbackSession = afterCallbackStore.sessions.find(
      (entry) => entry.tokenHash === crypto.createHash('sha256').update(googleSessionToken).digest('hex')
    );
    assert.ok(callbackSession, 'Google callback sloeg de sessie niet persistent op');
    assert.strictEqual(callbackSession.authMethod, 'google');

    const callbackMe = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie(googleSessionToken),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(callbackMe.status, 200);
    const callbackMePayload = await callbackMe.json();
    assert.strictEqual(callbackMePayload.id, 'teacher-1');
    assert.strictEqual(callbackMePayload.mustChangePassword, false);

    const unknownStart = await fetch(
      `${baseUrl}/api/auth/google/start?type=staff&name=Onbekend`,
      { redirect: 'manual' }
    );
    assert.strictEqual(unknownStart.status, 302);
    const unknownLocation = new URL(unknownStart.headers.get('location'));
    assert.strictEqual(unknownLocation.searchParams.has('login_hint'), false);
    assert.strictEqual(unknownLocation.searchParams.get('prompt'), 'select_account');

    const persist = await fetch(`${baseUrl}/api/auth/session/persist`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer legacy-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remember: true }),
    });
    assert.strictEqual(persist.status, 200);
    assert.match(persist.headers.get('set-cookie') || '', /boekenbaai_session=legacy-token/);

    const persistedStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const legacySession = persistedStore.sessions.find(
      (entry) => entry.tokenHash === crypto.createHash('sha256').update('legacy-token').digest('hex')
    );
    assert.ok(legacySession, 'Persistente legacy-sessie ontbreekt');
    assert.strictEqual(legacySession.authMethod, 'password');
    assert.match(legacySession.accountFingerprint || '', /^[a-f0-9]{64}$/);

    const legitimateMutation = await fetch(`${baseUrl}/api/auth/session/persist`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie('legacy-token'),
        Authorization: 'Bearer cookie',
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remember: true }),
    });
    assert.strictEqual(legitimateMutation.status, 200);

    const csrf = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie('legacy-token'),
        Origin: 'http://kwaadaardig.sliplane.app',
        'Sec-Fetch-Site': 'same-site',
      },
    });
    assert.strictEqual(csrf.status, 403);

    const sameOriginMe = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie('legacy-token'),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(sameOriginMe.status, 200);
    assert.strictEqual((await sameOriginMe.json()).id, 'teacher-1');
  } finally {
    await stop(child);
  }

  child = await start(false);
  try {
    const me = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie('legacy-token'),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(me.status, 200);
    assert.strictEqual((await me.json()).id, 'teacher-1');

    const expiredStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const legacyHash = crypto.createHash('sha256').update('legacy-token').digest('hex');
    const legacy = expiredStore.sessions.find((entry) => entry.tokenHash === legacyHash);
    legacy.expiresAt = Date.now() - 1;
    fs.writeFileSync(authPath, JSON.stringify(expiredStore, null, 2));

    const expired = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie('legacy-token'),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(expired.status, 401);
  } finally {
    await stop(child);
  }

  const googleToken = 'google-session-token';
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const googleStore = emptyStore();
  googleStore.sessions.push({
    tokenHash: crypto.createHash('sha256').update(googleToken).digest('hex'),
    userId: 'teacher-1',
    type: 'staff',
    remember: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    authMethod: 'google',
    accountFingerprint: accountCredentialFingerprint(db.users[0]),
  });
  fs.writeFileSync(authPath, JSON.stringify(googleStore, null, 2));

  child = await start(false);
  try {
    const googleMe = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie(googleToken),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(googleMe.status, 200);
    const payload = await googleMe.json();
    assert.strictEqual(payload.id, 'teacher-1');
    assert.strictEqual(payload.mustChangePassword, false);
  } finally {
    await stop(child);
  }

  writeDb('hash-after-reset');
  child = await start(false);
  try {
    const revoked = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: sessionCookie(googleToken),
        Authorization: 'Bearer cookie',
      },
    });
    assert.strictEqual(revoked.status, 401);
  } finally {
    await stop(child);
  }

  console.log('Google-auth runtime integratietest geslaagd.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
