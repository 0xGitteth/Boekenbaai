'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../google-auth-core');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

(function testVerifiedIdentityNeverFallsBackToEmail() {
  let store = core.emptyAuthStore();
  store = core.upsertLink(store, {
    accountType: 'student',
    accountId: 'student-1',
    email: 'leerling@koraaledu.nl',
    sub: 'oude-sub',
  }).store;

  assert.strictEqual(
    core.findLinkByIdentity(store, 'student', {
      email: 'leerling@koraaledu.nl',
      sub: 'nieuwe-sub',
    }),
    null,
    'Een andere sub met hetzelfde hergebruikte e-mailadres mag niet koppelen'
  );
})();

(function testUnverifiedPrelinkMayUseEmailOnce() {
  let store = core.emptyAuthStore();
  store = core.upsertLink(store, {
    accountType: 'student',
    accountId: 'student-1',
    email: 'leerling@koraaledu.nl',
    sub: '',
  }).store;

  const link = core.findLinkByIdentity(store, 'student', {
    email: 'leerling@koraaledu.nl',
    sub: 'eerste-google-sub',
  });
  assert.strictEqual(link?.accountId, 'student-1');
  assert.strictEqual(link?.sub, '');
})();

assert.ok(
  runtimeSource.includes("entry.status = 'superseded'"),
  'Nieuwe aanvraag moet een ouder openstaand verzoek superseden'
);
assert.ok(
  runtimeSource.includes("request.status !== 'approved'"),
  'Pending completion moet expliciet een goedgekeurd verzoek vereisen'
);
assert.ok(
  runtimeSource.includes('verifiedLinkConflicts(existing, request.email, request.sub)'),
  'Docentgoedkeuring moet een bestaande geverifieerde koppeling beschermen'
);

console.log('Google account-koppelflowtests geslaagd.');
