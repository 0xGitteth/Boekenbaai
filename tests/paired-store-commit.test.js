'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commitPairedJson,
  recoverPairedJson,
  journalPathFor,
  __test,
} = require('../paired-store-commit');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-paired-store-'));
const dataPath = path.join(tmp, 'db.json');
const authPath = path.join(tmp, 'auth.json');
const journalPath = journalPathFor(dataPath);

try {
  fs.writeFileSync(dataPath, JSON.stringify({ version: 'old-db' }));
  fs.writeFileSync(authPath, JSON.stringify({ version: 'old-auth' }));

  const committedData = { version: 'new-db', students: [{ id: 'student-1' }] };
  const committedAuth = { version: 'new-auth', sessions: [], links: [] };
  commitPairedJson({ dataPath, authPath, data: committedData, auth: committedAuth });

  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')), committedData);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), committedAuth);
  assert.strictEqual(fs.existsSync(journalPath), false, 'Na een volledige paired commit mag geen journal achterblijven');

  const recoveredData = { version: 'recovered-db', students: [{ id: 'student-2' }] };
  const recoveredAuth = { version: 'recovered-auth', sessions: [{ userId: 'student-2' }], links: [] };

  // Simuleer een procescrash nadat db.json al vervangen is maar vóór auth.json.
  __test.atomicWriteJson(journalPath, {
    version: 1,
    createdAt: new Date().toISOString(),
    data: recoveredData,
    auth: recoveredAuth,
  });
  __test.atomicWriteJson(dataPath, recoveredData);
  __test.atomicWriteJson(authPath, committedAuth);

  assert.notDeepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), recoveredAuth);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')), recoveredData);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), recoveredAuth);
  assert.strictEqual(fs.existsSync(journalPath), false, 'Herstel moet het journal pas na beide writes verwijderen');
  assert.strictEqual(recoverPairedJson({ dataPath, authPath }), false, 'Zonder journal is herstel een no-op');

  const managementSource = fs.readFileSync(path.join(__dirname, '..', 'student-management-preload.js'), 'utf8');
  const deactivateMatch = managementSource.match(/function deactivateStudent[\s\S]*?function stripCookie/);
  assert.ok(deactivateMatch, 'De deactivatieroute moet vindbaar blijven voor de atomiciteitsregressie');
  assert.match(
    deactivateMatch[0],
    /commitPairedJson\(\{[\s\S]*dataPath:\s*DATA_PATH[\s\S]*authPath:\s*AUTH_DATA_PATH/,
    'Leerling afmelden moet database en auth-store via één herstelbare paired commit opslaan'
  );
  assert.doesNotMatch(
    deactivateMatch[0],
    /writeJsonAtomic\(DATA_PATH,[\s\S]*saveAuthStore\(/,
    'Leerling afmelden mag database en auth-store niet meer als losse writes opslaan'
  );

  console.log('Paired store commit tests geslaagd.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
