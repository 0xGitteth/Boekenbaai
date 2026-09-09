'use strict';

const assert = require('assert');
const {
  isValidIsbn,
  toIsbn10,
  toIsbn13,
  getEquivalentIsbns,
  extractCbSearchDetailPath,
  parseCbDetailHtml,
  parseGoogleBooksData,
  mergeExactMetadata,
  createIsbnLookup,
} = require('../isbn-lookup-core');

function response(body, { status = 200, json = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' && !json ? JSON.parse(body) : body;
    },
  };
}

async function run() {
  assert.strictEqual(isValidIsbn('9789059965607'), true);
  assert.strictEqual(isValidIsbn('9059965604'), true);
  assert.strictEqual(toIsbn10('9789059965607'), '9059965604');
  assert.strictEqual(toIsbn13('9059965604'), '9789059965607');
  assert.deepStrictEqual(
    getEquivalentIsbns('9789059965607').sort(),
    ['9059965604', '9789059965607'].sort(),
  );
  assert.strictEqual(isValidIsbn('9789059965608'), false);

  const searchHtml = `
    <div class="iesearch">
      <ul id="tabs"><li><a href="#werk">Werken</a></li></ul>
      <div class="tab-pane active" id="werk">
        <div class="span2 wrk"><div><a href="/2095701/murdoku-terug-in-de-tijd.html">Murdoku</a></div></div>
      </div>
    </div>
    <footer><a href="/999999/top-33-result.html">Niet het zoekresultaat</a></footer>`;
  assert.strictEqual(
    extractCbSearchDetailPath(searchHtml),
    '/2095701/murdoku-terug-in-de-tijd.html',
  );

  const noResultHtml = `
    <div class="iesearch"><h1>Zoekresultaten</h1><p>Geen resultaten</p></div>
    <footer><a href="/999999/top-33-result.html">Top 33</a></footer>`;
  assert.strictEqual(
    extractCbSearchDetailPath(noResultHtml),
    '',
    'Footer links must never be mistaken for ISBN search results',
  );

  const cbDetailHtml = `
    <html><head>
      <meta name="og:title" content="Murdoku Terug in de tijd" />
      <meta name="og:url" content="https://metadata.isbn.nl/2095701/murdoku-terug-in-de-tijd.html" />
      <meta name="og:image" content="https://metadata.isbn.nl/ie_fcache/work-cover.jpg" />
      <meta name="og:description" content="Exacte beschrijving van het werk." />
    </head><body>
      <dl>
        <dt>Auteur(s)</dt><dd><a>Manuel Garand</a></dd>
        <dt>NUR code(s)</dt><dd><a>493 Puzzelboeken</a><br /><a>494 Spelen, spelletjes</a></dd>
        <dt>Uitgever(s)</dt><dd><a>Werkuitgever</a></dd>
      </dl>
      <h2>dit werk kent de volgende uitvoeringen</h2>
      <div class="uitv">
        <div class="uvlabel">Paperback</div>
        <a class="fancybox" rel="ieoi" href="/ie_fcache/paperback.jpg"><img /></a>
        <div class="uitvinfo">
          <span>ISBN</span></br>9789059965607<br /><br />
          <span>verschijningsdatum</span></br>22/05/2026<br />
          <div class="hidden pd-block">
            <span>uitgever</span> <div><a>Terra - Lannoo, Uitgeverij</a></div>
            <span>taal</span> Engels<br />
          </div>
        </div>
      </div>
      <div class="uitv">
        <div class="uvlabel">E-book (epub)</div>
        <a class="fancybox" rel="ieoi" href="/ie_fcache/ebook.jpg"><img /></a>
        <div class="uitvinfo">
          <span>ISBN</span></br>9789059969575<br /><br />
          <span>verschijningsdatum</span></br>26/05/2026<br />
          <div class="hidden pd-block">
            <span>uitgever</span> <div><a>Andere digitale uitgever</a></div>
            <span>taal</span> Nederlands<br />
          </div>
        </div>
      </div>
    </body></html>`;

  const cbMetadata = parseCbDetailHtml(cbDetailHtml, '9789059965607');
  assert.ok(cbMetadata, 'Expected exact CB edition match');
  assert.strictEqual(cbMetadata.title, 'Murdoku Terug in de tijd');
  assert.strictEqual(cbMetadata.author, 'Manuel Garand');
  assert.strictEqual(cbMetadata.publisher, 'Terra - Lannoo, Uitgeverij');
  assert.strictEqual(cbMetadata.language, 'en');
  assert.strictEqual(cbMetadata.publishedYear, 2026);
  assert.strictEqual(cbMetadata.format, 'Paperback');
  assert.strictEqual(cbMetadata.coverUrl, 'https://metadata.isbn.nl/ie_fcache/paperback.jpg');
  assert.deepStrictEqual(cbMetadata.tags, ['puzzelboeken', 'spelen, spelletjes']);

  const cbEquivalent = parseCbDetailHtml(cbDetailHtml, '9059965604');
  assert.ok(cbEquivalent, 'ISBN-10 should match the mathematically equivalent ISBN-13 edition');
  assert.strictEqual(cbEquivalent.publisher, 'Terra - Lannoo, Uitgeverij');
  assert.strictEqual(cbEquivalent.language, 'en');

  const otherEdition = parseCbDetailHtml(cbDetailHtml, '9789059969575');
  assert.ok(otherEdition);
  assert.strictEqual(otherEdition.publisher, 'Andere digitale uitgever');
  assert.strictEqual(otherEdition.language, 'nl');
  assert.strictEqual(otherEdition.format, 'E-book (epub)');
  assert.strictEqual(otherEdition.coverUrl, 'https://metadata.isbn.nl/ie_fcache/ebook.jpg');

  const googleFromIsbn10 = parseGoogleBooksData({
    items: [{
      volumeInfo: {
        title: 'Murdoku Terug in de tijd',
        authors: ['Manuel Garand'],
        industryIdentifiers: [{ type: 'ISBN_10', identifier: '9059965604' }],
        pageCount: 192,
        publisher: 'Google uitgever',
        language: 'en',
        imageLinks: { thumbnail: 'http://books.google.com/exact.jpg' },
      },
    }],
  }, '9789059965607');
  assert.ok(googleFromIsbn10, 'Equivalent ISBN-10 must count as the exact same edition');
  assert.strictEqual(googleFromIsbn10.pageCount, 192);
  assert.strictEqual(googleFromIsbn10.coverUrl, 'https://books.google.com/exact.jpg');

  const googleWrongEdition = parseGoogleBooksData({
    items: [{
      volumeInfo: {
        title: 'Murdoku Terug in de tijd',
        authors: ['Manuel Garand'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789059969575' }],
        pageCount: 190,
      },
    }],
  }, '9789059965607');
  assert.strictEqual(googleWrongEdition, null, 'A different edition must not be accepted in the exact stage');

  const merged = mergeExactMetadata({ cb: cbMetadata, google: googleFromIsbn10 }, '9789059965607');
  assert.strictEqual(merged.publisher, 'Terra - Lannoo, Uitgeverij', 'Exact CB edition fields should win');
  assert.strictEqual(merged.pageCount, 192, 'Google may fill an exact-edition field that CB lacks');
  assert.strictEqual(merged.coverUrl, 'https://metadata.isbn.nl/ie_fcache/paperback.jpg');
  assert.deepStrictEqual(merged.sources, ['Bureau ISBN', 'Google Books']);

  const requests = [];
  const fetchImpl = async (url) => {
    const textUrl = String(url);
    requests.push(textUrl);
    if (textUrl.startsWith('https://metadata.isbn.nl/search.html')) return response(searchHtml);
    if (textUrl === 'https://metadata.isbn.nl/2095701/murdoku-terug-in-de-tijd.html') return response(cbDetailHtml);
    if (textUrl.startsWith('https://www.googleapis.com/books/v1/volumes')) {
      return response({
        items: [{
          volumeInfo: {
            title: 'Murdoku Terug in de tijd',
            authors: ['Manuel Garand'],
            industryIdentifiers: [{ type: 'ISBN_10', identifier: '9059965604' }],
            pageCount: 192,
            language: 'en',
          },
        }],
      }, { json: true });
    }
    if (textUrl === 'https://openlibrary.org/isbn/9789059965607.json') return response({}, { status: 404, json: true });
    if (textUrl === 'https://openlibrary.org/isbn/9059965604.json') return response({}, { status: 404, json: true });
    throw new Error(`Unexpected request ${textUrl}`);
  };

  const lookup = createIsbnLookup({
    fetchImpl,
    env: { GOOGLE_BOOKS_API_KEY: 'test-key' },
    timeoutMs: 1000,
  });
  const result = await lookup('9789059965607');
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.matchLevel, 'exact_isbn');
  assert.strictEqual(result.publisher, 'Terra - Lannoo, Uitgeverij');
  assert.strictEqual(result.pageCount, 192);
  assert.ok(requests.some((url) => url.includes('metadata.isbn.nl/search.html?search=9789059965607')));

  const requestsBeforeCache = requests.length;
  const cached = await lookup('9059965604');
  assert.strictEqual(cached.cacheHit, true, 'ISBN-10 and ISBN-13 should share one cache entry');
  assert.strictEqual(requests.length, requestsBeforeCache, 'Cached equivalent ISBN must not perform network requests');

  console.log('ISBN exact-edition enrichment tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
