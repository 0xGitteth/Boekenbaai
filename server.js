const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
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
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.classes)) data.classes = [];
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.history)) data.history = [];
  data.students = data.students.map(ensureStudentShape);
  data.classes = data.classes.map(ensureClassShape);
  data.users = data.users.map(ensureTeacherShape);
  return data;
}

function saveDb(db) {
  // Atomic write: write to temp file then rename to avoid partial writes.
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

// Modern password handling: use bcrypt, but keep legacy sha256 support for migration.
function legacyHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function isBcryptHash(value) {
  return typeof value === 'string' && value.startsWith('$2');
}

function hashPassword(password) {
  // Use bcrypt sync for simplicity; acceptable for small-scale deployment.
  return bcrypt.hashSync(password, 10);
}

function getTokenFromHeader(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  return match ? match[1] : null;
}

// Simple rate limiter for login to mitigate brute-force attempts.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

function recordLoginAttempt(req) {
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  const entry = loginAttempts.get(ip) || { count: 0, firstAt: Date.now() };
  const now = Date.now();
  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  return entry;
}

function isLoginBlocked(req) {
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  const now = Date.now();
  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function getAuthenticatedUser(req, getDb) {
  const token = getTokenFromHeader(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
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

function findStudentByUsername(db, username) {
  const normalized = username.trim().toLowerCase();
  return db.students.find((entry) => (entry.username || '').toLowerCase() === normalized);
}

function generatePassword(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function isUsernameTaken(db, username, { allowStudentId = null } = {}) {
  const normalized = username.trim().toLowerCase();
  if (db.users.some((user) => user.username.toLowerCase() === normalized)) {
    return true;
  }
  return db.students.some((student) => {
    if (allowStudentId && student.id === allowStudentId) {
      return false;
    }
    return (student.username || '').toLowerCase() === normalized;
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

async function lookupIsbnMetadata(isbn) {
  const sanitized = sanitizeIsbn(isbn);
  const cacheKey = sanitized || `invalid:${String(isbn ?? '').trim()}`;
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
          // Gebruik socket.destroy() — `connection` is deprecated on newer Node-versies
          // en socket is de aanbevolen manier om de verbinding te beëindigen.
          if (req.socket && typeof req.socket.destroy === 'function') {
            req.socket.destroy();
          } else if (req.connection && typeof req.connection.destroy === 'function') {
            req.connection.destroy();
          }
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

function appendHistory(db, entry) {
  db.history.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  db.history = db.history.slice(0, 200);
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
      if (isLoginBlocked(req)) {
        return sendJson(res, 429, { message: 'Te veel inlogpogingen. Probeer later opnieuw.' });
      }
      const body = await parseBody(req);
      if (!body.username || !body.password) {
        recordLoginAttempt(req);
        return sendJson(res, 400, { message: 'Gebruikersnaam en wachtwoord zijn verplicht' });
      }
      const database = getDb();
      const username = body.username.trim();
      const normalized = username.toLowerCase();

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

      recordLoginAttempt(req);
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
      let books = db.books;
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
      return sendJson(res, 200, book);
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
      const book = {
        id: crypto.randomUUID(),
        title: body.title,
        author: body.author,
        barcode: normalizedBarcode,
        description: body.description || '',
        folderId: body.folderId || null,
        suitableForExamList: Boolean(body.suitableForExamList),
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        tags: body.tags || [],
        coverColor: body.coverColor || '#f9f9f9',
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
      Object.assign(book, {
        title: body.title ?? book.title,
        author: body.author ?? book.author,
        barcode: normalizedNewBarcode || '',
        description: body.description ?? book.description,
        folderId: body.folderId ?? book.folderId,
        suitableForExamList: body.suitableForExamList ?? book.suitableForExamList,
        tags: body.tags ?? book.tags,
        coverColor: body.coverColor ?? book.coverColor,
      });
      appendHistory(db, {
        type: 'book_updated',
        bookId: book.id,
        message: `${book.title} is bijgewerkt`,
      });
      saveDb(db);
      return sendJson(res, 200, book);
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
        const metadata = await lookupIsbnMetadata(isbn);
        return sendJson(res, 200, metadata);
      } catch (error) {
        console.error('ISBN-lookup mislukt:', error);
        return sendJson(res, 502, { message: 'Kon geen boekinformatie ophalen.' });
      }
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
        .map((account) => ({ id: account.id, name: account.name, username: account.username }));
      return sendJson(res, 200, teachers);
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

    if (req.method === 'GET' && requestUrl.pathname === '/api/folders') {
      const db = getDb();
      return sendJson(res, 200, db.folders);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/folders') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen mappen toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.name) {
        return sendJson(res, 400, { message: 'Naam is verplicht' });
      }
      const folder = {
        id: crypto.randomUUID(),
        name: body.name,
        description: body.description || '',
        color: body.color || '#9f86c0',
        examList: Boolean(body.examList),
      };
      db.folders.push(folder);
      appendHistory(db, {
        type: 'folder_created',
        folderId: folder.id,
        message: `Nieuwe map ${folder.name} aangemaakt`,
      });
      saveDb(db);
      return sendJson(res, 201, folder);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen de activiteit bekijken' });
      }
      const db = getDb();
      const limit = Number(requestUrl.searchParams.get('limit')) || 20;
      return sendJson(res, 200, db.history.slice(0, limit));
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
