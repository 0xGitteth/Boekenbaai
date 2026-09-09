'use strict';

const assert = require('assert');
const { createIsbnLookup } = require('../isbn-lookup-core');

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

async function run() {
  const isbn = '9789059965607';

  let missingTagsFallbackCalls = 0;
  const missingTagsFetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('metadata.isbn.nl/search')) {
      return response('<div id="werk"></div>', { contentType: 'text/html' });
    }
    if (textUrl.includes('googleapis.com/books')) return response(googlePayload(isbn));
    if (textUrl.includes('openlibrary.org')) return response({}, { status: 404 });
    if (textUrl.includes('isbnbarcode.org/api')) {
      missingTagsFallbackCalls += 1;
      return response({
        isbn,
        title: 'Titel die niet mag winnen',
        author: 'Auteur die niet mag winnen',
        cover_url: 'https://example.test/fallback-cover.jpg',
        categories: ['Jeugd', 'Fantasy'],
      });
    }
    throw new Error(`Unexpected request ${textUrl}`);
  };

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
    'Tag enrichment must not overwrite higher-priority exact title metadata',
  );
  assert.strictEqual(enriched.author, 'Primaire auteur');
  assert.strictEqual(enriched.coverUrl, 'https://example.test/primary-cover.jpg');
  assert.ok(enriched.sources.includes('Google Books'));
  assert.ok(enriched.sources.includes('isbnbarcode.org'));

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

  console.log('ISBN tag fallback regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
