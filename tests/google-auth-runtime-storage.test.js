'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(__dirname, 'preload-fixture.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-auth-corrupt-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31422;

fs.writeFileSync(dbPath, JSON.stringify({
  users: [{ id: 'teacher-1', role: 'teacher', name: 'Docent', passwordHash: 'hash' }],
  students: [],
  classes: [],
}, null, 2));
fs.writeFileSync(authPath, '{kapot-json');

const child = spawn(process.execPath, [
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
  fixturePath,
], {
  env: {
    ...process.env,
    PORT: String(port),
    BOEKENBAAI_SERVER_ENTRY: fixturePath,
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_GOOGLE_CLIENT_ID: 'test-client',
    BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-secret',
    BOEKENBAAI_AUTH_SECRET: 'test-auth-secret',
    BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
    BOEKENBAAI_PUBLIC_URL: `http://127.0.0.1:${port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Server start timeout');
}

(async () => {
  try {
    await waitForServer();
    const before = fs.readFileSync(authPath, 'utf8');
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/session/status`);
    assert.strictEqual(response.status, 503, 'Corrupte authopslag moet fail-closed reageren');
    assert.strictEqual(fs.readFileSync(authPath, 'utf8'), before, 'Corrupte authopslag mag niet worden overschreven');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  console.log('Google-auth storage fail-closed test geslaagd.');
})().catch((error) => {
  console.error(error);
  child.kill('SIGTERM');
  process.exit(1);
});
