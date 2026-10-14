'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planCoverBackfill } = require('../lib/cover-backfill-plan');

const source = 'https://covers.example.org/a.png';
const newSource = 'https://covers.example.org/b.png';
const local = '/api/covers/' + 'a'.repeat(64) + '.png';
const existing = (url) => url === local;

const expired = new Map([[source, { attempts: 1, nextRetryAt: 500 }]]);
assert.deepEqual(planCoverBackfill([], { hasAsset: existing, failures: expired, now: 1000 }), []);
assert.equal(expired.size, 0, 'Old retry must be pruned when no book references the URL');

const changed = new Map([[source, { attempts: 1, nextRetryAt: 500 }]]);
assert.deepEqual(planCoverBackfill([
  { coverUrl: newSource, localCoverUrl: '' },
], { hasAsset: existing, failures: changed, now: 1000 }), [
  { source: newSource, localAsset: '' },
]);
assert.equal(changed.size, 0, 'Replaced URL must never re-enter the retry scheduler');

const covered = new Map([[source, { attempts: 2, nextRetryAt: 500 }]]);
assert.deepEqual(planCoverBackfill([
  { coverUrl: source, localCoverUrl: local },
], { hasAsset: existing, failures: covered, now: 1000 }), []);
assert.equal(covered.size, 0, 'A fully cached URL must clear past failures');

const cooling = new Map([[source, { attempts: 1, nextRetryAt: 2000 }]]);
assert.deepEqual(planCoverBackfill([
  { coverUrl: source, localCoverUrl: '' },
], { hasAsset: existing, failures: cooling, now: 1000 }), []);
assert.equal(cooling.size, 1, 'Relevant future retries should be preserved');
assert.deepEqual(planCoverBackfill([
  { coverUrl: source, localCoverUrl: '' },
], { hasAsset: existing, failures: cooling, now: 2000 }), [
  { source, localAsset: '' },
]);

const shared = new Map([[source, { attempts: 3, nextRetryAt: Infinity, phase: 'download' }]]);
const plan = planCoverBackfill([
  { coverUrl: source, localCoverUrl: '' },
  { coverUrl: source, localCoverUrl: local },
  { coverUrl: source, localCoverUrl: '' },
], { hasAsset: existing, failures: shared, now: 1000 });
assert.deepEqual(plan, [{ source, localAsset: local }],
  'A saved image from one physical copy should serve the others immediately');
assert.equal(shared.size, 0, 'Existing shared cache must override a former failed download');

// A database save error must not lose its retry counter when another copy
// already has an image available. This is different from a download failure.
const linkFailure = new Map([[source, { attempts: 2, nextRetryAt: 3000, phase: 'link' }]]);
const partiallyCached = [
  { coverUrl: source, localCoverUrl: '' },
  { coverUrl: source, localCoverUrl: local },
];
assert.deepEqual(planCoverBackfill(partiallyCached,
  { hasAsset: existing, failures: linkFailure, now: 1000 }), []);
assert.equal(linkFailure.get(source).attempts, 2, 'A saved sibling must not reset failed database writes');
assert.deepEqual(planCoverBackfill(partiallyCached,
  { hasAsset: existing, failures: linkFailure, now: 3000 }), [{ source, localAsset: local }]);
linkFailure.set(source, { attempts: 4, nextRetryAt: Infinity, phase: 'link' });
assert.deepEqual(planCoverBackfill(partiallyCached,
  { hasAsset: existing, failures: linkFailure, now: 5000 }), [],
'Exhausted database-link retries must remain bounded');

// Persisted-but-unlinked downloads should be reused during write retries,
// even if the only previously linked physical copy is removed meanwhile.
const unlinkedAsset = '/api/covers/' + 'b'.repeat(64) + '.png';
const unlinkedFailure = new Map([[source, { attempts: 1, nextRetryAt: 2000,
  phase: 'link', localAsset: unlinkedAsset }]]);
assert.deepEqual(planCoverBackfill([
  { coverUrl: source, localCoverUrl: '' },
], { hasAsset: (asset) => asset === unlinkedAsset, failures: unlinkedFailure, now: 2000 }),
[{ source, localAsset: unlinkedAsset }], 'A downloaded unlinked file must be reused');
assert.equal(unlinkedFailure.get(source).attempts, 1);

const gone = planCoverBackfill([
  { coverUrl: source, localCoverUrl: local },
], { hasAsset: () => false, failures: new Map(), now: 1000 });
assert.deepEqual(gone, [{ source, localAsset: '' }],
  'A reference to a deleted file must not be reused');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(server, /planCoverBackfill\(snapshot\.books,/);
assert.match(server, /local = localAsset && coverAssets\.hasAsset\(localAsset\)/);
assert.match(server, /\? localAsset : await coverAssets\.saveSource\(source\)/);
assert.match(server, /scheduleBackfillRetry\(\)/);
console.log('Cover backfill plan tests passed');
