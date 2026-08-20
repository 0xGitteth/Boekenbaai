'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

assert.ok(
  source.includes("return new URL(CONFIGURED_PUBLIC_URL).protocol === 'https:'"),
  'Geconfigureerde HTTPS public URL moet Secure cookies afdwingen'
);
assert.ok(
  source.includes("httpOnly: true,\n    secure,\n    sameSite: 'Lax'"),
  'Sessietoken moet HttpOnly en SameSite gebruiken'
);
assert.ok(
  source.includes("secure: useSecureCookies(req)"),
  'OAuth/pending cookies moeten dezelfde productie-HTTPS detectie gebruiken'
);

console.log('Google-auth cookie security guards geslaagd.');
