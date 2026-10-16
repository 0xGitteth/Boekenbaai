'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { currentImportOwner, isImportOwnerConfirmedDead } = require('../book-import-owner');

const owner = currentImportOwner();
assert.equal(owner.host, os.hostname());
assert.equal(owner.pid, process.pid);
assert.equal(isImportOwnerConfirmedDead(owner), false);
assert.equal(isImportOwnerConfirmedDead(null), false);
assert.equal(isImportOwnerConfirmedDead({ ...owner, host: 'other-instance' }), false);
assert.equal(isImportOwnerConfirmedDead({ ...owner, pid: -1 }), false);

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
