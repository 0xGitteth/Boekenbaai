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
const DATA_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const sessions = new Map();

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
  return safeStudent;
}

function loadDb() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.classes)) data.classes = [];
  if (!Array.isArray(data.students)) data.students = [];
  data.students = data.students.map(ensureStudentShape);
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
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
  return db.books.find((book) => book.barcode === barcode);
}

function findStudentById(db, id) {
  return db.students.find((student) => student.id === id);
}

async function handleApi(req, res, requestUrl) {
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

      const staffAccount = database.users.find((entry) => entry.username.toLowerCase() === normalized);
      if (staffAccount) {
        let ok = false;
        if (isBcryptHash(staffAccount.passwordHash)) {
          ok = bcrypt.compareSync(body.password, staffAccount.passwordHash);
        } else {
          const legacy = legacyHash(body.password);
          if (legacy === staffAccount.passwordHash) {
            ok = true;
            // Migrate to bcrypt
            staffAccount.passwordHash = hashPassword(body.password);
            saveDb(database);
          }
        }
        if (ok) {
          const token = crypto.randomUUID();
          const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
          sessions.set(token, { userId: staffAccount.id, type: 'staff', createdAt: Date.now(), expiresAt });
          return sendJson(res, 200, {
            token,
            user: { id: staffAccount.id, name: staffAccount.name, role: staffAccount.role },
          });
        }
      }

      const studentAccount = findStudentByUsername(database, username);
      if (studentAccount) {
        let ok = false;
        if (isBcryptHash(studentAccount.passwordHash)) {
          ok = bcrypt.compareSync(body.password, studentAccount.passwordHash);
        } else {
          const legacy = legacyHash(body.password);
          if (legacy === studentAccount.passwordHash) {
            ok = true;
            studentAccount.passwordHash = hashPassword(body.password);
            saveDb(database);
          }
        }
        if (ok) {
          const token = crypto.randomUUID();
          const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
          sessions.set(token, { userId: studentAccount.id, type: 'student', createdAt: Date.now(), expiresAt });
          return sendJson(res, 200, {
            token,
            user: {
              id: studentAccount.id,
              name: studentAccount.name,
              role: 'student',
              grade: studentAccount.grade || '',
            },
          });
        }
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
        });
      }
      return sendJson(res, 200, { id: user.id, name: user.name, role: user.role });
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
      if (findBookByBarcode(db, body.barcode)) {
        return sendJson(res, 409, { message: 'Er bestaat al een boek met deze barcode' });
      }
      const book = {
        id: crypto.randomUUID(),
        title: body.title,
        author: body.author,
        barcode: body.barcode,
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
      const newBarcode = body.barcode ?? book.barcode;
      if (newBarcode !== book.barcode && findBookByBarcode(db, newBarcode)) {
        return sendJson(res, 409, { message: 'Er bestaat al een boek met deze barcode' });
      }
      Object.assign(book, {
        title: body.title ?? book.title,
        author: body.author ?? book.author,
        barcode: newBarcode,
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
      // body kan aanwezig zijn voor medewerkers (bijv. studentId, dueDate).
      // Zorg dat `body` altijd gedefinieerd is zodat we het veilig kunnen gebruiken
      // later in de handler (voorkomt ReferenceError wanneer een leerling uitleent).
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
  // body kan leeg zijn voor een student-actie; gebruik dan null als dueDate.
  book.dueDate = body && body.dueDate ? body.dueDate : null;
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
      const book = findBookByBarcode(db, barcodeMatch[1]);
      if (!book) {
        return sendJson(res, 404, { message: 'Geen boek gevonden met deze barcode' });
      }
      return sendJson(res, 200, book);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen leerlingen bekijken' });
      }
      const db = getDb();
      const students = db.students.map((student) => sanitizeStudent(student, { includeUsername: true }));
      return sendJson(res, 200, students);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/students') {
      if (!ensureRole(user, ['admin'])) {
        return sendJson(res, 403, { message: 'Alleen beheerders kunnen leerlingen toevoegen' });
      }
      const db = getDb();
      const body = await parseBody(req);
      if (!body.name || !body.username || !body.password) {
        return sendJson(res, 400, {
          message: 'Naam, gebruikersnaam en wachtwoord zijn verplicht',
        });
      }
      if (isUsernameTaken(db, body.username)) {
        return sendJson(res, 409, { message: 'Deze gebruikersnaam is al in gebruik' });
      }
      const student = {
        id: crypto.randomUUID(),
        name: body.name,
        username: body.username.trim(),
        passwordHash: hashPassword(body.password),
        grade: body.grade || '',
        borrowedBooks: [],
        classIds: [],
      };
      db.students.push(student);
      appendHistory(db, {
        type: 'student_created',
        studentId: student.id,
        message: `Nieuw leerlingaccount aangemaakt voor ${student.name}`,
      });
      saveDb(db);
      return sendJson(res, 201, {
        ...sanitizeStudent(student, { includeUsername: true }),
        temporaryPassword: body.password,
      });
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

      let workbook;
      try {
        const buffer = Buffer.from(body.file, 'base64');
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch (error) {
        return sendJson(res, 400, { message: 'Het Excelbestand kon niet gelezen worden' });
      }
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return sendJson(res, 400, { message: 'Het bestand bevat geen werkblad' });
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        return sendJson(res, 400, { message: 'Het werkblad is leeg' });
      }

      const createdAccounts = [];
      const updatedAccounts = [];
      const skipped = [];
      let changed = false;

      for (const row of rows) {
        const normalized = {};
        for (const [key, value] of Object.entries(row)) {
          if (!key) continue;
          normalized[key.toLowerCase()] = value;
        }
        const name = String(
          normalized.naam || normalized.name || normalized.leerling || ''
        ).trim();
        const username = String(
          normalized.gebruikersnaam || normalized.username || ''
        ).trim();
        let password = String(normalized.wachtwoord || normalized.password || '').trim();
        const grade = String(normalized.klas || normalized.klasnaam || normalized.leerjaar || '').trim();

        if (!name || !username) {
          skipped.push({
            name: name || '(onbekend)',
            username: username || '(leeg)',
            reason: 'Ontbrekende naam of gebruikersnaam',
          });
          continue;
        }

        const existingStudent = findStudentByUsername(db, username);
        if (existingStudent) {
          const originalName = existingStudent.name;
          const originalGrade = existingStudent.grade;
          existingStudent.name = name;
          let gradeChanged = false;
          if (grade) {
            if (originalGrade !== grade) {
              gradeChanged = true;
            }
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
            passwordChanged = true;
          }
          updatedAccounts.push({
            id: existingStudent.id,
            name: existingStudent.name,
            username: existingStudent.username,
            password: passwordChanged ? password : null,
          });
          if (passwordChanged || gradeChanged || originalName !== name) {
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
          grade,
          borrowedBooks: [],
          classIds: [],
        };
        db.students.push(student);
        createdAccounts.push({
          id: student.id,
          name: student.name,
          username: student.username,
          password,
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
        accounts: createdAccounts.concat(
          updatedAccounts.filter((entry) => entry.password)
        ),
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

    if (req.method === 'POST' && requestUrl.pathname === '/api/classes') {
      if (!ensureRole(user, ['teacher', 'admin'])) {
        return sendJson(res, 403, { message: 'Alleen medewerkers kunnen klassen toevoegen' });
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
        teacherIds: user.role === 'admin' ? validTeacherIds : [user.id],
        studentIds: [],
      };
      db.classes.push(klass);
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
      if (!body.studentId) {
        return sendJson(res, 400, { message: 'Leerling-ID is verplicht' });
      }
      const student = findStudentById(db, body.studentId);
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
      saveDb(db);
      return sendJson(res, 200, { class: klass, student });
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
      saveDb(db);
      return sendJson(res, 200, { class: klass, student });
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

  let filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Toegang geweigerd');
    return;
  }
  if (requestUrl.pathname === '/' || requestUrl.pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
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
