'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const {
  currentImportOwner, isImportOwnerConfirmedDead, sameImportOwner,
  isImportLeaseActive, IMPORT_LEASE_MS,
} = require('../book-import-owner');

const owner = currentImportOwner();
assert.equal(owner.host, os.hostname());
assert.equal(owner.pid, process.pid);
assert.equal(isImportOwnerConfirmedDead(owner), false);
assert.equal(isImportOwnerConfirmedDead(null), false);
assert.equal(isImportOwnerConfirmedDead({ ...owner, host: 'other-instance' }), false);
assert.equal(isImportOwnerConfirmedDead({ ...owner, pid: -1 }), false);

assert.ok(owner.instanceId);
assert.equal(isImportLeaseActive(owner), true);
assert.equal(sameImportOwner(owner, currentImportOwner()), true);
assert.equal(sameImportOwner(owner, { ...owner, instanceId: 'other' }), false);
assert.equal(isImportOwnerConfirmedDead({
  ...owner, host: 'old-container', leaseExpiresAt: Date.now() + 10000,
}), false);
assert.equal(isImportOwnerConfirmedDead({
  ...owner, host: 'old-container', leaseExpiresAt: Date.now() - 1,
}), true, 'Expired lease must be recoverable when hostname changes');
assert.equal(isImportOwnerConfirmedDead({
  ...owner, pid: process.pid, leaseExpiresAt: Date.now() - 1,
}), true, 'PID reuse cannot hide an expired lease');
assert.equal(isImportOwnerConfirmedDead(null, {
  lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
}), true, 'Legacy ownerless import must not remain stuck forever');
assert.equal(isImportOwnerConfirmedDead(null, {
  lastSeenAt: new Date().toISOString(),
}), false, 'Fresh unowned imports must be protected');
assert.ok(IMPORT_LEASE_MS >= 60000);

const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
assert.equal(deadProcess.status, 0);
assert.ok(deadProcess.pid > 0);
assert.equal(isImportOwnerConfirmedDead({ ...owner, pid: deadProcess.pid }), true);
assert.equal(isImportOwnerConfirmedDead(owner, {
  kill: () => { throw Object.assign(Error('permission'), { code: 'EPERM' }); },
}), false);
assert.equal(isImportOwnerConfirmedDead(owner, {
  kill: () => { throw Object.assign(Error('gone'), { code: 'ESRCH' }); },
}), true);
console.log('Only proven dead local import owners are interrupted');
