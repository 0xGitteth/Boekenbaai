from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: source block not found')
    return text.replace(old, new, 1)


impl_path = Path('isbn-lookup-core-impl.js')
impl = impl_path.read_text()

impl = replace_once(
    impl,
    """function absoluteCbUrl(value) {
  const url = String(value || '').trim();
  if (!url || /no-image-available/i.test(url)) return '';
  if (/^https?:\\/\\//i.test(url)) return url.replace(/^http:/i, 'https:');
  return `${CB_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
""",
    """function absoluteCbUrl(value) {
  const url = String(value || '').trim();
  if (!url || /no-image-available/i.test(url)) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (/^https?:\\/\\//i.test(url)) return url.replace(/^http:/i, 'https:');
  return `${CB_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
""",
    'protocol-relative CB cover URLs',
)

impl = replace_once(
    impl,
    """  const languageKey = text.match(/\\/languages\\/([a-z]{2,3})\\b/i);
  if (languageKey) return languageKey[1].toLowerCase();
  if (/^[a-z]{2,3}$/i.test(text)) return text;
  return stripHtml(value);
}
""",
    """  const iso6393To1 = {
    eng: 'en',
    nld: 'nl',
    dut: 'nl',
    deu: 'de',
    ger: 'de',
    fra: 'fr',
    fre: 'fr',
    spa: 'es',
    tur: 'tr',
  };
  const languageKey = text.match(/\\/(?:languages|l)\\/([a-z]{2,3})\\b/i);
  if (languageKey) {
    const code = languageKey[1].toLowerCase();
    return iso6393To1[code] || code;
  }
  if (/^[a-z]{2,3}$/i.test(text)) return iso6393To1[text] || text;
  return stripHtml(value);
}
""",
    'Open Library language normalization',
)

impl = replace_once(
    impl,
    """function splitCbEditionBlocks(html) {
  const source = String(html || '');
  const marker = /<div\\s+class=[\"']uitv[\"']\\s*>/gi;
  const starts = [];
""",
    """function splitCbEditionBlocks(html) {
  const source = String(html || '');
  const marker = /<div\\b[^>]*class=[\"'][^\"']*\\buitv\\b[^\"']*[\"'][^>]*>/gi;
  const starts = [];
""",
    'robust CB edition block marker',
)

impl = replace_once(
    impl,
    """function extractCbNurTags(html) {
  const match = String(html || '').match(
    /<dt>\\s*NUR code\\(s\\)\\s*<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>/i,
  );
  if (!match) return [];
  return Array.from(new Set(
    Array.from(match[1].matchAll(/<a[^>]*>([\\s\\S]*?)<\\/a>/gi))
      .map((entry) => stripHtml(entry[1]).replace(/^\\d{3}\\s+/, '').trim().toLowerCase())
      .filter(Boolean),
  ));
}
""",
    """function parseNurTags(fragment) {
  const anchors = Array.from(String(fragment || '').matchAll(/<a[^>]*>([\\s\\S]*?)<\\/a>/gi))
    .map((entry) => stripHtml(entry[1]).replace(/^\\d{3}\\s+/, '').trim().toLowerCase())
    .filter(Boolean);
  if (anchors.length) return Array.from(new Set(anchors));

  const plain = stripHtml(fragment);
  const values = [];
  for (const match of plain.matchAll(/(?:^|\\s)\\d{3}\\s+(.+?)(?=\\s+\\d{3}\\s+|$)/g)) {
    const label = String(match[1] || '').trim().toLowerCase();
    if (label) values.push(label);
  }
  return Array.from(new Set(values));
}

function extractCbNurTags(html) {
  const match = String(html || '').match(
    /<dt>\\s*NUR code\\(s\\)\\s*<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>/i,
  );
  return match ? parseNurTags(match[1]) : [];
}

function extractCbEditionNurTags(block) {
  const match = String(block || '').match(
    /<span>\\s*NUR\\s*<\\/span>([\\s\\S]*?)(?=<span>|$)/i,
  );
  return match ? parseNurTags(match[1]) : [];
}
""",
    'exact-edition NUR parsing',
)

impl = replace_once(
    impl,
    """  const coverUrl = absoluteCbUrl(coverMatch?.[1] || '');

  return {
""",
    """  const coverUrl = absoluteCbUrl(coverMatch?.[1] || '');
  const editionNurTags = extractCbEditionNurTags(exactBlock);
  const tags = editionNurTags.length ? editionNurTags : extractCbNurTags(html);

  return {
""",
    'CB edition NUR selection',
)

impl = replace_once(
    impl,
    """    coverUrl,
    tags: extractCbNurTags(html),
    format: formatMatch ? stripHtml(formatMatch[1]) : '',
    source: 'Bureau ISBN',
    sourceUrl: extractMeta(html, 'og:url'),
    matchLevel: 'exact_isbn',
    found: Boolean(
      title
      || authors.length
      || description
      || editionPublisher
      || workPublisher
      || coverUrl
    ),
""",
    """    coverUrl,
    tags,
    format: formatMatch ? stripHtml(formatMatch[1]) : '',
    source: 'Bureau ISBN',
    sourceUrl: extractMeta(html, 'og:url'),
    matchLevel: 'exact_isbn',
    // Reaching this point means an ISBN from the requested equivalence family
    // was present in this edition block. An incomplete exact record is still found.
    found: true,
""",
    'CB incomplete exact record semantics',
)

impl = replace_once(
    impl,
    """function splitGoogleCategory(value) {
  return String(value || '')
    .split(/\\s*\\/\\s*|\\s*;\\s*|\\s*>\\s*|\\s+[–-]\\s+/)
""",
    """function splitGoogleCategory(value) {
  return String(value || '')
    .split(/\\s*\\/\\s*|\\s*;\\s*|\\s*>\\s*|\\s+[–-]\\s+|\\s+[–-]|[–-]\\s+/)
""",
    'one-sided Google category separators',
)

impl = replace_once(
    impl,
    """    const score = [
      info.title,
      Array.isArray(info.authors) && info.authors.length,
      info.description,
      info.publisher,
      info.pageCount,
      info.imageLinks?.extraLarge
        || info.imageLinks?.large
        || info.imageLinks?.medium
        || info.imageLinks?.thumbnail,
    ].filter(Boolean).length;
""",
    """    const score = [
      info.title,
      Array.isArray(info.authors) && info.authors.length,
      info.description,
      info.publisher,
      info.publishedDate,
      info.pageCount,
      info.language,
      info.mainCategory || (Array.isArray(info.categories) && info.categories.length),
      info.imageLinks?.extraLarge
        || info.imageLinks?.large
        || info.imageLinks?.medium
        || info.imageLinks?.small
        || info.imageLinks?.thumbnail
        || info.imageLinks?.smallThumbnail,
    ].filter(Boolean).length;
""",
    'Google exact candidate richness scoring',
)

impl = replace_once(
    impl,
    """    found: Boolean(
      data.title
      || authors.length
      || publishers.length
      || coverId
      || data.number_of_pages
      || description
    ),
""",
    """    // A successful ISBN edition object is exact evidence even when its
    // bibliographic fields are sparse; do not turn exact-but-incomplete into a miss.
    found: Boolean(
      data.key
      || returnedIsbns.length
      || data.title
      || authors.length
      || publishers.length
      || coverId
      || data.number_of_pages
      || description
    ),
""",
    'Open Library incomplete exact record semantics',
)

impl_path.write_text(impl)

wrapper_path = Path('isbn-lookup-core.js')
wrapper = wrapper_path.read_text()

wrapper = replace_once(
    wrapper,
    """    const cached = fallbackCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) fallbackCache.delete(cacheKey);
    if (fallbackInflight.has(cacheKey)) return fallbackInflight.get(cacheKey);
""",
    """    const cached = fallbackCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cacheHit: true };
    }
    if (cached) fallbackCache.delete(cacheKey);
    if (fallbackInflight.has(cacheKey)) {
      const value = await fallbackInflight.get(cacheKey);
      return { ...value, cacheHit: false, joinedInflight: true };
    }
""",
    'fallback cache provenance',
)

wrapper = replace_once(
    wrapper,
    """          if (!response?.ok) {
            if (response?.status !== 404) sawError = true;
            continue;
          }

          let data = null;
""",
    """          if (response?.status === 204) continue;
          if (!response?.ok) {
            if (response?.status !== 404) sawError = true;
            continue;
          }

          let data = null;
""",
    'ISBNBarcode 204 classification',
)

wrapper = replace_once(
    wrapper,
    """    fallbackInflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      fallbackInflight.delete(cacheKey);
    }
""",
    """    fallbackInflight.set(cacheKey, promise);
    try {
      return { ...(await promise), cacheHit: false };
    } finally {
      fallbackInflight.delete(cacheKey);
    }
""",
    'live fallback cache provenance',
)

wrapper = replace_once(
    wrapper,
    """    const fallback = await loadFallback(normalized);
    const enriched = mergeFallbackMetadata(result, fallback.metadata);
    if (!result?.debug) return enriched;

    return {
      ...enriched,
      debug: {
        ...enriched.debug,
""",
    """    const fallback = await loadFallback(normalized);
    const enriched = {
      ...mergeFallbackMetadata(result, fallback.metadata),
      // This lookup is a cache hit only when every required layer was served
      // from cache. A live fallback request makes the overall result fresh.
      cacheHit: Boolean(result?.cacheHit && fallback.cacheHit),
    };
    if (!result?.debug) return enriched;

    return {
      ...enriched,
      debug: {
        ...enriched.debug,
        cacheHit: enriched.cacheHit,
""",
    'whole-lookup cacheHit semantics',
)

wrapper_path.write_text(wrapper)

test_path = Path('tests/isbn-wrapper-hardening.test.js')
test = test_path.read_text()
needle = "  console.log('ISBN wrapper hardening regression tests passed');\n"
if needle not in test:
    raise SystemExit('test insertion point not found')

addition = r'''  const oneSidedCategories = implDirect.parseGoogleBooksData({
    items: [{
      volumeInfo: {
        title: 'Categorie test',
        authors: ['Auteur'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
        categories: ['Self-Help', 'Fiction- Young Adult', 'History -War'],
      },
    }],
  }, isbn);
  assert.deepStrictEqual(
    oneSidedCategories.tags,
    ['self-help', 'fiction', 'young adult', 'history', 'war'],
    'One-sided spaced hierarchy hyphens must split without breaking in-word hyphens',
  );

  const duplicateExactGoogle = implDirect.parseGoogleBooksData({
    items: [
      {
        volumeInfo: {
          title: 'Exact zonder cover',
          authors: ['Auteur'],
          industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
        },
      },
      {
        volumeInfo: {
          title: 'Exact met kleine cover',
          authors: ['Auteur'],
          industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
          imageLinks: { smallThumbnail: 'http://books.google.com/small-only.jpg' },
        },
      },
    ],
  }, isbn);
  assert.strictEqual(
    duplicateExactGoogle.coverUrl,
    'https://books.google.com/small-only.jpg',
    'Exact Google candidates with small/smallThumbnail covers must receive cover richness credit',
  );

  const openLibraryLanguage = implDirect.parseOpenLibraryData({
    key: '/books/OL123M',
    isbn_13: [isbn],
    languages: [{ key: '/languages/eng' }],
  }, isbn);
  assert.ok(openLibraryLanguage?.found, 'Sparse exact Open Library edition objects must stay found');
  assert.strictEqual(
    openLibraryLanguage.language,
    'en',
    'Open Library ISO-639-3 language keys must normalize to the same two-letter code used by Google',
  );

  const sparseCbHtml = [
    '<dl><dt>NUR code(s)</dt><dd><a>999 Verkeerde werktag</a></dd></dl>',
    '<div class="card uitv extra" data-edition="1">',
    '<div class="uvlabel">Paperback</div>',
    '<a class="fancybox" href="//cdn.example.test/exact-cover.jpg"></a>',
    `<span>ISBN</span><br>${isbn}<br><br>`,
    '<span>verschijningsdatum</span><br>09/09/2026<br>',
    '<div class="hidden pd-block">',
    '<span>NUR</span><div><a>493 Puzzelboeken</a></div>',
    '<span>taal</span> Engels<br>',
    '</div>',
    '</div>',
  ].join('');
  const sparseCb = parseCbDetailHtml(sparseCbHtml, isbn);
  assert.ok(sparseCb?.found, 'An exact CB edition block must stay found even when work metadata is sparse');
  assert.strictEqual(sparseCb.language, 'en');
  assert.strictEqual(sparseCb.coverUrl, 'https://cdn.example.test/exact-cover.jpg');
  assert.deepStrictEqual(
    sparseCb.tags,
    ['puzzelboeken'],
    'Exact-edition NUR tags must win over broader work-level NUR tags when present',
  );

  const realNowForFallback = Date.now;
  let fallbackNow = 2_000_000;
  Date.now = () => fallbackNow;
  try {
    let noContentFallbackCalls = 0;
    const noContentLookup = createIsbnLookup({
      fetchImpl: primaryFetch({
        isbn,
        google: googlePayload(isbn, {
          imageLinks: { thumbnail: 'https://example.test/google-cover.jpg' },
        }),
        fallback: async () => {
          noContentFallbackCalls += 1;
          return response('', { status: 204, contentType: '' });
        },
      }),
      env: {
        GOOGLE_BOOKS_API_KEY: 'test-key',
        BOEKENBAAI_ENABLE_ISBNBARCODE: 'true',
        BOEKENBAAI_DEBUG_ISBN_LOOKUP: 'true',
        BOEKENBAAI_ISBN_CACHE_TTL_MS: '300000',
        BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS: '1000',
      },
    });

    const noContentFirst = await noContentLookup(isbn, { includeDebug: true });
    assert.strictEqual(noContentFirst.cacheHit, false);
    assert.strictEqual(noContentFirst.debug.sourceStatus['isbnbarcode.org'], 'not_found');
    assert.strictEqual(noContentFallbackCalls, 2);

    fallbackNow += 500;
    const noContentCached = await noContentLookup(isbn, { includeDebug: true });
    assert.strictEqual(noContentCached.cacheHit, true);
    assert.strictEqual(noContentCached.debug.cacheHit, true);
    assert.strictEqual(noContentFallbackCalls, 2);

    fallbackNow += 600;
    const noContentRetried = await noContentLookup(isbn, { includeDebug: true });
    assert.strictEqual(noContentFallbackCalls, 4);
    assert.strictEqual(
      noContentRetried.cacheHit,
      false,
      'A live supplemental fallback retry must make the whole lookup a non-cache hit',
    );
    assert.strictEqual(noContentRetried.debug.cacheHit, false);
  } finally {
    Date.now = realNowForFallback;
  }

'''

test_path.write_text(test.replace(needle, addition + needle, 1))
