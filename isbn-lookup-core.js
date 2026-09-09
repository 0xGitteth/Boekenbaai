'use strict';

const impl = require('./isbn-lookup-core-impl');

const DEFAULT_TIMEOUT_MS = 2800;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function toStrings(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(toStrings);
  if (typeof value === 'object') {
    const nested = value.name ?? value.label ?? value.value ?? value.text;
    return nested === undefined ? [] : toStrings(nested);
  }
  const text = String(value).trim();
  return text ? [text] : [];
}

function collectExplicitIdentifiers(data) {
  if (!data || typeof data !== 'object') return [];
  const raw = [
    data.isbn,
    data.ean,
    data.isbn13,
    data.isbn_13,
    data.isbn10,
    data.isbn_10,
    data.barcode,
  ];
  return raw.flatMap((entry) => (
    Array.isArray(entry) ? entry : entry === undefined || entry === null ? [] : [entry]
  )).map(impl.normalizeIsbn).filter(Boolean);
}

function parseIsbnBarcodeData(data, targetIsbn) {
  const parsed = impl.parseIsbnBarcodeData(data, targetIsbn);
  if (parsed) return parsed;
  if (!data || typeof data !== 'object') return null;

  const family = new Set(impl.getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;
  const explicitIdentifiers = collectExplicitIdentifiers(data);
  if (explicitIdentifiers.length
    && !explicitIdentifiers.some((identifier) => family.has(identifier))) {
    return null;
  }

  const tags = uniqueStrings(
    toStrings(data.categories || data.subjects || data.tags)
      .map((entry) => entry.toLowerCase()),
  );
  if (!tags.length) return null;

  return {
    barcode: impl.normalizeIsbn(targetIsbn),
    title: '',
    author: '',
    authors: [],
    description: '',
    publisher: '',
    publishedAt: '',
    publishedYear: null,
    pageCount: null,
    language: '',
    coverUrl: '',
    tags,
    source: 'isbnbarcode.org',
    matchLevel: 'exact_isbn',
    found: true,
  };
}

function mergeFallbackMetadata(result, fallback) {
  if (!fallback?.found) return result;
  const currentTags = Array.isArray(result?.tags) ? result.tags : [];
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const currentAuthors = Array.isArray(result?.authors) ? result.authors : [];
  const fallbackAuthors = Array.isArray(fallback?.authors) ? fallback.authors : [];

  return {
    ...result,
    title: result.title || fallback.title || '',
    author: result.author || fallback.author || '',
    authors: currentAuthors.length ? currentAuthors : fallbackAuthors,
    description: result.description || fallback.description || '',
    publisher: result.publisher || fallback.publisher || '',
    publishedYear: result.publishedYear || fallback.publishedYear || null,
    publishedAt: result.publishedAt || fallback.publishedAt || '',
    pageCount: result.pageCount || fallback.pageCount || null,
    language: result.language || fallback.language || '',
    coverUrl: result.coverUrl || fallback.coverUrl || '',
    tags: uniqueStrings([...currentTags, ...(fallback.tags || [])]),
    format: result.format || fallback.format || '',
    sources: uniqueStrings([...sources, 'isbnbarcode.org']),
  };
}

function createIsbnLookup(options = {}) {
  const lookup = impl.createIsbnLookup(options);
  const env = options.env || process.env;
  const enabled = String(env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true';
  if (!enabled) return lookup;

  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = positiveMs(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = positiveMs(env.BOEKENBAAI_ISBN_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  const isbnBarcodeBase = String(env.BOEKENBAAI_ISBN_API_BASE || 'https://isbnbarcode.org/api').replace(/\/$/, '');
  const userAgent = String(env.BOEKENBAAI_ISBN_USER_AGENT || 'Boekenbaai/1.0 school-library ISBN metadata lookup');
  const fallbackCache = new Map();
  const fallbackInflight = new Map();

  async function loadFallback(isbn) {
    const normalized = impl.normalizeIsbn(isbn);
    const cacheKey = impl.toIsbn13(normalized) || normalized;
    const cached = fallbackCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) fallbackCache.delete(cacheKey);
    if (fallbackInflight.has(cacheKey)) return fallbackInflight.get(cacheKey);

    const promise = (async () => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let value = { metadata: null, status: 'not_found' };
      try {
        if (typeof fetchImpl !== 'function') {
          value = { metadata: null, status: 'error' };
          return value;
        }
        const response = await fetchImpl(
          `${isbnBarcodeBase}/${encodeURIComponent(normalized)}`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': userAgent,
            },
            ...(controller ? { signal: controller.signal } : {}),
          },
        );
        if (!response?.ok) return value;

        let data = null;
        const contentType = response.headers?.get?.('content-type') || '';
        if (contentType.includes('application/json') && typeof response.json === 'function') {
          data = await response.json();
        } else if (typeof response.text === 'function') {
          const text = await response.text();
          try { data = JSON.parse(text); } catch (_error) { data = null; }
        } else if (typeof response.json === 'function') {
          data = await response.json();
        }

        const metadata = parseIsbnBarcodeData(data, normalized);
        value = {
          metadata,
          status: metadata?.found ? 'found' : 'not_found',
        };
        return value;
      } catch (error) {
        value = {
          metadata: null,
          status: error?.name === 'AbortError' ? 'timeout' : 'error',
        };
        return value;
      } finally {
        if (timer) clearTimeout(timer);
        fallbackCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
    })();

    fallbackInflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      fallbackInflight.delete(cacheKey);
    }
  }

  return async function lookupWithFallbackEnrichment(isbn, lookupOptions = {}) {
    const result = await lookup(isbn, lookupOptions);
    const currentTags = Array.isArray(result?.tags) ? result.tags : [];
    const sources = Array.isArray(result?.sources) ? result.sources : [];
    const alreadyTried = sources.some((source) => String(source).toLowerCase() === 'isbnbarcode.org');
    const needsFallback = Boolean(
      result?.found
      && result.title
      && result.author
      && result.coverUrl
      && currentTags.length === 0
      && !alreadyTried
    );

    if (!needsFallback) return result;

    const fallback = await loadFallback(isbn);
    const enriched = mergeFallbackMetadata(result, fallback.metadata);
    if (!result?.debug) return enriched;

    return {
      ...enriched,
      debug: {
        ...result.debug,
        sourcesTried: uniqueStrings([...(result.debug.sourcesTried || []), 'isbnbarcode.org']),
        sourceStatus: {
          ...(result.debug.sourceStatus || {}),
          'isbnbarcode.org': fallback.status,
        },
      },
    };
  };
}

module.exports = {
  ...impl,
  parseIsbnBarcodeData,
  createIsbnLookup,
};
