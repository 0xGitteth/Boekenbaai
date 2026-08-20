'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-auth-'));
const dbPath = path.join(tmp, 'db.json');
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
const port = 31421;

function start(seed) {
  const child = spawn(
    process.execPath,
    [
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
        BOEKENBAAI_AUTH_DATA_PATH: `${dbPath}.auth.json`,
        BOEKENBAAI_GOOGLE_CLIENT_ID: 'test-client',
        BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-secret',
        BOEKENBAAI_AUTH_SECRET: 'test-auth-secret',
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
