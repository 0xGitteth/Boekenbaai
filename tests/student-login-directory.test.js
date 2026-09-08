'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-student-login-directory-'));
const dbPath = path.join(tmp, 'db.json');
const port = 31441;
const baseUrl = `http://127.0.0.1:${port}`;

fs.writeFileSync(dbPath, JSON.stringify({
  books: [],
  students: [
    {
      id: 'student-active',
      name: 'Sanne Jansen',
      firstName: 'Sanne',
      lastName: 'Jansen',
      username: 'sanne',
      passwordHash: 'x',
      classIds: ['class-a'],
      borrowedBooks: [],
      active: true,
      parnassysStudentNumber: '12345',
    },
    {
      id: 'student-inactive',
      name: 'Oude Leerling',
      firstName: 'Oude',
      lastName: 'Leerling',
      username: 'oud',
      passwordHash: 'x',
      classIds: [],
      borrowedBooks: [],
      active: false,
      parnassysStudentNumber: '99999',
    },
  ],
  folders: [],
  classes: [
    { id: 'class-a', name: 'Structuurklas Bovenbouw', studentIds: ['student-active'], teacherIds: [] },
  ],
  users: [],
  history: [],
}, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'student-login-directory-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  path.join(root, 'server.js'),
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    BOEKENBAAI_PUBLIC_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte: ${stderr.join('')}`);
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

    const activeResponse = await fetch(`${baseUrl}/api/login-search?q=san&type=student`, {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        'X-Forwarded-For': '198.51.100.121',
      },
    });
    assert.strictEqual(activeResponse.status, 200);
    const active = await activeResponse.json();
    assert.strictEqual(active.matches.length, 1);
    assert.strictEqual(active.matches[0].id, 'student-active');
    assert.strictEqual(active.matches[0].name, 'Sanne J. · Structuurklas Bovenbouw');
    assert.strictEqual(active.matches[0].displayName, active.matches[0].name);
    assert.deepStrictEqual(
      Object.keys(active.matches[0]).sort(),
      ['displayName', 'id', 'name', 'type']
    );
    assert.strictEqual(Object.hasOwn(active.matches[0], 'parnassysStudentNumber'), false);
    assert.strictEqual(Object.hasOwn(active.matches[0], 'username'), false);

    const inactiveResponse = await fetch(`${baseUrl}/api/login-search?q=oude&type=student`, {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        'X-Forwarded-For': '198.51.100.122',
      },
    });
    assert.strictEqual(inactiveResponse.status, 200);
    const inactive = await inactiveResponse.json();
    assert.deepStrictEqual(inactive.matches, []);

    const staleSelection = await fetch(
      `${baseUrl}/api/auth/login-mode?type=student&accountId=student-inactive`
    );
    assert.strictEqual(staleSelection.status, 404);

    const page = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /student-management-compat\.js/);

    console.log('Leerling login-directory tests geslaagd.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  if (stderr.length) console.error(stderr.join(''));
  process.exitCode = 1;
});
