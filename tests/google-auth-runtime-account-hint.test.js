'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

assert.ok(
  source.includes("requestUrl.searchParams.get('accountId') || ''"),
  'Google start moet het geselecteerde account-id kunnen ontvangen'
);
assert.ok(
  source.includes("const account = findAccount(db, type === 'staff' ? 'staff' : 'student', accountId);"),
  'Account-id moet server-side tegen bestaande accounts worden opgelost'
);
assert.ok(
  source.includes('if (candidates.length !== 1 || !candidates[0]?.id) return'),
  'Login hint mag alleen bij één ondubbelzinnig account worden gebruikt'
);

console.log('Google account-id login hint guards geslaagd.');
