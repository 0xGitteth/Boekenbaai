const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Kon blok niet vinden tussen ${startMarker} en ${endMarker}`);
  }
  return source.slice(start, end).trim();
}

const helperBlock = extractBetween(
  'async function fetchImportInfoForBookDetail(',
  'function applyBookDetailDescriptionState('
);

function buildFetchImportInfoForBookDetail(fetchJsonImpl) {
  const factory = new Function('fetchJson', `${helperBlock}\nreturn fetchImportInfoForBookDetail;`);
  return factory(fetchJsonImpl);
}

async function run() {
  const calls = [];
  const fetchImportInfoForBookDetail = buildFetchImportInfoForBookDetail(async (url) => {
    calls.push(url);
    if (url.includes('/books/first/import-info')) {
      const error = new Error('Geen importgegevens bekend voor dit boek');
      error.status = 404;
      throw error;
    }
    if (url.includes('/books/second/import-info')) {
      return { importStatus: 'created' };
    }
    throw new Error(`Onverwachte URL: ${url}`);
  });

  const state = {
    currentBookId: 'first',
    currentDetail: {
      copies: [{ id: 'first' }, { id: 'second' }, { id: 'second' }],
    },
  };

  const result = await fetchImportInfoForBookDetail(state);
  assert.deepStrictEqual(result, { importStatus: 'created' });
  assert.strictEqual(state.currentBookId, 'second');
  assert.deepStrictEqual(calls, [
    '/api/books/first/import-info',
    '/api/books/second/import-info',
  ]);

  const fetchWith403 = buildFetchImportInfoForBookDetail(async () => {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  });
  await assert.rejects(
    () => fetchWith403({ currentBookId: 'abc', currentDetail: { copies: [{ id: 'def' }] } }),
    (error) => error && error.status === 403
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
