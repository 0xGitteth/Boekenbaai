'use strict';
const assert = require('node:assert/strict');
const { normalizeCoverCrop } = require('../lib/cover-crop');
assert.deepEqual(normalizeCoverCrop({ enabled: true, x: 0, y: 100, zoom: 2.5 }), { enabled: true, x: 0, y: 100, zoom: 2.5 });
assert.deepEqual(normalizeCoverCrop({ enabled: true, x: 50, y: 50, zoom: 1 }), { enabled: true, x: 50, y: 50, zoom: 1 });
for (const v of [null, [], {}, { enabled: false, x: 10, y: 20, zoom: 1 }, { enabled: true, x: -1, y: 30, zoom: 1 }, { enabled: true, x: 30, y: 30, zoom: 3 }, { enabled: true, x: '20', y: 30, zoom: 1 }, { enabled: true, x: 30, y: 101, zoom: 1 }, { enabled: true, x: 30, y: 20, zoom: Infinity }]) assert.equal(normalizeCoverCrop(v), null);
console.log('Book cover crop validation passed');
