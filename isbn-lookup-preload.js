'use strict';

const { createIsbnLookup } = require('./isbn-lookup-core');

// Existing import tests use the server's fixture-based lookup. Do not override
// that deterministic test path. In normal runtime this hook is resolved by
// server.js for both manual ISBN lookups and import enrichment.
if (!process.env.BOEKENBAAI_TEST_ISBN_FIXTURES
  && typeof globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP !== 'function') {
  const lookup = createIsbnLookup({ fetchImpl: global.fetch, env: process.env });
  globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP = lookup;
}
