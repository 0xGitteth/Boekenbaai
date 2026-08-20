'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-auth-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
fs.writeFileSync(
  dbPath,
  JSON.stringify(
    {
      users: [{ id: 'teacher-1', role: 'teacher', name: 'Docent', classIds: [] }],
      students: [],
      classes: [],
    },
    null,
    2
  )
);
fs.writeFileSync(
  authPath,
  JSON.stringify(
    {
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
    },
    null,
    2
  )
);
const port = 31421;

function start(seed) {
  const child = spawn(
    process.execPath,
    [
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
        const response = await fetch(`http://127.0.0.1:${port}/`);
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

(async () => {
  let child = await start(true);
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /google-auth\.css/);
    assert.match(html, /google-auth\.js/);
    assert.match(html, /google-login-hint\.js/);

    const hintedStart = await fetch(
      `http://127.0.0.1:${port}/api/auth/google/start?type=staff&name=Docent`,
      { redirect: 'manual' }
    );
    assert.strictEqual(hintedStart.status, 302);
    const hintedLocation = new URL(hintedStart.headers.get('location'));
    assert.strictEqual(hintedLocation.searchParams.get('login_hint'), 'docent@koraaledu.nl');
    assert.strictEqual(hintedLocation.searchParams.has('prompt'), false);

    const unknownStart = await fetch(
      `http://127.0.0.1:${port}/api/auth/google/start?type=staff&name=Onbekend`,
      { redirect: 'manual' }
    );
    assert.strictEqual(unknownStart.status, 302);
    const unknownLocation = new URL(unknownStart.headers.get('location'));
    assert.strictEqual(unknownLocation.searchParams.has('login_hint'), false);
    assert.strictEqual(unknownLocation.searchParams.get('prompt'), 'select_account');

    const persist = await fetch(`http://127.0.0.1:${port}/api/auth/session/persist`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer legacy-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remember: true }),
    });
    assert.strictEqual(persist.status, 200);
    assert.match(persist.headers.get('set-cookie') || '', /boekenbaai_session=legacy-token/);
  } finally {
    await stop(child);
  }

  child = await start(false);
  try {
    const me = await fetch(`http://127.0.0.1:${port}/api/me`, {
      headers: { Authorization: 'Bearer legacy-token' },
    });
    assert.strictEqual(me.status, 200);
    const payload = await me.json();
    assert.strictEqual(payload.id, 'teacher-1');
  } finally {
    await stop(child);
  }

  console.log('Google-auth preload integratietest geslaagd.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});