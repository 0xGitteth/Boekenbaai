'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');
assert.ok(!source.includes('refresh_token'), 'Boekenbaai hoort geen Google refresh tokens te verwerken of bewaren');
assert.ok(!source.includes("access_type', 'offline"), 'Boekenbaai hoort geen offline Google-toegang te vragen');
assert.ok(!source.includes("scope', 'openid email profile "), 'Boekenbaai hoort geen extra Google API-scopes te vragen');
console.log('Google minimale-scope guards geslaagd.');
