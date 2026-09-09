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
  const tagCache = new Map();
  const tagInflight = new Map();

  async function loadTags(isbn) {
    const normalized = impl.normalizeIsbn(isbn);
    const cacheKey = impl.toIsbn13(normalized) || normalized;
    const cached = tagCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.tags;
    if (cached) tagCache.delete(cacheKey);
    if (tagInflight.has(cacheKey)) return tagInflight.get(cacheKey);

    const promise = (async () => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let tags = [];
      try {
        if (typeof fetchImpl !== 'function') return tags;
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
        if (!response?.ok) return tags;

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

        const metadata = impl.parseIsbnBarcodeData(data, normalized);
        tags = uniqueStrings(metadata?.tags || []);
        return tags;
      } catch (_error) {
        return tags;
      } finally {
        if (timer) clearTimeout(timer);
        tagCache.set(cacheKey, {
          tags,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
    })();

    tagInflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      tagInflight.delete(cacheKey);
    }
  }

  return async function lookupWithTagFallback(isbn, lookupOptions = {}) {
    const result = await lookup(isbn, lookupOptions);
    const currentTags = Array.isArray(result?.tags) ? result.tags : [];
    const sources = Array.isArray(result?.sources) ? result.sources : [];
    const alreadyTried = sources.some((source) => String(source).toLowerCase() === 'isbnbarcode.org');
    const needsTagFallback = Boolean(
      result?.found
      && result.title
      && result.author
      && result.coverUrl
      && currentTags.length === 0
      && !alreadyTried
    );

    if (!needsTagFallback) return result;

    const fallbackTags = await loadTags(isbn);
    if (!fallbackTags.length) {
      if (!result?.debug) return result;
      return {
        ...result,
        debug: {
          ...result.debug,
          sourcesTried: uniqueStrings([...(result.debug.sourcesTried || []), 'isbnbarcode.org']),
          sourceStatus: {
            ...(result.debug.sourceStatus || {}),
            'isbnbarcode.org': 'not_found',
          },
        },
      };
    }

    return {
      ...result,
      tags: uniqueStrings([...currentTags, ...fallbackTags]),
      sources: uniqueStrings([...sources, 'isbnbarcode.org']),
      ...(result?.debug ? {
        debug: {
          ...result.debug,
          sourcesTried: uniqueStrings([...(result.debug.sourcesTried || []), 'isbnbarcode.org']),
          sourceStatus: {
            ...(result.debug.sourceStatus || {}),
            'isbnbarcode.org': 'found',
          },
        },
      } : {}),
    };
  };
}

module.exports = {
  ...impl,
  createIsbnLookup,
};
