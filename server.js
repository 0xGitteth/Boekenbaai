const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
let xlsxModule = null;

function loadXlsx() {
  if (xlsxModule) {
    return xlsxModule;
  }
  try {
    // Lazy-load to allow the server to run even when the optional dependency
    // is not installed (bijv. in offline-omgevingen voor demo's of tests).
    // De Excel-import endpoint controleert later of de module beschikbaar is.
    // eslint-disable-next-line global-require
    xlsxModule = require('xlsx');
  } catch (error) {
    xlsxModule = null;
  }
  return xlsxModule;
}

const PORT = process.env.PORT || 3000;
const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const DIST_DIR = path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');

const configuredStaticDir = process.env.BOEKENBAAI_STATIC_DIR
  ? path.resolve(__dirname, process.env.BOEKENBAAI_STATIC_DIR)
  : null;

const PUBLIC_API_BASE = process.env.BOEKENBAAI_PUBLIC_API_BASE || '';
const ISBN_API_BASE = process.env.BOEKENBAAI_ISBN_API_BASE || 'https://isbnbarcode.org/api';
const ENABLE_ISBNBARCODE_LOOKUP =
  String(process.env.BOEKENBAAI_ENABLE_ISBNBARCODE || '').toLowerCase() === 'true';
const IMPORT_ISBN_ENRICHMENT_ENABLED =
  String(process.env.BOEKENBAAI_IMPORT_ENRICH_ISBN || '').toLowerCase() === 'true';
const DEFAULT_ISBN_CACHE_TTL_MS = 5 * 60 * 1000;
const ISBN_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.BOEKENBAAI_ISBN_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_ISBN_CACHE_TTL_MS;
})();

const STATIC_DIR = (() => {
  const candidates = [configuredStaticDir, DIST_DIR, PUBLIC_DIR].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch (error) {
      // Ignore missing directories, try the next candidate.
    }
  }
  return PUBLIC_DIR;
})();

const allowedOrigins = (process.env.BOEKENBAAI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const EMPTY_DB = {
  books: [],
  students: [],
  folders: [],
  classes: [],
  users: [],
  history: [],
};

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function ensureDbFile() {
  try {
    fs.accessSync(DATA_PATH, fs.constants.F_OK);
  } catch (error) {
    ensureParentDirectory(DATA_PATH);
    if (DATA_PATH !== DEFAULT_DATA_PATH && fs.existsSync(DEFAULT_DATA_PATH)) {
      fs.copyFileSync(DEFAULT_DATA_PATH, DATA_PATH);
    } else {
      fs.writeFileSync(DATA_PATH, JSON.stringify(EMPTY_DB, null, 2));
    }
  }
}

ensureDbFile();
console.log(`Boekenbaai gebruikt data-bestand: ${DATA_PATH}`);
console.log(`Boekenbaai serveert statische bestanden uit: ${STATIC_DIR}`);

const sessions = new Map();
const isbnMetadataCache = new Map();
const isbnLookupInflight = new Map();
const globalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

function getIsbnCacheKey(isbn) {
  const sanitized = sanitizeIsbn(isbn);
  return sanitized || `invalid:${String(isbn ?? '').trim()}`;
}

function resolveLookupIsbnMetadata() {
  if (typeof globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP === 'function') {
    return globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP;
  }
  return lookupIsbnMetadata;
}

function isOriginAllowed(origin, requestUrl) {
  if (!origin) return false;
  if (allowedOrigins.includes('*')) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  if (allowedOrigins.length === 0) {
    const sameOrigin = `${requestUrl.protocol}//${requestUrl.host}`;
    return origin === sameOrigin;
  }
  return false;
}

function applyCors(req, res, requestUrl) {
  const origin = req.headers.origin;
  if (!origin || !isOriginAllowed(origin, requestUrl)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function ensureStudentShape(student) {
  const safeStudent = { ...student };
  if (!Array.isArray(safeStudent.borrowedBooks)) {
    safeStudent.borrowedBooks = [];
  }
  if (!Array.isArray(safeStudent.classIds)) {
    safeStudent.classIds = [];
  }
  safeStudent.username = safeStudent.username || '';
  safeStudent.passwordHash = safeStudent.passwordHash || '';
  safeStudent.mustChangePassword = Boolean(student.mustChangePassword);
  return safeStudent;
}

function ensureClassShape(klass) {
  const safeClass = { ...klass };
  safeClass.name = typeof safeClass.name === 'string' ? safeClass.name : '';
  safeClass.teacherIds = Array.isArray(safeClass.teacherIds)
    ? Array.from(new Set(safeClass.teacherIds.filter((id) => typeof id === 'string')))
    : [];
  safeClass.studentIds = Array.isArray(safeClass.studentIds)
    ? Array.from(new Set(safeClass.studentIds.filter((id) => typeof id === 'string')))
    : [];
  return safeClass;
}

function ensureTeacherShape(user) {
  if (!user) {
    return user;
  }
  const safeUser = { ...user };
  safeUser.username = typeof safeUser.username === 'string' ? safeUser.username : '';
  safeUser.passwordHash = typeof safeUser.passwordHash === 'string' ? safeUser.passwordHash : '';
  safeUser.mustChangePassword = Boolean(user.mustChangePassword);
  if (safeUser.role !== 'teacher') {
    return safeUser;
  }
  safeUser.classIds = Array.isArray(safeUser.classIds)
    ? Array.from(new Set(safeUser.classIds.filter((id) => typeof id === 'string')))
    : [];
  return safeUser;
}

function normalizeClassKey(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function normalizePublisher(value) {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
      .filter(Boolean)
      .join(', ');
  }
  return String(value).trim();
}

function normalizePublishedYear(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 0 ? year : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const match = text.match(/(\d{4})/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

function normalizePageCountValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const number = Number(text);
  if (Number.isFinite(number) && number > 0) {
    return Math.round(number);
  }
  const match = text.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLanguageCode(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeLanguageCode(entry);
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  const token = text.split(/[,;/\s]+/).find((part) => part.trim());
  if (!token) {
    return '';
  }
  return token.length <= 3 ? token.toLowerCase() : token;
}

function normalizeCoverUrl(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const text = String(value).trim();
  return text;
}

function ensureBookShape(book) {
  const source = typeof book === 'object' && book ? book : {};
  const safeBook = { ...source };
  safeBook.title = typeof source.title === 'string' ? source.title : '';
  safeBook.author = typeof source.author === 'string' ? source.author : '';
  safeBook.barcode = typeof source.barcode === 'string' ? source.barcode : '';
  safeBook.description = typeof source.description === 'string' ? source.description : '';
  if (typeof source.folderId === 'string' && source.folderId.trim()) {
    safeBook.folderId = source.folderId;
  } else {
    safeBook.folderId = null;
  }
  safeBook.suitableForExamList = Boolean(source.suitableForExamList);
  safeBook.status = typeof source.status === 'string' ? source.status : 'available';
  safeBook.borrowedBy = typeof source.borrowedBy === 'string' ? source.borrowedBy : null;
  safeBook.dueDate = typeof source.dueDate === 'string' && source.dueDate.trim() ? source.dueDate : null;
  safeBook.tags = parseMultiValueField(source.tags);
  safeBook.coverColor = typeof source.coverColor === 'string' ? source.coverColor : '#f9f9f9';
  safeBook.publisher = normalizePublisher(source.publisher);
  safeBook.publishedYear = normalizePublishedYear(
    source.publishedYear ?? source.year ?? source.publishedAt
  );
  safeBook.pageCount = normalizePageCountValue(source.pageCount ?? source.pages);
  safeBook.language = normalizeLanguageCode(source.language);
  safeBook.coverUrl = normalizeCoverUrl(source.coverUrl || source.cover || '');
  return safeBook;
}

function ensureFolderShape(folder) {
  const source = typeof folder === 'object' && folder ? folder : {};
  const safeFolder = { ...source };
  safeFolder.name = typeof source.name === 'string' ? source.name : '';
  safeFolder.description = typeof source.description === 'string' ? source.description : '';
  safeFolder.color = typeof source.color === 'string' ? source.color : '#9f86c0';
  safeFolder.examList = Boolean(source.examList);
  return safeFolder;
}

function getBorrowCountsMap(historyEntries) {
  const counts = new Map();
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  for (const entry of entries) {
    if (!entry || entry.type !== 'check_out') {
      continue;
    }
    const rawId = entry.bookId;
    const bookId = typeof rawId === 'string' ? rawId : rawId != null ? String(rawId) : '';
    if (!bookId) {
      continue;
    }
    const current = counts.get(bookId) || 0;
    counts.set(bookId, current + 1);
  }
  return counts;
}

function withBorrowCount(book, borrowCounts) {
  if (!book) {
    return book;
  }
  const bookId = typeof book.id === 'string' ? book.id : book.id != null ? String(book.id) : '';
  const borrowCount = bookId && borrowCounts instanceof Map ? borrowCounts.get(bookId) || 0 : 0;
  return { ...book, borrowCount };
}

function findClassByName(db, name) {
  const key = normalizeClassKey(name);
  if (!key) return null;
  return db.classes.find((klass) => normalizeClassKey(klass.name) === key) || null;
}

function ensureClassRecord(db, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    return null;
  }
  let klass = findClassByName(db, trimmed);
  if (!klass) {
    klass = {
      id: crypto.randomUUID(),
      name: trimmed,
      teacherIds: [],
      studentIds: [],
    };
    db.classes.push(klass);
  } else {
    if (!Array.isArray(klass.teacherIds)) {
      klass.teacherIds = [];
    }
    if (!Array.isArray(klass.studentIds)) {
      klass.studentIds = [];
    }
  }
  return klass;
}

function parseMultiValueField(value) {
  if (!value && value !== 0) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')).trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/[,;/\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['true', '1', 'yes', 'y', 'ja', 'on'].includes(normalized);
}

function collectTeacherNames(db, classRecords) {
  if (!Array.isArray(classRecords) || !classRecords.length) {
    return [];
  }
  const names = new Set();
  for (const klass of classRecords) {
    const teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
    for (const teacherId of teacherIds) {
      const teacher = db.users.find((account) => account.id === teacherId);
      if (teacher) {
        names.add(teacher.name || teacher.username || 'Onbekende docent');
      }
    }
  }
  return Array.from(names);
}

function normalizeRowKeys(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!key) continue;
    normalized[key.toLowerCase().trim()] = value;
  }
  return normalized;
}

function readWorkbookRows(XLSX, base64) {
  let workbook;
  try {
    const buffer = Buffer.from(base64, 'base64');
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    return { ok: false, error: 'Het Excelbestand kon niet gelezen worden' };
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { ok: false, error: 'Het bestand bevat geen werkblad' };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) {
    return { ok: false, error: 'Het werkblad is leeg' };
  }
  return { ok: true, rows };
}

function loadDb() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.books)) data.books = [];
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.classes)) data.classes = [];
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.folders)) data.folders = [];
  if (!Array.isArray(data.history)) data.history = [];
  data.books = data.books.map(ensureBookShape);
  data.students = data.students.map(ensureStudentShape);
  data.classes = data.classes.map(ensureClassShape);
  data.folders = data.folders.map(ensureFolderShape);
  data.users = data.users.map(ensureTeacherShape);
  return data;
}

function saveDb(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getTokenFromHeader(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  return match ? match[1] : null;
}

function getAuthenticatedUser(req, getDb) {
  const token = getTokenFromHeader(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const db = getDb();
  if (session.type === 'staff') {
    const user = db.users.find((entry) => entry.id === session.userId);
    if (!user) {
      sessions.delete(token);
      return null;
    }
    return { ...user, token };
  }
  if (session.type === 'student') {
    const student = db.students.find((entry) => entry.id === session.userId);
    if (!student) {
      sessions.delete(token);
      return null;
    }
    return {
      id: student.id,
      name: student.name,
      role: 'student',
      grade: student.grade || '',
      borrowedBooks: student.borrowedBooks,
      classIds: student.classIds,
      username: student.username,
      token,
    };
  }
  sessions.delete(token);
  return null;
}

function ensureRole(user, roles) {
  if (!user) return false;
  if (!roles || roles.length === 0) return true;
  return roles.includes(user.role);
}

function sanitizeStudent(student, options = {}) {
  if (!student) return null;
  const base = {
    id: student.id,
    name: student.name,
    grade: student.grade || '',
    borrowedBooks: Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [],
    classIds: Array.isArray(student.classIds) ? student.classIds : [],
    mustChangePassword: Boolean(student.mustChangePassword),
  };
  if (options.includeUsername) {
    base.username = student.username || '';
  }
  return base;
}

function sanitizeTeacher(teacher) {
  if (!teacher) return null;
  return {
    id: teacher.id,
    name: teacher.name,
    username: teacher.username || '',
    classIds: Array.isArray(teacher.classIds) ? teacher.classIds : [],
    mustChangePassword: Boolean(teacher.mustChangePassword),
  };
}

function findStudentByUsername(db, username) {
  const normalized = username.trim().toLowerCase();
  return db.students.find((entry) => (entry.username || '').toLowerCase() === normalized);
}

function generatePassword(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function isUsernameTaken(db, username, { allowStudentId = null, allowUserId = null } = {}) {
  const normalized = String(username || '').trim().toLowerCase();
  if (
    db.users.some((user) => {
      if (!user || typeof user.username !== 'string') {
        return false;
      }
      if (allowUserId && user.id === allowUserId) {
        return false;
      }
      return user.username.toLowerCase() === normalized;
    })
  ) {
    return true;
  }
  return db.students.some((student) => {
    if (!student || typeof student.username !== 'string') {
      return false;
    }
    if (allowStudentId && student.id === allowStudentId) {
      return false;
    }
    return student.username.toLowerCase() === normalized;
  });
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toStringList(value) {
  return toArray(value)
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object') {
        return entry.name || entry.full_name || entry.label || entry.value || entry.text || null;
      }
      return null;
    })
    .filter(Boolean);
}

function sanitizeIsbn(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9X]/gi, '');
}

function normalizeBarcode(value) {
  if (value == null) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  const hasTrailingX = /x$/i.test(trimmed);
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (!digitsOnly && !hasTrailingX) {
    return '';
  }
  return hasTrailingX ? `${digitsOnly}X` : digitsOnly;
}

function parseIsbnBarcodeData(data, fallbackBarcode) {
  if (!data || typeof data !== 'object') return null;
  const title = data.title || data.book_title || data.item_name || data.name || '';
  const authorStrings = toStringList(data.author || data.author_name || data.authors || data.contributors);
  const author = typeof data.author === 'string'
    ? data.author
    : authorStrings[0] || '';
  const description = typeof data.description === 'string'
    ? data.description
    : data.description?.value || data.synopsis || data.summary || '';
  const publisher = toStringList(data.publisher || data.publisher_name || data.publishers).join(', ');
  const publishedAt = data.publish_date || data.publication_date || '';
  const language = toStringList(data.language || data.languages || data.language_name).join(', ');
  if (!title && !author && !description && !publisher) {
    return null;
  }
  return {
    barcode: sanitizeIsbn(data.isbn || data.ean || fallbackBarcode),
    title,
    author,
    authors: authorStrings,
    description,
    publisher,
    publishedAt,
    language,
    source: 'isbnbarcode.org',
    found: true,
  };
}

function parseOpenLibraryData(data, fallbackBarcode) {
  if (!data || typeof data !== 'object') return null;
  const title = data.title || '';
  const authorStrings = toStringList(data.authors);
  if (!authorStrings.length && typeof data.by_statement === 'string') {
    authorStrings.push(data.by_statement);
  }
  const author = authorStrings[0] || '';
  const description = typeof data.description === 'string'
    ? data.description
    : data.description?.value || '';
  const publisher = toStringList(data.publishers).join(', ');
  const publishedAt = data.publish_date || '';
  const language = toArray(data.languages)
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.key === 'string') {
        return entry.key.split('/').pop();
      }
      return null;
    })
    .filter(Boolean)
    .join(', ');
  if (!title && !author && !description && !publisher) {
    return null;
  }
  return {
    barcode: sanitizeIsbn((data.isbn_13 && data.isbn_13[0]) || (data.isbn_10 && data.isbn_10[0]) || fallbackBarcode),
    title,
    author,
    authors: authorStrings,
    description,
    publisher,
    publishedAt,
    language,
    source: 'openlibrary',
    found: true,
  };
}

function normalizeIsbnMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { fields: null, source: null, found: false };
  }
  const metadataAuthor = metadata.author || (Array.isArray(metadata.authors) ? metadata.authors.find(Boolean) : '');
  const publisher = normalizePublisher(metadata.publisher);
  const publishedYear = normalizePublishedYear(metadata.publishedYear ?? metadata.publishedAt);
  const pageCount = normalizePageCountValue(metadata.pageCount);
  const language = normalizeLanguageCode(metadata.language);
  const coverUrl = normalizeCoverUrl(metadata.coverUrl);
  const tags = parseMultiValueField(metadata.tags);
  const fields = {
    title: typeof metadata.title === 'string' ? metadata.title.trim() : '',
    author: metadataAuthor ? String(metadataAuthor).trim() : '',
    description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
    publisher,
    publishedYear,
    pageCount,
    language,
    coverUrl,
    tags,
  };
  return {
    fields,
    source: metadata.source || null,
    found: Boolean(metadata.found),
  };
}

async function lookupIsbnMetadata(isbn) {
  const sanitized = sanitizeIsbn(isbn);
  const cacheKey = getIsbnCacheKey(isbn);
  const now = Date.now();
  const cached = isbnMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    isbnMetadataCache.delete(cacheKey);
  }

  const inflight = isbnLookupInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const lookupPromise = (async () => {
    let result;

    if (!sanitized) {
      result = {
        barcode: '',
        title: '',
        author: '',
        authors: [],
        description: '',
        publisher: '',
        publishedAt: '',
        language: '',
        source: 'unknown',
        found: false,
      };
    } else if (!globalFetch) {
      result = {
        barcode: sanitized,
        title: '',
        author: '',
        authors: [],
        description: '',
        publisher: '',
        publishedAt: '',
        language: '',
        source: 'offline',
        found: false,
      };
    } else {
      const headers = {
        Accept: 'application/json',
        'User-Agent': 'Boekenbaai/1.0 (+https://boekenbaai.example)',
      };

      const sources = [
        {
          name: 'openlibrary',
          url: `https://openlibrary.org/isbn/${sanitized}.json`,
          parser: (data) => parseOpenLibraryData(data, sanitized),
        },
      ];

      if (ENABLE_ISBNBARCODE_LOOKUP) {
        sources.push({
          name: 'isbnbarcode.org',
          url: `${ISBN_API_BASE.replace(/\/$/, '')}/${sanitized}`,
          parser: (data) => parseIsbnBarcodeData(data, sanitized),
        });
      }

      for (const source of sources) {
        try {
          const response = await globalFetch(source.url, { headers });
          if (!response.ok) {
            if (response.status === 404) {
              continue;
            }
            continue;
          }
          const contentType = response.headers.get('content-type') || '';
          let payload = null;
          if (contentType.includes('application/json')) {
            payload = await response.json();
          } else {
            const text = await response.text();
            try {
              payload = JSON.parse(text);
            } catch (error) {
              payload = null;
            }
          }
          const metadata = source.parser(payload);
          if (metadata) {
            result = metadata;
            break;
          }
        } catch (error) {
          console.warn(`Kon geen gegevens ophalen via ${source.name}:`, error.message || error);
        }
      }

      if (!result) {
        result = {
          barcode: sanitized,
          title: '',
          author: '',
          authors: [],
          description: '',
          publisher: '',
          publishedAt: '',
          language: '',
          source: 'none',
          found: false,
        };
      }
    }

    isbnMetadataCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + ISBN_CACHE_TTL_MS,
    });
    return result;
  })();

  isbnLookupInflight.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    isbnLookupInflight.delete(cacheKey);
  }
}

function sendJson(res, statusCode, payload) {
  const headers = { 'Content-Type': 'application/json' };
  const varyHeader = res.getHeader('Vary');
  if (varyHeader) headers.Vary = varyHeader;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  const allowHeaders = res.getHeader('Access-Control-Allow-Headers');
  if (allowHeaders) headers['Access-Control-Allow-Headers'] = allowHeaders;
  const allowMethods = res.getHeader('Access-Control-Allow-Methods');
  if (allowMethods) headers['Access-Control-Allow-Methods'] = allowMethods;
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, headers = {}) {
  const varyHeader = res.getHeader('Vary');
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  const allowHeaders = res.getHeader('Access-Control-Allow-Headers');
  const allowMethods = res.getHeader('Access-Control-Allow-Methods');
  const finalHeaders = {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  };
  if (varyHeader) finalHeaders.Vary = varyHeader;
  if (allowOrigin) finalHeaders['Access-Control-Allow-Origin'] = allowOrigin;
  if (allowHeaders) finalHeaders['Access-Control-Allow-Headers'] = allowHeaders;
  if (allowMethods) finalHeaders['Access-Control-Allow-Methods'] = allowMethods;
  res.writeHead(statusCode, finalHeaders);
  res.end(text);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Bestand niet gevonden');
      return;
    }
    if (ext === '.html') {
      let html = data.toString('utf-8');
      if (PUBLIC_API_BASE) {
        html = html.replace(
          /(<meta\s+name="boekenbaai-api-base"\s+content=")([^"]*)("[^>]*>)/i,
          `$1${PUBLIC_API_BASE}$3`
        );
        if (!html.includes('window.BOEKENBAAI_API_BASE')) {
          const script = `    <script>window.BOEKENBAAI_API_BASE = ${JSON.stringify(
            PUBLIC_API_BASE
          )};</script>`;
          html = html.replace(/<\/head>/i, `${script}\n  </head>`);
        }
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload te groot'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error('Kon JSON niet lezen'));
      }
    });
  });
}

/**
 * Voeg een uitleenlogregel toe aan `db.history`.
 * Wordt gebruikt voor check-ins/-outs en verwante gebeurtenissen.
 */
function appendHistory(db, entry) {
  db.history.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  db.history = db.history.slice(0, 200);
}

/**
 * Geef de uitleenlog van een leerling terug op basis van `db.history`.
 * Filtert uitsluitend check-ins/-outs en sorteert op tijdstip.
 */
function getStudentLoanHistory(db, studentId) {
  const entries = Array.isArray(db.history) ? db.history : [];
  const loans = entries
    .filter((entry) =>
      entry &&
      entry.studentId === studentId &&
      (entry.type === 'check_out' || entry.type === 'check_in') &&
      typeof entry.timestamp === 'string'
    )
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      bookId: entry.bookId,
      studentId: entry.studentId,
      message: entry.message,
      timestamp: entry.timestamp,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return loans;
}

function getPublicLoanActivity(db, { limit = 12 } = {}) {
  const entries = Array.isArray(db.history) ? db.history : [];
  const sanitized = entries
    .filter((entry) =>
      entry &&
      (entry.type === 'check_out' || entry.type === 'check_in') &&
      typeof entry.timestamp === 'string'
    )
    .map((entry) => {
      const book = findBookById(db, entry.bookId);
      return {
        id: entry.id,
        type: entry.type,
        bookId: entry.bookId,
        title: book?.title || 'Onbekend boek',
        timestamp: entry.timestamp,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (Number.isFinite(limit) && limit > 0) {
    return sanitized.slice(0, limit);
  }
  return sanitized;
}

function getCurrentSchoolYearRange(now = new Date()) {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(startYear, 7, 1, 0, 0, 0, 0);
  const end = new Date(startYear + 1, 6, 31, 23, 59, 59, 999);
  return { start, end };
}

function buildStudentStats(db, studentId) {
  const student = findStudentById(db, studentId);
  if (!student) {
    return null;
  }

  const loanHistory = getStudentLoanHistory(db, studentId);
  const checkoutHistory = loanHistory.filter((entry) => entry.type === 'check_out');
  const totalBorrowed = checkoutHistory.length;
  const lastBorrowedAt = checkoutHistory.length ? checkoutHistory[0].timestamp : null;
  const lastReadAt = loanHistory.length ? loanHistory[0].timestamp : lastBorrowedAt;

  const { start: schoolYearStart, end: schoolYearEnd } = getCurrentSchoolYearRange();
  const schoolYearBorrowCount = checkoutHistory.filter((entry) => {
    const timestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
    return timestamp && timestamp >= schoolYearStart && timestamp <= schoolYearEnd;
  }).length;

  const activeBorrowedBooks = Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [];
  const now = Date.now();
  const activeLoans = activeBorrowedBooks.map((loan) => {
    const book = findBookById(db, loan.bookId);
    const borrowedAt = loan.borrowedAt || loan.timestamp || loan.date || book?.borrowedAt || null;
    const borrowedMs = borrowedAt ? new Date(borrowedAt).getTime() : NaN;
    const daysBorrowed = Number.isFinite(borrowedMs)
      ? Math.max(0, Math.floor((now - borrowedMs) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      bookId: loan.bookId,
      title: book?.title || loan.title || 'Onbekend boek',
      borrowedAt,
      dueDate: loan.dueDate || book?.dueDate || null,
      daysBorrowed,
    };
  });

  const genreCounts = checkoutHistory.reduce((acc, entry) => {
    const book = findBookById(db, entry.bookId);
    const tags = Array.isArray(book?.tags) ? book.tags : [];
    if (!tags.length) {
      acc.set('Onbekend genre', (acc.get('Onbekend genre') || 0) + 1);
      return acc;
    }
    for (const tag of tags) {
      const key = String(tag || '').trim() || 'Onbekend genre';
      acc.set(key, (acc.get(key) || 0) + 1);
    }
    return acc;
  }, new Map());
  const topGenres = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const borrowedTitlesMap = checkoutHistory.reduce((acc, entry) => {
    const book = findBookById(db, entry.bookId);
    const title = book?.title || entry.title || 'Onbekend boek';
    const existing = acc.get(entry.bookId);
    if (!existing) {
      acc.set(entry.bookId, { bookId: entry.bookId, title, lastBorrowedAt: entry.timestamp, borrowCount: 1 });
    } else {
      existing.borrowCount += 1;
      if (entry.timestamp && new Date(entry.timestamp) > new Date(existing.lastBorrowedAt)) {
        existing.lastBorrowedAt = entry.timestamp;
      }
    }
    return acc;
  }, new Map());
  const borrowedTitles = Array.from(borrowedTitlesMap.values()).sort(
    (a, b) => new Date(b.lastBorrowedAt).getTime() - new Date(a.lastBorrowedAt).getTime()
  );

  return {
    studentId,
    totalBorrowed,
    totalBorrowedBooks: totalBorrowed,
    borrowCount: totalBorrowed,
    borrowedCount: totalBorrowed,
    schoolYearBorrowCount,
    activeLoans,
    activeLoanCount: activeLoans.length,
    lastReadAt,
    lastBorrowedAt,
    topGenres,
    borrowedTitles,
  };
}

function buildSchoolStats(db) {
  const history = Array.isArray(db.history) ? db.history : [];
  const checkouts = history.filter((entry) => entry && entry.type === 'check_out');
  const totalBorrowed = checkouts.length;

  const borrowCountByBookId = new Map();
  for (const entry of checkouts) {
    if (!entry.bookId) continue;
    const current = borrowCountByBookId.get(entry.bookId) || 0;
    borrowCountByBookId.set(entry.bookId, current + 1);
  }

  const genreCounts = new Map();
  for (const entry of checkouts) {
    const book = findBookById(db, entry.bookId);
    const tags = Array.isArray(book?.tags) ? book.tags : [];
    for (const tag of tags) {
      const label = String(tag || '').trim();
      if (!label) continue;
      genreCounts.set(label, (genreCounts.get(label) || 0) + 1);
    }
  }

  const topGenres = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  const alwaysBorrowed = db.books
    .filter((book) => book.status === 'borrowed')
    .map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      borrowCount: borrowCountByBookId.get(book.id) || 0,
      borrowedBy: book.borrowedBy || null,
      dueDate: book.dueDate || null,
    }))
    .sort((a, b) => b.borrowCount - a.borrowCount || a.title.localeCompare(b.title))
    .slice(0, 5);

  return {
    totalBorrowed,
    totalBorrowedBooks: totalBorrowed,
    borrowCount: totalBorrowed,
    borrowedCount: totalBorrowed,
    topGenres,
    alwaysBorrowed,
  };
}

function findBookById(db, id) {
  return db.books.find((book) => book.id === id);
}

function findBookByBarcode(db, barcode) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    return null;
  }
  return db.books.find((book) => normalizeBarcode(book.barcode) === normalized) || null;
}

function findStudentById(db, id) {
  return db.students.find((student) => student.id === id);
}

function getTeacherClassIds(db, teacherId) {
  if (!teacherId) {
    return [];
  }
  const ids = new Set();
  for (const klass of db.classes) {
    const teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
    if (teacherIds.includes(teacherId)) {
      ids.add(klass.id);
    }
  }
  return Array.from(ids);
}

async function handleApi(req, res, requestUrl) {
  const originAllowed = isOriginAllowed(req.headers.origin, requestUrl);
  if (req.method === 'OPTIONS') {
    if (originAllowed) {
      applyCors(req, res, requestUrl);
      res.writeHead(204, { 'Content-Length': '0' });
    } else {
      res.writeHead(403, { 'Content-Length': '0' });
    }
    res.end();
    return;
  }

  if (originAllowed) {
    applyCors(req, res, requestUrl);
  }

  try {
    let db;
    const getDb = () => {
      if (!db) {
        db = loadDb();
      }
      return db;
    };
    const user = getAuthenticatedUser(req, getDb);

    if (req.method === 'POST' && requestUrl.pathname === '/api/login') {
      const body = await parseBody(req);
      if (!body.username || !body.password) {
        return sendJson(res, 400, { message: 'Gebruikersnaam en wachtwoord zijn verplicht' });
      }
      const database = getDb();
      const username = body.username.trim();
      const normalized = username.toLowerCase();
      const passwordHash = hashPassword(body.password);

      const staffAccount = database.users.find(
        (entry) => entry.username.toLowerCase() === normalized
      );
      if (staffAccount && staffAccount.passwordHash === passwordHash) {
        const token = crypto.randomUUID();
        sessions.set(token, { userId: staffAccount.id, type: 'staff', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: staffAccount.id,
            name: staffAccount.name,
            role: staffAccount.role,
            mustChangePassword: Boolean(staffAccount.mustChangePassword),
          },
        });
      }

      const studentAccount = findStudentByUsername(database, username);
      if (studentAccount && studentAccount.passwordHash === passwordHash) {
        const token = crypto.randomUUID();
        sessions.set(token, { userId: studentAccount.id, type: 'student', createdAt: Date.now() });
        return sendJson(res, 200, {
          token,
          user: {
            id: studentAccount.id,
            name: studentAccount.name,
            role: 'student',
            grade: studentAccount.grade || '',
            mustChangePassword: Boolean(studentAccount.mustChangePassword),
          },
        });
      }

      return sendJson(res, 401, { message: 'Onjuiste inloggegevens' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/logout') {
      const token = getTokenFromHeader(req);
      if (token) {
        sessions.delete(token);
      }
      return sendJson(res, 200, { message: 'Afgemeld' });
    }

    if (req.method === 'PATCH' && requestUrl.pathname === '/api/account/password') {
      if (!user) {
        return sendJson(res, 401, { message: 'Niet ingelogd' });
      }
      const body = await parseBody(req);
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : String(body.currentPassword || '');
      const newPassword =
        typeof body.newPassword === 'string' ? body.newPassword : String(body.newPassword || '');
      if (!currentPassword || !newPassword) {
        return sendJson(res, 400, { message: 'Vul je huidige en nieuwe wachtwoord in.' });
      }
      if (newPassword.length < 6) {
        return sendJson(res, 400, {
          message: 'Kies een nieuw wachtwoord van minimaal 6 tekens.',
        });
      }

      const db = getDb();
      let account = null;
      if (user.role === 'student') {
        account = db.students.find((entry) => entry.id === user.id) || null;
      } else if (user.role === 'teacher' || user.role === 'admin') {
        account = db.users.find((entry) => entry.id === user.id) || null;
      }
      if (!account) {
        return sendJson(res, 404, { message: 'Account niet gevonden' });
      }

      const currentHash = hashPassword(currentPassword);
      if (account.passwordHash !== currentHash) {
        return sendJson(res, 400, { message: 'Huidig wachtwoord klopt niet.' });
      }

      const newHash = hashPassword(newPassword);
      if (newHash === account.passwordHash) {
        return sendJson(res, 400, { message: 'Kies een ander nieuw wachtwoord.' });
      }
      account.passwordHash = newHash;
      if (body.clearMustChange !== false) {
        account.mustChangePassword = false;
      }
      saveDb(db);
      return sendJson(res, 200, {
        message: 'Wachtwoord gewijzigd',
        mustChangePassword: Boolean(account.mustChangePassword),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/me') {
      if (!user) {
        return sendJson(res, 401, { message: 'Niet ingelogd' });
      }
      if (user.role === 'student') {
        const db = getDb();
        const student = findStudentById(db, user.id);
        return sendJson(res, 200, {
          id: student.id,
          name: student.name,
          role: 'student',
          grade: student.grade || '',
          borrowedBooks: student.borrowedBooks || [],
          classIds: student.classIds || [],
          username: student.username || '',
          mustChangePassword: Boolean(student.mustChangePassword),
        });
      }
      return sendJson(res, 200, {
        id: user.id,
        name: user.name,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      const db = getDb();
      const totalBooks = db.books.length;
      const borrowedBooks = db.books.filter((book) => book.status === 'borrowed').length;
      const availableBooks = totalBooks - borrowedBooks;
      const examListBooks = db.books.filter((book) => book.suitableForExamList).length;
      return sendJson(res, 200, { totalBooks, borrowedBooks, availableBooks, examListBooks });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/books') {
      const db = getDb();
      const borrowCounts = getBorrowCountsMap(db.history);
      let books = db.books.map((book) => withBorrowCount(book, borrowCounts));
      const folder = requestUrl.searchParams.get('folder');
      const query = requestUrl.searchParams.get('query');
      if (folder) {
        books = books.filter((book) => book.folderId === folder);
      }
      if (query) {
        const term = query.toLowerCase();
        books = books.filter((book) => {
          return (
            book.title.toLowerCase().includes(term) ||
            book.author.toLowerCase().includes(term) ||
            (book.description && book.description.toLowerCase().includes(term)) ||
            (book.tags || []).some((tag) => tag.toLowerCase().includes(term))
          );
        });
      }
      return sendJson(res, 200, books);
    }

    const bookIdMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)$/);
    if (bookIdMatch && req.method === 'GET') {
      const db = getDb();
      const book = findBookById(db, bookIdMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      const borrowCounts = getBorrowCountsMap(db.history);
      return sendJson(res, 200, withBorrowCount(book, borrowCounts));
    }

    if (requestUrl.pathname === '/api/books' && req.method === 'POST') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.title || !body.author || !body.barcode) {
        return sendJson(res, 400, { message: 'Titel, auteur en barcode zijn verplicht' });
      }
      const normalizedBarcode = normalizeBarcode(body.barcode);
      if (!normalizedBarcode) {
        return sendJson(res, 400, { message: 'Voer een geldige barcode in' });
      }
      if (findBookByBarcode(db, normalizedBarcode)) {
        return sendJson(res, 409, { message: 'Er bestaat al een boek met deze barcode' });
      }
      const tags = parseMultiValueField(body.tags);
      const publisher = normalizePublisher(body.publisher);
      const publishedYear = normalizePublishedYear(body.publishedYear ?? body.year ?? body.publishedAt);
      const pageCount = normalizePageCountValue(body.pageCount ?? body.pages);
      const language = normalizeLanguageCode(body.language);
      const coverUrl = normalizeCoverUrl(body.coverUrl);
      const coverColor = typeof body.coverColor === 'string' ? body.coverColor : '#f9f9f9';
      const book = {
        id: crypto.randomUUID(),
        title: body.title,
        author: body.author,
        barcode: normalizedBarcode,
        description: body.description || '',
        suitableForExamList: Boolean(body.suitableForExamList),
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        tags,
        coverColor,
        publisher,
        publishedYear,
        pageCount,
        language,
        coverUrl,
      };
      db.books.push(book);
      appendHistory(db, {
        type: 'book_created',
        bookId: book.id,
        message: `${book.title} is toegevoegd aan de bibliotheek`,
      });
      saveDb(db);
      return sendJson(res, 201, book);
    }

    if (bookIdMatch && req.method === 'PUT') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken wijzigen' });
      }
      const db = getDb();
      const book = findBookById(db, bookIdMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      const body = await parseBody(req);
      const hasNewBarcode = Object.prototype.hasOwnProperty.call(body, 'barcode');
      const normalizedNewBarcode = hasNewBarcode
        ? normalizeBarcode(body.barcode)
        : normalizeBarcode(book.barcode);
      if (hasNewBarcode && !normalizedNewBarcode) {
        return sendJson(res, 400, { message: 'Voer een geldige barcode in' });
      }
      const normalizedCurrentBarcode = normalizeBarcode(book.barcode);
      if (
        normalizedNewBarcode &&
        normalizedNewBarcode !== normalizedCurrentBarcode &&
        findBookByBarcode(db, normalizedNewBarcode)
      ) {
        return sendJson(res, 409, { message: 'Er bestaat al een boek met deze barcode' });
      }
      const hasPublisher = Object.prototype.hasOwnProperty.call(body, 'publisher');
      const hasPublishedYear =
        Object.prototype.hasOwnProperty.call(body, 'publishedYear') ||
        Object.prototype.hasOwnProperty.call(body, 'year');
      const hasPageCount =
        Object.prototype.hasOwnProperty.call(body, 'pageCount') ||
        Object.prototype.hasOwnProperty.call(body, 'pages');
      const hasLanguage = Object.prototype.hasOwnProperty.call(body, 'language');
      const hasCoverUrl = Object.prototype.hasOwnProperty.call(body, 'coverUrl');
      const hasTags = Object.prototype.hasOwnProperty.call(body, 'tags');
      const nextTags = hasTags ? parseMultiValueField(body.tags) : book.tags;
      const nextPublisher = hasPublisher ? normalizePublisher(body.publisher) : book.publisher;
      const nextPublishedYear = hasPublishedYear
        ? normalizePublishedYear(body.publishedYear ?? body.year ?? body.publishedAt)
        : book.publishedYear;
      const nextPageCount = hasPageCount
        ? normalizePageCountValue(body.pageCount ?? body.pages)
        : book.pageCount;
      const nextLanguage = hasLanguage ? normalizeLanguageCode(body.language) : book.language;
      const nextCoverUrl = hasCoverUrl ? normalizeCoverUrl(body.coverUrl) : book.coverUrl;
      Object.assign(book, {
        title: body.title ?? book.title,
        author: body.author ?? book.author,
        barcode: normalizedNewBarcode || '',
        description: body.description ?? book.description,
        suitableForExamList: body.suitableForExamList ?? book.suitableForExamList,
        tags: nextTags,
        coverColor: body.coverColor ?? book.coverColor,
        publisher: nextPublisher,
        publishedYear: nextPublishedYear,
        pageCount: nextPageCount,
        language: nextLanguage,
        coverUrl: nextCoverUrl,
      });
      appendHistory(db, {
        type: 'book_updated',
        bookId: book.id,
        message: `${book.title} is bijgewerkt`,
      });
      saveDb(db);
      return sendJson(res, 200, book);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/books/import') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message: 'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }
      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }
      const db = getDb();
      const createdBooks = [];
      const updatedBooks = [];
      const skipped = [];
      let changed = false;
      const lookup = resolveLookupIsbnMetadata();
      const importEnrichmentEnabled =
        body.enrichIsbn === undefined
          ? IMPORT_ISBN_ENRICHMENT_ENABLED
          : parseBooleanFlag(body.enrichIsbn);

      for (const row of workbookResult.rows) {
        const normalized = normalizeRowKeys(row);
        const title = String(normalized.titel || normalized.title || '').trim();
        const author = String(normalized.auteur || normalized.author || '').trim();
        const barcodeSource =
          normalized.barcode ||
          normalized['barcode / isbn'] ||
          normalized.isbn ||
          normalized['isbn13'] ||
          normalized['isbn-13'] ||
          normalized['isbn 13'] ||
          normalized['isbn'] ||
          normalized.ean ||
          normalized['ean13'] ||
          normalized['ean-13'] ||
          normalized['streepjescode'] ||
          normalized.code;
        const barcode = normalizeBarcode(barcodeSource);
        const missingFields = [];
        if (!title) missingFields.push('titel');
        if (!author) missingFields.push('auteur');
        if (!barcode) missingFields.push('barcode/ISBN');
        if (missingFields.length) {
          skipped.push({
            title: title || '(onbekend)',
            author: author || '',
            barcode: barcodeSource ? String(barcodeSource).trim() : '',
            reason: `Ontbrekende ${missingFields.join(', ')}`,
          });
          continue;
        }

        const description = String(
          normalized.beschrijving ||
            normalized.description ||
            normalized.samenvatting ||
            normalized.summary ||
            ''
        ).trim();
        const publisherSource =
          normalized.uitgever ||
          normalized.publisher ||
          normalized['uitgeverij'] ||
          normalized['publisher name'];
        const publisher = normalizePublisher(publisherSource);
        const publishedYearSource =
          normalized.jaar ||
          normalized['jaar van uitgave'] ||
          normalized.publicatiejaar ||
          normalized.publishedyear ||
          normalized.year ||
          normalized.jaaruitgave ||
          normalized.published ||
          normalized['publication year'];
        const publishedYear = normalizePublishedYear(publishedYearSource);
        const pageCountSource =
          normalized.paginas ||
          normalized['paginas'] ||
          normalized['aantal paginas'] ||
          normalized['aantal pagina\'s'] ||
          normalized.pages ||
          normalized.pagecount ||
          normalized['page count'];
        const pageCount = normalizePageCountValue(pageCountSource);
        const languageSource =
          normalized.taal ||
          normalized.language ||
          normalized.taalcode ||
          normalized['language code'];
        const language = normalizeLanguageCode(languageSource);
        const coverUrlSource =
          normalized.cover ||
          normalized['cover url'] ||
          normalized.coverurl ||
          normalized.afbeelding ||
          normalized.image ||
          normalized['image url'] ||
          normalized['afbeelding url'];
        const coverUrl = normalizeCoverUrl(coverUrlSource);
        const tagSources = [
          normalized['thema\'s'],
          normalized.themas,
          normalized.thema,
          normalized.tags,
          normalized.trefwoorden,
          normalized.keywords,
          normalized.onderwerpen,
          normalized['onderwerp(en)'],
          normalized['thema s'],
        ];
        const tags = Array.from(
          new Set(
            tagSources
              .flatMap(parseMultiValueField)
              .map((value) =>
                typeof value === 'string' ? value.trim() : String(value ?? '').trim()
              )
              .filter(Boolean)
          )
        );
        const examValue =
          normalized.leeslijst ||
          normalized['op de leeslijst'] ||
          normalized.examlist ||
          normalized['exam list'];
        const suitableForExamList = parseBooleanFlag(examValue);

        const cacheKey = getIsbnCacheKey(barcode);
        const allowLookup = importEnrichmentEnabled && !isbnLookupInflight.has(cacheKey);
        let metadata = null;
        if (allowLookup) {
          try {
            metadata = await lookup(barcode);
          } catch (error) {
            console.warn('ISBN-verrijking mislukt:', error?.message || error);
          }
        }
        const normalizedMetadata = normalizeIsbnMetadata(metadata);
        const metadataFields = normalizedMetadata.fields;
        const enrichment =
          importEnrichmentEnabled || metadata
            ? { source: normalizedMetadata.source, found: Boolean(normalizedMetadata.found) }
            : null;

        const existingBook = findBookByBarcode(db, barcode);
        if (existingBook) {
          const nextTitle = title || existingBook.title || metadataFields?.title || '';
          const nextAuthor = author || existingBook.author || metadataFields?.author || '';
          const nextDescription =
            description || existingBook.description || metadataFields?.description || '';
          const hasPublisherInput = publisherSource !== undefined && String(publisherSource).trim();
          const nextPublisher = hasPublisherInput
            ? publisher
            : existingBook.publisher || metadataFields?.publisher || '';
          const hasPublishedYearInput = publishedYearSource !== undefined && publishedYearSource !== '';
          const nextPublishedYear = hasPublishedYearInput
            ? publishedYear
            : existingBook.publishedYear ?? metadataFields?.publishedYear ?? null;
          const hasPageCountInput = pageCountSource !== undefined && pageCountSource !== '';
          const nextPageCount = hasPageCountInput
            ? pageCount
            : existingBook.pageCount ?? metadataFields?.pageCount ?? null;
          const hasLanguageInput = languageSource !== undefined && String(languageSource).trim();
          const nextLanguage = hasLanguageInput
            ? language
            : existingBook.language || metadataFields?.language || '';
          const hasCoverInput = coverUrlSource !== undefined && String(coverUrlSource).trim();
          const nextCoverUrl = hasCoverInput
            ? coverUrl
            : existingBook.coverUrl || metadataFields?.coverUrl || '';
          const nextTags = (() => {
            if (tags.length) return tags;
            if (Array.isArray(existingBook.tags) && existingBook.tags.length) return existingBook.tags;
            return metadataFields?.tags || [];
          })();

          const updates = {};
          if (nextTitle !== existingBook.title) {
            updates.title = nextTitle;
          }
          if (nextAuthor !== existingBook.author) {
            updates.author = nextAuthor;
          }
          if (nextDescription !== existingBook.description) {
            updates.description = nextDescription;
          }
          if (nextPublisher !== existingBook.publisher) {
            updates.publisher = nextPublisher;
          }
          if (nextPublishedYear !== existingBook.publishedYear) {
            updates.publishedYear = nextPublishedYear;
          }
          if (nextPageCount !== existingBook.pageCount) {
            updates.pageCount = nextPageCount;
          }
          if (nextLanguage !== existingBook.language) {
            updates.language = nextLanguage;
          }
          if (nextCoverUrl !== existingBook.coverUrl) {
            updates.coverUrl = nextCoverUrl;
          }
          const currentTagKeys = new Set((existingBook.tags || []).map((tag) => tag.toLowerCase()));
          const newTagKeys = new Set(nextTags.map((tag) => tag.toLowerCase()));
          let tagsChanged = currentTagKeys.size !== newTagKeys.size;
          if (!tagsChanged) {
            for (const key of currentTagKeys) {
              if (!newTagKeys.has(key)) {
                tagsChanged = true;
                break;
              }
            }
          }
          if (tagsChanged) {
            updates.tags = nextTags;
          }
          if (examValue !== undefined && examValue !== '' && suitableForExamList !== existingBook.suitableForExamList) {
            updates.suitableForExamList = suitableForExamList;
          }
          if (Object.keys(updates).length) {
            Object.assign(existingBook, updates);
            updatedBooks.push({
              title: existingBook.title,
              author: existingBook.author,
              barcode: existingBook.barcode,
              publisher: existingBook.publisher,
              publishedYear: existingBook.publishedYear,
              pageCount: existingBook.pageCount,
              language: existingBook.language,
              tags: existingBook.tags,
              status: 'updated',
              enrichment: enrichment || undefined,
            });
            changed = true;
          }
          continue;
        }

        const book = ensureBookShape({
          id: crypto.randomUUID(),
          title: title || metadataFields?.title || '',
          author: author || metadataFields?.author || '',
          barcode,
          description: description || metadataFields?.description || '',
          tags: tags.length ? tags : metadataFields?.tags || [],
          publisher: publisherSource !== undefined ? publisher : metadataFields?.publisher || '',
          publishedYear:
            publishedYearSource !== undefined && publishedYearSource !== ''
              ? publishedYear
              : metadataFields?.publishedYear ?? null,
          pageCount:
            pageCountSource !== undefined && pageCountSource !== ''
              ? pageCount
              : metadataFields?.pageCount ?? null,
          language:
            languageSource !== undefined && String(languageSource).trim()
              ? language
              : metadataFields?.language || '',
          coverUrl:
            coverUrlSource !== undefined && String(coverUrlSource).trim()
              ? coverUrl
              : metadataFields?.coverUrl || '',
          suitableForExamList,
        });
        book.status = 'available';
        book.borrowedBy = null;
        book.dueDate = null;
        db.books.push(book);
        createdBooks.push({
          title: book.title,
          author: book.author,
          barcode: book.barcode,
          publisher: book.publisher,
          publishedYear: book.publishedYear,
          pageCount: book.pageCount,
          language: book.language,
          tags: book.tags,
          status: 'created',
          enrichment: enrichment || undefined,
        });
        changed = true;
      }

      if (changed) {
        appendHistory(db, {
          type: 'books_imported',
          message: `${createdBooks.length} boeken toegevoegd, ${updatedBooks.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
      }

      return sendJson(res, 200, {
        created: createdBooks.length,
        updated: updatedBooks.length,
        skipped,
        books: createdBooks.concat(updatedBooks),
      });
    }

    if (bookIdMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boeken verwijderen' });
      }
      const db = getDb();
      const index = db.books.findIndex((entry) => entry.id === bookIdMatch[1]);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      const [removed] = db.books.splice(index, 1);
      for (const student of db.students) {
        if (!Array.isArray(student.borrowedBooks)) continue;
        student.borrowedBooks = student.borrowedBooks.filter((item) => item.bookId !== removed.id);
      }
      appendHistory(db, {
        type: 'book_deleted',
        bookId: removed.id,
        message: `${removed.title} is verwijderd uit de bibliotheek`,
      });
      saveDb(db);
      return sendJson(res, 200, { message: 'Boek verwijderd' });
    }

    const checkoutMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)\/check-out$/);
    if (checkoutMatch && req.method === 'POST') {
      if (!user) {
        return sendJson(res, 401, { message: 'Log eerst in om boeken te lenen' });
      }
      const db = getDb();
      const book = findBookById(db, checkoutMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      if (book.status === 'borrowed') {
        return sendJson(res, 400, { message: 'Boek is al uitgeleend' });
      }
      let student = null;
      let body = {};
      if (user.role === 'student') {
        student = findStudentById(db, user.id);
      } else if (ensureRole(user, ['teacher', 'admin'])) {
        body = await parseBody(req);
        if (!body.studentId) {
          return sendJson(res, 400, { message: 'Selecteer eerst een leerling' });
        }
        student = findStudentById(db, body.studentId);
      }
      if (!student) {
        return sendJson(res, 400, { message: 'Leerling niet gevonden' });
      }
      if (student.borrowedBooks.some((item) => item.bookId === book.id)) {
        return sendJson(res, 400, {
          message: 'Dit boek staat al op jouw uitleenlijst. Lever het eerst in.',
        });
      }

      book.status = 'borrowed';
      book.borrowedBy = student.id;
      book.dueDate = typeof body.dueDate === 'string' && body.dueDate.trim()
        ? body.dueDate
        : null;
      student.borrowedBooks.push({ bookId: book.id, borrowedAt: new Date().toISOString() });

      appendHistory(db, {
        type: 'check_out',
        bookId: book.id,
        studentId: student.id,
        message: `${student.name} heeft ${book.title} geleend`,
      });
      saveDb(db);
      return sendJson(res, 200, { book, student });
    }

    const checkinMatch = requestUrl.pathname.match(/^\/api\/books\/([\w-]+)\/check-in$/);
    if (checkinMatch && req.method === 'POST') {
      if (!user) {
        return sendJson(res, 401, { message: 'Log eerst in om boeken terug te brengen' });
      }
      const db = getDb();
      const book = findBookById(db, checkinMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Boek niet gevonden' });
      }
      if (book.status !== 'borrowed') {
        return sendJson(res, 400, { message: 'Boek is al beschikbaar' });
      }
      let student = null;
      if (user.role === 'student') {
        student = findStudentById(db, user.id);
      } else if (ensureRole(user, ['teacher', 'admin'])) {
        const body = await parseBody(req);
        if (!body.studentId) {
          return sendJson(res, 400, { message: 'Selecteer eerst een leerling' });
        }
        student = findStudentById(db, body.studentId);
      }
      if (!student) {
        return sendJson(res, 400, { message: 'Leerling niet gevonden' });
      }
      const hadBook = student.borrowedBooks.some((item) => item.bookId === book.id);
      if (!hadBook) {
        return sendJson(res, 400, { message: 'Dit boek stond niet op jouw uitleenlijst.' });
      }

      book.status = 'available';
      book.borrowedBy = null;
      book.dueDate = null;
      student.borrowedBooks = student.borrowedBooks.filter((item) => item.bookId !== book.id);

      appendHistory(db, {
        type: 'check_in',
        bookId: book.id,
        studentId: student.id,
        message: `${student.name} heeft ${book.title} teruggebracht`,
      });
      saveDb(db);
      return sendJson(res, 200, { book, student });
    }

    const barcodeMatch = requestUrl.pathname.match(/^\/api\/books\/barcode\/([\w-]+)$/);
    if (barcodeMatch && req.method === 'GET') {
      const db = getDb();
      const normalizedBarcode = normalizeBarcode(barcodeMatch[1]);
      if (!normalizedBarcode) {
        return sendJson(res, 400, { message: 'Ongeldige barcode opgegeven' });
      }
      const book = findBookByBarcode(db, normalizedBarcode);
      if (!book) {
        return sendJson(res, 404, { message: 'Geen boek gevonden met deze barcode' });
      }
      return sendJson(res, 200, book);
    }

    const isbnLookupMatch = requestUrl.pathname.match(/^\/api\/isbn\/([\w-]+)$/i);
    if (isbnLookupMatch && req.method === 'GET') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen boekinformatie opzoeken' });
      }
      const isbn = sanitizeIsbn(isbnLookupMatch[1]);
      if (!isbn) {
        return sendJson(res, 400, { message: 'Ongeldige barcode opgegeven' });
      }
      try {
        const lookup = resolveLookupIsbnMetadata();
        const metadata = await lookup(isbn);
        return sendJson(res, 200, metadata);
      } catch (error) {
        console.error('ISBN-lookup mislukt:', error);
        return sendJson(res, 502, { message: 'Kon geen boekinformatie ophalen.' });
      }
    }

    const studentLoansMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/loans$/);
    if (studentLoansMatch && req.method === 'GET') {
      const studentId = studentLoansMatch[1];
      if (!studentId) {
        return sendJson(res, 400, { message: 'Leerling-id ontbreekt of is ongeldig' });
      }
      const isStudent = user?.role === 'student';
      const isOwnAccount = isStudent && user.id === studentId;
      const isStaff = ensureRole(user, ['teacher', 'admin']);
      if (!isOwnAccount && !isStaff) {
        const statusCode = user ? 403 : 401;
        const message = isStudent
          ? 'Je kunt alleen je eigen uitleenlog bekijken.'
          : 'Alleen medewerkers kunnen uitleenlogs bekijken';
        return sendJson(res, statusCode, { message });
      }
      const db = getDb();
      const student = findStudentById(db, studentId);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      const loans = getStudentLoanHistory(db, studentId);
      return sendJson(res, 200, loans);
    }

    const studentStatsMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/stats$/);
    if (studentStatsMatch && req.method === 'GET') {
      const studentId = studentStatsMatch[1];
      if (!studentId) {
        return sendJson(res, 400, { message: 'Leerling-id ontbreekt of is ongeldig' });
      }
      const isOwnStats = user?.role === 'student' && user.id === studentId;
      if (!isOwnStats && !ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingstatistieken bekijken' });
      }
      const db = getDb();
      const stats = buildStudentStats(db, studentId);
      if (!stats) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      return sendJson(res, 200, stats);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen bekijken' });
      }
      const db = getDb();
      let studentList = db.students;
      if (user.role === 'teacher') {
        const teacherClassIds = getTeacherClassIds(db, user.id);
        studentList = db.students.filter((student) =>
          (student.classIds || []).some((classId) => teacherClassIds.includes(classId))
        );
      }
      const students = studentList.map((student) => sanitizeStudent(student, { includeUsername: true }));
      return sendJson(res, 200, students);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/teachers') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten bekijken' });
      }
      const db = getDb();
      const teachers = db.users
        .filter((account) => account.role === 'teacher')
        .map((account) => {
          const ownClassIds = Array.isArray(account.classIds) ? account.classIds : [];
          const relatedClassIds = getTeacherClassIds(db, account.id);
          const classIds = Array.from(new Set([...ownClassIds, ...relatedClassIds]));
          return sanitizeTeacher({ ...account, classIds });
        });
      return sendJson(res, 200, teachers);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/teachers') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim();
      let temporaryPassword = (body.password || body.temporaryPassword || '').trim();
      if (!name || !username) {
        return sendJson(res, 400, { message: 'Naam en gebruikersnaam zijn verplicht' });
      }
      if (isUsernameTaken(db, username)) {
        return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
      }
      const requestedClassIds = Array.isArray(body.classIds) ? body.classIds : [];
      const validClassIds = requestedClassIds
        .map((classId) => String(classId || '').trim())
        .filter((classId) => classId && db.classes.some((klass) => klass.id === classId));
      if (!temporaryPassword) {
        temporaryPassword = generatePassword(10);
      }
      const teacher = {
        id: crypto.randomUUID(),
        role: 'teacher',
        name,
        username,
        passwordHash: hashPassword(temporaryPassword),
        mustChangePassword: true,
        classIds: Array.from(new Set(validClassIds)),
      };
      db.users.push(teacher);
      for (const classId of teacher.classIds) {
        const klass = db.classes.find((entry) => entry.id === classId);
        if (!klass) continue;
        klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
        if (!klass.teacherIds.includes(teacher.id)) {
          klass.teacherIds.push(teacher.id);
        }
      }
      appendHistory(db, {
        type: 'teacher_created',
        teacherId: teacher.id,
        performedBy: user?.id || null,
        message: `Nieuw docentaccount aangemaakt voor ${teacher.name}`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        teacher: sanitizeTeacher(teacher),
        temporaryPassword,
      });
    }

    const teacherMatch = requestUrl.pathname.match(/^\/api\/teachers\/([\w-]+)$/);
    if (teacherMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten bijwerken' });
      }
      const db = getDb();
      const teacher = db.users.find((account) => account.id === teacherMatch[1]);
      if (!teacher || teacher.role !== 'teacher') {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const body = await parseBody(req);
      let changed = false;
      let passwordChanged = false;
      let providedPassword = '';
      if (typeof body.name === 'string') {
        const trimmed = body.name.trim();
        if (trimmed) {
          teacher.name = trimmed;
          changed = true;
        }
      }
      if (typeof body.username === 'string') {
        const trimmed = body.username.trim();
        if (trimmed && trimmed !== teacher.username) {
          if (isUsernameTaken(db, trimmed, { allowUserId: teacher.id })) {
            return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
          }
          teacher.username = trimmed;
          changed = true;
        }
      }
      if (Array.isArray(body.classIds)) {
        const requestedClassIds = body.classIds
          .map((classId) => String(classId || '').trim())
          .filter(Boolean);
        const validClassIds = requestedClassIds.filter((classId) =>
          db.classes.some((klass) => klass.id === classId)
        );
        const previousClassIds = Array.isArray(teacher.classIds)
          ? [...teacher.classIds]
          : getTeacherClassIds(db, teacher.id);
        const newClassIds = Array.from(new Set(validClassIds));
        const previousSet = new Set(previousClassIds);
        const newSet = new Set(newClassIds);
        const removedIds = previousClassIds.filter((id) => !newSet.has(id));
        const addedIds = newClassIds.filter((id) => !previousSet.has(id));
        if (removedIds.length || addedIds.length || previousClassIds.length !== newClassIds.length) {
          changed = true;
        }
        teacher.classIds = newClassIds;
        for (const classId of removedIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (!klass) continue;
          klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
          klass.teacherIds = klass.teacherIds.filter((id) => id !== teacher.id);
        }
        for (const classId of newClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (!klass) continue;
          klass.teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
          if (!klass.teacherIds.includes(teacher.id)) {
            klass.teacherIds.push(teacher.id);
          }
        }
        if (removedIds.length || addedIds.length) {
          appendHistory(db, {
            type: 'teacher_classes_updated',
            teacherId: teacher.id,
            performedBy: user?.id || null,
            message: `Klassen bijgewerkt voor docent ${teacher.name}`,
          });
        }
      }
      if (typeof body.temporaryPassword === 'string' && body.temporaryPassword.trim()) {
        providedPassword = body.temporaryPassword.trim();
        teacher.passwordHash = hashPassword(providedPassword);
        teacher.mustChangePassword = true;
        passwordChanged = true;
        changed = true;
        for (const [token, session] of sessions.entries()) {
          if (session.type === 'staff' && session.userId === teacher.id) {
            sessions.delete(token);
          }
        }
        appendHistory(db, {
          type: 'teacher_password_set',
          teacherId: teacher.id,
          performedBy: user?.id || null,
          message: `Handmatig wachtwoord ingesteld voor docent ${teacher.name}`,
        });
      }
      if (!changed) {
        return sendJson(res, 200, { teacher: sanitizeTeacher(teacher) });
      }
      saveDb(db);
      const response = { teacher: sanitizeTeacher(teacher) };
      if (passwordChanged && providedPassword) {
        response.temporaryPassword = providedPassword;
      }
      return sendJson(res, 200, response);
    }

    if (teacherMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen docenten verwijderen' });
      }
      const db = getDb();
      const index = db.users.findIndex(
        (account) => account.id === teacherMatch[1] && account.role === 'teacher'
      );
      if (index === -1) {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const [removedTeacher] = db.users.splice(index, 1);
      for (const klass of db.classes) {
        if (!Array.isArray(klass.teacherIds)) {
          continue;
        }
        klass.teacherIds = klass.teacherIds.filter((id) => id !== removedTeacher.id);
      }
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'staff' && session.userId === removedTeacher.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'teacher_deleted',
        teacherId: removedTeacher.id,
        performedBy: user?.id || null,
        message: `Docent ${removedTeacher.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { teacher: sanitizeTeacher(removedTeacher) });
    }

    const teacherResetMatch = requestUrl.pathname.match(/^\/api\/teachers\/([\w-]+)\/reset-password$/);
    if (teacherResetMatch && req.method === 'POST') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen wachtwoorden resetten' });
      }
      const db = getDb();
      const teacher = db.users.find((account) => account.id === teacherResetMatch[1]);
      if (!teacher || teacher.role !== 'teacher') {
        return sendJson(res, 404, { message: 'Docent niet gevonden' });
      }
      const temporaryPassword = generatePassword(10);
      teacher.passwordHash = hashPassword(temporaryPassword);
      teacher.mustChangePassword = true;
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'staff' && session.userId === teacher.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'teacher_password_reset',
        teacherId: teacher.id,
        performedBy: user?.id || null,
        message: `Wachtwoord opnieuw ingesteld voor docent ${teacher.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        teacher: { id: teacher.id, name: teacher.name, username: teacher.username },
        temporaryPassword,
      });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts aanmaken' });
      }
      const db = getDb();
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (!name || !username || !password) {
        return sendJson(res, 400, {
          message: 'Naam, gebruikersnaam en wachtwoord zijn verplicht',
        });
      }
      if (isUsernameTaken(db, username)) {
        return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
      }
      const requestedClassIds = Array.isArray(body.classIds)
        ? body.classIds.filter((value) => typeof value === 'string')
        : [];
      const validClassIds = requestedClassIds.filter((classId) =>
        db.classes.some((klass) => klass.id === classId)
      );

      const student = {
        id: crypto.randomUUID(),
        name,
        username,
        passwordHash: hashPassword(password),
        mustChangePassword: true,
        grade: (body.grade || '').trim(),
        borrowedBooks: [],
        classIds: validClassIds,
      };
      db.students.push(student);
      for (const classId of validClassIds) {
        const klass = db.classes.find((entry) => entry.id === classId);
        if (!klass) continue;
        klass.studentIds = Array.isArray(klass.studentIds) ? klass.studentIds : [];
        if (!klass.studentIds.includes(student.id)) {
          klass.studentIds.push(student.id);
        }
      }
      appendHistory(db, {
        type: 'student_created',
        studentId: student.id,
        message: `Nieuw leerlingaccount aangemaakt voor ${student.name}`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        ...sanitizeStudent(student, { includeUsername: true }),
        temporaryPassword: password,
      });
    }

    const studentResetMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)\/reset-password$/);
    if (studentResetMatch && req.method === 'POST') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen wachtwoorden resetten' });
      }
      const db = getDb();
      const student = findStudentById(db, studentResetMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      if (user.role === 'teacher') {
        const teacherClassIds = getTeacherClassIds(db, user.id);
        const allowed = (student.classIds || []).some((classId) => teacherClassIds.includes(classId));
        if (!allowed) {
          return sendJson(res, 403, {
            message: 'Je kunt alleen wachtwoorden resetten voor leerlingen uit jouw klassen',
          });
        }
      }
      const temporaryPassword = generatePassword(10);
      student.passwordHash = hashPassword(temporaryPassword);
      student.mustChangePassword = true;
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'student' && session.userId === student.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'student_password_reset',
        studentId: student.id,
        performedBy: user?.id || null,
        message: `Wachtwoord opnieuw ingesteld voor ${student.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, {
        student: sanitizeStudent(student, { includeUsername: true }),
        temporaryPassword,
      });
    }

    const studentUpdateMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)$/);
    if (studentUpdateMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts bijwerken' });
      }
      const db = getDb();
      const student = findStudentById(db, studentUpdateMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      const body = await parseBody(req);
      let temporaryPassword = null;
      let passwordChanged = false;
      let classesChanged = false;
      const previousClassIds = Array.isArray(student.classIds) ? [...student.classIds] : [];
      let nextClassIds = new Set(previousClassIds);

      if (body && typeof body.generateTemporaryPassword === 'boolean' && body.generateTemporaryPassword) {
        temporaryPassword = generatePassword(10);
      } else if (typeof body?.temporaryPassword === 'string') {
        const trimmed = body.temporaryPassword.trim();
        if (!trimmed) {
          return sendJson(res, 400, { message: 'Tijdelijk wachtwoord mag niet leeg zijn' });
        }
        temporaryPassword = trimmed;
      }

      if (Array.isArray(body?.classIds)) {
        nextClassIds = new Set(
          body.classIds
            .map((value) => String(value || '').trim())
            .filter((value) => value && db.classes.some((klass) => klass.id === value))
        );
      } else {
        const addClassId = typeof body?.addClassId === 'string' ? body.addClassId : body?.addClassId?.id;
        if (addClassId) {
          const normalizedAdd = String(addClassId).trim();
          if (normalizedAdd && db.classes.some((klass) => klass.id === normalizedAdd)) {
            nextClassIds.add(normalizedAdd);
          }
        }
        const removeClassId = typeof body?.removeClassId === 'string' ? body.removeClassId : body?.removeClassId?.id;
        if (removeClassId) {
          const normalizedRemove = String(removeClassId).trim();
          if (normalizedRemove) {
            nextClassIds.delete(normalizedRemove);
          }
        }
      }

      const validClassIds = Array.from(nextClassIds).filter((classId) =>
        db.classes.some((klass) => klass.id === classId)
      );
      const uniqueClassIds = Array.from(new Set(validClassIds));
      const addedClassIds = uniqueClassIds.filter((id) => !previousClassIds.includes(id));
      const removedClassIds = previousClassIds.filter((id) => !uniqueClassIds.includes(id));

      if (temporaryPassword) {
        student.passwordHash = hashPassword(temporaryPassword);
        student.mustChangePassword = true;
        passwordChanged = true;
        for (const [token, session] of sessions.entries()) {
          if (session.type === 'student' && session.userId === student.id) {
            sessions.delete(token);
          }
        }
      }

      if (addedClassIds.length || removedClassIds.length) {
        student.classIds = uniqueClassIds;
        for (const classId of removedClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (klass) {
            klass.studentIds = (klass.studentIds || []).filter((id) => id !== student.id);
          }
        }
        for (const classId of addedClassIds) {
          const klass = db.classes.find((entry) => entry.id === classId);
          if (klass) {
            klass.studentIds = Array.isArray(klass.studentIds) ? klass.studentIds : [];
            if (!klass.studentIds.includes(student.id)) {
              klass.studentIds.push(student.id);
            }
          }
        }
        classesChanged = true;
      }

      if (!passwordChanged && !classesChanged) {
        return sendJson(res, 400, { message: 'Geen geldige wijzigingen opgegeven' });
      }

      if (passwordChanged) {
        appendHistory(db, {
          type: 'student_password_reset',
          studentId: student.id,
          performedBy: user?.id || null,
          message: `Tijdelijk wachtwoord ingesteld voor ${student.name}`,
        });
      }

      if (classesChanged) {
        const addedNames = addedClassIds
          .map((classId) => db.classes.find((klass) => klass.id === classId)?.name)
          .filter(Boolean);
        const removedNames = removedClassIds
          .map((classId) => db.classes.find((klass) => klass.id === classId)?.name)
          .filter(Boolean);
        const classMessages = [];
        if (addedNames.length) {
          classMessages.push(`toegevoegd aan ${addedNames.join(', ')}`);
        }
        if (removedNames.length) {
          classMessages.push(`verwijderd uit ${removedNames.join(', ')}`);
        }
        const messageSuffix = classMessages.length ? ` ${classMessages.join(' en ')}` : '';
        appendHistory(db, {
          type: 'student_class_updated',
          studentId: student.id,
          performedBy: user?.id || null,
          message: `${student.name}${messageSuffix}`.trim(),
        });
      }

      saveDb(db);
      return sendJson(res, 200, {
        student: sanitizeStudent(student, { includeUsername: true }),
        ...(temporaryPassword ? { temporaryPassword } : {}),
        classChanges: classesChanged
          ? {
              added: addedClassIds,
              removed: removedClassIds,
            }
          : undefined,
      });
    }

    const studentDeleteMatch = requestUrl.pathname.match(/^\/api\/students\/([\w-]+)$/);
    if (studentDeleteMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingaccounts verwijderen' });
      }
      const db = getDb();
      const student = findStudentById(db, studentDeleteMatch[1]);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      db.students = db.students.filter((entry) => entry.id !== student.id);
      for (const klass of db.classes) {
        klass.studentIds = (klass.studentIds || []).filter((id) => id !== student.id);
      }
      for (const book of db.books) {
        if (book.borrowedBy === student.id) {
          book.borrowedBy = null;
          book.status = 'available';
          book.dueDate = null;
        }
      }
      for (const [token, session] of sessions.entries()) {
        if (session.type === 'student' && session.userId === student.id) {
          sessions.delete(token);
        }
      }
      appendHistory(db, {
        type: 'student_deleted',
        studentId: student.id,
        message: `Leerlingaccount van ${student.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { message: 'Leerlingaccount verwijderd' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/students/import') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message:
            'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }

      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }

      const createdAccounts = [];
      const updatedAccounts = [];
      const skipped = [];
      let changed = false;

      for (const row of workbookResult.rows) {
        const normalized = normalizeRowKeys(row);
        const name = String(
          normalized.naam || normalized.name || normalized.leerling || normalized.student || ''
        ).trim();
        const username = String(
          normalized.gebruikersnaam || normalized.username || ''
        ).trim();
        let password = String(normalized.wachtwoord || normalized.password || '').trim();
        const gradeSource = String(
          normalized.leerjaar ||
            normalized.grade ||
            normalized.graad ||
            normalized.year ||
            normalized.niveau ||
            normalized.opleiding ||
            ''
        ).trim();
        const classNames = [
          normalized.klassen,
          normalized['klas(sen)'],
          normalized.klas,
          normalized.klasnaam,
          normalized.groep,
          normalized.groepen,
          normalized.class,
          normalized.classes,
        ]
          .flatMap(parseMultiValueField)
          .map((value) => value.trim())
          .filter(Boolean);
        const uniqueClassNames = Array.from(new Set(classNames));

        if (!name || !username) {
          skipped.push({
            name: name || '(onbekend)',
            username: username || '(leeg)',
            reason: 'Ontbrekende naam of gebruikersnaam',
          });
          continue;
        }

        if (!uniqueClassNames.length) {
          skipped.push({
            name,
            username,
            reason: 'Geen klas opgegeven',
          });
          continue;
        }

        const classRecords = uniqueClassNames
          .map((className) => ensureClassRecord(db, className))
          .filter(Boolean);
        const classIds = classRecords.map((klass) => klass.id);

        let grade = gradeSource;
        if (!grade && classRecords.length) {
          grade = classRecords[0].name;
        }

        const existingStudent = findStudentByUsername(db, username);
        if (existingStudent) {
          const originalName = existingStudent.name;
          const originalGrade = existingStudent.grade || '';
          const originalClassIds = Array.isArray(existingStudent.classIds)
            ? [...existingStudent.classIds]
            : [];
          existingStudent.name = name;
          if (grade) {
            existingStudent.grade = grade;
          }
          if (!Array.isArray(existingStudent.borrowedBooks)) {
            existingStudent.borrowedBooks = [];
          }
          if (!Array.isArray(existingStudent.classIds)) {
            existingStudent.classIds = [];
          }
          let passwordChanged = false;
          if (password) {
            existingStudent.passwordHash = hashPassword(password);
            existingStudent.mustChangePassword = true;
            passwordChanged = true;
          }

          const newClassIdSet = new Set(classIds);
          const removedClassIds = originalClassIds.filter((classId) => !newClassIdSet.has(classId));
          const addedClassIds = classIds.filter((classId) => !originalClassIds.includes(classId));

          existingStudent.classIds = classIds;

          for (const classId of removedClassIds) {
            const klass = db.classes.find((entry) => entry.id === classId);
            if (klass) {
              klass.studentIds = (klass.studentIds || []).filter((id) => id !== existingStudent.id);
            }
          }
          for (const klass of classRecords) {
            if (!klass.studentIds.includes(existingStudent.id)) {
              klass.studentIds.push(existingStudent.id);
            }
          }

          const teacherNames = collectTeacherNames(db, classRecords);
          updatedAccounts.push({
            id: existingStudent.id,
            name: existingStudent.name,
            username: existingStudent.username,
            password: passwordChanged ? password : null,
            classes: classRecords.map((klass) => klass.name),
            teachers: teacherNames,
            grade: existingStudent.grade || '',
            status: 'updated',
          });

          if (
            passwordChanged ||
            originalName !== existingStudent.name ||
            originalGrade !== (existingStudent.grade || '') ||
            removedClassIds.length ||
            addedClassIds.length
          ) {
            changed = true;
          }
          continue;
        }

        if (isUsernameTaken(db, username)) {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al in gebruik',
          });
          continue;
        }

        if (!password) {
          password = generatePassword(10);
        }

        const student = {
          id: crypto.randomUUID(),
          name,
          username,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          grade,
          borrowedBooks: [],
          classIds,
        };
        db.students.push(student);
        for (const klass of classRecords) {
          if (!klass.studentIds.includes(student.id)) {
            klass.studentIds.push(student.id);
          }
        }
        const teacherNames = collectTeacherNames(db, classRecords);
        createdAccounts.push({
          id: student.id,
          name: student.name,
          username: student.username,
          password,
          classes: classRecords.map((klass) => klass.name),
          teachers: teacherNames,
          grade: student.grade || '',
          status: 'created',
        });
        changed = true;
      }

      if (changed) {
        appendHistory(db, {
          type: 'students_imported',
          message: `${createdAccounts.length} leerlingen toegevoegd, ${updatedAccounts.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
      }

      return sendJson(res, 200, {
        created: createdAccounts.length,
        updated: updatedAccounts.length,
        skipped,
        accounts: createdAccounts.concat(updatedAccounts),
      });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/teachers/import') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen lijsten importeren' });
      }
      const XLSX = loadXlsx();
      if (!XLSX) {
        return sendJson(res, 503, {
          message:
            'Excel-import is momenteel niet beschikbaar omdat de "xlsx" module ontbreekt op de server',
        });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.file) {
        return sendJson(res, 400, { message: 'Geen bestand ontvangen' });
      }

      const workbookResult = readWorkbookRows(XLSX, body.file);
      if (!workbookResult.ok) {
        return sendJson(res, 400, { message: workbookResult.error });
      }

      const createdAccounts = [];
      const updatedAccounts = [];
      const skipped = [];
      let changed = false;

      for (const row of workbookResult.rows) {
        const normalized = normalizeRowKeys(row);
        const name = String(
          normalized.naam || normalized.name || normalized.docent || normalized.teacher || ''
        ).trim();
        const username = String(
          normalized.gebruikersnaam || normalized.username || ''
        ).trim();
        let password = String(normalized.wachtwoord || normalized.password || '').trim();
        const classNames = [
          normalized.klassen,
          normalized['klas(sen)'],
          normalized.klas,
          normalized.klasnaam,
          normalized.groep,
          normalized.groepen,
          normalized.class,
          normalized.classes,
        ]
          .flatMap(parseMultiValueField)
          .map((value) => value.trim())
          .filter(Boolean);
        const uniqueClassNames = Array.from(new Set(classNames));

        if (!name || !username) {
          skipped.push({
            name: name || '(onbekend)',
            username: username || '(leeg)',
            reason: 'Ontbrekende naam of gebruikersnaam',
          });
          continue;
        }

        if (!uniqueClassNames.length) {
          skipped.push({
            name,
            username,
            reason: 'Geen klas opgegeven',
          });
          continue;
        }

        const classRecords = uniqueClassNames
          .map((className) => ensureClassRecord(db, className))
          .filter(Boolean);
        const classIds = classRecords.map((klass) => klass.id);

        const normalizedUsername = username.toLowerCase();
        const existingTeacher = db.users.find(
          (account) => (account.username || '').toLowerCase() === normalizedUsername
        );
        const usernameTakenByStudent = db.students.some(
          (student) => (student.username || '').toLowerCase() === normalizedUsername
        );

        if (!existingTeacher && usernameTakenByStudent) {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al in gebruik door een leerling',
          });
          continue;
        }

        if (existingTeacher && existingTeacher.role !== 'teacher') {
          skipped.push({
            name,
            username,
            reason: 'Gebruikersnaam is al gekoppeld aan een medewerker',
          });
          continue;
        }

        if (existingTeacher) {
          const originalName = existingTeacher.name;
          const originalClassIds = Array.isArray(existingTeacher.classIds)
            ? [...existingTeacher.classIds]
            : [];
          let passwordChanged = false;
          if (password) {
            existingTeacher.passwordHash = hashPassword(password);
            existingTeacher.mustChangePassword = true;
            passwordChanged = true;
          }
          existingTeacher.name = name;
          existingTeacher.username = username;
          existingTeacher.role = 'teacher';
          existingTeacher.classIds = classIds;

          const newClassIdSet = new Set(classIds);
          const removedClassIds = originalClassIds.filter((classId) => !newClassIdSet.has(classId));
          const addedClassIds = classIds.filter((classId) => !originalClassIds.includes(classId));

          for (const classId of removedClassIds) {
            const klass = db.classes.find((entry) => entry.id === classId);
            if (klass) {
              klass.teacherIds = (klass.teacherIds || []).filter((id) => id !== existingTeacher.id);
            }
          }

          for (const klass of classRecords) {
            if (!klass.teacherIds.includes(existingTeacher.id)) {
              klass.teacherIds.push(existingTeacher.id);
            }
          }

          updatedAccounts.push({
            id: existingTeacher.id,
            name: existingTeacher.name,
            username: existingTeacher.username,
            password: passwordChanged ? password : null,
            classes: classRecords.map((klass) => klass.name),
            status: 'updated',
          });

          if (passwordChanged || originalName !== existingTeacher.name || removedClassIds.length || addedClassIds.length) {
            changed = true;
          }
          continue;
        }

        if (!password) {
          password = generatePassword(10);
        }

        const teacher = {
          id: crypto.randomUUID(),
          role: 'teacher',
          name,
          username,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          classIds,
        };
        db.users.push(teacher);
        for (const klass of classRecords) {
          if (!klass.teacherIds.includes(teacher.id)) {
            klass.teacherIds.push(teacher.id);
          }
        }

        createdAccounts.push({
          id: teacher.id,
          name: teacher.name,
          username: teacher.username,
          password,
          classes: classRecords.map((klass) => klass.name),
          status: 'created',
        });
        changed = true;
      }

      if (changed) {
        appendHistory(db, {
          type: 'teachers_imported',
          message: `${createdAccounts.length} docenten toegevoegd, ${updatedAccounts.length} bijgewerkt via Excel-import`,
        });
        saveDb(db);
      }

      return sendJson(res, 200, {
        created: createdAccounts.length,
        updated: updatedAccounts.length,
        skipped,
        accounts: createdAccounts.concat(updatedAccounts),
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/activity/public') {
      const db = getDb();
      const limit = Number(requestUrl.searchParams.get('limit')) || 12;
      const activity = getPublicLoanActivity(db, { limit });
      return sendJson(res, 200, activity);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen de activiteit bekijken' });
      }
      const db = getDb();
      const limit = Number(requestUrl.searchParams.get('limit')) || 20;

      let historyEntries = Array.isArray(db.history) ? db.history : [];

      if (user.role === 'teacher') {
        const teacherClassIds = new Set(
          (Array.isArray(user.classIds) ? user.classIds : []).filter(Boolean)
        );

        const classesForTeacher = (Array.isArray(db.classes) ? db.classes : []).filter((klass) => {
          if (!klass || typeof klass.id !== 'string') {
            return false;
          }
          const teacherIds = Array.isArray(klass.teacherIds) ? klass.teacherIds : [];
          if (teacherIds.includes(user.id)) {
            teacherClassIds.add(klass.id);
            return true;
          }
          return teacherClassIds.has(klass.id);
        });

        const studentIds = new Set();
        for (const klass of classesForTeacher) {
          const studentsInClass = Array.isArray(klass.studentIds) ? klass.studentIds : [];
          for (const studentId of studentsInClass) {
            if (studentId) {
              studentIds.add(studentId);
            }
          }
        }

        for (const student of Array.isArray(db.students) ? db.students : []) {
          if (!student || !Array.isArray(student.classIds)) {
            continue;
          }
          const belongsToTeacher = student.classIds.some((classId) => teacherClassIds.has(classId));
          if (belongsToTeacher && student.id) {
            studentIds.add(student.id);
          }
        }

        historyEntries = historyEntries.filter(
          (entry) => entry && typeof entry.studentId === 'string' && studentIds.has(entry.studentId)
        );
      }

      const sortedHistory = historyEntries
        .filter((entry) => entry && typeof entry.timestamp === 'string')
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (Number.isFinite(limit) && limit > 0) {
        return sendJson(res, 200, sortedHistory.slice(0, limit));
      }
      return sendJson(res, 200, sortedHistory);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/stats/school') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen schoolstatistieken bekijken' });
      }
      const db = getDb();
      const stats = buildSchoolStats(db);
      return sendJson(res, 200, stats);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/classes') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bekijken' });
      }
      const db = getDb();
      let classes = db.classes || [];
      if (user.role === 'teacher') {
        classes = classes.filter((cls) => (cls.teacherIds || []).includes(user.id));
      }
      return sendJson(res, 200, classes);
    }

    const classStatsMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)\/stats$/);
    if (classStatsMatch && req.method === 'GET') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bekijken' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStatsMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen bekijken' });
      }

      const studentIdsInClass = new Set([
        ...(Array.isArray(klass.studentIds) ? klass.studentIds : []),
        ...db.students
          .filter((student) => Array.isArray(student.classIds) && student.classIds.includes(klass.id))
          .map((student) => student.id),
      ].filter(Boolean));

      const classHistory = (Array.isArray(db.history) ? db.history : []).filter(
        (entry) => entry && entry.type === 'check_out' && studentIdsInClass.has(entry.studentId)
      );
      const borrowCountPerStudent = new Map();
      for (const entry of classHistory) {
        const current = borrowCountPerStudent.get(entry.studentId) || 0;
        borrowCountPerStudent.set(entry.studentId, current + 1);
      }

      const activeLoanCount = db.books.filter(
        (book) => book.status === 'borrowed' && studentIdsInClass.has(book.borrowedBy)
      ).length;

      for (const student of db.students) {
        if (!studentIdsInClass.has(student.id)) {
          continue;
        }
        if (Array.isArray(student.borrowedBooks) && student.borrowedBooks.length > 0) {
          const current = borrowCountPerStudent.get(student.id) || 0;
          borrowCountPerStudent.set(student.id, current);
        }
      }

      const now = new Date();
      const schoolYearStart = (() => {
        const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        return new Date(year, 7, 1);
      })();
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const classHistoryThisSchoolYear = classHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= schoolYearStart;
      });

      const classHistoryLastMonth = classHistory.filter((entry) => {
        const date = new Date(entry.timestamp);
        return !Number.isNaN(date.getTime()) && date >= monthAgo;
      });

      const borrowCountThisSchoolYear = new Map();
      for (const entry of classHistoryThisSchoolYear) {
        borrowCountThisSchoolYear.set(
          entry.studentId,
          (borrowCountThisSchoolYear.get(entry.studentId) || 0) + 1
        );
      }

      const studentsInClass = db.students.filter((student) => studentIdsInClass.has(student.id));

      const activeReaders = Array.from(borrowCountPerStudent.keys()).filter((studentId) => {
        const student = db.students.find((entry) => entry.id === studentId);
        return (
          (borrowCountPerStudent.get(studentId) || 0) > 0 ||
          (student && Array.isArray(student.borrowedBooks) && student.borrowedBooks.length > 0)
        );
      }).length;

      const topReaders = Array.from(borrowCountPerStudent.entries())
        .map(([studentId, count]) => {
          const student = db.students.find((entry) => entry.id === studentId);
          return {
            id: studentId,
            name: student ? student.name : 'Onbekende leerling',
            borrowCount: count,
            totalBorrowed: count,
            borrowedCount: count,
          };
        })
        .sort((a, b) => b.borrowCount - a.borrowCount || a.name.localeCompare(b.name))
        .slice(0, 3);

      const nonReaders = studentsInClass
        .filter((student) => {
          const borrowCount = borrowCountThisSchoolYear.get(student.id) || 0;
          const activeLoansForStudent = Array.isArray(student.borrowedBooks)
            ? student.borrowedBooks.length
            : 0;
          return borrowCount === 0 && activeLoansForStudent === 0;
        })
        .map((student) => ({ id: student.id, name: student.name || 'Onbekende leerling' }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const heavyReaders = Array.from(borrowCountThisSchoolYear.entries())
        .map(([studentId, count]) => {
          const student = db.students.find((entry) => entry.id === studentId);
          return {
            id: studentId,
            name: student ? student.name : 'Onbekende leerling',
            borrowCount: count,
          };
        })
        .sort((a, b) => b.borrowCount - a.borrowCount || a.name.localeCompare(b.name))
        .slice(0, 5);

      const genreCounts = new Map();
      const titleCounts = new Map();
      for (const entry of classHistoryThisSchoolYear) {
        const book = findBookById(db, entry.bookId);
        if (book) {
          if (Array.isArray(book.tags)) {
            for (const tag of book.tags) {
              const normalizedTag = typeof tag === 'string' ? tag.trim() : String(tag ?? '').trim();
              if (!normalizedTag) continue;
              genreCounts.set(normalizedTag, (genreCounts.get(normalizedTag) || 0) + 1);
            }
          }
          const key = book.title || 'Onbekende titel';
          titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
        }
      }

      const topGenres = Array.from(genreCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 5);

      const topTitles = Array.from(titleCounts.entries())
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
        .slice(0, 5);

      const stats = {
        totalBorrowedBooks: classHistory.length,
        totalBorrowed: classHistory.length,
        borrowCount: classHistory.length,
        borrowedCount: classHistory.length,
        activeLoans: activeLoanCount,
        currentLoans: activeLoanCount,
        activeLoanCount: activeLoanCount,
        activeStudents: activeReaders,
        activeReaders,
        readerCount: activeReaders,
        topReaders,
        borrowedThisSchoolYear: classHistoryThisSchoolYear.length,
        totalBorrowedThisSchoolYear: classHistoryThisSchoolYear.length,
        borrowedLastMonth: classHistoryLastMonth.length,
        nonReaders,
        heavyReaders,
        topGenres,
        topTitles,
      };

      return sendJson(res, 200, stats);
    }

    const classMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)$/);
    if (classMatch && req.method === 'PATCH') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen bijwerken' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen bijwerken' });
      }
      const body = await parseBody(req);
      if (body.name) {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return sendJson(res, 400, { message: 'Naam van de klas kan niet leeg zijn' });
        }
        klass.name = trimmed;
      }
      if (user.role === 'admin' && Array.isArray(body.teacherIds)) {
        const valid = body.teacherIds.filter((teacherId) =>
          db.users.some((account) => account.id === teacherId && account.role === 'teacher')
        );
        klass.teacherIds = valid;
        for (const account of db.users) {
          if (account.role !== 'teacher') {
            continue;
          }
          account.classIds = Array.isArray(account.classIds)
            ? account.classIds.filter((id) => db.classes.some((entry) => entry.id === id))
            : [];
          if (valid.includes(account.id)) {
            if (!account.classIds.includes(klass.id)) {
              account.classIds.push(klass.id);
            }
          } else {
            account.classIds = account.classIds.filter((id) => id !== klass.id);
          }
        }
      }
      saveDb(db);
      return sendJson(res, 200, klass);
    }

    if (classMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen klassen verwijderen' });
      }
      const db = getDb();
      const index = db.classes.findIndex((cls) => cls.id === classMatch[1]);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      const [removedClass] = db.classes.splice(index, 1);
      for (const student of db.students) {
        student.classIds = (student.classIds || []).filter((id) => id !== removedClass.id);
      }
      for (const account of db.users) {
        if (account.role !== 'teacher') {
          continue;
        }
        account.classIds = Array.isArray(account.classIds)
          ? account.classIds.filter((id) => id !== removedClass.id)
          : [];
      }
      appendHistory(db, {
        type: 'class_deleted',
        classId: removedClass.id,
        message: `Klas ${removedClass.name} is verwijderd`,
      });
      saveDb(db);
      return sendJson(res, 200, { message: 'Klas verwijderd' });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/classes') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen klassen toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { message: 'Naam van de klas is verplicht' });
      }
      const requestedTeacherIds = Array.isArray(body.teacherIds) ? body.teacherIds : [];
      const validTeacherIds = requestedTeacherIds.filter((teacherId) =>
        db.users.some((account) => account.id === teacherId && account.role === 'teacher')
      );
      const klass = {
        id: crypto.randomUUID(),
        name: body.name.trim(),
        teacherIds: validTeacherIds,
        studentIds: [],
      };
      db.classes.push(klass);
      appendHistory(db, {
        type: 'class_created',
        classId: klass.id,
        message: `Nieuwe klas ${klass.name} aangemaakt`,
      });
      saveDb(db);
      return sendJson(res, 201, klass);
    }

    const classStudentAddMatch = requestUrl.pathname.match(/^\/api\/classes\/([\w-]+)\/students$/);
    if (classStudentAddMatch && req.method === 'POST') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen koppelen' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStudentAddMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen beheren' });
      }
      const body = await parseBody(req);
      const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      let student = null;
      if (studentId) {
        student = findStudentById(db, studentId);
      }
      if (!student && username) {
        student = findStudentByUsername(db, username);
      }
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      if (!(klass.studentIds || []).includes(student.id)) {
        klass.studentIds = klass.studentIds || [];
        klass.studentIds.push(student.id);
      }
      student.classIds = student.classIds || [];
      if (!student.classIds.includes(klass.id)) {
        student.classIds.push(klass.id);
      }
      appendHistory(db, {
        type: 'class_student_added',
        classId: klass.id,
        studentId: student.id,
        message: `${student.name} gekoppeld aan ${klass.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, { class: klass, student: sanitizeStudent(student, { includeUsername: true }) });
    }

    const classStudentRemoveMatch = requestUrl.pathname.match(
      /^\/api\/classes\/([\w-]+)\/students\/([\w-]+)$/
    );
    if (classStudentRemoveMatch && req.method === 'DELETE') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen ontkoppelen' });
      }
      const db = getDb();
      const klass = db.classes.find((cls) => cls.id === classStudentRemoveMatch[1]);
      if (!klass) {
        return sendJson(res, 404, { message: 'Klas niet gevonden' });
      }
      if (user.role === 'teacher' && !(klass.teacherIds || []).includes(user.id)) {
        return sendJson(res, 403, { message: 'Je mag alleen je eigen klassen beheren' });
      }
      const studentId = classStudentRemoveMatch[2];
      const student = findStudentById(db, studentId);
      if (!student) {
        return sendJson(res, 404, { message: 'Leerling niet gevonden' });
      }
      klass.studentIds = (klass.studentIds || []).filter((id) => id !== studentId);
      student.classIds = (student.classIds || []).filter((id) => id !== klass.id);
      appendHistory(db, {
        type: 'class_student_removed',
        classId: klass.id,
        studentId: student.id,
        message: `${student.name} losgekoppeld van ${klass.name}`,
      });
      saveDb(db);
      return sendJson(res, 200, { class: klass, student: sanitizeStudent(student, { includeUsername: true }) });
    }

    return sendJson(res, 404, { message: 'Niet gevonden' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { message: 'Interne serverfout' });
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname.startsWith('/api/')) {
    handleApi(req, res, requestUrl);
    return;
  }

  let filePath = path.join(STATIC_DIR, requestUrl.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    sendText(res, 403, 'Toegang geweigerd');
    return;
  }
  if (requestUrl.pathname === '/' || requestUrl.pathname === '') {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      sendText(res, 404, 'Pagina niet gevonden');
      return;
    }
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    serveFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`Boekenbaai server draait op http://localhost:${PORT}`);
});

let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Ontvangen signaal ${signal}, server wordt afgesloten...`);
  server.close(() => {
    console.log('HTTP-server netjes afgesloten.');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('Geforceerde afsluiting na timeout.');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
