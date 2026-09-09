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

function mergeFallbackMetadata(result, fallback) {
  if (!fallback?.found) return result;

  const base = result && typeof result === 'object' ? result : {};
  const baseFound = Boolean(base.found);
  const currentTags = Array.isArray(base.tags) ? base.tags : [];
  const currentSources = Array.isArray(base.sources) ? base.sources : [];
  const currentAuthors = Array.isArray(base.authors) ? base.authors : [];
  const fallbackAuthors = Array.isArray(fallback.authors) ? fallback.authors : [];
  const mergedAuthors = currentAuthors.length ? currentAuthors : fallbackAuthors;
  const mergedAuthor = base.author || fallback.author || mergedAuthors.join(', ');

  return {
    ...base,
    barcode: base.barcode || fallback.barcode || '',
    title: base.title || fallback.title || '',
    author: mergedAuthor,
    authors: mergedAuthors,
    description: base.description || fallback.description || '',
    publisher: base.publisher || fallback.publisher || '',
    publishedYear: base.publishedYear || fallback.publishedYear || null,
    publishedAt: base.publishedAt || fallback.publishedAt || '',
    pageCount: base.pageCount || fallback.pageCount || null,
    language: base.language || fallback.language || '',
    coverUrl: base.coverUrl || fallback.coverUrl || '',
    previewLink: base.previewLink || fallback.previewLink || '',
    tags: uniqueStrings([...currentTags, ...(fallback.tags || [])]),
    format: base.format || fallback.format || '',
    source: baseFound && base.source && base.source !== 'none'
      ? base.source
      : fallback.source || 'isbnbarcode.org',
    sources: uniqueStrings([...currentSources, fallback.source || 'isbnbarcode.org']),
    sourceUrl: base.sourceUrl || fallback.sourceUrl || '',
    matchLevel: baseFound && base.matchLevel && base.matchLevel !== 'none'
      ? base.matchLevel
      : fallback.matchLevel || 'exact_isbn',
    found: true,
  };
}

function withIsbnBarcodeConfiguredDebug(result) {
  if (!result?.debug) return result;
  return {
    ...result,
    debug: {
      ...result.debug,
      sourcesConfigured: uniqueStrings([
        ...(result.debug.sourcesConfigured || []),
        'isbnbarcode.org',
      ]),
      isbnbarcode: {
        ...(result.debug.isbnbarcode || {}),
        enabled: true,
      },
    },
  };
}

function createIsbnLookup(options = {}) {
  const env = options.env || process.env;
  const enabled = String(env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true';
  const baseFetchImpl = options.fetchImpl || global.fetch;

  // The wrapper owns the optional ISBNBarcode fallback so parsing, exact-ISBN
  // validation, cache semantics and source priority all use one code path.
  const innerEnv = enabled
    ? { ...env, BOEKENBAAI_ENABLE_ISBNBARCODE: 'false' }
    : env;
  const lookup = impl.createIsbnLookup({ ...options, env: innerEnv, fetchImpl: baseFetchImpl });
  if (!enabled) return lookup;

  const timeoutMs = positiveMs(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = positiveMs(env.BOEKENBAAI_ISBN_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  const negativeCacheTtlMs = positiveMs(
    env.BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS,
    cacheTtlMs,
  );
  const isbnBarcodeBase = String(
    env.BOEKENBAAI_ISBN_API_BASE || 'https://isbnbarcode.org/api',
  ).replace(/\/$/, '');
  const userAgent = String(
    env.BOEKENBAAI_ISBN_USER_AGENT
    || 'Boekenbaai/1.0 school-library ISBN metadata lookup',
  );
  const fallbackCache = new Map();
  const fallbackInflight = new Map();

  async function loadFallback(isbn) {
    const normalized = impl.normalizeIsbn(isbn);
    const cacheKey = impl.toIsbn13(normalized) || normalized;
    const cached = fallbackCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cacheHit: true };
    }
    if (cached) fallbackCache.delete(cacheKey);
    if (fallbackInflight.has(cacheKey)) {
      const value = await fallbackInflight.get(cacheKey);
      return { ...value, cacheHit: false, joinedInflight: true };
    }

    const promise = (async () => {
      if (typeof baseFetchImpl !== 'function') {
        return { metadata: null, status: 'error', requestUrls: [] };
      }

      let sawError = false;
      let sawTimeout = false;
      const requestUrls = [];

      for (const candidate of impl.getEquivalentIsbns(normalized)) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        const requestUrl = `${isbnBarcodeBase}/${encodeURIComponent(candidate)}`;
        requestUrls.push(requestUrl);

        try {
          const response = await baseFetchImpl(
            requestUrl,
            {
              headers: {
                Accept: 'application/json',
                'User-Agent': userAgent,
              },
              ...(controller ? { signal: controller.signal } : {}),
            },
          );

          if (response?.status === 204) continue;
          if (!response?.ok) {
            if (response?.status !== 404) sawError = true;
            continue;
          }

          let data = null;
          const contentType = response.headers?.get?.('content-type') || '';
          if (contentType.includes('application/json') && typeof response.json === 'function') {
            data = await response.json();
          } else if (typeof response.text === 'function') {
            const text = await response.text();
            if (!text.trim()) {
              sawError = true;
              continue;
            }
            try {
              data = JSON.parse(text);
            } catch (_error) {
              sawError = true;
              continue;
            }
          } else if (typeof response.json === 'function') {
            data = await response.json();
          } else {
            sawError = true;
            continue;
          }

          const metadata = impl.parseIsbnBarcodeData(data, normalized);
          if (metadata?.found) {
            const value = { metadata, status: 'found', requestUrls };
            fallbackCache.set(cacheKey, {
              value,
              expiresAt: Date.now() + cacheTtlMs,
            });
            return value;
          }
        } catch (error) {
          if (error?.name === 'AbortError') sawTimeout = true;
          else sawError = true;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      const status = sawError ? 'error' : sawTimeout ? 'timeout' : 'not_found';
      const value = { metadata: null, status, requestUrls };
      if (status === 'not_found') {
        fallbackCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + negativeCacheTtlMs,
        });
      }
      return value;
    })();

    fallbackInflight.set(cacheKey, promise);
    try {
      return { ...(await promise), cacheHit: false };
    } finally {
      fallbackInflight.delete(cacheKey);
    }
  }

  return async function lookupWithFallbackEnrichment(isbn, lookupOptions = {}) {
    const rawResult = await lookup(isbn, lookupOptions);
    const result = withIsbnBarcodeConfiguredDebug(rawResult);
    const normalized = impl.normalizeIsbn(isbn);
    if (!impl.isValidIsbn(normalized)) return result;

    const currentTags = Array.isArray(result?.tags) ? result.tags : [];
    const coreComplete = Boolean(
      result?.found
      && result.title
      && result.author
      && result.coverUrl
    );
    if (coreComplete && currentTags.length > 0) return result;

    const fallback = await loadFallback(normalized);
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
        sourcesTried: uniqueStrings([
          ...(result.debug.sourcesTried || []),
          'isbnbarcode.org',
        ]),
        sourceStatus: {
          ...(result.debug.sourceStatus || {}),
          'isbnbarcode.org': fallback.status,
        },
        isbnbarcode: {
          ...(result.debug.isbnbarcode || {}),
          enabled: true,
          requestUrl: fallback.requestUrls?.[0] || '',
          requestUrls: fallback.requestUrls || [],
        },
      },
    };
  };
}

module.exports = {
  ...impl,
  createIsbnLookup,
};
