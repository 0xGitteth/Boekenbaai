'use strict';

const DEFAULT_TIMEOUT_MS = 2800;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CB_SEARCH_RESULTS = 20;
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
  return /^\d{9}[\dX]$/.test(isbn)
    && calculateIsbn10Check(isbn.slice(0, 9)) === isbn[9];
}

function isValidIsbn13(value) {
  const isbn = normalizeIsbn(value);
  return /^\d{13}$/.test(isbn)
    && calculateIsbn13Check(isbn.slice(0, 12)) === isbn[12];
}

function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 10) return isValidIsbn10(isbn);
  if (isbn.length === 13) return isValidIsbn13(isbn);
  return false;
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
  return Array.from(new Set([
    normalized,
    toIsbn13(normalized),
    toIsbn10(normalized),
  ].filter(Boolean)));
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
    const number = Number(codePoint);
    if (!Number.isInteger(number)
      || number < 0
      || number > 0x10FFFF
      || (number >= 0xD800 && number <= 0xDFFF)) {
      return match;
    }
    return String.fromCodePoint(number);
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
  if (url.startsWith('//')) return `https:${url}`;
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
  const iso6393To1 = {
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
  const languageKey = text.match(/\/(?:languages|l)\/([a-z]{2,3})\b/i);
  if (languageKey) {
    const code = languageKey[1].toLowerCase();
    return iso6393To1[code] || code;
  }
  if (/^[a-z]{2,3}$/i.test(text)) return iso6393To1[text] || text;
  return stripHtml(value);
}

function yearFromDate(value) {
  const match = stripHtml(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function numberFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  const match = String(value || '').match(/\d+/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
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

function extractDefinition(html, labelPattern) {
  const pattern = new RegExp(`<dt>\\s*${labelPattern}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');
  const match = String(html || '').match(pattern);
  return match ? stripHtml(match[1]) : '';
}

function extractDefinitionValues(html, labelPattern) {
  const pattern = new RegExp(`<dt>\\s*${labelPattern}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');
  const match = String(html || '').match(pattern);
  if (!match) return [];
  const anchors = Array.from(match[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((entry) => stripHtml(entry[1]))
    .filter(Boolean);
  if (anchors.length) return anchors;
  const plain = stripHtml(match[1]);
  return plain ? [plain] : [];
}

function extractDivElementById(html, id) {
  const source = String(html || '');
  const safeId = escapeRegex(id);
  const openingPattern = new RegExp(
    `<div\\b[^>]*\\bid=["']${safeId}["'][^>]*>`,
    'i',
  );
  const opening = openingPattern.exec(source);
  if (!opening) return '';

  const divPattern = /<\/?div\b[^>]*>/gi;
  divPattern.lastIndex = opening.index;
  let depth = 0;
  let match;
  while ((match = divPattern.exec(source))) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      depth -= 1;
    } else if (!/\/>\s*$/.test(tag)) {
      depth += 1;
    }
    if (depth === 0) {
      return source.slice(opening.index, divPattern.lastIndex);
    }
  }
  return source.slice(opening.index);
}

function extractCbSearchDetailPaths(html, limit = MAX_CB_SEARCH_RESULTS) {
  const workBlock = extractDivElementById(html, 'werk');
  if (!workBlock) return [];

  const starts = Array.from(workBlock.matchAll(
    /<div\b[^>]*class=["'][^"']*\bwrk\b[^"']*["'][^>]*>/gi,
  )).map((match) => match.index);
  if (!starts.length) return [];

  const numericLimit = Number(limit);
  const boundedLimit = Number.isFinite(numericLimit) && numericLimit > 0
    ? Math.min(MAX_CB_SEARCH_RESULTS, Math.floor(numericLimit))
    : MAX_CB_SEARCH_RESULTS;
  const paths = [];
  const seen = new Set();

  for (let index = 0; index < starts.length && paths.length < boundedLimit; index += 1) {
    const block = workBlock.slice(starts[index], starts[index + 1] ?? workBlock.length);
    const match = block.match(/<a[^>]+href=["'](\/\d+\/[^"']+\.html)["']/i);
    const path = match?.[1] || '';
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function extractCbSearchDetailPath(html) {
  return extractCbSearchDetailPaths(html, 1)[0] || '';
}

function splitCbEditionBlocks(html) {
  const source = String(html || '');
  const marker = /<div\b[^>]*class=["'][^"']*\buitv\b[^"']*["'][^>]*>/gi;
  const starts = [];
  let match;
  while ((match = marker.exec(source))) starts.push(match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSpanValue(block, label) {
  const safeLabel = escapeRegex(label);
  const match = String(block || '').match(new RegExp(
    `<span>\\s*${safeLabel}\\s*</span>\\s*(?:</?br\\s*\\/?\\s*>)*\\s*([\\s\\S]*?)(?=<br\\s*\\/?\\s*>|<span>|<div[^>]+class=["']pd|$)`,
    'i',
  ));
  return match ? stripHtml(match[1]) : '';
}

function extractEditionField(block, label) {
  const safeLabel = escapeRegex(label);
  const match = String(block || '').match(new RegExp(
    `<span>\\s*${safeLabel}\\s*</span>\\s*([\\s\\S]*?)(?=<span>|</div>\\s*<div[^>]+class=["']pd|$)`,
    'i',
  ));
  return match ? stripHtml(match[1]) : '';
}

function parseNurTags(fragment) {
  const anchors = Array.from(String(fragment || '').matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi))
    .flatMap((entry) => {
      const text = stripHtml(entry[1]);
      const match = text.match(/^\d{3}\s+(.+)$/);
      const label = String(match?.[1] || '').trim().toLowerCase();
      return label ? [label] : [];
    });
  if (anchors.length) return Array.from(new Set(anchors));

  const plain = stripHtml(fragment);
  const values = [];
  for (const match of plain.matchAll(/(?:^|\s)\d{3}\s+(.+?)(?=\s+\d{3}\s+|$)/g)) {
    const label = String(match[1] || '').trim().toLowerCase();
    if (label) values.push(label);
  }
  return Array.from(new Set(values));
}

function extractCbNurTags(html) {
  const match = String(html || '').match(
    /<dt>\s*NUR code\(s\)\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i,
  );
  return match ? parseNurTags(match[1]) : [];
}

function extractCbEditionNurTags(block) {
  const source = String(block || '');
  const nurMarker = /<span>\s*NUR\s*<\/span>/i;
  const marker = nurMarker.exec(source);
  if (!marker) return [];

  // NUR lives in the edition's hidden pd-block. The final edition block may
  // extend to the end of the document, so first isolate that pd-block instead
  // of allowing footer/navigation anchors to leak into edition classifications.
  const prefix = source.slice(0, marker.index);
  const pdOpenings = Array.from(prefix.matchAll(
    /<div\b[^>]*class=["'][^"']*\bpd-block\b[^"']*["'][^>]*>/gi,
  ));
  const pdOpening = pdOpenings[pdOpenings.length - 1];

  let scoped = source;
  if (pdOpening) {
    const divPattern = /<\/?div\b[^>]*>/gi;
    divPattern.lastIndex = pdOpening.index;
    let depth = 0;
    let end = source.length;
    let divMatch;
    while ((divMatch = divPattern.exec(source))) {
      if (/^<\//.test(divMatch[0])) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        end = divPattern.lastIndex;
        break;
      }
    }
    const candidate = source.slice(pdOpening.index, end);
    if (nurMarker.test(candidate)) scoped = candidate;
  }

  const scopedMarker = nurMarker.exec(scoped);
  if (!scopedMarker) return [];
  let fragment = scoped.slice(scopedMarker.index + scopedMarker[0].length);
  const nextSpan = fragment.search(/<span\b/i);
  if (nextSpan >= 0) fragment = fragment.slice(0, nextSpan);

  if (!pdOpening) {
    const closingDiv = fragment.search(/<\/div\s*>/i);
    if (closingDiv >= 0) fragment = fragment.slice(0, closingDiv);
  }

  return parseNurTags(fragment);
}

function parseCbDetailHtml(html, targetIsbn) {
  const family = new Set(getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;

  let exactBlock = '';
  let exactIsbn = '';
  for (const block of splitCbEditionBlocks(html)) {
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
  const authors = extractDefinitionValues(html, 'Auteur\\(s\\)');
  const editionPublisher = extractEditionField(exactBlock, 'uitgever');
  const editionLanguage = extractEditionField(exactBlock, 'taal');
  const publicationDate = extractSpanValue(exactBlock, 'verschijningsdatum');
  const formatMatch = exactBlock.match(/<div[^>]+class=["']uvlabel["'][^>]*>([\s\S]*?)<\/div>/i);
  const coverMatch = exactBlock.match(
    /<a[^>]+class=["'][^"']*fancybox[^"']*["'][^>]+href=["']([^"']+)["']/i,
  );
  const coverUrl = absoluteCbUrl(coverMatch?.[1] || '');
  const editionNurTags = extractCbEditionNurTags(exactBlock);
  const tags = editionNurTags.length ? editionNurTags : extractCbNurTags(html);

  return {
    barcode: normalizeIsbn(targetIsbn),
    matchedIsbn: exactIsbn,
    title,
    author: authors.join(', '),
    authors,
    description: stripHtml(description),
    publisher: editionPublisher,
    publishedYear: yearFromDate(publicationDate),
    publishedAt: publicationDate,
    pageCount: null,
    language: normalizeLanguage(editionLanguage),
    coverUrl,
    tags,
    format: formatMatch ? stripHtml(formatMatch[1]) : '',
    source: 'Bureau ISBN',
    sourceUrl: extractMeta(html, 'og:url'),
    matchLevel: 'exact_isbn',
    // Reaching this point means an ISBN from the requested equivalence family
    // was present in this edition block. An incomplete exact record is still found.
    found: true,
  };
}

function splitGoogleCategory(value) {
  return String(value || '')
    .split(/\s*\/\s*|\s*;\s*|\s*>\s*|\s+[–-]\s+|\s+[–-]|[–-]\s+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseGoogleBooksData(data, targetIsbn) {
  const family = new Set(getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;
  const items = Array.isArray(data?.items) ? data.items : [];
  let best = null;
  let bestScore = -1;

  for (const item of items) {
    const info = item?.volumeInfo || {};
    const identifiers = Array.isArray(info.industryIdentifiers)
      ? info.industryIdentifiers
      : [];
    const exact = identifiers.some((entry) => family.has(normalizeIsbn(entry?.identifier)));
    if (!exact) continue;
    const score = [
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
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  if (!best) return null;
  const info = best.volumeInfo || {};
  const authors = Array.isArray(info.authors)
    ? info.authors.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const imageLinks = info.imageLinks || {};
  const cover = imageLinks.extraLarge
    || imageLinks.large
    || imageLinks.medium
    || imageLinks.small
    || imageLinks.thumbnail
    || imageLinks.smallThumbnail
    || '';
  const categories = [
    info.mainCategory,
    ...(Array.isArray(info.categories)
      ? info.categories
      : info.categories
        ? [info.categories]
        : []),
  ].filter(Boolean);

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
    tags: Array.from(new Set(categories.flatMap(splitGoogleCategory))),
    source: 'Google Books',
    matchLevel: 'exact_isbn',
    found: true,
  };
}

function parseOpenLibraryData(data, targetIsbn) {
  if (!data || typeof data !== 'object' || data.error) return null;
  const family = new Set(getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;

  const returnedIsbns = [
    ...(Array.isArray(data.isbn_13) ? data.isbn_13 : []),
    ...(Array.isArray(data.isbn_10) ? data.isbn_10 : []),
  ].map(normalizeIsbn).filter(Boolean);
  if (!returnedIsbns.some((isbn) => family.has(isbn))) {
    return null;
  }

  const authors = Array.isArray(data.authors)
    ? data.authors
      .map((entry) => (typeof entry?.name === 'string' ? entry.name.trim() : ''))
      .filter(Boolean)
    : [];
  if (!authors.length && typeof data.by_statement === 'string') {
    authors.push(stripHtml(data.by_statement));
  }
  const publishers = Array.isArray(data.publishers)
    ? data.publishers
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean)
    : [];
  const languages = Array.isArray(data.languages)
    ? data.languages.map((entry) => entry?.key || entry).filter(Boolean)
    : [];
  const coverId = Array.isArray(data.covers)
    ? data.covers
      .map((entry) => Number(entry))
      .find((entry) => Number.isInteger(entry) && entry > 0)
    : undefined;
  const description = typeof data.description === 'string'
    ? data.description
    : data.description?.value || '';
  const subjects = Array.isArray(data.subjects)
    ? data.subjects
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean)
    : [];

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
    coverUrl: coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`
      : '',
    tags: subjects.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
    source: 'Open Library',
    matchLevel: 'exact_isbn',
    // The parser only reaches this point after an ISBN from the requested
    // equivalence family is present in the response itself.
    found: true,
  };
}

function toStringList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }
  if (typeof value === 'object') {
    for (const key of ['name', 'full_name', 'label', 'value', 'text', 'url', 'href']) {
      const nested = toStringList(value[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function collectIsbnBarcodeIdentifiers(data) {
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
    identifiers: providedValues.map(normalizeIsbn).filter(Boolean),
  };
}

function parseIsbnBarcodeData(data, targetIsbn) {
  if (!data || typeof data !== 'object') return null;
  const family = new Set(getEquivalentIsbns(targetIsbn));
  if (!family.size) return null;

  const identifierEvidence = collectIsbnBarcodeIdentifiers(data);
  if (identifierEvidence.provided
    && !identifierEvidence.identifiers.some((identifier) => family.has(identifier))) {
    return null;
  }

  const mergeAliases = (...values) => dedupe(values.flatMap(toStringList));
  const firstAlias = (...values) => {
    for (const value of values) {
      const strings = toStringList(value);
      if (strings.length) return strings[0];
    }
    return '';
  };
  const authors = mergeAliases(
    data.author,
    data.author_name,
    data.authors,
    data.contributors,
  );
  const title = firstAlias(
    data.title,
    data.book_title,
    data.item_name,
    data.name,
  );
  const description = firstAlias(
    data.description,
    data.synopsis,
    data.summary,
  );
  const publishers = mergeAliases(
    data.publisher,
    data.publisher_name,
    data.publishers,
  );
  const languages = mergeAliases(
    data.language,
    data.languages,
    data.language_name,
  );
  const coverUrl = firstAlias(
    data.cover,
    data.cover_url,
    data.image,
    data.image_url,
    data.thumbnail,
  ).replace(/^http:\/\//i, 'https://');
  const publishedAt = firstAlias(data.publish_date, data.publication_date);
  const pageCount = numberFromValue(firstAlias(
    data.page_count,
    data.pages,
    data.number_of_pages,
  ));
  const tags = mergeAliases(data.categories, data.subjects, data.tags)
    .map((entry) => entry.toLowerCase());
  const language = normalizeLanguage(languages.join(' '));

  if (!title
    && !authors.length
    && !description
    && !publishers.length
    && !coverUrl
    && !publishedAt
    && !pageCount
    && !language
    && !tags.length) {
    return null;
  }

  return {
    barcode: normalizeIsbn(targetIsbn),
    title,
    author: authors.join(', '),
    authors,
    description: stripHtml(description),
    publisher: publishers.join(', '),
    publishedAt,
    publishedYear: yearFromDate(publishedAt),
    pageCount,
    language,
    coverUrl,
    tags,
    source: 'isbnbarcode.org',
    matchLevel: 'exact_isbn',
    found: true,
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

function mergeSameSourceExactMetadata(base, incoming) {
  if (!base?.found) return incoming || null;
  if (!incoming?.found) return base;

  const merged = { ...base };
  for (const field of [
    'title',
    'author',
    'description',
    'publisher',
    'publishedYear',
    'publishedAt',
    'pageCount',
    'language',
    'coverUrl',
    'previewLink',
    'format',
    'sourceUrl',
    'matchedIsbn',
  ]) {
    const current = merged[field];
    const next = incoming[field];
    const currentMissing = current === undefined || current === null || current === '';
    const nextPresent = next !== undefined && next !== null && next !== '';
    if (currentMissing && nextPresent) merged[field] = next;
  }
  merged.authors = base.authors?.length ? base.authors : incoming.authors || [];
  merged.tags = dedupe([...(base.tags || []), ...(incoming.tags || [])]);
  merged.source = base.source || incoming.source || '';
  merged.matchLevel = 'exact_isbn';
  merged.found = true;
  return merged;
}

function mergeExactMetadata({ cb, google, openLibrary, isbnBarcode } = {}, targetIsbn) {
  const available = [cb, google, openLibrary, isbnBarcode]
    .filter((entry) => entry?.found);
  const empty = {
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
    format: '',
    source: 'none',
    sources: [],
    matchLevel: 'none',
    found: false,
  };
  if (!available.length) return empty;

  const pick = (...values) => (
    values.find((value) => value !== undefined && value !== null && value !== '') ?? ''
  );
  const authors = cb?.authors?.length
    ? cb.authors
    : google?.authors?.length
      ? google.authors
      : openLibrary?.authors?.length
        ? openLibrary.authors
        : isbnBarcode?.authors || [];

  return {
    barcode: normalizeIsbn(targetIsbn),
    title: pick(cb?.title, google?.title, openLibrary?.title, isbnBarcode?.title),
    author: pick(cb?.author, google?.author, openLibrary?.author, isbnBarcode?.author),
    authors: dedupe(authors),
    description: pick(
      cb?.description,
      google?.description,
      openLibrary?.description,
      isbnBarcode?.description,
    ),
    publisher: pick(
      cb?.publisher,
      google?.publisher,
      openLibrary?.publisher,
      isbnBarcode?.publisher,
    ),
    publishedYear: pick(
      cb?.publishedYear,
      google?.publishedYear,
      openLibrary?.publishedYear,
      isbnBarcode?.publishedYear,
    ) || null,
    publishedAt: pick(
      cb?.publishedAt,
      google?.publishedAt,
      openLibrary?.publishedAt,
      isbnBarcode?.publishedAt,
    ),
    pageCount: google?.pageCount
      || openLibrary?.pageCount
      || isbnBarcode?.pageCount
      || cb?.pageCount
      || null,
    language: pick(
      cb?.language,
      google?.language,
      openLibrary?.language,
      isbnBarcode?.language,
    ),
    coverUrl: pick(
      cb?.coverUrl,
      google?.coverUrl,
      openLibrary?.coverUrl,
      isbnBarcode?.coverUrl,
    ),
    previewLink: pick(google?.previewLink, openLibrary?.previewLink),
    tags: dedupe([
      ...(cb?.tags || []),
      ...(google?.tags || []),
      ...(openLibrary?.tags || []),
      ...(isbnBarcode?.tags || []),
    ]),
    format: cb?.format || '',
    source: cb?.found
      ? 'Bureau ISBN'
      : google?.found
        ? 'Google Books'
        : openLibrary?.found
          ? 'Open Library'
          : 'isbnbarcode.org',
    sources: available.map((entry) => entry.source),
    sourceUrl: cb?.sourceUrl || '',
    matchLevel: 'exact_isbn',
    found: true,
  };
}

function parsePositiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

async function fetchAndConsume(fetchImpl, url, options, timeoutMs, consume) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetchImpl(
      url,
      controller ? { ...options, signal: controller.signal } : options,
    );
    const status = Number(response?.status) || 0;
    if (!response) throw new Error('empty_fetch_response');
    if (!response.ok) {
      if (status === 404) return { response, value: null };
      const error = new Error(`http_${status || 'error'}`);
      error.name = 'HttpError';
      error.status = status;
      throw error;
    }
    if (status === 204) return { response, value: null };
    const value = await consume(response);
    return { response, value };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchText(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { value } = await fetchAndConsume(
    fetchImpl,
    url,
    options,
    timeoutMs,
    (response) => response.text(),
  );
  return value === null ? '' : value;
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { value } = await fetchAndConsume(
    fetchImpl,
    url,
    options,
    timeoutMs,
    async (response) => {
      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType.includes('application/json') && typeof response.json === 'function') {
        return response.json();
      }
      if (typeof response.text === 'function') {
        const text = await response.text();
        if (!text.trim()) throw new Error('empty_json_response');
        try {
          return JSON.parse(text);
        } catch (error) {
          const syntaxError = new SyntaxError('invalid_json_response');
          syntaxError.cause = error;
          throw syntaxError;
        }
      }
      if (typeof response.json === 'function') return response.json();
      throw new Error('json_body_unavailable');
    },
  );
  return value;
}

function createDebugPayload(isbn, env) {
  return {
    isbn,
    sourcesConfigured: [],
    sourcesTried: [],
    sourceStatus: {},
    googleBooks: {
      enabled: Boolean(env.GOOGLE_BOOKS_API_KEY),
      exactMatchFound: false,
    },
    openLibrary: { enabled: true },
    isbnbarcode: {
      enabled: String(env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true',
    },
    bureauIsbn: { enabled: true },
    cacheHit: false,
    transientFailure: false,
  };
}

function createIsbnLookup({
  fetchImpl = global.fetch,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const cacheTtlMs = parsePositiveMs(
    env.BOEKENBAAI_ISBN_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
  );
  const negativeCacheTtlMs = parsePositiveMs(
    env.BOEKENBAAI_ISBN_NEGATIVE_CACHE_TTL_MS,
    cacheTtlMs,
  );
  const debugEnabled = String(env.BOEKENBAAI_DEBUG_ISBN_LOOKUP || '').toLowerCase() === 'true';
  const isbnBarcodeEnabled = String(env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true';
  const isbnBarcodeBase = String(
    env.BOEKENBAAI_ISBN_API_BASE || 'https://isbnbarcode.org/api',
  ).replace(/\/$/, '');
  const userAgent = String(
    env.BOEKENBAAI_ISBN_USER_AGENT
    || 'Boekenbaai/1.0 school-library ISBN metadata lookup',
  );
  const headers = { Accept: '*/*', 'User-Agent': userAgent };

  async function lookupCb(isbn, debug) {
    const visitedDetailPaths = new Set();
    const deadline = Date.now() + Math.max(timeoutMs * 3, timeoutMs);
    const remainingTimeout = () => Math.max(
      1,
      Math.min(timeoutMs, deadline - Date.now()),
    );

    for (const candidate of getEquivalentIsbns(isbn)) {
      if (Date.now() >= deadline) break;
      let detailPaths = [];
      try {
        const searchUrl = new URL('/search.html', CB_BASE_URL);
        searchUrl.searchParams.set('search', candidate);
        debug?.sourcesTried.push('Bureau ISBN');
        const searchHtml = await fetchText(
          fetchImpl,
          searchUrl.toString(),
          { headers },
          remainingTimeout(),
        );
        detailPaths = extractCbSearchDetailPaths(searchHtml);
      } catch (error) {
        if (debug) {
          debug.sourceStatus['Bureau ISBN'] = error?.name === 'AbortError'
            ? 'timeout'
            : 'error';
          debug.transientFailure = true;
        }
        continue;
      }

      for (const detailPath of detailPaths) {
        if (Date.now() >= deadline) break;
        if (visitedDetailPaths.has(detailPath)) continue;
        visitedDetailPaths.add(detailPath);
        try {
          const detailHtml = await fetchText(
            fetchImpl,
            absoluteCbUrl(detailPath),
            { headers },
            remainingTimeout(),
          );
          const metadata = parseCbDetailHtml(detailHtml, isbn);
          if (metadata?.found) {
            if (debug) debug.sourceStatus['Bureau ISBN'] = 'found';
            return metadata;
          }
        } catch (error) {
          if (debug) {
            debug.sourceStatus['Bureau ISBN'] = error?.name === 'AbortError'
              ? 'timeout'
              : 'error';
            debug.transientFailure = true;
          }
        }
      }
    }
    if (debug && !debug.sourceStatus['Bureau ISBN']) {
      debug.sourceStatus['Bureau ISBN'] = 'not_found';
    }
    return null;
  }


  async function lookupGoogle(isbn, debug) {
    if (!env.GOOGLE_BOOKS_API_KEY) return null;
    let mergedMetadata = null;
    for (const candidate of getEquivalentIsbns(isbn)) {
      try {
        const url = new URL(GOOGLE_BOOKS_URL);
        url.searchParams.set('q', `isbn:${candidate}`);
        url.searchParams.set('printType', 'books');
        url.searchParams.set('projection', 'full');
        url.searchParams.set('maxResults', '10');
        debug?.sourcesTried.push('Google Books');
        const data = await fetchJson(
          fetchImpl,
          url.toString(),
          {
            headers: {
              ...headers,
              Accept: 'application/json',
              'x-goog-api-key': env.GOOGLE_BOOKS_API_KEY,
            },
          },
          timeoutMs,
        );
        const metadata = parseGoogleBooksData(data, isbn);
        if (metadata?.found) {
          mergedMetadata = mergeSameSourceExactMetadata(mergedMetadata, metadata);
          if (debug) {
            debug.googleBooks.exactMatchFound = true;
            debug.sourceStatus['Google Books'] = 'found';
          }
        }
      } catch (error) {
        if (debug) {
          if (debug.sourceStatus['Google Books'] !== 'found') {
            debug.sourceStatus['Google Books'] = error?.name === 'AbortError'
              ? 'timeout'
              : 'error';
          }
          debug.transientFailure = true;
        }
      }
    }
    if (mergedMetadata) return mergedMetadata;
    if (debug && !debug.sourceStatus['Google Books']) {
      debug.sourceStatus['Google Books'] = 'not_found';
    }
    return null;
  }


  async function lookupOpenLibrary(isbn, debug) {
    let mergedMetadata = null;
    for (const candidate of getEquivalentIsbns(isbn)) {
      try {
        debug?.sourcesTried.push('Open Library');
        const data = await fetchJson(
          fetchImpl,
          `${OPEN_LIBRARY_BASE_URL}/isbn/${encodeURIComponent(candidate)}.json`,
          { headers: { ...headers, Accept: 'application/json' } },
          timeoutMs,
        );
        const metadata = parseOpenLibraryData(data, isbn);
        if (metadata?.found) {
          mergedMetadata = mergeSameSourceExactMetadata(mergedMetadata, metadata);
          if (debug) debug.sourceStatus['Open Library'] = 'found';
        }
      } catch (error) {
        if (debug) {
          if (debug.sourceStatus['Open Library'] !== 'found') {
            debug.sourceStatus['Open Library'] = error?.name === 'AbortError'
              ? 'timeout'
              : 'error';
          }
          debug.transientFailure = true;
        }
      }
    }
    if (mergedMetadata) return mergedMetadata;
    if (debug && !debug.sourceStatus['Open Library']) {
      debug.sourceStatus['Open Library'] = 'not_found';
    }
    return null;
  }


  async function lookupIsbnBarcode(isbn, debug) {
  if (!isbnBarcodeEnabled) return null;
  for (const candidate of getEquivalentIsbns(isbn)) {
    try {
      debug?.sourcesTried.push('isbnbarcode.org');
      const data = await fetchJson(
        fetchImpl,
        `${isbnBarcodeBase}/${encodeURIComponent(candidate)}`,
        { headers: { ...headers, Accept: 'application/json' } },
        timeoutMs,
      );
      const metadata = parseIsbnBarcodeData(data, isbn);
      if (metadata?.found) {
        if (debug) debug.sourceStatus['isbnbarcode.org'] = 'found';
        return metadata;
      }
    } catch (error) {
      if (debug) {
        debug.sourceStatus['isbnbarcode.org'] = error?.name === 'AbortError'
          ? 'timeout'
          : 'error';
      }
    }
  }
  if (debug && !debug.sourceStatus['isbnbarcode.org']) {
    debug.sourceStatus['isbnbarcode.org'] = 'not_found';
  }
  return null;
}

function isComplete(result) {
  return Boolean(
    result?.found
    && result.title
    && result.author
    && result.coverUrl
    && Array.isArray(result.tags)
    && result.tags.length,
  );
}

  return async function lookupIsbnMetadata(isbn, options = {}) {
    const normalized = normalizeIsbn(isbn);
    const includeDebug = Boolean(options?.includeDebug && debugEnabled);

    if (!isValidIsbn(normalized)) {
      const result = mergeExactMetadata({}, normalized);
      if (includeDebug) {
        result.debug = {
          ...createDebugPayload(normalized, env),
          cacheHit: false,
          invalidIsbn: true,
        };
      }
      return result;
    }

    const cacheKey = toIsbn13(normalized) || normalized;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const result = {
        ...cached.value,
        barcode: normalized,
        cacheHit: true,
      };
      if (includeDebug) {
        result.debug = {
          ...(cached.debug || createDebugPayload(normalized, env)),
          isbn: normalized,
          cacheHit: true,
        };
      }
      return result;
    }
    if (cached) cache.delete(cacheKey);

    const existing = inflight.get(cacheKey);
    if (existing) {
      const entry = await existing;
      const result = {
        ...entry.value,
        barcode: normalized,
        cacheHit: false,
      };
      if (includeDebug) {
        result.debug = {
          ...(entry.debug || createDebugPayload(normalized, env)),
          isbn: normalized,
          cacheHit: false,
          joinedInflight: true,
        };
      }
      return result;
    }

    const lookupPromise = (async () => {
    const sourceState = createDebugPayload(normalized, env);
    sourceState.sourcesConfigured = [
      'Bureau ISBN',
      ...(env.GOOGLE_BOOKS_API_KEY ? ['Google Books'] : []),
      'Open Library',
      ...(isbnBarcodeEnabled ? ['isbnbarcode.org'] : []),
    ];

    const [cbSettled, googleSettled, openSettled] = await Promise.allSettled([
      lookupCb(normalized, sourceState),
      lookupGoogle(normalized, sourceState),
      lookupOpenLibrary(normalized, sourceState),
    ]);

    const cb = cbSettled.status === 'fulfilled' ? cbSettled.value : null;
    const google = googleSettled.status === 'fulfilled' ? googleSettled.value : null;
    const openLibrary = openSettled.status === 'fulfilled' ? openSettled.value : null;

    let result = mergeExactMetadata({ cb, google, openLibrary }, normalized);
    if (isbnBarcodeEnabled && !isComplete(result)) {
      const isbnBarcode = await lookupIsbnBarcode(normalized, sourceState);
      result = mergeExactMetadata({ cb, google, openLibrary, isbnBarcode }, normalized);
    }

    result.barcode = normalized;
    const transientFailure = Boolean(sourceState.transientFailure)
      || Object.values(sourceState.sourceStatus)
        .some((status) => status === 'error' || status === 'timeout');
    const ttl = result.found ? cacheTtlMs : negativeCacheTtlMs;
    const entry = {
      value: result,
      debug: debugEnabled ? sourceState : null,
      expiresAt: Date.now() + ttl,
    };
    if (!transientFailure) cache.set(cacheKey, entry);
    return entry;
  })();

  inflight.set(cacheKey, lookupPromise);
    try {
      const entry = await lookupPromise;
      const result = {
        ...entry.value,
        barcode: normalized,
        cacheHit: false,
      };
      if (includeDebug) {
        result.debug = {
          ...(entry.debug || createDebugPayload(normalized, env)),
          isbn: normalized,
          cacheHit: false,
        };
      }
      return result;
    } finally {
      inflight.delete(cacheKey);
    }
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
  extractMeta,
  extractCbSearchDetailPath,
  extractCbSearchDetailPaths,
  parseCbDetailHtml,
  parseGoogleBooksData,
  parseOpenLibraryData,
  parseIsbnBarcodeData,
  mergeExactMetadata,
  createIsbnLookup,
};
