'use strict';

const assert = require('assert');
const implDirect = require('../isbn-lookup-core-impl');
const {
  createIsbnLookup,
  extractMeta,
  parseCbDetailHtml,
  parseIsbnBarcodeData,
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
      if (typeof body === 'string') return JSON.parse(body);
      return body;
    },
  };
}

function googlePayload(isbn, overrides = {}) {
  return {
    items: [{
      volumeInfo: {
        title: 'Google titel',
        authors: ['Google auteur'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
        ...overrides,
      },
    }],
  };
}

function primaryFetch({ isbn, google, fallback }) {
  return async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) {
      return response('<div id="werk"></div>', { contentType: 'text/html' });
    }
    if (textUrl.includes('googleapis.com/books')) {
      return response(google || { items: [] });
    }
    if (textUrl.includes('openlibrary.org')) {
      return response({}, { status: 404 });
    }
    if (textUrl.includes('isbnbarcode.org/api')) {
      return fallback(textUrl);
    }
    throw new Error(`Unexpected request ${textUrl}`);
  };
}

async function run() {
  const isbn = '9789059965607';

  assert.strictEqual(
    extractMeta(
      '<meta name="twitter:title" property="og:title" content="Caf&#233; &#x1F4DA;">',
      'og:title',
    ),
    'Café 📚',
    'Wrapper meta parsing must decode decimal and hexadecimal HTML entities',
  );

  const metadataWithSecondaryTags = parseIsbnBarcodeData({
    isbn,
    title: 'Titel',
    categories: [],
    subjects: ['Fantasy'],
    tags: ['Young Adult'],
  }, isbn);
  assert.ok(metadataWithSecondaryTags?.found);
  assert.deepStrictEqual(
    metadataWithSecondaryTags.tags,
    ['fantasy', 'young adult'],
    'All ISBNBarcode tag fields must be merged even when ordinary metadata makes the base parser succeed',
  );

  assert.strictEqual(
    parseIsbnBarcodeData({
      isbn: 'not-an-isbn',
      title: 'Onbetrouwbare titel',
      subjects: ['Fantasy'],
    }, isbn),
    null,
    'A provided but invalid explicit identifier must not be treated as absent evidence',
  );

  let incompleteFallbackCalls = 0;
  const incompleteLookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn),
      fallback: async () => {
        incompleteFallbackCalls += 1;
        return response({
          isbn,
          cover_url: 'https://example.test/fallback-cover.jpg',
          publisher: 'Fallback uitgever',
          categories: [],
          subjects: ['Fantasy'],
        });
      },
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  const incompleteResult = await incompleteLookup(isbn);
  assert.strictEqual(incompleteFallbackCalls, 1);
  assert.strictEqual(incompleteResult.title, 'Google titel');
  assert.strictEqual(incompleteResult.author, 'Google auteur');
  assert.strictEqual(incompleteResult.coverUrl, 'https://example.test/fallback-cover.jpg');
  assert.strictEqual(incompleteResult.publisher, 'Fallback uitgever');
  assert.deepStrictEqual(incompleteResult.tags, ['fantasy']);
  assert.strictEqual(incompleteResult.source, 'Google Books');
  assert.deepStrictEqual(incompleteResult.sources, ['Google Books', 'isbnbarcode.org']);

  let fallbackOnlyCalls = 0;
  const fallbackOnlyLookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      fallback: async () => {
        fallbackOnlyCalls += 1;
        return response({
          isbn,
          title: 'Alleen fallback',
          author: 'Fallback auteur',
          cover_url: 'https://example.test/only-fallback.jpg',
          subjects: ['Jeugd'],
        });
      },
    }),
    env: {
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  const fallbackOnlyResult = await fallbackOnlyLookup(isbn);
  assert.strictEqual(fallbackOnlyCalls, 1);
  assert.strictEqual(fallbackOnlyResult.found, true);
  assert.strictEqual(fallbackOnlyResult.title, 'Alleen fallback');
  assert.strictEqual(fallbackOnlyResult.author, 'Fallback auteur');
  assert.strictEqual(fallbackOnlyResult.source, 'isbnbarcode.org');
  assert.deepStrictEqual(fallbackOnlyResult.sources, ['isbnbarcode.org']);
  assert.deepStrictEqual(fallbackOnlyResult.tags, ['jeugd']);
  assert.strictEqual(fallbackOnlyResult.barcode, isbn);

  let configuredFallbackCalls = 0;
  const configuredLookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn, {
        imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
        categories: ['Fantasy'],
      }),
      fallback: async () => {
        configuredFallbackCalls += 1;
        return response({ isbn, subjects: ['Onnodig'] });
      },
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const configuredResult = await configuredLookup(isbn, { includeDebug: true });
  assert.strictEqual(configuredFallbackCalls, 0);
  assert.strictEqual(configuredResult.debug.isbnbarcode.enabled, true);
  assert.ok(configuredResult.debug.sourcesConfigured.includes('isbnbarcode.org'));
  assert.ok(!configuredResult.debug.sourcesTried.includes('isbnbarcode.org'));

  const http500Lookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn, {
        imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
      }),
      fallback: async () => response({}, { status: 500 }),
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const http500Result = await http500Lookup(isbn, { includeDebug: true });
  assert.strictEqual(http500Result.debug.sourceStatus['isbnbarcode.org'], 'error');

  const http404Lookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn, {
        imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
      }),
      fallback: async () => response({}, { status: 404 }),
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const http404Result = await http404Lookup(isbn, { includeDebug: true });
  assert.strictEqual(http404Result.debug.sourceStatus['isbnbarcode.org'], 'not_found');

  const malformedLookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn, {
        imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
      }),
      fallback: async () => response('{broken-json', { contentType: 'text/plain' }),
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const malformedResult = await malformedLookup(isbn, { includeDebug: true });
  assert.strictEqual(malformedResult.debug.sourceStatus['isbnbarcode.org'], 'error');

  const realDateNow = Date.now;
  let now = 1_000_000;
  let negativeFallbackCalls = 0;
  Date.now = () => now;
  try {
    const negativeTtlLookup = createIsbnLookup({
      fetchImpl: primaryFetch({
        isbn,
        google: googlePayload(isbn, {
          imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
        }),
        fallback: async () => {
          negativeFallbackCalls += 1;
          return response({}, { status: 404 });
        },
      }),
      env: {
        GOOGLE_BOOKS_API_KEY: 'test-key',
        BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
        BOEKENBAAI_ISBN_CACHE_TTL_MS: '300000',
        BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS: '1000',
      },
    });

    await negativeTtlLookup(isbn);
    assert.strictEqual(negativeFallbackCalls, 2);
    now += 500;
    await negativeTtlLookup(isbn);
    assert.strictEqual(
      negativeFallbackCalls,
      2,
      'Negative fallback result must stay cached inside its configured TTL after exhausting equivalent ISBNs',
    );
    now += 600;
    await negativeTtlLookup(isbn);
    assert.strictEqual(
      negativeFallbackCalls,
      4,
      'Negative fallback cache must expire using BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS',
    );
  } finally {
    Date.now = realDateNow;
  }


  const orderedCbHtml = [
    '<meta name="twitter:title" property="og:title" content="Correct eerst">',
    '<meta property="og:title" content="Later fout">',
    '<div class="uitv">',
    '<div class="uvlabel">Paperback</div>',
    '<span>ISBN</span><br>9789059965607<br><br>',
    '</div>',
  ].join('');
  assert.strictEqual(
    parseCbDetailHtml(orderedCbHtml, isbn).title,
    'Correct eerst',
    'Bureau ISBN parsing must preserve first-match ordering for dual name/property meta tags',
  );
  assert.strictEqual(
    implDirect.extractMeta(
      '<meta name="twitter:title" property="og:title" content="Correct eerst"><meta property="og:title" content="Later fout">',
      'og:title',
    ),
    'Correct eerst',
    'The internal meta extractor must match property independently without alias synthesis',
  );

  const aliasHeavy = parseIsbnBarcodeData({
    isbn,
    title: [],
    book_title: 'Titel uit tweede alias',
    author: [],
    authors: ['Auteur uit tweede alias'],
    publisher: [],
    publishers: ['Uitgever uit tweede alias'],
    language: [],
    languages: ['Nederlands'],
    cover: [],
    cover_url: 'http://example.test/alias-cover.jpg',
    publish_date: [],
    publication_date: '2026-09-09',
    page_count: [],
    pages: 222,
    categories: [],
    subjects: ['Fantasy'],
  }, isbn);
  assert.ok(aliasHeavy?.found);
  assert.strictEqual(aliasHeavy.title, 'Titel uit tweede alias');
  assert.strictEqual(aliasHeavy.author, 'Auteur uit tweede alias');
  assert.strictEqual(aliasHeavy.publisher, 'Uitgever uit tweede alias');
  assert.strictEqual(aliasHeavy.language, 'nl');
  assert.strictEqual(aliasHeavy.coverUrl, 'https://example.test/alias-cover.jpg');
  assert.strictEqual(aliasHeavy.publishedAt, '2026-09-09');
  assert.strictEqual(aliasHeavy.pageCount, 222);
  assert.deepStrictEqual(aliasHeavy.tags, ['fantasy']);
  const arrayDescription = implDirect.parseIsbnBarcodeData({
    isbn,
    description: ['Beschrijving uit array'],
    page_count: [144],
  }, isbn);
  assert.strictEqual(
    arrayDescription.description,
    'Beschrijving uit array',
    'Array-valued description aliases must not be discarded',
  );
  assert.strictEqual(arrayDescription.pageCount, 144);
  const directAliasHeavy = implDirect.parseIsbnBarcodeData({
    isbn,
    author: [],
    authors: ['Direct auteur'],
    publisher: [],
    publishers: ['Direct uitgever'],
    language: [],
    languages: ['Nederlands'],
    categories: [],
    tags: ['Jeugd'],
  }, isbn);
  assert.strictEqual(directAliasHeavy.author, 'Direct auteur');
  assert.strictEqual(directAliasHeavy.publisher, 'Direct uitgever');
  assert.strictEqual(directAliasHeavy.language, 'nl');
  assert.deepStrictEqual(directAliasHeavy.tags, ['jeugd']);
  assert.strictEqual(
    implDirect.parseIsbnBarcodeData({ isbn: 'geen-isbn', title: 'Niet accepteren' }, isbn),
    null,
    'The internal parser must reject provided but invalid explicit ISBN evidence',
  );

  const isbn10 = implDirect.toIsbn10(isbn);
  const equivalentFallbackUrls = [];
  const equivalentLookup = createIsbnLookup({
    fetchImpl: async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('metadata.isbn.nl/search')) {
        return response('<div id="werk"></div>', { contentType: 'text/html' });
      }
      if (textUrl.includes('openlibrary.org')) return response({}, { status: 404 });
      if (textUrl.includes('isbnbarcode.org/api')) {
        equivalentFallbackUrls.push(textUrl);
        if (textUrl.endsWith(`/${isbn10}`)) return response({}, { status: 404 });
        if (textUrl.endsWith(`/${isbn}`)) {
          return response({ isbn, title: 'Gevonden via ISBN13', author: 'Auteur' });
        }
      }
      throw new Error(`Unexpected request ${textUrl}`);
    },
    env: { BOEKENBAAI_ENABLE_ISBNBARCODE: 'true' },
  });
  const fromIsbn10 = await equivalentLookup(isbn10);
  assert.strictEqual(fromIsbn10.title, 'Gevonden via ISBN13');
  assert.strictEqual(fromIsbn10.barcode, isbn10);
  assert.deepStrictEqual(
    equivalentFallbackUrls.map((url) => url.split('/').pop()),
    [isbn10, isbn],
    'Fallback must exhaust equivalent ISBN representations before caching a miss',
  );
  const equivalentCallsBeforeCache = equivalentFallbackUrls.length;
  const fromIsbn13Cache = await equivalentLookup(isbn);
  assert.strictEqual(fromIsbn13Cache.title, 'Gevonden via ISBN13');
  assert.strictEqual(fromIsbn13Cache.barcode, isbn);
  assert.strictEqual(equivalentFallbackUrls.length, equivalentCallsBeforeCache);

  let transientPrimaryCalls = 0;
  const transientPrimaryLookup = createIsbnLookup({
    fetchImpl: async (url) => {
      const textUrl = String(url);
      transientPrimaryCalls += 1;
      if (textUrl.includes('metadata.isbn.nl/search')) return response('', { status: 500, contentType: 'text/html' });
      if (textUrl.includes('googleapis.com/books')) return response({}, { status: 429 });
      if (textUrl.includes('openlibrary.org')) return response({}, { status: 503 });
      throw new Error(`Unexpected request ${textUrl}`);
    },
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const transientFirst = await transientPrimaryLookup(isbn, { includeDebug: true });
  assert.strictEqual(transientFirst.found, false);
  assert.strictEqual(transientFirst.debug.sourceStatus['Bureau ISBN'], 'error');
  assert.strictEqual(transientFirst.debug.sourceStatus['Google Books'], 'error');
  assert.strictEqual(transientFirst.debug.sourceStatus['Open Library'], 'error');
  const transientCallsAfterFirst = transientPrimaryCalls;
  await transientPrimaryLookup(isbn, { includeDebug: true });
  assert.ok(
    transientPrimaryCalls > transientCallsAfterFirst,
    'Transient primary failures must not be negatively cached as a genuine ISBN miss',
  );

  let fallbackTransientCalls = 0;
  const fallbackTransientLookup = createIsbnLookup({
    fetchImpl: primaryFetch({
      isbn,
      google: googlePayload(isbn, {
        imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
      }),
      fallback: async () => {
        fallbackTransientCalls += 1;
        return response({}, { status: 500 });
      },
    }),
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  await fallbackTransientLookup(isbn);
  const fallbackTransientAfterFirst = fallbackTransientCalls;
  await fallbackTransientLookup(isbn);
  assert.ok(
    fallbackTransientCalls > fallbackTransientAfterFirst,
    'Transient ISBNBarcode failures must not be cached as not-found metadata',
  );

  assert.doesNotThrow(() => implDirect.extractMeta(
    '<meta property="og:title" content="Bad &#99999999; entity">',
    'og:title',
  ));

  console.log('ISBN wrapper hardening regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
