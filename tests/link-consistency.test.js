'use strict';

const assert = require('assert');
const { supersedeChangedAccountRequests } = require('../link-consistency-preload').__test;

(function testStudentPendingRequestIsSupersededAfterManualEmailChange() {
  const before = {
    links: [{ accountType: 'student', accountId: 's1', email: 'old@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [], linkRequests: [],
  };
  const after = {
    links: [{ accountType: 'student', accountId: 's1', email: 'new@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [],
    linkRequests: [{ id: 'r1', studentId: 's1', email: 'wrong@koraaledu.nl', status: 'pending' }],
  };
  assert.strictEqual(supersedeChangedAccountRequests(before, after), true);
  assert.strictEqual(after.linkRequests[0].status, 'superseded');
})();

(function testUnchangedEmailLeavesRequestAlone() {
  const before = {
    links: [{ accountType: 'staff', accountId: 't1', email: 'same@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [], linkRequests: [],
  };
  const after = {
    links: [{ accountType: 'staff', accountId: 't1', email: 'same@koraaledu.nl', sub: 'verified' }],
    sessions: [], pendingIdentities: [],
    linkRequests: [{ id: 'r2', staffId: 't1', email: 'same@koraaledu.nl', status: 'pending' }],
  };
  assert.strictEqual(supersedeChangedAccountRequests(before, after), false);
  assert.strictEqual(after.linkRequests[0].status, 'pending');
})();

console.log('Google link consistency tests geslaagd.');
