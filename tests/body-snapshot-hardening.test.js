'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-body-snapshot-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const teacherToken = 'body-snapshot-teacher-token';
const teacher = {
  id: 'teacher-1',
  role: 'teacher',
  name: 'Mentor Test',
  username: 'mentor.test',
  passwordHash: 'technical-hash',
  active: true,
  mustChangePassword: false,
};
const db = {
  books: [],
  students: [],
  users: [teacher],
  classes: [],
  history: [],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
let store = core.upsertSession(core.emptyAuthStore(), teacherToken, {
  userId: teacher.id,
  type: 'staff',
  remember: true,
  now: Date.now(),
}).store;
const storedSession = store.sessions.find((entry) => entry.tokenHash === core.tokenHash(teacherToken));
storedSession.accountFingerprint = accountCredentialFingerprint(teacher);
storedSession.authMethod = 'google';
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

process.env.BOEKENBAAI_DATA_PATH = dbPath;
process.env.BOEKENBAAI_AUTH_DATA_PATH = authPath;
require('../release-hardening-preload');

let value = 0;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => resolve(JSON.parse(body || '{}')));
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/mentor/students') {
    res.statusCode = 404;
    res.end();
    return;
  }
  const snapshot = value;
  parseBody(req).then(() => {
    value = snapshot + 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ value }));
  }).catch((error) => {
    res.statusCode = 500;
    res.end(error.message);
  });
});

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function authorizedStream(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/mentor/students',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `boekenbaai_session=${encodeURIComponent(teacherToken)}`,
      },
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk.toString(); });
      response.on('end', () => resolve({ status: response.statusCode, raw }));
    });
    request.on('error', reject);
    request.write('{"name":"');
    setTimeout(() => {
      value = 10;
      request.end('Sanne"}');
    }, 30);
  });
}

function unauthenticatedWithoutBody(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/mentor/students',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk.toString(); });
      response.on('end', () => {
        clearTimeout(timer);
        request.destroy();
        resolve({ status: response.statusCode, raw });
      });
    });
    request.on('error', (error) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error('Ongeauthenticeerd verzoek werd niet vóór de body afgewezen'));
    }, 750);
    request.flushHeaders();
  });
}

(async () => {
  try {
    await listen();
    const port = server.address().port;

    const authorized = await authorizedStream(port);
    assert.strictEqual(authorized.status, 200);
    assert.strictEqual(JSON.parse(authorized.raw).value, 11);
    assert.strictEqual(value, 11, 'Listener moet pas na de volledig ontvangen body een state-snapshot nemen');

    const unauthenticated = await unauthenticatedWithoutBody(port);
    assert.strictEqual(unauthenticated.status, 401);
    assert.match(unauthenticated.raw, /Log eerst in|Sessie/);

    console.log('Streamed body snapshot en pre-auth buffering hardening tests geslaagd.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
