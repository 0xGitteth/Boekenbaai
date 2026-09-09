'use strict';

const DEFAULT_TIMEOUT_MS = 2800;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const CB_BASE_URL = 'https://metadata.isbn.nl';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

function normalizeIsbn(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function calculateIsbn10Check(firstNine) {
  if (!/^\d{9}$/.test(firstNine)) return '';
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(firstNine[index]) * (10 - index);
  }
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

function calculateIsbn13Check(firstTwelve) {
  if (!/^\d{12}$/.test(firstTwelve)) return '';
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(firstTwelve[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function isValidIsbn10(value) {
  const isbn = normalizeIsbn(value);
  return /^\d{9}[\dX]$/.test(isbn) && calculateIsbn10Check(isbn.slice(0, 9)) === isbn[9];
}

function isValidIsbn13(value) {
  const isbn = normalizeIsbn(value);
  return /^\d{13}$/.test(isbn) && calculateIsbn13Check(isbn.slice(0, 12)) === isbn[12];
}

function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  return isbn.length === 10 ? isValidIsbn10(isbn) : isbn.length === 13 ? isValidIsbn13(isbn) : false;
}

function toIsbn13(value) {
  const isbn = normalizeIsbn(value);
  if (isValidIsbn13(isbn)) return isbn;
  if (!isValidIsbn10(isbn)) return '';
  const firstTwelve = `978${isbn.slice(0, 9)}`;
  return `${firstTwelve}${calculateIsbn13Check(firstTwelve)}`;
}

function toIsbn10(value) {
  const isbn = normalizeIsbn(value);
  if (isValidIsbn10(isbn)) return isbn;
  if (!isValidIsbn13(isbn) || !isbn.startsWith('978')) return '';
  const firstNine = isbn.slice(3, 12);
  return `${firstNine}${calculateIsbn10Check(firstNine)}`;
}

function getEquivalentIsbns(value) {
  const normalized = normalizeIsbn(value);
  if (!isValidIsbn(normalized)) return [];
  const values = [normalized, toIsbn13(normalized), toIsbn10(normalized)].filter(Boolean);
  return Array.from(new Set(values));
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
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}

function stripHtml(value) {
  return decodeHtml(
    String(value || '')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<\/p\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function absoluteCbUrl(value) {
  const url = String(value || '').trim();
  if (!url || /no-image-available/i.test(url)) return '';
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:/i, 'https:');
  return `${CB_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function normalizeLanguage(value) {
  const text = stripHtml(value).toLowerCase();
  if (!text) return '';
  const mappings = [
    [/\bnederlands\b|\bdutch\b/, 'nl'],
    [/\bengels\b|\benglish\b/, 'en'],
    [/\bduits\b|\bgerman\b/, 'de'],
    [/\bfrans\b|\bfrench\b/, 'fr'],
    [/\bspaans\b|\bspanish\b/, 'es'],
    [/\bturks\b|\bturkish\b/, 'tr'],
  ];
  for (const [pattern, code] of mappings) {
    if (pattern.test(text)) return code;
  }
  const short = text.match(/\b[a-z]{2,3}\b/);
  return short ? short[0] : stripHtml(value);
}

function yearFromDate(value) {
  const text = stripHtml(value);
  if (!text) return null;
  const fourDigit = text.match(/\b(19|20)\d{2}\b/);
  if (fourDigit) return Number(fourDigit[0]);
  return null;
}

function numberFromValue(value) {
  const match = String(value || '').match(/\d+/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function extractMeta(html, name) {
  const safeName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${safeName}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${safeName}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return decodeHtml(match[1]).trim();
  }
  return '';
}

function extractDefinition(html, labelPattern) {
  const pattern = new RegExp(`<dt>\\s*${labelPattern}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');
  const match = String(html || '').match(pattern);
  return match ? stripHtml(match[1]) : '';
}

function extractCbSearchDetailPath(html) {
  const source = String(html || '');
  const workTabIndex = source.search(/<div[^>]+id=["']werk["'][^>]*>/i);
  if (workTabIndex < 0) return '';
  const scoped = source.slice(workTabIndex, workTabIndex + 12000);
  const match = scoped.match(/<div[^>]+class=["'][^"']*\bwrk\b[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["'](\/\d+\/[^"']+\.html)["']/i);
  return match ? match[1] : '';
}

function splitCbEditionBlocks(html) {
  const source = String(html || '');
  const marker = /<div\s+class=["']uitv["']\s*>/gi;
  const starts = [];
  let match;
  while ((match = marker.exec(source))) starts.push(match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function extractSpanValue(block, label) {
  const safeLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(
    new RegExp(`<span>\\s*${safeLabel}\\s*</span>\\s*(?:</?br\\s*\\/?\\s*>)*\\s*([\\s\\S]*?)(?=<br\\s*\\/?\\s*>|<span>|<div[^>]+class=["']pd|$)`, 'i'),
  );
  return match ? stripHtml(match[1]) : '';
}

function extractEditionField(block, label) {
  const safeLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(
    new RegExp(`<span>\\s*${safeLabel}\\s*</span>\\s*([\\s\\S]*?)(?=<span>|</div>\\s*<div[^>]+class=["']pd|$)`, 'i'),
  );
  return match ? stripHtml(match[1]) : '';
}

function extractCbNurTags(html) {
  const source = String(html || '');
  const values = [];
  const definition = source.match(/<dt>\s*NUR code\(s\)\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
  if (definition) {
    const anchors = definition[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi);
    for (const anchor of anchors) {
      const label = stripHtml(anchor[1]).replace(/^\d{3}\s+/, '').trim();
      if (label) values.push(label.toLowerCase());
    }
  }
  return Array.from(new Set(values));
}

function parseCbDetailHtml(html, targetIsbn) {
  const family = new Set(getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;
  const editions = splitCbEditionBlocks(html);
  let exactBlock = '';
  let exactIsbn = '';
  for (const block of editions) {
    const isbn = normalizeIsbn(extractSpanValue(block, 'ISBN'));
    if (family.has(isbn)) {
      exactBlock = block;
      exactIsbn = isbn;
      break;
    }
  }
  if (!exactBlock) return null;

  const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
  const author = extractDefinition(html, 'Auteur\\(s\\)');
  const workPublisher = extractDefinition(html, 'Uitgever\\(s\\)');
  const editionPublisher = extractEditionField(exactBlock, 'uitgever');
  const editionLanguage = extractEditionField(exactBlock, 'taal');
  const publicationDate = extractSpanValue(exactBlock, 'verschijningsdatum');
  const formatMatch = exactBlock.match(/<div[^>]+class=["']uvlabel["'][^>]*>([\s\S]*?)<\/div>/i);
  const coverMatch = exactBlock.match(/<a[^>]+class=["'][^"']*fancybox[^"']*["'][^>]+href=["']([^"']+)["']/i);
  const ogCover = extractMeta(html, 'og:image');

  return {
    barcode: exactIsbn || normalizeIsbn(targetIsbn),
    title,
    author,
    authors: author ? author.split(/\s*,\s*/).filter(Boolean) : [],
    description: stripHtml(description),
    publisher: editionPublisher || workPublisher,
    publishedYear: yearFromDate(publicationDate),
    publishedAt: publicationDate,
    pageCount: null,
    language: normalizeLanguage(editionLanguage),
    coverUrl: absoluteCbUrl(coverMatch?.[1] || ogCover),
    tags: extractCbNurTags(html),
    format: formatMatch ? stripHtml(formatMatch[1]) : '',
    source: 'Bureau ISBN',
    sourceUrl: extractMeta(html, 'og:url'),
    matchLevel: 'exact_isbn',
    found: Boolean(title || author || description || editionPublisher || coverMatch || ogCover),
  };
}

function parseGoogleBooksData(data, targetIsbn) {
  const family = new Set(getEquivalentIsbns(targetIsbn));
  const items = Array.isArray(data?.items) ? data.items : [];
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const info = item?.volumeInfo || {};
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const exact = identifiers.some((entry) => family.has(normalizeIsbn(entry?.identifier)));
    if (!exact) continue;
    const score = [
      info.title,
      Array.isArray(info.authors) && info.authors.length,
      info.description,
      info.publisher,
      info.pageCount,
      info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.medium || info.imageLinks?.thumbnail,
    ].filter(Boolean).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best) return null;
  const info = best.volumeInfo || {};
  const authors = Array.isArray(info.authors) ? info.authors.map((entry) => String(entry).trim()).filter(Boolean) : [];
  const imageLinks = info.imageLinks || {};
  const cover = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.small || imageLinks.thumbnail || imageLinks.smallThumbnail || '';
  const categories = Array.isArray(info.categories) ? info.categories : [];
  return {
    barcode: normalizeIsbn(targetIsbn),
    title: String(info.title || '').trim(),
    author: authors.join(', '),
    authors,
    description: stripHtml(info.description || ''),
    publisher: String(info.publisher || '').trim(),
    publishedYear: yearFromDate(info.publishedDate),
    publishedAt: String(info.publishedDate || '').trim(),
    pageCount: numberFromValue(info.pageCount),
    language: normalizeLanguage(info.language),
    coverUrl: String(cover || '').replace(/^http:\/\//i, 'https://'),
    previewLink: String(info.previewLink || best.previewLink || '').trim(),
    tags: categories.flatMap((entry) => String(entry).split(/\s*[/;>-]\s*/)).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    source: 'Google Books',
    matchLevel: 'exact_isbn',
    found: true,
  };
}

function parseOpenLibraryData(data, targetIsbn) {
  if (!data || typeof data !== 'object' || data.error) return null;
  const family = new Set(getEquivalentIsbns(targetIsbn));
  const returnedIsbns = [
    ...(Array.isArray(data.isbn_13) ? data.isbn_13 : []),
    ...(Array.isArray(data.isbn_10) ? data.isbn_10 : []),
  ].map(normalizeIsbn).filter(Boolean);
  if (returnedIsbns.length && !returnedIsbns.some((isbn) => family.has(isbn))) return null;

  const authors = Array.isArray(data.authors)
    ? data.authors.map((entry) => typeof entry?.name === 'string' ? entry.name.trim() : '').filter(Boolean)
    : [];
  if (!authors.length && typeof data.by_statement === 'string') authors.push(stripHtml(data.by_statement));
  const publishers = Array.isArray(data.publishers) ? data.publishers.map((entry) => typeof entry === 'string' ? entry : entry?.name).filter(Boolean) : [];
  const languages = Array.isArray(data.languages) ? data.languages.map((entry) => entry?.key || entry).filter(Boolean) : [];
  const covers = Array.isArray(data.covers) ? data.covers.filter((entry) => Number.isFinite(Number(entry))) : [];
  const description = typeof data.description === 'string' ? data.description : data.description?.value || '';
  const subjects = Array.isArray(data.subjects) ? data.subjects.map((entry) => typeof entry === 'string' ? entry : entry?.name).filter(Boolean) : [];
  return {
    barcode: normalizeIsbn(targetIsbn),
    title: String(data.title || '').trim(),
    author: authors.join(', '),
    authors,
    description: stripHtml(description),
    publisher: publishers.join(', '),
    publishedYear: yearFromDate(data.publish_date),
    publishedAt: String(data.publish_date || '').trim(),
    pageCount: numberFromValue(data.number_of_pages || data.pagination),
    language: normalizeLanguage(languages.join(' ')),
    coverUrl: covers.length ? `https://covers.openlibrary.org/b/id/${covers[0]}-L.jpg?default=false` : '',
    tags: subjects.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
    source: 'Open Library',
    matchLevel: 'exact_isbn',
    found: Boolean(data.title || publishers.length || covers.length || data.number_of_pages),
  };
}

function dedupe(values) {
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

function mergeExactMetadata({ cb, google, openLibrary }, targetIsbn) {
  const available = [cb, google, openLibrary].filter((entry) => entry?.found);
  if (!available.length) {
    return {
      barcode: normalizeIsbn(targetIsbn),
      title: '',
      author: '',
      authors: [],
      description: '',
      publisher: '',
      publishedYear: null,
      publishedAt: '',
      pageCount: null,
      language: '',
      coverUrl: '',
      previewLink: '',
      tags: [],
      source: 'none',
      sources: [],
      matchLevel: 'none',
      found: false,
    };
  }

  const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
  const authors = cb?.authors?.length ? cb.authors : google?.authors?.length ? google.authors : openLibrary?.authors || [];
  const sourceNames = available.map((entry) => entry.source);
  return {
    barcode: normalizeIsbn(targetIsbn),
    title: pick(cb?.title, google?.title, openLibrary?.title),
    author: pick(cb?.author, google?.author, openLibrary?.author),
    authors: dedupe(authors),
    description: pick(cb?.description, google?.description, openLibrary?.description),
    publisher: pick(cb?.publisher, google?.publisher, openLibrary?.publisher),
    publishedYear: pick(cb?.publishedYear, google?.publishedYear, openLibrary?.publishedYear) || null,
    publishedAt: pick(cb?.publishedAt, google?.publishedAt, openLibrary?.publishedAt),
    pageCount: google?.pageCount || openLibrary?.pageCount || cb?.pageCount || null,
    language: pick(cb?.language, google?.language, openLibrary?.language),
    coverUrl: pick(cb?.coverUrl, google?.coverUrl, openLibrary?.coverUrl),
    previewLink: pick(google?.previewLink, openLibrary?.previewLink),
    tags: dedupe([
      ...(cb?.tags || []),
      ...(google?.tags || []),
      ...(openLibrary?.tags || []),
    ]),
    format: cb?.format || '',
    source: cb?.found ? 'Bureau ISBN' : google?.found ? 'Google Books' : 'Open Library',
    sources: sourceNames,
    sourceUrl: cb?.sourceUrl || '',
    matchLevel: 'exact_isbn',
    found: true,
  };
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, controller ? { ...options, signal: controller.signal } : options);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchText(fetchImpl, url, options = {}, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
  if (!response?.ok) return '';
  return response.text();
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
  if (!response?.ok) return null;
  return response.json();
}

function createIsbnLookup({ fetchImpl = global.fetch, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cache = new Map();
  const userAgent = String(env.BOEKENBAAI_ISBN_USER_AGENT || 'Boekenbaai/1.0 school-library ISBN metadata lookup');
  const headers = { Accept: '*/*', 'User-Agent': userAgent };

  async function lookupCb(isbn) {
    for (const candidate of getEquivalentIsbns(isbn)) {
      try {
        const searchUrl = new URL('/search.html', CB_BASE_URL);
        searchUrl.searchParams.set('search', candidate);
        const searchHtml = await fetchText(fetchImpl, searchUrl.toString(), { headers }, timeoutMs);
        if (!searchHtml) continue;
        const detailPath = extractCbSearchDetailPath(searchHtml);
        if (!detailPath) continue;
        const detailHtml = await fetchText(fetchImpl, absoluteCbUrl(detailPath), { headers }, timeoutMs);
        if (!detailHtml) continue;
        const metadata = parseCbDetailHtml(detailHtml, isbn);
        if (metadata?.found) return metadata;
      } catch (_error) {
        // CB is an enrichment source. Failure must never break the ISBN lookup.
      }
    }
    return null;
  }

  async function lookupGoogle(isbn) {
    if (!env.GOOGLE_BOOKS_API_KEY) return null;
    try {
      const queryIsbn = toIsbn13(isbn) || normalizeIsbn(isbn);
      const url = new URL(GOOGLE_BOOKS_URL);
      url.searchParams.set('q', `isbn:${queryIsbn}`);
      url.searchParams.set('printType', 'books');
      url.searchParams.set('projection', 'full');
      url.searchParams.set('maxResults', '10');
      const data = await fetchJson(fetchImpl, url.toString(), {
        headers: { ...headers, Accept: 'application/json', 'x-goog-api-key': env.GOOGLE_BOOKS_API_KEY },
      }, timeoutMs);
      return parseGoogleBooksData(data, isbn);
    } catch (_error) {
      return null;
    }
  }

  async function lookupOpenLibrary(isbn) {
    const candidates = getEquivalentIsbns(isbn);
    for (const candidate of candidates) {
      try {
        const url = `${OPEN_LIBRARY_BASE_URL}/isbn/${encodeURIComponent(candidate)}.json`;
        const data = await fetchJson(fetchImpl, url, { headers: { ...headers, Accept: 'application/json' } }, timeoutMs);
        const metadata = parseOpenLibraryData(data, isbn);
        if (metadata?.found) return metadata;
      } catch (_error) {
        // Continue with the equivalent ISBN if available.
      }
    }
    return null;
  }

  return async function lookupIsbnMetadata(isbn) {
    const normalized = normalizeIsbn(isbn);
    if (!isValidIsbn(normalized)) {
      return mergeExactMetadata({}, normalized);
    }
    const cacheKey = toIsbn13(normalized) || normalized;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cacheHit: true };

    const [cbResult, googleResult, openLibraryResult] = await Promise.allSettled([
      lookupCb(normalized),
      lookupGoogle(normalized),
      lookupOpenLibrary(normalized),
    ]);
    const result = mergeExactMetadata({
      cb: cbResult.status === 'fulfilled' ? cbResult.value : null,
      google: googleResult.status === 'fulfilled' ? googleResult.value : null,
      openLibrary: openLibraryResult.status === 'fulfilled' ? openLibraryResult.value : null,
    }, normalized);
    const ttl = result.found ? DEFAULT_CACHE_TTL_MS : DEFAULT_NEGATIVE_CACHE_TTL_MS;
    cache.set(cacheKey, { value: result, expiresAt: Date.now() + ttl });
    return { ...result, cacheHit: false };
  };
}

module.exports = {
  normalizeIsbn,
  isValidIsbn,
  isValidIsbn10,
  isValidIsbn13,
  toIsbn10,
  toIsbn13,
  getEquivalentIsbns,
  extractCbSearchDetailPath,
  parseCbDetailHtml,
  parseGoogleBooksData,
  parseOpenLibraryData,
  mergeExactMetadata,
  createIsbnLookup,
};
