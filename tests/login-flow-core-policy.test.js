'use strict';

const assert = require('assert');
const core = require('../google-auth-core');

const store = {
  version: 1,
  links: [
    {
      accountType: 'staff',
      accountId: 'teacher-1',
      email: 'docent@koraaledu.nl',
      sub: 'teacher-sub',
    },
    {
      accountType: 'staff',
      accountId: 'admin-1',
      email: 'beheer@koraaledu.nl',
      sub: 'admin-sub',
    },
  ],
  sessions: [],
  pendingIdentities: [],
  linkRequests: [],
};

core.setLocalOnlyStaffAccountIds(['admin-1']);

assert.strictEqual(
  core.findLinkByAccount(store, 'staff', 'admin-1'),
  null,
  'Een lokaal beheeraccount mag geen actieve Google-koppeling hebben'
);
assert.ok(core.findLinkByAccount(store, 'staff', 'teacher-1'));

assert.strictEqual(
  core.findLinkByIdentity(store, 'staff', {
    email: 'beheer@koraaledu.nl',
    sub: 'admin-sub',
  }),
  null,
  'Een oude admin-Google-identiteit mag niet kunnen inloggen'
);
assert.ok(
  core.findLinkByIdentity(store, 'staff', {
    email: 'docent@koraaledu.nl',
    sub: 'teacher-sub',
  })
);

assert.throws(
  () => core.upsertLink(store, {
    accountType: 'staff',
    accountId: 'admin-1',
    email: 'nieuwbeheer@koraaledu.nl',
    sub: '',
  }),
  (error) => error?.code === 'LOCAL_ONLY_ACCOUNT'
);

const teacherUpdate = core.upsertLink(store, {
  accountType: 'staff',
  accountId: 'teacher-1',
  email: 'docent@koraaledu.nl',
  sub: 'teacher-sub',
});
assert.strictEqual(teacherUpdate.link.accountId, 'teacher-1');

core.setLocalOnlyStaffAccountIds([]);
console.log('Local-only auth-core policytests geslaagd.');
