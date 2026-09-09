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

function decodeHtml(value) {
  const named = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    bull: '•',
  };
  const decodeCodePoint = (match, codePoint) => {
    const valueNumber = Number(codePoint);
    if (!Number.isInteger(valueNumber)
      || valueNumber < 0
      || valueNumber > 0x10FFFF
      || (valueNumber >= 0xD800 && valueNumber <= 0xDFFF)) {
      return match;
    }
    return String.fromCodePoint(valueNumber);
  };

  return String(value || '')
    .replace(/&#(\d+);/g, (match, code) => decodeCodePoint(match, Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => (
      decodeCodePoint(match, Number.parseInt(code, 16))
    ))
    .replace(/&([a-z]+);/gi, (match, name) => (
      Object.prototype.hasOwnProperty.call(named, name.toLowerCase())
        ? named[name.toLowerCase()]
        : match
    ));
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(String(tag || '')))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[3]);
  }
  return attrs;
}

function scanOpeningTags(html, tagName) {
  const source = String(html || '');
  const lower = source.toLowerCase();
  const needle = `<${String(tagName || '').toLowerCase()}`;
  const tags = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = lower.indexOf(needle, cursor);
    if (start < 0) break;
    const boundary = lower[start + needle.length] || '';
    if (boundary && !/[\s/>]/.test(boundary)) {
      cursor = start + needle.length;
      continue;
    }

    let quote = '';
    let end = start + needle.length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '>') {
        tags.push(source.slice(start, end + 1));
        end += 1;
        break;
      }
    }
    cursor = Math.max(end, start + needle.length);
  }

  return tags;
}

function extractMeta(html, name) {
  const wanted = String(name || '').toLowerCase();
  for (const tag of scanOpeningTags(html, 'meta')) {
    const attrs = parseHtmlAttributes(tag);
    const nameKey = String(attrs.name || '').toLowerCase();
    const propertyKey = String(attrs.property || '').toLowerCase();
    if ((nameKey === wanted || propertyKey === wanted) && attrs.content !== undefined) {
      return String(attrs.content).trim();
    }
  }
  return '';
}

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeCbMetaProperties(html) {
  const source = String(html || '');
  const aliases = [];
  for (const tag of scanOpeningTags(source, 'meta')) {
    const attrs = parseHtmlAttributes(tag);
    if (!attrs.name || !attrs.property || attrs.content === undefined) continue;
    aliases.push(
      `<meta property="${escapeHtmlAttribute(attrs.property)}" content="${escapeHtmlAttribute(attrs.content)}">`,
    );
  }
  return aliases.length ? `${source}\n${aliases.join('\n')}` : source;
}

function parseCbDetailHtml(html, targetIsbn) {
  return impl.parseCbDetailHtml(normalizeCbMetaProperties(html), targetIsbn);
}

function wrapCbResponse(response) {
  if (!response || typeof response.text !== 'function') return response;
  return new Proxy(response, {
    get(target, property) {
      if (property === 'text') {
        return async () => normalizeCbMetaProperties(await target.text());
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createFetchWithCbMetaNormalization(fetchImpl) {
  if (typeof fetchImpl !== 'function') return fetchImpl;
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const url = String(input?.url || input || '');
    return /https?:\/\/metadata\.isbn\.nl(?:\/|$)/i.test(url)
      ? wrapCbResponse(response)
      : response;
  };
}

function explicitIdentifierEvidence(data) {
  if (!data || typeof data !== 'object') {
    return { provided: false, identifiers: [] };
  }
  const raw = [
    data.isbn,
    data.ean,
    data.isbn13,
    data.isbn_13,
    data.isbn10,
    data.isbn_10,
    data.barcode,
  ];
  const providedValues = raw.flatMap((entry) => (
    Array.isArray(entry) ? entry : entry === undefined || entry === null ? [] : [entry]
  )).filter((entry) => String(entry).trim() !== '');

  return {
    provided: providedValues.length > 0,
    identifiers: providedValues.map(impl.normalizeIsbn).filter(Boolean),
  };
}

function combinedIsbnBarcodeTags(data) {
  if (!data || typeof data !== 'object') return [];
  return uniqueStrings([
    ...toStrings(data.categories),
    ...toStrings(data.subjects),
    ...toStrings(data.tags),
  ].map((entry) => entry.toLowerCase()));
}

function parseIsbnBarcodeData(data, targetIsbn) {
  if (!data || typeof data !== 'object') return null;
  const family = new Set(impl.getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;

  const evidence = explicitIdentifierEvidence(data);
  if (evidence.provided
    && !evidence.identifiers.some((identifier) => family.has(identifier))) {
    return null;
  }

  const combinedTags = combinedIsbnBarcodeTags(data);
  const parsed = impl.parseIsbnBarcodeData(data, targetIsbn);
  if (parsed) {
    return {
      ...parsed,
      tags: uniqueStrings([...(parsed.tags || []), ...combinedTags]),
    };
  }
  if (!combinedTags.length) return null;

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
    tags: combinedTags,
    source: 'isbnbarcode.org',
    matchLevel: 'exact_isbn',
    found: true,
  };
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
  const fetchImpl = createFetchWithCbMetaNormalization(baseFetchImpl);

  // ISBNBarcode is owned by this wrapper so every lookup path uses the same
  // exact-ISBN validation, tag parsing, cache semantics, and debug behavior.
  const innerEnv = enabled
    ? { ...env, BOEKENBAAI_ENABLE_ISBNBARCODE: 'false' }
    : env;
  const lookup = impl.createIsbnLookup({ ...options, env: innerEnv, fetchImpl });
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
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) fallbackCache.delete(cacheKey);
    if (fallbackInflight.has(cacheKey)) return fallbackInflight.get(cacheKey);

    const promise = (async () => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let value = { metadata: null, status: 'not_found' };
      try {
        if (typeof baseFetchImpl !== 'function') {
          value = { metadata: null, status: 'error' };
          return value;
        }
        const response = await baseFetchImpl(
          `${isbnBarcodeBase}/${encodeURIComponent(normalized)}`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': userAgent,
            },
            ...(controller ? { signal: controller.signal } : {}),
          },
        );
        if (!response?.ok) {
          value = {
            metadata: null,
            status: response?.status === 404 ? 'not_found' : 'error',
          };
          return value;
        }

        let data = null;
        const contentType = response.headers?.get?.('content-type') || '';
        if (contentType.includes('application/json') && typeof response.json === 'function') {
          data = await response.json();
        } else if (typeof response.text === 'function') {
          const text = await response.text();
          if (!text.trim()) {
            value = { metadata: null, status: 'not_found' };
            return value;
          }
          try {
            data = JSON.parse(text);
          } catch (_error) {
            value = { metadata: null, status: 'error' };
            return value;
          }
        } else if (typeof response.json === 'function') {
          data = await response.json();
        } else {
          value = { metadata: null, status: 'error' };
          return value;
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
        const ttl = value.metadata?.found ? cacheTtlMs : negativeCacheTtlMs;
        fallbackCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + ttl,
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
    const needsFallback = !coreComplete || currentTags.length === 0;
    if (!needsFallback) return result;

    const fallback = await loadFallback(normalized);
    const enriched = mergeFallbackMetadata(result, fallback.metadata);
    if (!result?.debug) return enriched;

    return {
      ...enriched,
      debug: {
        ...enriched.debug,
        sourcesTried: uniqueStrings([
          ...(result.debug.sourcesTried || []),
          'isbnbarcode.org',
        ]),
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
  extractMeta,
  parseCbDetailHtml,
  parseIsbnBarcodeData,
  createIsbnLookup,
};
