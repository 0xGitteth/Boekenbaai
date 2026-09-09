'use strict';

const assert = require('assert');
const { createIsbnLookup, parseIsbnBarcodeData } = require('../isbn-lookup-core');

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

function googlePayload(isbn, categories) {
  return {
    items: [{
      volumeInfo: {
        title: 'Primaire exacte titel',
        authors: ['Primaire auteur'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
        imageLinks: { thumbnail: 'https://example.test/primary-cover.jpg' },
        ...(categories ? { categories } : {}),
      },
    }],
  };
}

function basePrimaryFetch(isbn, fallbackHandler) {
  return async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) {
      return response('<div id="werk"></div>', { contentType: 'text/html' });
    }
    if (textUrl.includes('googleapis.com/books')) return response(googlePayload(isbn));
    if (textUrl.includes('openlibrary.org')) return response({}, { status: 404 });
    if (textUrl.includes('isbnbarcode.org/api')) return fallbackHandler(textUrl);
    throw new Error(`Unexpected request ${textUrl}`);
  };
}

async function run() {
  const isbn = '9789059965607';

  const tagOnlyParsed = parseIsbnBarcodeData({
    isbn,
    categories: ['Jeugd', 'Fantasy'],
  }, isbn);
  assert.ok(tagOnlyParsed?.found, 'Tag-only exact ISBNBarcode records must be accepted');
  assert.deepStrictEqual(tagOnlyParsed.tags, ['jeugd', 'fantasy']);
  assert.strictEqual(
    parseIsbnBarcodeData({
      isbn: '9789059969575',
      categories: ['Verkeerde editie'],
    }, isbn),
    null,
    'Tag-only records must still reject a mismatched explicit ISBN',
  );

  let missingTagsFallbackCalls = 0;
  const missingTagsFetch = basePrimaryFetch(isbn, async () => {
    missingTagsFallbackCalls += 1;
    return response({
      isbn,
      title: 'Titel die niet mag winnen',
      author: 'Auteur die niet mag winnen',
      cover_url: 'https://example.test/fallback-cover.jpg',
      publisher: 'Fallback uitgever',
      description: 'Fallback beschrijving',
      pages: 321,
      language: 'Nederlands',
      categories: ['Jeugd', 'Fantasy'],
    });
  });

  const missingTagsLookup = createIsbnLookup({
    fetchImpl: missingTagsFetch,
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  const enriched = await missingTagsLookup(isbn);
  assert.strictEqual(
    missingTagsFallbackCalls,
    1,
    'ISBNBarcode must be consulted when exact primary metadata is core-complete but tags are missing',
  );
  assert.deepStrictEqual(enriched.tags, ['jeugd', 'fantasy']);
  assert.strictEqual(
    enriched.title,
    'Primaire exacte titel',
    'Fallback enrichment must not overwrite higher-priority exact title metadata',
  );
  assert.strictEqual(enriched.author, 'Primaire auteur');
  assert.strictEqual(enriched.coverUrl, 'https://example.test/primary-cover.jpg');
  assert.strictEqual(enriched.publisher, 'Fallback uitgever');
  assert.strictEqual(enriched.description, 'Fallback beschrijving');
  assert.strictEqual(enriched.pageCount, 321);
  assert.strictEqual(enriched.language, 'nl');
  assert.ok(enriched.sources.includes('Google Books'));
  assert.ok(enriched.sources.includes('isbnbarcode.org'));

  let tagOnlyFallbackCalls = 0;
  const tagOnlyFetch = basePrimaryFetch(isbn, async () => {
    tagOnlyFallbackCalls += 1;
    return response({ isbn, categories: ['Young Adult'] });
  });
  const tagOnlyLookup = createIsbnLookup({
    fetchImpl: tagOnlyFetch,
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  const tagOnlyResult = await tagOnlyLookup(isbn);
  assert.strictEqual(tagOnlyFallbackCalls, 1);
  assert.deepStrictEqual(
    tagOnlyResult.tags,
    ['young adult'],
    'A tag-only ISBNBarcode response must classify an otherwise complete exact book',
  );

  let completeFallbackCalls = 0;
  const alreadyTaggedFetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) {
      return response('<div id="werk"></div>', { contentType: 'text/html' });
    }
    if (textUrl.includes('googleapis.com/books')) {
      return response(googlePayload(isbn, ['Fantasy']));
    }
    if (textUrl.includes('openlibrary.org')) return response({}, { status: 404 });
    if (textUrl.includes('isbnbarcode.org/api')) {
      completeFallbackCalls += 1;
      return response({ isbn, categories: ['Onnodig'] });
    }
    throw new Error(`Unexpected request ${textUrl}`);
  };

  const alreadyTaggedLookup = createIsbnLookup({
    fetchImpl: alreadyTaggedFetch,
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
    },
  });
  const alreadyTagged = await alreadyTaggedLookup(isbn);
  assert.strictEqual(
    completeFallbackCalls,
    0,
    'ISBNBarcode must stay skipped when exact primary metadata already contains tags',
  );
  assert.deepStrictEqual(alreadyTagged.tags, ['fantasy']);

  const errorFetch = basePrimaryFetch(isbn, async () => {
    throw new Error('network down');
  });
  const errorLookup = createIsbnLookup({
    fetchImpl: errorFetch,
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const errorResult = await errorLookup(isbn, { includeDebug: true });
  assert.strictEqual(
    errorResult.debug.sourceStatus['isbnbarcode.org'],
    'error',
    'A network failure in tag enrichment must stay classified as error',
  );

  const timeoutFetch = basePrimaryFetch(isbn, async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });
  const timeoutLookup = createIsbnLookup({
    fetchImpl: timeoutFetch,
    env: {
      GOOGLE_BOOKS_API_KEY: 'test-key',
      BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
      BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
    },
  });
  const timeoutResult = await timeoutLookup(isbn, { includeDebug: true });
  assert.strictEqual(
    timeoutResult.debug.sourceStatus['isbnbarcode.org'],
    'timeout',
    'An aborted tag-enrichment request must stay classified as timeout',
  );

  console.log('ISBN tag fallback regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
