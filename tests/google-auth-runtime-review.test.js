'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

assert.ok(runtime.includes("authorize.searchParams.set('nonce', nonce);"), 'OIDC nonce ontbreekt in Google authorize-request');
assert.ok(runtime.includes('verifyGoogleIdentity(idToken, state.nonce)'), 'Callback bindt ID-token niet aan OAuth nonce');
assert.ok(runtime.includes("requestUrl.searchParams.get('accountId') || ''"), 'Account-id loginhint ondersteuning ontbreekt');
assert.ok(runtime.includes('verifiedLinkConflicts(existing, pending.email, pending.sub)'), 'Koppelrequest beschermt geverifieerde sub niet');
assert.ok(runtime.includes("entry.status = 'superseded'"), 'Oud openstaand koppelverzoek wordt niet superseded');
assert.ok(!runtime.includes("authorize.searchParams.set('prompt', 'select_account');\n    return"), 'Prompt mag alleen zonder login hint gezet worden');
assert.ok(!packageJson.scripts.start.includes('google-auth-preload.js'), 'Oude Google auth preload staat nog in startscript');
assert.ok(!packageJson.scripts.start.includes('google-login-hint-preload.js'), 'Oude login-hint preload staat nog in startscript');
assert.ok(packageJson.scripts.start.includes('google-auth-runtime-preload.js'), 'Nieuwe Google auth runtime ontbreekt in startscript');

console.log('Google-auth runtime reviewguards geslaagd.');
