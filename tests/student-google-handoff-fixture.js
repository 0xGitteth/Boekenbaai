'use strict';

const http = require('http');
const { URL } = require('url');
const core = require('../google-auth-core');

const port = Number(process.env.PORT || 31441);
const secret = process.env.BOEKENBAAI_AUTH_SECRET || 'handoff-test-secret';

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
    const store = core.emptyAuthStore();
    store.links.push({
      accountType: 'student',
      accountId: 'student-2',
      email: 'gekoppeld@koraaledu.nl',
      sub: 'gekoppeld-sub',
    });
    try {
      core.findLinkByIdentity(store, 'student', {
        email: 'gekoppeld@koraaledu.nl',
        sub: 'gekoppeld-sub',
      });
      res.statusCode = 302;
      res.setHeader('Location', '/index.html?googleAuth=success');
      return res.end();
    } catch (error) {
      res.statusCode = 302;
      res.setHeader('Location', '/index.html?googleAuth=oauth-error');
      return res.end();
    }
  }

  if (requestUrl.pathname === '/api/auth/google/link-request') {
    res.statusCode = 418;
    return res.end('delegated');
  }

  res.statusCode = 404;
  return res.end('not found');
}).listen(port, '127.0.0.1');
