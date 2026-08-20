'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

assert.ok(
  source.includes("if (bearer && bearer !== SESSION_SENTINEL)"),
  'Bestaande bearer-token login moet ondersteund blijven'
);
assert.ok(
  source.includes("if (req.method === 'POST' && requestUrl.pathname === '/api/logout')"),
  'Bestaande logout moet ook Google/persistente sessies intrekken'
);
assert.ok(
  source.includes("requestUrl.pathname.startsWith('/api/auth/session/')"),
  'Remember-me sessieroutes moeten door de runtime afgehandeld blijven'
);

console.log('Legacy auth compatibiliteitsguards geslaagd.');
