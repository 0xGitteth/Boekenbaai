'use strict';

const ranges978Part1 = require('./book-edition-isbn-ranges-978-1');
const ranges978Part2 = require('./book-edition-isbn-ranges-978-2');
const ranges978Part3 = require('./book-edition-isbn-ranges-978-3');
const ranges978Part4 = require('./book-edition-isbn-ranges-978-4');
const ranges979 = require('./book-edition-isbn-ranges-979');

// International ISBN Agency range snapshot dated 2026-09-10.
// Business::ISBN::Data 20260910.001; serial 9bd90878-c627-47f0-8d9a-432d469adfe9.
// Upstream Git blob: 0ced653e4662471188d66d2b979e947c2c5c8af9.
// Canonical prefix/group/range SHA-256: 60bc9433f52becc75b8c2048b949b3efe6183b79764308f14f0e2205e81e5d35.
const ISBN_REGISTRANT_RANGES = {
  978: { ...ranges978Part1, ...ranges978Part2, ...ranges978Part3, ...ranges978Part4 },
  979: ranges979,
};

function isValidIsbnRegistrantRange(prefix, group, registrant) {
  const ranges = ISBN_REGISTRANT_RANGES[prefix]?.[group];
  if (!Array.isArray(ranges) || !ranges.length || !registrant) return false;
  for (let index = 0; index < ranges.length; index += 2) {
    const low = ranges[index];
    const high = ranges[index + 1];
    if (registrant.length !== low.length || high.length !== low.length) continue;
    if (registrant >= low && registrant <= high) return true;
  }
  return false;
}

module.exports = { isValidIsbnRegistrantRange };
