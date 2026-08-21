'use strict';

const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const core = require('../google-auth-core');

const port = Number(process.env.PORT || 31441);
const secret = process.env.BOEKENBAAI_AUTH_SECRET || 'handoff-test-secret';
const authPath = process.env.BOEKENBAAI_AUTH_DATA_PATH;

function readStore() {
  if (!authPath || !fs.existsSync(authPath)) return core.emptyAuthStore();
  return core.normalizeStore(JSON.parse(fs.readFileSync(authPath, 'utf8')));
}

function writeStore(store) {
  fs.writeFileSync(authPath, JSON.stringify(core.normalizeStore(store), null, 2));
}

http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);

  if (requestUrl.pathname === '/health') {
    res.statusCode = 200;
    return res.end('ok');
  }

  if (requestUrl.pathname === '/api/auth/google/start') {
    const type = requestUrl.searchParams.get('type') === 'staff' ? 'staff' : 'student';
    const state = core.createSignedState(
      { type, nonce: 'fixture-nonce', iat: Date.now() },
      secret
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ state }));
  }

  if (requestUrl.pathname === '/api/auth/google/callback') {
    const token = requestUrl.searchParams.get('as') === 'student-1'
      ? 'fixture-correct-session-token'
      : 'fixture-session-token';
    const sessionUserId = requestUrl.searchParams.get('as') === 'student-1'
      ? 'student-1'
      : 'student-2';
    let store = readStore();

    if (sessionUserId === 'student-2') {
      // Simuleer precies het risicopad van de echte runtime: een bestaand, nog
      // niet geverifieerd e-mailadres van een ander account krijgt tijdens de
      // callback een Google sub en dat andere account krijgt een sessie.
      const wrongPrelink = core.findLinkByAccount(store, 'student', 'student-2');
      if (wrongPrelink && !wrongPrelink.sub) {
        wrongPrelink.sub = 'gekoppeld-sub';
        wrongPrelink.linkedBy = wrongPrelink.linkedBy || 'google-login';
      }
    }

    const result = core.upsertSession(store, token, {
      userId: sessionUserId,
      type: 'student',
      remember: false,
      now: Date.now(),
    });
    writeStore(result.store);
    res.statusCode = 302;
    res.setHeader('Set-Cookie', [
      `boekenbaai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
      'boekenbaai_auth_hint=1; Path=/; SameSite=Lax',
    ]);
    res.setHeader('Location', '/index.html?googleAuth=success');
    return res.end();
  }

  if (requestUrl.pathname === '/api/auth/google/pending') {
    res.statusCode = 418;
    return res.end('delegated-pending');
  }

  if (requestUrl.pathname === '/api/auth/google/link-request') {
    res.statusCode = 418;
    return res.end('delegated');
  }

  res.statusCode = 404;
  return res.end('not found');
}).listen(port, '127.0.0.1');
