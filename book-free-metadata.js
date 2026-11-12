'use strict';

// Optional free Dutch ISBN enrichment. The service requires a real contact
// address for repeated automated requests. Never use it without that setting.
const {normalizeIsbn, isValidIsbn, toIsbn13, getEquivalentIsbns} = require('./isbn-lookup-core-impl');

const normalizeText = value => String(value || '').normalize('NFKC').trim()
  .replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
const validContact = value => typeof value === 'string'
  && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isbnOf = book => {
  for (const candidate of [book?.metadataIsbn, book?.editionIsbn, book?.barcode]) {
    const isbn = normalizeIsbn(candidate);
    if (isValidIsbn(isbn)) return toIsbn13(isbn);
  }
  return '';
};
const workKey = book => JSON.stringify([isbnOf(book), normalizeText(book?.title), normalizeText(book?.author)]);
const isMissing = book => !String(book?.publisher || '').trim()
  || !Number.isInteger(Number(book?.publishedYear)) || Number(book?.publishedYear) < 1
  || !String(book?.description || '').trim()
  || !String(book?.coverUrl || '').trim()
  || !Number.isInteger(Number(book?.pageCount)) || Number(book?.pageCount) < 1
  || !(Array.isArray(book?.tags) && book.tags.length);

function decodeEntities(input) {
  return String(input || '').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi, (all, key) => {
    const named = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
    if (key[0] !== '#') return named[key.toLowerCase()] ?? all;
    const num = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isInteger(num) && num > 0 && num <= 0x10ffff && !(num >= 0xd800 && num <= 0xdfff)
      ? String.fromCodePoint(num) : all;
  });
}
function stripMarkup(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function parseEasyCb(text, requestedIsbn) {
  const isbn = normalizeIsbn(requestedIsbn);
  if (!isValidIsbn(isbn) || typeof text !== 'string' || text.length > 256 * 1024) return null;
  const fields = new Map();
  const raw = new Map();
  let afterMutation = false;
  for (const line of text.split(/\r?\n/)) {
    if (!afterMutation && line.trim() === 'mutationlog:') {
      afterMutation = true;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key || !value) continue;
    const destination = afterMutation ? raw : fields;
    if (!destination.has(key)) destination.set(key, []);
    destination.get(key).push(value);
  }
  const first = (map, key) => map.get(key)?.[0] || '';
  const returned = normalizeIsbn(first(fields, 'isbn'));
  if (!returned || !getEquivalentIsbns(isbn).includes(returned)) return null;
  const imageNames = [...raw.entries()]
    .filter(([key]) => /(?:^|\.)ResourceVersion\.ResourceLink$/.test(key))
    .flatMap(([,values]) => values);
  const front = imageNames.find(name => new RegExp('^' + returned + '_VRK\\.jpe?g$', 'i').test(name));
  const coverUrl = front ? 'https://easycbapi.nl/resources/jpg/' + front : '';
  const subjects = [...raw.entries()]
    .filter(([key]) => /(?:^|\.)SubjectHeadingText$/.test(key))
    .flatMap(([,values]) => values).map(stripMarkup)
    .filter(x => x.length > 2 && x.length < 100).slice(0, 20);
  const pageCount = Number(first(fields, 'pages'));
  const date = first(fields, 'publishingdate');
  return {
    isbn: toIsbn13(returned),
    title: stripMarkup(first(fields, 'title')).slice(0, 300),
    author: stripMarkup(first(fields, 'author')).slice(0, 300),
    description: stripMarkup(first(fields, 'synopsis')).slice(0, 2500),
    publisher: stripMarkup(first(fields, 'publisher')).slice(0, 200),
    publishedYear: /^\d{4}(?:\d{4})?$/.test(date) ? Number(date.slice(0,4)) : null,
    pageCount: Number.isInteger(pageCount) && pageCount > 0 && pageCount < 20000 ? pageCount : null,
    coverUrl, tags: [...new Set(subjects)],
    source: 'EasyCB',
  };
}
function titleAgrees(book, source) {
  const a = normalizeText(book?.title), b = normalizeText(source?.title);
  if (!a || !b) return false;
  if (a === b) return true;
  // Subtitles and punctuation differ across editions, but never guess a
  // different title. ISBN matching on its own is not enough to override it.
  return a.length >= 9 && b.length >= 9
    && (a.startsWith(b + ':') || b.startsWith(a + ':'));
}
function usableFor(book, metadata) {
  return Boolean(metadata && isbnOf(book) === metadata.isbn && titleAgrees(book, metadata));
}
function nextCandidate(books, now = Date.now(), excluded = new Set(), failedCovers = new Set()) {
  for (const book of Array.isArray(books) ? books : []) {
    const isbn = isbnOf(book), key = workKey(book);
    if (!isbn || excluded.has(key)) continue;
    const failedCover = failedCovers.has(book.coverUrl) && !book.localCoverUrl;
    const check = book.freeMetadataCheck;
    const last = Number.isFinite(Date.parse(check?.checkedAt)) ? Date.parse(check.checkedAt) : 0;
    const recent = last && now - last < 90 * 86400000
      && check?.isbn === isbn && normalizeText(check?.title) === normalizeText(book.title);
    // The cover downloader may discover a broken image after the initial
    // metadata check. Retry only if this particular URL has not been checked.
    if (recent && !(failedCover && check.failedCoverUrl !== book.coverUrl)) continue;
    if (!isMissing(book) && !failedCover) continue;
    return {isbn, key, title:book.title, author:book.author};
  }
  return null;
}
function applyResult(db, candidate, metadata, now = new Date().toISOString(), status = 'found',
  failedCovers = new Set()) {
  let updated = 0, newCover = false;
  for (const book of db.books || []) {
    if (workKey(book) !== candidate.key) continue;
    const failedCoverUrl = failedCovers.has(book.coverUrl) && !book.localCoverUrl
      ? book.coverUrl : '';
    if (status === 'found' && usableFor(book, metadata)) {
      const update = (field, value) => {
        if (value === null || value === undefined || value === '') return;
        if (book[field] !== undefined && book[field] !== null && book[field] !== '') return;
        book[field] = value;
        // Record the supplier without changing any teacher-entered values.
        if (!book.importProvenance || typeof book.importProvenance !== 'object') {
          book.importProvenance = {fieldSources:{}};
        }
        if (!book.importProvenance.fieldSources) book.importProvenance.fieldSources = {};
        book.importProvenance.fieldSources[field] = {sourceType:'metadata',sourceDetail:'easycb'};
        updated++;
      };
      update('description', metadata.description);
      update('publisher', metadata.publisher);
      update('publishedYear', metadata.publishedYear);
      update('pageCount', metadata.pageCount);
      const coverSource = book.importProvenance?.fieldSources?.coverUrl?.sourceType;
      if (metadata.coverUrl && (
        !book.coverUrl || (failedCoverUrl && !['manual', 'excel'].includes(coverSource))
      ) && book.coverUrl !== metadata.coverUrl) {
        book.coverUrl = metadata.coverUrl;
        if (!book.importProvenance || typeof book.importProvenance !== 'object') {
          book.importProvenance = {fieldSources:{}};
        }
        if (!book.importProvenance.fieldSources) book.importProvenance.fieldSources = {};
        book.importProvenance.fieldSources.coverUrl = {sourceType:'metadata',sourceDetail:'easycb'};
        newCover = true; updated++;
      }
      if ((!Array.isArray(book.tags) || !book.tags.length) && metadata.tags.length) {
        book.tags = metadata.tags.slice(0, 20);
        if (!book.importProvenance || typeof book.importProvenance !== 'object') {
          book.importProvenance = {fieldSources:{}};
        }
        if (!book.importProvenance.fieldSources) book.importProvenance.fieldSources = {};
        book.importProvenance.fieldSources.tags = {sourceType:'metadata',sourceDetail:'easycb'};
        updated++;
      }
    }
    book.freeMetadataCheck = {
      source:'EasyCB', status:status === 'found' && !usableFor(book,metadata) ? 'mismatch' : status,
      checkedAt:now, isbn:candidate.isbn, title:book.title, failedCoverUrl,
    };
  }
  return {updated,newCover};
}
async function fetchEasyCb(isbn, {fetchImpl = global.fetch, contact, timeoutMs = 4500} = {}) {
  if (!validContact(contact)) return {status:'not_configured',metadata:null};
  if (!isValidIsbn(isbn)) return {status:'invalid',metadata:null};
  if (typeof fetchImpl !== 'function') return {status:'error',metadata:null};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(timeoutMs, 8000)));
  try {
    const response = await fetchImpl('https://easycbapi.nl/isbn/' + encodeURIComponent(toIsbn13(isbn)),{
      headers:{Accept:'text/plain',contact,'User-Agent':'Boekenbaai/1.0 school library'},
      signal:controller.signal,redirect:'error',
    });
    if (response.status === 404) return {status:'not_found',metadata:null};
    if (!response.ok || Number(response.headers?.get?.('content-length')) > 256 * 1024)
      return {status:'error',metadata:null};
    const text = await response.text();
    const metadata = parseEasyCb(text, isbn);
    return {status:metadata?'found':'not_found',metadata};
  } catch {
    return {status:'error',metadata:null};
  } finally {
    clearTimeout(timer);
  }
}
module.exports={validContact,isbnOf,workKey,isMissing,parseEasyCb,titleAgrees,usableFor,
  nextCandidate,applyResult,fetchEasyCb};
