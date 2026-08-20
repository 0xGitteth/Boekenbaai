'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
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

function start(seed) {
  const child = spawn(
    process.execPath,
    [
      '--require',
      path.join(root, 'google-auth-security-preload.js'),
      '--require',
      path.join(root, 'google-login-hint-preload.js'),
      '--require',
      path.join(root, 'google-auth-preload.js'),
      path.join(__dirname, 'preload-fixture.js'),
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        SEED_LEGACY: seed ? '1' : '0',
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
    const timer = setTimeout(() => reject(new Error('fixture start timeout')), 3000);
    child.on('error', reject);
    child.stdout.on('data', () => {});
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

(async () => {
  let child = await start(true);
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
    assert.strictEqual(persistedStore.sessions.length, 1);
    assert.strictEqual(persistedStore.sessions[0].authMethod, 'password');
    assert.match(persistedStore.sessions[0].accountFingerprint || '', /^[a-f0-9]{64}$/);

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
    expiredStore.sessions[0].expiresAt = Date.now() - 1;
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
    tokenHash: require('crypto').createHash('sha256').update(googleToken).digest('hex'),
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

  console.log('Google-auth preload integratietest geslaagd.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});