const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function createMockResponse(payload, { status = 200, headers = { 'content-type': 'application/json' } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || headers[name] || '';
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function loadServerModule({ fetchImpl = global.fetch, env = {} } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-parser-test-'));
  const dataPath = path.join(tempDir, 'db.json');
  fs.writeFileSync(dataPath, JSON.stringify({ books: [], students: [], folders: [], classes: [], users: [], history: [] }));

  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = `${fs.readFileSync(serverPath, 'utf8')}\nmodule.exports = { parseGoogleBooksData, parseOpenLibraryData, normalizeCoverUrl, normalizeIsbnMetadata, mergeLookupMetadata, lookupIsbnMetadata };`;
  const actualHttp = require('http');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(serverPath),
    __filename: serverPath,
    console: { log() {}, warn() {}, error() {} },
    process: {
      ...process,
      env: {
        ...process.env,
        PORT: '0',
        BOEKENBAAI_DATA_PATH: dataPath,
        ...env,
      },
      on() {},
      exit(code) {
        throw new Error(`Unexpected process.exit(${code})`);
      },
    },
    fetch: fetchImpl,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  sandbox.require = (request) => {
    if (request === 'http') {
      return {
        ...actualHttp,
        createServer() {
          return {
            listen(_port, cb) {
              if (typeof cb === 'function') cb();
            },
            close(cb) {
              if (typeof cb === 'function') cb();
            },
          };
        },
      };
    }
    return require(request);
  };

  vm.runInNewContext(source, sandbox, { filename: serverPath });
  return sandbox.module.exports;
}

async function runTests() {
  const {
    parseGoogleBooksData,
    parseOpenLibraryData,
    normalizeCoverUrl,
    normalizeIsbnMetadata,
    mergeLookupMetadata,
  } = loadServerModule();

  assert.strictEqual(
    normalizeCoverUrl('http://books.google.com/example-cover.jpg'),
    'https://books.google.com/example-cover.jpg',
  );
  assert.strictEqual(
    normalizeCoverUrl('https://books.google.com/example-cover.jpg'),
    'https://books.google.com/example-cover.jpg',
  );
  assert.strictEqual(
    normalizeCoverUrl('http://intranet.local/example-cover.jpg'),
    'http://intranet.local/example-cover.jpg',
  );
  assert.strictEqual(normalizeCoverUrl(''), '');
  assert.strictEqual(normalizeCoverUrl(null), '');

  const googleMetadata = parseGoogleBooksData({
    items: [
      {
        volumeInfo: {
          title: 'Vriendschap voor altijd',
          authors: ['Voorbeeld Auteur'],
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: '9781234567890' },
          ],
          mainCategory: 'Fiction',
          categories: [
            'Juvenile Fiction / Social Themes / Friendship',
            'Ages 9-12 - School & Education',
            'Fiction',
          ],
        },
      },
    ],
  }, '9781234567890');

  assert.ok(googleMetadata, 'Expected Google Books metadata');
  assert.deepStrictEqual(
    Array.from(googleMetadata.tags),
    ['fiction', 'juvenile fiction', 'social themes', 'friendship', 'ages 9-12', 'school & education'],
  );
  assert.deepStrictEqual(
    Array.from(normalizeIsbnMetadata(googleMetadata).fields.tags),
    ['fiction', 'juvenile fiction', 'social themes', 'friendship', 'ages 9-12', 'school & education'],
  );

  const openLibraryMetadata = parseOpenLibraryData({
    title: 'Onderwerpenboek',
    authors: [{ name: 'Tester' }],
    covers: [9876543],
    subjects: [
      { name: 'Friendship' },
      '  Social life and customs ',
      { name: 'friendship' },
    ],
  }, '9780000000001');

  assert.ok(openLibraryMetadata, 'Expected Open Library metadata');
  assert.strictEqual(
    openLibraryMetadata.coverUrl,
    'https://covers.openlibrary.org/b/id/9876543-L.jpg',
  );
  assert.deepStrictEqual(Array.from(openLibraryMetadata.tags), ['friendship', 'social life and customs']);
  assert.deepStrictEqual(
    Array.from(normalizeIsbnMetadata(openLibraryMetadata).fields.tags),
    ['friendship', 'social life and customs'],
  );
  assert.strictEqual(
    normalizeIsbnMetadata(openLibraryMetadata).fields.coverUrl,
    'https://covers.openlibrary.org/b/id/9876543-L.jpg',
  );

  const rangedGoogleMetadata = parseGoogleBooksData({
    items: [
      {
        volumeInfo: {
          title: 'Range test',
          authors: ['Voorbeeld Auteur'],
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: '9781234567891' },
          ],
          categories: ['Coming-of-age - School stories'],
        },
      },
    ],
  }, '9781234567891');

  assert.ok(rangedGoogleMetadata, 'Expected Google Books metadata for range test');
  assert.deepStrictEqual(Array.from(rangedGoogleMetadata.tags), ['coming-of-age', 'school stories']);

  const mergedTags = mergeLookupMetadata(
    { title: 'Google title', tags: ['fiction', 'Friendship'], found: true },
    { title: 'Open title', tags: ['friendship', 'school'], found: true },
  );
  assert.strictEqual(mergedTags.title, 'Google title');
  assert.deepStrictEqual(Array.from(mergedTags.tags), ['fiction', 'friendship', 'school']);

  const fetchCalls = [];
  const googleUrlPart = 'www.googleapis.com/books/v1/volumes';
  const openLibraryUrlPart = 'openlibrary.org/isbn/9781234567890.json';
  const lookupFetch = async (url) => {
    fetchCalls.push(url);
    if (url.includes(googleUrlPart)) {
      return createMockResponse({
        items: [
          {
            volumeInfo: {
              title: 'Google Titel',
              authors: ['Google Auteur'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9781234567890' },
              ],
              imageLinks: { thumbnail: 'http://books.google.com/google-cover.jpg' },
              categories: ['Fiction / Adventure'],
              publisher: 'Google Uitgever',
            },
          },
        ],
      });
    }
    if (url.includes(openLibraryUrlPart)) {
      return createMockResponse({
        title: 'Open Titel',
        authors: [{ name: 'Open Auteur' }],
        publishers: ['Open Uitgever'],
        subjects: ['Adventure', 'Friendship', 'fiction'],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const { lookupIsbnMetadata } = loadServerModule({
    fetchImpl: lookupFetch,
    env: { GOOGLE_BOOKS_API_KEY: 'test-key' },
  });

  const lookupResult = await lookupIsbnMetadata('9781234567890');
  assert.deepStrictEqual(fetchCalls.length, 2, 'Lookup should continue to Open Library for tag enrichment');
  assert.strictEqual(lookupResult.title, 'Google Titel');
  assert.strictEqual(lookupResult.author, 'Google Auteur');
  assert.strictEqual(lookupResult.coverUrl, 'https://books.google.com/google-cover.jpg');
  assert.strictEqual(lookupResult.publisher, 'Google Uitgever');
  assert.deepStrictEqual(
    Array.from(lookupResult.tags),
    ['fiction', 'adventure', 'friendship'],
    'Tags from Google Books and Open Library should be merged and deduplicated',
  );

  const noGoogleTagCalls = [];
  const lookupFetchWithoutGoogleTags = async (url) => {
    noGoogleTagCalls.push(url);
    if (url.includes(googleUrlPart)) {
      return createMockResponse({
        items: [
          {
            volumeInfo: {
              title: 'Google Titel zonder tags',
              authors: ['Google Auteur'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9781234567890' },
              ],
              imageLinks: { thumbnail: 'http://books.google.com/google-cover.jpg' },
            },
          },
        ],
      });
    }
    if (url.includes(openLibraryUrlPart)) {
      return createMockResponse({
        title: 'Open Titel',
        authors: [{ name: 'Open Auteur' }],
        subjects: [{ name: 'Social themes' }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const { lookupIsbnMetadata: lookupWithoutGoogleTags } = loadServerModule({
    fetchImpl: lookupFetchWithoutGoogleTags,
    env: { GOOGLE_BOOKS_API_KEY: 'test-key' },
  });

  const lookupWithoutTagResult = await lookupWithoutGoogleTags('9781234567890');
  assert.deepStrictEqual(noGoogleTagCalls.length, 2, 'Lookup should not stop before Open Library adds tags');
  assert.strictEqual(lookupWithoutTagResult.title, 'Google Titel zonder tags');
  assert.strictEqual(lookupWithoutTagResult.author, 'Google Auteur');
  assert.strictEqual(lookupWithoutTagResult.coverUrl, 'https://books.google.com/google-cover.jpg');
  assert.deepStrictEqual(Array.from(lookupWithoutTagResult.tags), ['social themes']);

  const openLibraryOnlyFetch = async (url) => {
    if (url.includes(openLibraryUrlPart)) {
      return createMockResponse({
        title: 'Open Only Titel',
        authors: [{ name: 'Open Only Auteur' }],
        covers: ['12345'],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const { lookupIsbnMetadata: lookupOpenOnly } = loadServerModule({
    fetchImpl: openLibraryOnlyFetch,
    env: {},
  });
  const openOnlyResult = await lookupOpenOnly('9781234567890');
  assert.strictEqual(openOnlyResult.source, 'openlibrary');
  assert.strictEqual(openOnlyResult.coverUrl, 'https://covers.openlibrary.org/b/id/12345-L.jpg');

  console.log('ISBN metadata parser tests passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
