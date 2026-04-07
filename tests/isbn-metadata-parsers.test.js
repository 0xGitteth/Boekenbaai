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

function loadServerModule({
  fetchImpl = global.fetch,
  env = {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-parser-test-'));
  const dataPath = path.join(tempDir, 'db.json');
  fs.writeFileSync(dataPath, JSON.stringify({ books: [], students: [], folders: [], classes: [], users: [], history: [] }));

  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = `${fs.readFileSync(serverPath, 'utf8')}\nmodule.exports = { parseGoogleBooksData, parseOpenLibraryData, parseGoogleBooksTitleAuthorFallbackData, normalizeCoverUrl, rewriteArchiveOpenLibraryCoverUrl, normalizeIsbnMetadata, mergeLookupMetadata, lookupIsbnMetadata, lookupMetadataByTitleAuthor, fetchGoogleBooksFallbackWithRetry };`;
  const actualHttp = require('http');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(serverPath),
    __filename: serverPath,
    console: { log() {}, info() {}, warn() {}, error() {} },
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
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
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
    if (request.startsWith('./')) {
      return require(path.join(path.dirname(serverPath), request));
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
    parseGoogleBooksTitleAuthorFallbackData,
    normalizeCoverUrl,
    rewriteArchiveOpenLibraryCoverUrl,
    normalizeIsbnMetadata,
    mergeLookupMetadata,
    lookupMetadataByTitleAuthor,
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
  assert.strictEqual(
    rewriteArchiveOpenLibraryCoverUrl('https://archive.org/download/l_covers_0012/l_covers_0012_92.zip/0012920350-L.jpg'),
    'https://covers.openlibrary.org/b/id/12920350-L.jpg?default=false',
  );
  assert.strictEqual(
    rewriteArchiveOpenLibraryCoverUrl('archive.org/download/olcovers687/olcovers687-L.zip/6878733-L.jpg'),
    'https://covers.openlibrary.org/b/id/6878733-L.jpg?default=false',
  );
  assert.strictEqual(
    rewriteArchiveOpenLibraryCoverUrl('https://books.google.com/books/content?id=abc123&printsec=frontcover&img=1&zoom=1'),
    'https://books.google.com/books/content?id=abc123&printsec=frontcover&img=1&zoom=1',
  );
  assert.strictEqual(rewriteArchiveOpenLibraryCoverUrl(''), '');
  assert.strictEqual(rewriteArchiveOpenLibraryCoverUrl(null), null);

  const fallbackTarget = { title: 'Lopen voor je leven', author: 'Els Beerten', language: 'nl' };
  const poorStrictCandidate = {
    volumeInfo: {
      title: 'Lopen voor je leven',
      authors: ['Els Beerten'],
      language: 'nl',
    },
  };
  const richStrictCandidate = {
    volumeInfo: {
      title: 'Lopen voor je leven',
      authors: ['Els Beerten'],
      language: 'nl',
      publisher: 'Uitgeverij X',
      description: 'Rijke beschrijving',
      imageLinks: { thumbnail: 'http://books.google.com/books/content?id=PVdxAAAAQBAJ' },
    },
  };
  const richWrongAuthorCandidate = {
    volumeInfo: {
      title: 'Lopen voor je leven',
      authors: ['Andere Auteur'],
      language: 'nl',
      publisher: 'Andere Uitgever',
      description: 'Andere beschrijving',
      imageLinks: { thumbnail: 'http://books.google.com/books/content?id=wrong-author' },
    },
  };
  const richOmnibusCandidate = {
    volumeInfo: {
      title: 'Lopen voor je leven omnibus',
      authors: ['Els Beerten'],
      language: 'nl',
      publisher: 'Bundel Uitgever',
      description: 'Bundel beschrijving',
      imageLinks: { thumbnail: 'http://books.google.com/books/content?id=omnibus' },
    },
  };

  const scenario1 = parseGoogleBooksTitleAuthorFallbackData(
    { items: [poorStrictCandidate, richStrictCandidate] },
    fallbackTarget,
  );
  assert.ok(scenario1, 'Expected strict fallback match for scenario 1');
  assert.strictEqual(scenario1.coverUrl, 'https://books.google.com/books/content?id=PVdxAAAAQBAJ');
  assert.strictEqual(scenario1.publisher, 'Uitgeverij X');
  assert.strictEqual(scenario1.description, 'Rijke beschrijving');

  const scenario2 = parseGoogleBooksTitleAuthorFallbackData(
    { items: [poorStrictCandidate, richStrictCandidate] },
    fallbackTarget,
  );
  assert.ok(scenario2, 'Expected strict fallback match for scenario 2');
  assert.strictEqual(scenario2.publisher, 'Uitgeverij X');

  const scenario3 = parseGoogleBooksTitleAuthorFallbackData(
    { items: [poorStrictCandidate, richWrongAuthorCandidate] },
    fallbackTarget,
  );
  assert.ok(scenario3, 'Expected strict fallback match for scenario 3');
  assert.strictEqual(scenario3.author, 'Els Beerten');
  assert.strictEqual(scenario3.coverUrl, '');

  const scenario4 = parseGoogleBooksTitleAuthorFallbackData(
    { items: [richOmnibusCandidate] },
    fallbackTarget,
  );
  assert.strictEqual(scenario4, null, 'Rich omnibus candidate should still be rejected');

  const scenario5 = parseGoogleBooksTitleAuthorFallbackData(
    { items: [poorStrictCandidate, richStrictCandidate] },
    fallbackTarget,
  );
  assert.ok(scenario5, 'Expected strict fallback match for scenario 5');
  assert.strictEqual(scenario5.coverUrl, 'https://books.google.com/books/content?id=PVdxAAAAQBAJ');
  assert.strictEqual(scenario5.publisher, 'Uitgeverij X');
  assert.strictEqual(scenario5.description, 'Rijke beschrijving');

  const retryDelays = [];
  let retryFetchCalls = 0;
  const retryServer = loadServerModule({
    env: { GOOGLE_BOOKS_API_KEY: 'test-key' },
    fetchImpl: async () => {
      retryFetchCalls += 1;
      if (retryFetchCalls === 1) {
        return createMockResponse(
          { items: [] },
          { status: 503, headers: { 'retry-after': '1', 'content-type': 'application/json' } },
        );
      }
      return createMockResponse({ items: [] }, { status: 200 });
    },
    setTimeoutImpl: (fn, delay) => {
      retryDelays.push(delay);
      fn();
      return 1;
    },
    clearTimeoutImpl: () => {},
  });
  const retryResponse = await retryServer.fetchGoogleBooksFallbackWithRetry(
    'https://www.googleapis.com/books/v1/volumes?q=intitle%3A%22Retry%22',
    'strict_quoted_title_author',
  );
  assert.strictEqual(retryResponse.status, 200);
  assert.strictEqual(retryFetchCalls, 2);
  assert.ok(
    retryDelays[0] >= 1000,
    `Expected Retry-After-driven delay for 503 to be >= 1000ms, received ${retryDelays[0]}`,
  );

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
  assert.strictEqual(
    normalizeIsbnMetadata({
      coverUrl: 'https://archive.org/download/l_covers_0012/l_covers_0012_92.zip/0012920350-L.jpg',
      found: true,
    }).fields.coverUrl,
    'https://covers.openlibrary.org/b/id/12920350-L.jpg?default=false',
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

  const queryUrls = [];
  const queryFetch = async (url) => {
    queryUrls.push(String(url));
    return createMockResponse({ items: [] });
  };
  const { lookupMetadataByTitleAuthor: queryLookup } = loadServerModule({
    fetchImpl: queryFetch,
    env: { GOOGLE_BOOKS_API_KEY: 'test-key' },
  });
  await queryLookup({ title: 'He said "Yes"', author: 'Els Beerten' });
  assert.ok(
    queryUrls.some((url) => url.includes('q=intitle%3A%22He+said+%5C%22Yes%5C%22%22+inauthor%3A%22Els+Beerten%22')),
    'Title with embedded quotes should be safely escaped inside quoted query terms',
  );
  await queryLookup({ title: 'Lopen voor je leven', author: 'A "Quoted" Author' });
  assert.ok(
    queryUrls.some((url) => url.includes('q=intitle%3A%22Lopen+voor+je+leven%22+inauthor%3A%22A+%5C%22Quoted%5C%22+Author%22')),
    'Author with embedded quotes should be safely escaped inside quoted query terms',
  );
  await queryLookup({ title: 'Lopen voor je leven', author: 'Els Beerten' });
  assert.ok(
    queryUrls.some((url) => url.includes('q=intitle%3A%22Lopen+voor+je+leven%22+inauthor%3A%22Els+Beerten%22')),
    'Existing no-quote behavior should remain unchanged',
  );

  {
    const cooldownFetchCalls = [];
    const cooldownFetch = async (url) => {
      cooldownFetchCalls.push(String(url));
      if (cooldownFetchCalls.length === 1) {
        return createMockResponse(
          { items: [] },
          { status: 429, headers: { 'retry-after': '0.05', 'content-type': 'application/json' } },
        );
      }
      return createMockResponse({
        items: [
          {
            volumeInfo: {
              title: 'Cooldown Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/cooldown-cover.jpg' },
            },
          },
        ],
      });
    };
    const { lookupMetadataByTitleAuthor: cooldownLookup } = loadServerModule({
      fetchImpl: cooldownFetch,
      env: {
        GOOGLE_BOOKS_API_KEY: 'test-key',
        BOEKENBAAI_TITLE_AUTHOR_RATE_LIMIT_COOLDOWN_MS: '10',
      },
    });
    const firstAttempt = await cooldownLookup({ title: 'Cooldown Titel', author: 'Carry Slee' });
    assert.strictEqual(firstAttempt, null, '429 response should not be treated as success');
    assert.strictEqual(cooldownFetchCalls.length, 1, '429 should stop retries and variant ladder for that lookup');

    const secondAttempt = await cooldownLookup({ title: 'Andere Titel', author: 'Carry Slee' });
    assert.strictEqual(secondAttempt, null, 'Lookup should be skipped while cooldown is active');
    assert.strictEqual(cooldownFetchCalls.length, 1, 'Cooldown skip should prevent extra requests');

    await new Promise((resolve) => setTimeout(resolve, 80));
    const thirdAttempt = await cooldownLookup({ title: 'Cooldown Titel', author: 'Carry Slee' });
    assert.ok(thirdAttempt, 'Lookup should try again after cooldown ends');
    assert.strictEqual(
      thirdAttempt.coverUrl,
      'https://example.com/cooldown-cover.jpg',
      'Post-cooldown attempt should fetch fresh Google Books data',
    );
    assert.strictEqual(cooldownFetchCalls.length, 2, 'After cooldown expiry the fallback should call Google Books again');
  }

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

  {
    let releaseFetch;
    let lookupCalls = 0;
    const delayedFetch = async () => {
      lookupCalls += 1;
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      return createMockResponse({
        title: 'Inflight Titel',
        authors: [{ name: 'Inflight Auteur' }],
      });
    };
    const { lookupIsbnMetadata: inflightLookup } = loadServerModule({
      fetchImpl: delayedFetch,
      env: { BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true' },
    });
    const firstLookup = inflightLookup('9789999999991');
    const secondLookup = inflightLookup('9789999999991', { includeDebug: true });
    while (typeof releaseFetch !== 'function') {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseFetch();
    const [nonDebugResult, debugResult] = await Promise.all([firstLookup, secondLookup]);
    assert.strictEqual(lookupCalls, 1, 'Concurrent non-debug and debug lookup should share one inflight external request');
    assert.strictEqual(nonDebugResult.debug, undefined, 'Non-debug caller should not receive debug payload');
    assert.ok(debugResult.debug, 'Debug caller should receive debug payload');
  }

  {
    let releaseFetch;
    let lookupCalls = 0;
    const delayedFetch = async () => {
      lookupCalls += 1;
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      return createMockResponse({
        title: 'Inflight Debug Eerst',
        authors: [{ name: 'Auteur' }],
      });
    };
    const { lookupIsbnMetadata: inflightLookup } = loadServerModule({
      fetchImpl: delayedFetch,
      env: { BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true' },
    });
    const debugLookup = inflightLookup('9789999999992', { includeDebug: true });
    const nonDebugLookup = inflightLookup('9789999999992');
    while (typeof releaseFetch !== 'function') {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseFetch();
    const [debugResult, nonDebugResult] = await Promise.all([debugLookup, nonDebugLookup]);
    assert.strictEqual(lookupCalls, 1, 'Concurrent debug and non-debug lookup should share one inflight external request');
    assert.ok(debugResult.debug, 'Debug caller should receive debug payload');
    assert.strictEqual(nonDebugResult.debug, undefined, 'Non-debug caller should not receive debug payload');
  }

  {
    let lookupCalls = 0;
    const cacheFetch = async () => {
      lookupCalls += 1;
      return createMockResponse({
        title: 'Cache Titel',
        authors: [{ name: 'Cache Auteur' }],
      });
    };
    const { lookupIsbnMetadata: cacheLookup } = loadServerModule({
      fetchImpl: cacheFetch,
      env: { BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true' },
    });
    const firstResult = await cacheLookup('9789999999993');
    const cachedDebugResult = await cacheLookup('9789999999993', { includeDebug: true });
    assert.strictEqual(lookupCalls, 1, 'Cache hit should not trigger a second external request');
    assert.strictEqual(firstResult.debug, undefined, 'Non-debug caller should not receive debug payload');
    assert.ok(cachedDebugResult.debug, 'Debug caller should receive debug payload on cache hit');
    assert.strictEqual(cachedDebugResult.debug.cacheHit, true, 'Cache-hit debug payload should indicate cache hit');
  }

  {
    const { lookupIsbnMetadata: lookupWithoutDebugEnabled } = loadServerModule({
      fetchImpl: async () => createMockResponse({
        title: 'Debug Uit',
        authors: [{ name: 'Auteur' }],
      }),
      env: { BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'false' },
    });
    const result = await lookupWithoutDebugEnabled('9789999999994', { includeDebug: true });
    assert.strictEqual(result.debug, undefined, 'Debug output should stay disabled when BOEKENBAAI_DEBUG_ISBN_LOOKUP=false');
  }

  console.log('ISBN metadata parser tests passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
