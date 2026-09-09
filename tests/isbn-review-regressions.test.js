'use strict';

const assert = require('assert');
const {
  extractMeta,
  parseCbDetailHtml,
  parseGoogleBooksData,
  parseOpenLibraryData,
  parseIsbnBarcodeData,
  createIsbnLookup,
} = require('../isbn-lookup-core');

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : '';
      },
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

async function run() {
  const isbn = '9789059965607';
  const isbn10 = '9059965604';

  assert.strictEqual(
    extractMeta('<meta name="og:description" content="L\'enfant perdu">', 'og:description'),
    "L'enfant perdu",
    'Apostrophes inside double-quoted meta content must be preserved',
  );
  assert.strictEqual(
    extractMeta('<meta property="og:title" content="1 > 0">', 'og:title'),
    '1 > 0',
    'Literal > characters inside quoted meta content must not terminate the tag scan',
  );

  const detailNoEditionCover = `
    <meta name="og:title" content="L'enfant perdu">
    <meta name="og:image" content="https://metadata.isbn.nl/wrong-work-cover.jpg">
    <dl><dt>Auteur(s)</dt><dd><a>Auteur Een</a></dd></dl>
    <div class="uitv">
      <div class="uvlabel">Paperback</div>
      <div class="uitvinfo"><span>ISBN</span></br>${isbn}<br/></div>
    </div>
    <div class="uitv">
      <div class="uvlabel">E-book</div>
      <a class="fancybox" href="/other-edition.jpg"></a>
      <div class="uitvinfo"><span>ISBN</span></br>9789059969575<br/></div>
    </div>`;
  const cb = parseCbDetailHtml(detailNoEditionCover, isbn);
  assert.ok(cb);
  assert.strictEqual(cb.title, "L'enfant perdu");
  assert.strictEqual(
    cb.coverUrl,
    '',
    'A work-level CB image must never be used as the cover of an exact edition without its own cover',
  );

  const google = parseGoogleBooksData({
    items: [{
      volumeInfo: {
        title: 'Test',
        authors: ['Auteur'],
        industryIdentifiers: [{ identifier: isbn10 }],
        categories: ['Self-Help / Non-Fiction - Young Adult'],
      },
    }],
  }, isbn);
  assert.deepStrictEqual(
    google.tags,
    ['self-help', 'non-fiction', 'young adult'],
    'Hyphenated category names must stay intact',
  );

  const compactHierarchyGoogle = parseGoogleBooksData({
    items: [{
      volumeInfo: {
        title: 'Test',
        authors: ['Auteur'],
        industryIdentifiers: [{ identifier: isbn10 }],
        categories: ['Fiction>Fantasy', 'Self-Help'],
      },
    }],
  }, isbn);
  assert.deepStrictEqual(
    compactHierarchyGoogle.tags,
    ['fiction', 'fantasy', 'self-help'],
    'Compact > category hierarchies must split while hyphenated category names stay intact',
  );

  const openLibrary = parseOpenLibraryData({
    title: 'Test',
    authors: [{ name: 'Auteur' }],
    covers: [-1, 0, 1.5, 55],
  }, isbn);
  assert.strictEqual(openLibrary.coverUrl, 'https://covers.openlibrary.org/b/id/55-L.jpg?default=false');
  assert.strictEqual(
    parseOpenLibraryData({ title: 'Test', authors: [{ name: 'Auteur' }], covers: [-1, 0, 1.5] }, isbn).coverUrl,
    '',
    'Invalid Open Library cover identifiers must be ignored',
  );

  assert.strictEqual(
    parseIsbnBarcodeData({
      isbn: '9789059969575',
      title: 'Verkeerde editie',
      author: 'Auteur',
      cover_url: 'https://example.test/wrong.jpg',
    }, isbn),
    null,
    'ISBNBarcode records with an explicit mismatched ISBN must be rejected',
  );
  assert.ok(
    parseIsbnBarcodeData({
      isbn: isbn10,
      title: 'Zelfde editie',
      author: 'Auteur',
    }, isbn),
    'An explicitly equivalent ISBN-10 from ISBNBarcode must be accepted',
  );

  const calls = [];
  let releaseSearch;
  let delayedSearchCount = 0;
  const delayedFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('metadata.isbn.nl/search')) {
      delayedSearchCount += 1;
      if (delayedSearchCount === 1) {
        await new Promise((resolve) => { releaseSearch = resolve; });
      }
      return response('<div id="werk"></div>', { contentType: 'text/html' });
    }
    if (String(url).includes('openlibrary')) return response({}, { status: 404 });
    throw new Error(String(url));
  };
  const coalescedLookup = createIsbnLookup({ fetchImpl: delayedFetch, env: {} });
  const first = coalescedLookup(isbn);
  while (typeof releaseSearch !== 'function') await new Promise((resolve) => setTimeout(resolve, 0));
  const second = coalescedLookup(isbn10);
  releaseSearch();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult.barcode, isbn);
  assert.strictEqual(
    secondResult.barcode,
    isbn10,
    'A joined equivalent request must retain the ISBN used by the current caller',
  );
  assert.strictEqual(
    calls.filter((url) => url.includes('metadata.isbn.nl/search')).length,
    2,
    'Concurrent callers must share one CB lookup rather than starting duplicate source passes',
  );

  let cacheCalls = 0;
  const cacheFetch = async (url) => {
    cacheCalls += 1;
    if (String(url).includes('metadata.isbn.nl/search')) return response('<div id="werk"></div>', { contentType: 'text/html' });
    if (String(url).includes('openlibrary')) return response({}, { status: 404 });
    throw new Error(String(url));
  };
  const shortCacheLookup = createIsbnLookup({
    fetchImpl: cacheFetch,
    env: {
      BOEKENBAAI_ISBN_CACHE_TTL_MS: '5',
      BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS: '5',
    },
  });
  await shortCacheLookup(isbn);
  const beforeCache = cacheCalls;
  const equivalentCached = await shortCacheLookup(isbn10);
  assert.strictEqual(equivalentCached.cacheHit, true);
  assert.strictEqual(equivalentCached.barcode, isbn10);
  assert.strictEqual(cacheCalls, beforeCache);
  await new Promise((resolve) => setTimeout(resolve, 12));
  await shortCacheLookup(isbn);
  assert.ok(cacheCalls > beforeCache, 'Configured cache TTL must be honored');

  const realDateNow = Date.now;
  let fakeNow = 1_000_000;
  let negativeCacheCalls = 0;
  try {
    Date.now = () => fakeNow;
    const negativeCacheFetch = async (url) => {
      negativeCacheCalls += 1;
      if (String(url).includes('metadata.isbn.nl/search')) {
        return response('<div id="werk"></div>', { contentType: 'text/html' });
      }
      if (String(url).includes('openlibrary')) return response({}, { status: 404 });
      throw new Error(String(url));
    };
    const negativeCacheLookup = createIsbnLookup({
      fetchImpl: negativeCacheFetch,
      env: {},
    });
    await negativeCacheLookup(isbn);
    const afterInitialNegativeLookup = negativeCacheCalls;
    fakeNow += 61 * 1000;
    const stillCachedNegative = await negativeCacheLookup(isbn10);
    assert.strictEqual(stillCachedNegative.cacheHit, true);
    assert.strictEqual(
      negativeCacheCalls,
      afterInitialNegativeLookup,
      'Default not-found cache entries must remain cached beyond 60 seconds',
    );
    fakeNow += 4 * 60 * 1000;
    await negativeCacheLookup(isbn);
    assert.ok(
      negativeCacheCalls > afterInitialNegativeLookup,
      'Default not-found cache entries must expire after the documented five-minute TTL',
    );
  } finally {
    Date.now = realDateNow;
  }

  let fallbackCalls = 0;
  const fallbackFetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) return response('<div id="werk"></div>', { contentType: 'text/html' });
    if (textUrl.includes('openlibrary')) return response({}, { status: 404 });
    if (textUrl.includes('isbnbarcode.org/api')) {
      fallbackCalls += 1;
      return response({
        title: 'Fallback titel',
        author: 'Fallback auteur',
        cover_url: 'http://example.test/cover.jpg',
      });
    }
    throw new Error(textUrl);
  };
  const fallbackLookup = createIsbnLookup({
    fetchImpl: fallbackFetch,
    env: { BOEKENBAAI_ENABLE_ISBNBARCODE: 'true' },
  });
  const fallbackResult = await fallbackLookup(isbn);
  assert.strictEqual(fallbackResult.title, 'Fallback titel');
  assert.strictEqual(fallbackCalls, 1, 'Configured ISBNBarcode fallback must remain active');

  const mismatchedFallbackFetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) return response('<div id="werk"></div>', { contentType: 'text/html' });
    if (textUrl.includes('openlibrary')) return response({}, { status: 404 });
    if (textUrl.includes('isbnbarcode.org/api')) {
      return response({
        isbn: '9789059969575',
        title: 'Verkeerde editie',
        author: 'Verkeerde auteur',
        cover_url: 'https://example.test/wrong.jpg',
      });
    }
    throw new Error(textUrl);
  };
  const mismatchedFallbackLookup = createIsbnLookup({
    fetchImpl: mismatchedFallbackFetch,
    env: { BOEKENBAAI_ENABLE_ISBNBARCODE: 'true' },
  });
  const mismatchedFallbackResult = await mismatchedFallbackLookup(isbn);
  assert.strictEqual(mismatchedFallbackResult.found, false);
  assert.strictEqual(mismatchedFallbackResult.title, '');

  const debugLookup = createIsbnLookup({
    fetchImpl: fallbackFetch,
    env: {
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const debugFresh = await debugLookup(isbn, { includeDebug: true });
  assert.ok(debugFresh.debug);
  assert.strictEqual(debugFresh.debug.cacheHit, false);
  assert.ok(debugFresh.debug.sourcesConfigured.includes('isbnbarcode.org'));
  const debugCached = await debugLookup(isbn10, { includeDebug: true });
  assert.strictEqual(debugCached.debug.cacheHit, true);
  assert.strictEqual(debugCached.debug.isbn, isbn10);
  assert.strictEqual(debugCached.barcode, isbn10);

  let aborted = false;
  const hangingFetch = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: { get() { return 'text/html'; } },
    text() {
      return new Promise((_resolve, reject) => {
        if (!options.signal) return;
        options.signal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });
  const timeoutLookup = createIsbnLookup({ fetchImpl: hangingFetch, env: {}, timeoutMs: 20 });
  const timeoutResult = await timeoutLookup(isbn);
  assert.strictEqual(timeoutResult.found, false);
  assert.strictEqual(aborted, true, 'Timeout must remain active while the response body is consumed');

  console.log('ISBN review regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
