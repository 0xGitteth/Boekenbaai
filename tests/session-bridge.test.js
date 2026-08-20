'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installSessionBridge } = require('../google-session-bridge');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-session-bridge-'));
const fixturePath = path.join(tmp, 'fixture.js');
fs.writeFileSync(
  fixturePath,
  [
    "'use strict';",
    'const firstMap = new Map();',
    'const secondUnrelatedMap = new Map();',
    'const sessions = new Map();',
    'const afterSessionsMap = new Map();',
    'module.exports = { firstMap, secondUnrelatedMap, sessions, afterSessionsMap };',
  ].join('\n')
);

const bridge = installSessionBridge({ target: fixturePath });
const fixture = require(fixturePath);
assert.strictEqual(bridge.wasTransformed(), true);
assert.strictEqual(fixture.sessions, bridge.sessions);
assert.notStrictEqual(fixture.firstMap, bridge.sessions);
assert.notStrictEqual(fixture.secondUnrelatedMap, bridge.sessions);
assert.notStrictEqual(fixture.afterSessionsMap, bridge.sessions);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(globalThis, '__BOEKENBAAI_SESSIONS'),
  false,
  'Globale sessiereferentie moet na laden opgeruimd zijn'
);
bridge.sessions.set('test-token', { userId: 'user-1' });
assert.deepStrictEqual(fixture.sessions.get('test-token'), { userId: 'user-1' });
bridge.restore();

const brokenPath = path.join(tmp, 'broken.js');
fs.writeFileSync(brokenPath, "'use strict';\nconst somethingElse = new Map();\n");
const brokenBridge = installSessionBridge({ target: brokenPath });
assert.throws(() => require(brokenPath), /verwacht exact één sessiedeclaratie/);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(globalThis, '__BOEKENBAAI_SESSIONS'),
  false,
  'Globale sessiereferentie moet ook na een mislukte transformatie opgeruimd zijn'
);
brokenBridge.restore();

console.log('Sessiebrugtests geslaagd.');
