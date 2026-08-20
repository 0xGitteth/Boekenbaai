'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

assert.ok(
  source.includes("const GOOGLE_CLIENT_ID = process.env.BOEKENBAAI_GOOGLE_CLIENT_ID"),
  'Client-id configuratie ontbreekt'
);
assert.ok(
  source.includes("const GOOGLE_CLIENT_SECRET = process.env.BOEKENBAAI_GOOGLE_CLIENT_SECRET"),
  'Client-secret configuratie ontbreekt'
);
assert.ok(
  source.includes("process.env.BOEKENBAAI_GOOGLE_DOMAIN || 'koraaledu.nl'"),
  'Schooldomein configuratie ontbreekt'
);
assert.ok(
  source.includes("signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(7000) : undefined"),
  'Google token exchange heeft geen timeout'
);
assert.ok(
  source.includes("authorize.searchParams.set('scope', 'openid email profile')"),
  'OAuth scopes wijken af van minimale login-scopes'
);
assert.ok(
  !source.includes('access_type'),
  'Boekenbaai hoort geen offline access/refresh token te vragen'
);

console.log('Google-auth runtime configuratietests geslaagd.');
