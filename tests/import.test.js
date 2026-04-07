const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const PORT = 4011;
const BASE_URL = `http://localhost:${PORT}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createDbFixture(filePath, overrides = {}) {
  const db = {
    books: [],
    students: [],
    classes: [],
    folders: [],
    users: [
      {
        id: 'admin',
        name: 'Admin',
        username: 'admin',
        passwordHash: hashPassword('admin-pass'),
        role: 'admin',
      },
    ],
    history: [],
    ...overrides,
  };

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

async function waitForServer(proc) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes(`http://localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

function buildWorkbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer.toString('base64');
}

function startServer(env = {}) {
  const serverProcess = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      ...env,
      PORT,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return serverProcess;
}

async function loginAdmin() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass' }),
  });
  assert.strictEqual(response.status, 200);
  assert.ok(response.body.token, 'Admin token should be returned');
  return response.body.token;
}

async function runEnrichmentImportTest({ enableFlag, requestFlag }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-'));
  const dbPath = path.join(tempDir, 'db.json');
  const logPath = path.join(tempDir, 'lookups.log');
  createDbFixture(dbPath);
  const fixtures = {
    '9781234567890': {
      title: 'Metadata title',
      author: 'Metadata auteur',
      description: 'Beschrijving uit metadata',
      publisher: 'Meta Uitgever',
      publishedAt: '2010',
      pageCount: 321,
      language: 'nl',
      coverUrl: 'https://example.com/cover.jpg',
      tags: ['meta', 'isbn'],
      source: 'mock-source',
      found: true,
    },
  };

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_IMPORT_ENRICH_ISBN: enableFlag ? 'true' : 'false',
    BOEKENBAAI_ISBN_MOCK_LOG: logPath,
    BOEKENBAAI_TEST_ISBN_FIXTURES: JSON.stringify(fixtures),
    NODE_OPTIONS: `--require ${path.join(__dirname, 'mock-isbn-lookup.js')}`,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const workbookBase64 = buildWorkbookBase64([
      {
        Titel: 'Gebruikerstitel',
        Auteur: 'Gebruikersauteur',
        Barcode: '9781234567890',
        Beschrijving: '',
      },
    ]);

    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64, enrichIsbn: requestFlag }),
    });

    const books = importResponse.body.books || [];
    return {
      books,
      importResponse,
      dbPath,
      token,
      logPath,
      serverProcess,
    };
  } catch (error) {
    serverProcess.kill('SIGINT');
    throw error;
  }
}

async function runEasyReadingTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-easy-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const workbookBase64 = buildWorkbookBase64([
      {
        Titel: 'Test Boek',
        Auteur: 'Test Auteur',
        Barcode: '9781111111111',
        Leeslijst: 'Ja',
        'Makkelijk lezen?': 'true',
      },
    ]);

    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });

    const books = importResponse.body.books || [];
    return {
      books,
      importResponse,
      dbPath,
      token,
      serverProcess,
    };
  } catch (error) {
    serverProcess.kill('SIGINT');
    throw error;
  }
}

async function runStudentImportNamePartsTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-students-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const workbookBase64 = buildWorkbookBase64([
      {
        Voornaam: 'Jan',
        Voorvoegsel: 'van',
        Achternaam: 'Dijk',
        Gebruikersnaam: 'jan.vandijk',
        Wachtwoord: 'Welkom123',
        'Klas(sen)': '1A',
      },
    ]);

    const importResponse = await request('/api/students/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });

    return {
      importResponse,
      dbPath,
      serverProcess,
    };
  } catch (error) {
    serverProcess.kill('SIGINT');
    throw error;
  }
}

async function readBookCollection(token) {
  const { status, body } = await request('/api/books', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(status, 200);
  return body;
}

async function runManualCoverNormalizationTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-manual-cover-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const createResponse = await request('/api/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: 'Handmatig boek',
        author: 'Auteur',
        barcode: '9782222222222',
        coverUrl: 'http://books.google.com/manual-cover.jpg',
      }),
    });
    assert.strictEqual(createResponse.status, 201);
    assert.strictEqual(
      createResponse.body.book.coverUrl,
      'https://books.google.com/manual-cover.jpg',
    );

    const updateResponse = await request(`/api/books/${createResponse.body.book.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        coverUrl: 'http://books.google.com/updated-cover.jpg',
      }),
    });
    assert.strictEqual(updateResponse.status, 200);
    assert.strictEqual(
      updateResponse.body.book.coverUrl,
      'https://books.google.com/updated-cover.jpg',
    );

    const storedBooks = await readBookCollection(token);
    const stored = storedBooks.find((book) => book.id === createResponse.body.book.id);
    assert.ok(stored);
    assert.strictEqual(stored.coverUrl, 'https://books.google.com/updated-cover.jpg');

    const nonGoogleCreateResponse = await request('/api/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: 'Intranet boek',
        author: 'Auteur',
        barcode: '9782222222223',
        coverUrl: 'http://intranet.local/manual-cover.jpg',
      }),
    });
    assert.strictEqual(nonGoogleCreateResponse.status, 201);
    assert.strictEqual(
      nonGoogleCreateResponse.body.book.coverUrl,
      'http://intranet.local/manual-cover.jpg',
    );

    const storedAfterNonGoogleCreate = await readBookCollection(token);
    const nonGoogleStored = storedAfterNonGoogleCreate.find(
      (book) => book.id === nonGoogleCreateResponse.body.book.id,
    );
    assert.ok(nonGoogleStored);
    assert.strictEqual(nonGoogleStored.coverUrl, 'http://intranet.local/manual-cover.jpg');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runImportCoverNormalizationTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-cover-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const workbookBase64 = buildWorkbookBase64([
      {
        Titel: 'Import boek',
        Auteur: 'Import auteur',
        Barcode: '9783333333333',
        'Cover URL': 'http://books.google.com/import-cover.jpg',
      },
      {
        Titel: 'Import archiefcover',
        Auteur: 'Import auteur',
        Barcode: '9783333333334',
        'Cover URL': 'https://archive.org/download/l_covers_0012/l_covers_0012_92.zip/0012920350-L.jpg',
      },
    ]);

    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });

    assert.strictEqual(importResponse.status, 200);
    const [importedBook] = importResponse.body.books;
    assert.ok(importedBook);
    assert.strictEqual(importedBook.status, 'created');

    const storedBooks = await readBookCollection(token);
    const stored = storedBooks.find((book) => book.barcode === '9783333333333');
    assert.ok(stored);
    assert.strictEqual(stored.coverUrl, 'https://books.google.com/import-cover.jpg');
    const storedArchiveCover = storedBooks.find((book) => book.barcode === '9783333333334');
    assert.ok(storedArchiveCover);
    assert.strictEqual(
      storedArchiveCover.coverUrl,
      'https://covers.openlibrary.org/b/id/12920350-L.jpg?default=false',
    );
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runStoredCoverRewriteOnLoadTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-stored-cover-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, {
    books: [
      {
        id: 'stale-archive',
        title: 'De reis van de lege flessen',
        author: 'Kader Abdolah',
        barcode: '9789029078733',
        metadataIsbn: '',
        description: '',
        coverUrl: 'https://archive.org/download/l_covers_0013/l_covers_0013_53.zip/0013539664-L.jpg',
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'already-openlibrary',
        title: 'Open Library',
        author: 'Auteur',
        barcode: '9789029078734',
        metadataIsbn: '',
        description: '',
        coverUrl: 'https://covers.openlibrary.org/b/id/13539664-L.jpg?default=false',
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'google-cover',
        title: 'Google Book',
        author: 'Auteur',
        barcode: '9789029078735',
        metadataIsbn: '',
        description: '',
        coverUrl: 'https://books.google.com/google-cover.jpg',
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'blank-cover',
        title: 'Leeg',
        author: 'Auteur',
        barcode: '9789029078736',
        metadataIsbn: '',
        description: '',
        coverUrl: '',
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'null-cover',
        title: 'Null',
        author: 'Auteur',
        barcode: '9789029078737',
        metadataIsbn: '',
        description: '',
        coverUrl: null,
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'malformed-cover',
        title: 'Malformed',
        author: 'Auteur',
        barcode: '9789029078738',
        metadataIsbn: '',
        description: '',
        coverUrl: 'not-a-url',
        coverColor: '#f9f9f9',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: [],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const books = await readBookCollection(token);
    const byBarcode = (barcode) => books.find((book) => book.barcode === barcode);

    const staleArchive = byBarcode('9789029078733');
    assert.ok(staleArchive);
    assert.strictEqual(
      staleArchive.coverUrl,
      'https://covers.openlibrary.org/b/id/13539664-L.jpg?default=false',
    );

    const alreadyOpenLibrary = byBarcode('9789029078734');
    assert.ok(alreadyOpenLibrary);
    assert.strictEqual(
      alreadyOpenLibrary.coverUrl,
      'https://covers.openlibrary.org/b/id/13539664-L.jpg?default=false',
    );

    const googleCover = byBarcode('9789029078735');
    assert.ok(googleCover);
    assert.strictEqual(googleCover.coverUrl, 'https://books.google.com/google-cover.jpg');

    const blankCover = byBarcode('9789029078736');
    assert.ok(blankCover);
    assert.strictEqual(blankCover.coverUrl, '');

    const nullCover = byBarcode('9789029078737');
    assert.ok(nullCover);
    assert.strictEqual(nullCover.coverUrl, '');

    const malformedCover = byBarcode('9789029078738');
    assert.ok(malformedCover);
    assert.strictEqual(malformedCover.coverUrl, 'not-a-url');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runThemeImportWorkflowTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-theme-import-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, {
    books: [
      {
        id: 'existing-f',
        title: 'Bestaand F',
        author: 'Auteur F',
        barcode: '9786666666661',
        metadataIsbn: '',
        description: '',
        coverUrl: '',
        coverColor: '',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: ['adventure stories', 'friendship'],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'existing-g',
        title: 'Bestaand G',
        author: 'Auteur G',
        barcode: '9786666666662',
        metadataIsbn: '',
        description: '',
        coverUrl: '',
        coverColor: '',
        publisher: '',
        publishedYear: null,
        pageCount: null,
        language: '',
        tags: ['adventure stories'],
        manualThemes: [],
        status: 'available',
        suitableForExamList: false,
        easyReading: false,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Case A', Auteur: 'Auteur', Barcode: '9784444444441', 'thema’s': 'Psychische gezondheid; Pesten' },
      { Titel: 'Case B', Auteur: 'Auteur', Barcode: '9784444444442', "thema's": 'Psychische gezondheid; Pesten' },
      { Titel: 'Case C', Auteur: 'Auteur', Barcode: '9784444444443', themas: 'Psychische gezondheid; Pesten' },
      { Titel: 'Case D', Auteur: 'Auteur', Barcode: '9784444444444', themas: 'Media & Invloed; Spanning' },
      { Titel: 'Case E', Auteur: 'Auteur', Barcode: '9784444444445', themas: 'Pesten', tags: 'bullying, school harassment' },
      { Titel: 'Bestaand F update', Auteur: 'Auteur F', Barcode: '9786666666661', themas: 'Isolatie; Macht & hiërarchie' },
      { Titel: 'Bestaand G update', Auteur: 'Auteur G', Barcode: '9786666666662', themas: 'Overleven', tags: 'survival, wilderness survival' },
      { Titel: 'Case H', Auteur: 'Auteur', Barcode: '9784444444448', themas: 'Fantasy', 'Makkelijk lezen': 'true' },
    ]);

    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });
    assert.strictEqual(importResponse.status, 200);

    const books = await readBookCollection(token);
    const byBarcode = (barcode) => books.find((book) => book.barcode === barcode);

    const caseA = byBarcode('9784444444441');
    const caseB = byBarcode('9784444444442');
    const caseC = byBarcode('9784444444443');
    assert.deepStrictEqual(caseA.manualThemes, ['Psychische gezondheid', 'Pesten']);
    assert.deepStrictEqual(caseA.themes, ['Psychische gezondheid', 'Pesten']);
    assert.deepStrictEqual(caseB.manualThemes, ['Psychische gezondheid', 'Pesten']);
    assert.deepStrictEqual(caseB.themes, ['Psychische gezondheid', 'Pesten']);
    assert.deepStrictEqual(caseC.manualThemes, ['Psychische gezondheid', 'Pesten']);
    assert.deepStrictEqual(caseC.themes, ['Psychische gezondheid', 'Pesten']);

    const caseD = byBarcode('9784444444444');
    assert.deepStrictEqual(caseD.manualThemes, ['Media & Invloed', 'Spanning']);
    assert.deepStrictEqual(caseD.tags, []);

    const caseE = byBarcode('9784444444445');
    assert.deepStrictEqual(caseE.manualThemes, ['Pesten']);
    assert.deepStrictEqual(caseE.tags, ['bullying', 'school harassment']);
    assert.deepStrictEqual(caseE.themes, ['Pesten']);

    const caseF = byBarcode('9786666666661');
    assert.deepStrictEqual(caseF.tags, ['adventure stories', 'friendship']);
    assert.deepStrictEqual(caseF.manualThemes, ['Macht & hiërarchie', 'Isolatie']);
    assert.deepStrictEqual(caseF.themes, ['Macht & hiërarchie', 'Isolatie']);

    const caseG = byBarcode('9786666666662');
    assert.deepStrictEqual(caseG.manualThemes, ['Overleven']);
    assert.deepStrictEqual(caseG.tags, ['survival', 'wilderness survival']);
    assert.deepStrictEqual(caseG.themes, ['Overleven']);

    const caseH = byBarcode('9784444444448');
    assert.strictEqual(caseH.easyReading, true);
    assert.deepStrictEqual(caseH.manualThemes, ['Fantasy']);
    assert.ok(!caseH.themes.includes('Makkelijk Lezen'));
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runStrictTitleAuthorFallbackImportTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-fallback-'));
  const dbPath = path.join(tempDir, 'db.json');
  const logPath = path.join(tempDir, 'lookups.log');
  createDbFixture(dbPath, {
    books: [
      {
        id: crypto.randomUUID(),
        title: 'Hajar en Daan',
        author: 'Carry Slee',
        barcode: '9787000000005',
        metadataIsbn: '',
        description: '',
        publisher: '',
        language: 'nl',
        coverUrl: 'https://example.com/already-set-cover.jpg',
        status: 'available',
      },
    ],
  });

  const fixtures = {
    '9787000000001': { title: 'Hajar en Daan', author: 'Carry Slee', coverUrl: '' },
    '9787000000002': { title: 'Hajar en Daan', author: 'Carry Slee', publisher: '', description: '' },
    '9787000000003': { title: 'Hajar en Daan', author: 'Carry Slee', coverUrl: '' },
    '9787000000004': { title: 'Hajar en Daan', author: 'Carry Slee', coverUrl: '' },
    '9787000000006': {
      title: 'Hajar en Daan',
      author: 'Carry Slee',
      coverUrl: 'https://example.com/exact-rich.jpg',
      publisher: 'Rijke Uitgever',
      description: 'Rijke beschrijving',
    },
    '9787000000007': { title: 'Door jou ben ik mij', author: 'Hinke Abbema, van', coverUrl: '' },
    '9787000000008': { title: 'Geef me de ruimte', author: 'Thea Beckman', coverUrl: '' },
    '9787000000009': { title: 'P.s. ik hou van je (p.s. i love you)', author: 'Cecelia Ahern', coverUrl: '' },
    '9787000000010': { title: 'P.s. ik hou van je', author: 'Andere Auteur', coverUrl: '' },
    '9787000000011': { title: 'Hajar en Daan!', author: 'Carry Slee', coverUrl: '' },
    '9787000000012': { title: 'Hajar en Daan Deel 2.', author: 'Carry Slee', coverUrl: '' },
  };
  const taFixtures = {
    'hajar en daan|||carry slee': {
      title: 'Hajar en Daan (Lijsters editie)',
      author: 'Carry Slee',
      coverUrl: 'https://example.com/fallback-cover.jpg',
      publisher: 'Fallback Uitgever',
      description: 'Fallback beschrijving',
      language: 'nl',
    },
    'hajar en daan|||andere auteur': {
      title: 'Hajar en Daan',
      author: 'Volledig Andere',
      coverUrl: 'https://example.com/wrong-author-cover.jpg',
      language: 'nl',
    },
    'hajar en daan deel 2|||carry slee': {
      title: 'Hajar en Daan omnibus',
      author: 'Carry Slee',
      coverUrl: 'https://example.com/omnibus-cover.jpg',
      language: 'nl',
    },
    'door jou ben ik mij|||hinke abbema, van': {
      title: 'Door jou ben ik mij',
      author: 'Hinke van Abbema',
      coverUrl: 'https://example.com/hinke-cover.jpg',
      publisher: 'Fallback Uitgever',
      description: 'Fallback beschrijving',
      language: 'nl',
    },
    'geef me de ruimte|||thea beckman': {
      title: 'Beckman, Geef me de ruimte!, 37e dr.',
      author: 'Thea Beckman',
      coverUrl: 'https://example.com/ruimte-cover.jpg',
      publisher: 'Uitgever',
      description: 'Beschrijving',
      language: 'nl',
    },
    'p.s. ik hou van je (p.s. i love you)|||cecelia ahern': {
      title: 'P.S. Ik hou van je',
      author: 'Cecelia Ahern',
      coverUrl: 'https://example.com/ps-cover.jpg',
      publisher: 'PS Uitgever',
      description: 'PS beschrijving',
      language: 'nl',
    },
    'p.s. ik hou van je|||andere auteur': {
      title: 'P.S. Ik hou van je',
      author: 'Volledig Andere',
      coverUrl: 'https://example.com/wrong-ps-cover.jpg',
      language: 'nl',
    },
    'hajar en daan!|||carry slee': {
      title: 'Hajar en Daan omnibus',
      author: 'Carry Slee',
      coverUrl: 'https://example.com/omnibus-no-part-cover.jpg',
      language: 'nl',
    },
    'hajar en daan deel 2.|||carry slee': {
      title: 'Hajar en Daan deel 3',
      author: 'Carry Slee',
      coverUrl: 'https://example.com/deel3-cover.jpg',
      language: 'nl',
    },
  };

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_ISBN_MOCK_LOG: logPath,
    BOEKENBAAI_TEST_ISBN_FIXTURES: JSON.stringify(fixtures),
    BOEKENBAAI_TEST_TITLE_AUTHOR_FIXTURES: JSON.stringify(taFixtures),
    NODE_OPTIONS: `--require ${path.join(__dirname, 'mock-isbn-lookup.js')}`,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Hajar en Daan', Auteur: 'Carry Slee', Barcode: '9787000000001' },
      { Titel: 'Hajar en Daan', Auteur: 'Carry Slee', Barcode: '9787000000002' },
      { Titel: 'Hajar en Daan', Auteur: 'Andere Auteur', Barcode: '9787000000003' },
      { Titel: 'Hajar en Daan Deel 2', Auteur: 'Carry Slee', Barcode: '9787000000004' },
      { Titel: 'Hajar en Daan', Auteur: 'Carry Slee', Barcode: '9787000000005' },
      { Titel: 'Hajar en Daan', Auteur: 'Carry Slee', Barcode: '9787000000006' },
      { Titel: 'Door jou ben ik mij', Auteur: 'Hinke Abbema, van', Barcode: '9787000000007' },
      { Titel: 'Geef me de ruimte', Auteur: 'Thea Beckman', Barcode: '9787000000008' },
      { Titel: 'P.s. ik hou van je (p.s. i love you)', Auteur: 'Cecelia Ahern', Barcode: '9787000000009' },
      { Titel: 'P.s. ik hou van je', Auteur: 'Andere Auteur', Barcode: '9787000000010' },
      { Titel: 'Hajar en Daan!', Auteur: 'Carry Slee', Barcode: '9787000000011' },
      { Titel: 'Hajar en Daan Deel 2.', Auteur: 'Carry Slee', Barcode: '9787000000012' },
    ]);
    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });
    assert.strictEqual(importResponse.status, 200);
    const books = await readBookCollection(token);
    const byBarcode = (barcode) => books.find((book) => book.barcode === barcode);

    const scenario1 = byBarcode('9787000000001');
    assert.strictEqual(scenario1.coverUrl, 'https://example.com/fallback-cover.jpg');
    assert.strictEqual(scenario1.title, 'Hajar en Daan');
    assert.strictEqual(scenario1.author, 'Carry Slee');

    const scenario2 = byBarcode('9787000000002');
    assert.strictEqual(scenario2.publisher, 'Fallback Uitgever');
    assert.strictEqual(scenario2.description, 'Fallback beschrijving');

    const scenario3 = byBarcode('9787000000003');
    assert.strictEqual(scenario3.coverUrl, '');

    const scenario4 = byBarcode('9787000000004');
    assert.strictEqual(scenario4.coverUrl, '');

    const scenario5 = byBarcode('9787000000005');
    assert.strictEqual(scenario5.coverUrl, 'https://example.com/already-set-cover.jpg');

    const scenario6 = byBarcode('9787000000006');
    assert.strictEqual(scenario6.coverUrl, 'https://example.com/exact-rich.jpg');
    assert.strictEqual(scenario6.publisher, 'Rijke Uitgever');
    assert.strictEqual(scenario6.description, 'Rijke beschrijving');

    const scenario7 = byBarcode('9787000000007');
    assert.strictEqual(scenario7.coverUrl, 'https://example.com/hinke-cover.jpg');

    const scenario8 = byBarcode('9787000000008');
    assert.strictEqual(scenario8.coverUrl, 'https://example.com/ruimte-cover.jpg');

    const scenario9 = byBarcode('9787000000009');
    assert.strictEqual(scenario9.coverUrl, 'https://example.com/ps-cover.jpg');

    const scenario10 = byBarcode('9787000000010');
    assert.strictEqual(scenario10.coverUrl, '');

    const scenario11 = byBarcode('9787000000011');
    assert.strictEqual(scenario11.coverUrl, '');

    const scenario12 = byBarcode('9787000000012');
    assert.strictEqual(scenario12.coverUrl, '');

    const logs = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const taLookups = logs.filter((entry) => entry.startsWith('TA:'));
    assert.strictEqual(taLookups.length, 11);
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runGoogleBooksFallbackResilienceTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-fallback-google-'));
  const dbPath = path.join(tempDir, 'db.json');
  const googleLogPath = path.join(tempDir, 'google.log');
  createDbFixture(dbPath);
  const emptyIsbnFixtures = {};
  const qStrictRetry503 = 'intitle:"Retry 503 Titel" inauthor:"Carry Slee"';
  const qStrictFail503 = 'intitle:"Fail 503 Titel" inauthor:"Carry Slee"';
  const qStrictWithParens = 'intitle:"Ladder Titel (schooleditie)" inauthor:"Carry Slee"';
  const qPrimaryWithParens = 'intitle:"Ladder Titel" inauthor:"Carry Slee"';
  const qRelaxedWithParens = 'intitle:"Ladder Titel (schooleditie)" inauthor:Carry Slee';
  const qStrictLanguageCache = 'intitle:"Language Cache Titel" inauthor:"Carry Slee"';
  const queryPlan = {
    [qStrictRetry503]: [
      { status: 503, items: [] },
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Retry 503 Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/retry-503.jpg' },
            },
          },
        ],
      },
    ],
    [qStrictFail503]: [
      { status: 503, items: [] },
      { status: 503, items: [] },
      { status: 503, items: [] },
    ],
    [qStrictWithParens]: [{ status: 200, items: [] }],
    [qPrimaryWithParens]: [{ status: 200, items: [] }],
    [qRelaxedWithParens]: [
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Ladder Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/ladder-rich.jpg' },
              publisher: 'Rijke Uitgever',
              description: 'Rijke beschrijving',
            },
          },
          {
            volumeInfo: {
              title: 'Ladder Titel',
              authors: ['Carry Slee'],
              language: 'nl',
            },
          },
        ],
      },
    ],
    [qStrictLanguageCache]: [
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Language Cache Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/language-cache.jpg' },
            },
          },
        ],
      },
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Language Cache Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/language-cache.jpg' },
            },
          },
        ],
      },
    ],
  };

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
    GOOGLE_BOOKS_API_KEY: 'test-google-key',
    BOEKENBAAI_TEST_ISBN_FIXTURES: JSON.stringify(emptyIsbnFixtures),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_FALLBACK_PLAN: JSON.stringify(queryPlan),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_LOG: googleLogPath,
    NODE_OPTIONS: `--require ${path.join(__dirname, 'mock-isbn-only-lookup.js')} --require ${path.join(__dirname, 'mock-google-books-fallback.js')}`,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Retry 503 Titel', Auteur: 'Carry Slee', Barcode: '9787100000001' },
      { Titel: 'Retry 503 Titel', Auteur: 'Carry Slee', Barcode: '9787100000004' },
      { Titel: 'Ladder Titel (schooleditie)', Auteur: 'Carry Slee', Barcode: '9787100000005' },
      { Titel: 'Language Cache Titel', Auteur: 'Carry Slee', Taal: 'nl', Barcode: '9787100000007' },
      { Titel: 'Language Cache Titel', Auteur: 'Carry Slee', Taal: 'en', Barcode: '9787100000008' },
      { Titel: 'Fail 503 Titel', Auteur: 'Carry Slee', Barcode: '9787100000003' },
      { Titel: 'Fail 503 Titel', Auteur: 'Carry Slee', Barcode: '9787100000006' },
    ]);
    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });
    assert.strictEqual(importResponse.status, 200);

    const books = await readBookCollection(token);
    const byBarcode = (barcode) => books.find((book) => book.barcode === barcode);
    assert.strictEqual(byBarcode('9787100000001').coverUrl, 'https://example.com/retry-503.jpg');
    assert.strictEqual(byBarcode('9787100000003').coverUrl, '');
    assert.strictEqual(byBarcode('9787100000006').coverUrl, '');
    assert.strictEqual(byBarcode('9787100000004').coverUrl, 'https://example.com/retry-503.jpg');
    assert.strictEqual(byBarcode('9787100000005').coverUrl, 'https://example.com/ladder-rich.jpg');
    assert.strictEqual(byBarcode('9787100000005').publisher, 'Rijke Uitgever');
    assert.strictEqual(byBarcode('9787100000005').description, 'Rijke beschrijving');
    assert.strictEqual(byBarcode('9787100000007').coverUrl, 'https://example.com/language-cache.jpg');
    assert.strictEqual(byBarcode('9787100000008').coverUrl, '');

    const googleLogs = fs.readFileSync(googleLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    const queryCount = (query) => googleLogs.filter((entry) => entry.includes(`GB:${query}#`)).length;
    assert.strictEqual(queryCount(qStrictRetry503), 2);
    assert.strictEqual(queryCount(qStrictFail503), 3);
    assert.strictEqual(queryCount(qStrictWithParens), 1);
    assert.strictEqual(queryCount(qPrimaryWithParens), 1);
    assert.strictEqual(queryCount(qRelaxedWithParens), 1);
    assert.strictEqual(queryCount(qStrictLanguageCache), 2);
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runGoogleBooksFallbackDeferredQueueTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-fallback-deferred-'));
  const dbPath = path.join(tempDir, 'db.json');
  const googleLogPath = path.join(tempDir, 'google.log');
  createDbFixture(dbPath);
  const qRetry503 = 'intitle:"Deferred 503 Titel" inauthor:"Carry Slee"';
  const qCooldown = 'intitle:"Cooldown Titel" inauthor:"Carry Slee"';
  const qNoMatch = 'intitle:"No Match Titel" inauthor:"Carry Slee"';
  const queryPlan = {
    [qRetry503]: [
      { status: 503, items: [] },
      { status: 503, items: [] },
      { status: 503, items: [] },
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Deferred 503 Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/deferred-503.jpg' },
            },
          },
        ],
      },
    ],
    [qCooldown]: [
      {
        status: 200,
        items: [
          {
            volumeInfo: {
              title: 'Cooldown Titel',
              authors: ['Carry Slee'],
              language: 'nl',
              imageLinks: { thumbnail: 'https://example.com/cooldown-retry.jpg' },
            },
          },
        ],
      },
    ],
    [qNoMatch]: [{ status: 200, items: [] }],
  };

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
    GOOGLE_BOOKS_API_KEY: 'test-google-key',
    BOEKENBAAI_TITLE_AUTHOR_RATE_LIMIT_COOLDOWN_MS: '20',
    BOEKENBAAI_TEST_ISBN_FIXTURES: JSON.stringify({}),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_FALLBACK_PLAN: JSON.stringify(queryPlan),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_LOG: googleLogPath,
    NODE_OPTIONS: `--require ${path.join(__dirname, 'mock-isbn-only-lookup.js')} --require ${path.join(__dirname, 'mock-google-books-fallback.js')}`,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Deferred 503 Titel', Auteur: 'Carry Slee', Barcode: '9787200000001' },
      { Titel: 'Cooldown Titel', Auteur: 'Carry Slee', Barcode: '9787200000002' },
      { Titel: 'No Match Titel', Auteur: 'Carry Slee', Barcode: '9787200000003' },
    ]);
    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });
    assert.strictEqual(importResponse.status, 200);

    const books = await readBookCollection(token);
    const byBarcode = (barcode) => books.find((book) => book.barcode === barcode);
    assert.strictEqual(byBarcode('9787200000001').coverUrl, 'https://example.com/deferred-503.jpg');
    assert.strictEqual(byBarcode('9787200000002').coverUrl, 'https://example.com/cooldown-retry.jpg');
    assert.strictEqual(byBarcode('9787200000003').coverUrl, '');

    const googleLogs = fs.readFileSync(googleLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    const queryCount = (query) => googleLogs.filter((entry) => entry.includes(`GB:${query}#`)).length;
    assert.strictEqual(queryCount(qRetry503), 4, '503 row should be retried later in the same import run');
    assert.strictEqual(queryCount(qCooldown), 1, 'Cooldown-skipped row should be retried after cooldown');
    assert.strictEqual(queryCount(qNoMatch), 1, 'No-match row should not be retried indefinitely');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runGoogleBooksFallbackDeferredBudgetTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-fallback-budget-'));
  const dbPath = path.join(tempDir, 'db.json');
  const googleLogPath = path.join(tempDir, 'google.log');
  createDbFixture(dbPath);
  const qAlways503 = 'intitle:"Always 503 Titel" inauthor:"Carry Slee"';
  const queryPlan = {
    [qAlways503]: [{ status: 503, items: [] }],
  };

  const serverProcess = startServer({
    BOEKENBAAI_DATA_PATH: dbPath,
    GOOGLE_BOOKS_API_KEY: 'test-google-key',
    BOEKENBAAI_TITLE_AUTHOR_RATE_LIMIT_COOLDOWN_MS: '5',
    BOEKENBAAI_TEST_ISBN_FIXTURES: JSON.stringify({}),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_FALLBACK_PLAN: JSON.stringify(queryPlan),
    BOEKENBAAI_TEST_GOOGLE_BOOKS_LOG: googleLogPath,
    NODE_OPTIONS: `--require ${path.join(__dirname, 'mock-isbn-only-lookup.js')} --require ${path.join(__dirname, 'mock-google-books-fallback.js')}`,
  });

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Always 503 Titel', Auteur: 'Carry Slee', Barcode: '9787200000010' },
    ]);
    const importResponse = await request('/api/books/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64 }),
    });
    assert.strictEqual(importResponse.status, 200);

    const books = await readBookCollection(token);
    const result = books.find((book) => book.barcode === '9787200000010');
    assert.strictEqual(result.coverUrl, '');

    const googleLogs = fs.readFileSync(googleLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    const queryCount = googleLogs.filter((entry) => entry.includes(`GB:${qAlways503}#`)).length;
    assert.ok(queryCount <= 12, `Retry budget should be bounded, received ${queryCount} calls`);
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function runTests() {
  // Enrichment enabled via request flag should merge metadata without overriding user fields.
  const enrichmentResult = await runEnrichmentImportTest({ enableFlag: false, requestFlag: true });
  const [createdBook] = enrichmentResult.books;
  assert.strictEqual(enrichmentResult.importResponse.status, 200);
  assert.ok(createdBook, 'Book should be returned in response');
  assert.deepStrictEqual(createdBook.enrichment, { source: 'mock-source', found: true });
  assert.strictEqual(createdBook.title, 'Gebruikerstitel');
  assert.strictEqual(createdBook.author, 'Gebruikersauteur');
  const booksAfterImport = await readBookCollection(enrichmentResult.token);
  const stored = booksAfterImport.find((book) => book.barcode === '9781234567890');
  assert.strictEqual(stored.description, 'Beschrijving uit metadata');
  assert.strictEqual(stored.publisher, 'Meta Uitgever');
  assert.strictEqual(stored.publishedYear, 2010);
  assert.strictEqual(stored.pageCount, 321);
  assert.strictEqual(stored.language, 'nl');
  assert.strictEqual(stored.coverUrl, 'https://example.com/cover.jpg');
  assert.deepStrictEqual(stored.tags, ['meta', 'isbn']);
  enrichmentResult.serverProcess.kill('SIGINT');

  // Enrichment disabled should skip lookups and leave optional fields untouched.
  const disabledResult = await runEnrichmentImportTest({ enableFlag: false, requestFlag: false });
  assert.strictEqual(disabledResult.importResponse.status, 200);
  const [disabledBook] = disabledResult.books;
  assert.ok(disabledBook);
  assert.strictEqual(disabledBook.enrichment, undefined);
  const booksWithoutEnrichment = await readBookCollection(disabledResult.token);
  const storedWithout = booksWithoutEnrichment.find((book) => book.barcode === '9781234567890');
  assert.strictEqual(storedWithout.description, '');
  assert.strictEqual(storedWithout.publisher, '');
  assert.strictEqual(storedWithout.publishedYear, null);
  const logContents = fs.existsSync(disabledResult.logPath)
    ? fs.readFileSync(disabledResult.logPath, 'utf-8').trim()
    : '';
  assert.strictEqual(logContents, '', 'Lookup log should stay empty when enrichment is disabled');
  disabledResult.serverProcess.kill('SIGINT');

  await runManualCoverNormalizationTest();
  await runImportCoverNormalizationTest();
  await runStoredCoverRewriteOnLoadTest();
  await runThemeImportWorkflowTest();
  await runStrictTitleAuthorFallbackImportTest();
  await runGoogleBooksFallbackResilienceTest();
  await runGoogleBooksFallbackDeferredQueueTest();
  await runGoogleBooksFallbackDeferredBudgetTest();

  // Test easyReading and suitableForExamList import
  const easyReadingResult = await runEasyReadingTest();
  assert.strictEqual(easyReadingResult.importResponse.status, 200);
  const [easyBook] = easyReadingResult.books;
  assert.ok(easyBook);
  assert.strictEqual(easyBook.suitableForExamList, true);
  assert.strictEqual(easyBook.easyReading, true);
  const booksWithFlags = await readBookCollection(easyReadingResult.token);
  const storedWithFlags = booksWithFlags.find((book) => book.barcode === '9781111111111');
  assert.strictEqual(storedWithFlags.suitableForExamList, true);
  assert.strictEqual(storedWithFlags.easyReading, true);
  easyReadingResult.serverProcess.kill('SIGINT');

  // Student import should support separate name columns and store first name metadata.
  const studentImportResult = await runStudentImportNamePartsTest();
  assert.strictEqual(studentImportResult.importResponse.status, 200);
  assert.strictEqual(studentImportResult.importResponse.body.created, 1);
  assert.strictEqual(studentImportResult.importResponse.body.accounts[0].name, 'Jan van Dijk');
  assert.strictEqual(studentImportResult.importResponse.body.accounts[0].firstName, 'Jan');
  const importedDb = JSON.parse(fs.readFileSync(studentImportResult.dbPath, 'utf-8'));
  assert.strictEqual(importedDb.students[0].name, 'Jan van Dijk');
  assert.strictEqual(importedDb.students[0].firstName, 'Jan');
  assert.strictEqual(importedDb.students[0].middleName, 'van');
  assert.strictEqual(importedDb.students[0].lastName, 'Dijk');
  studentImportResult.serverProcess.kill('SIGINT');

  console.log('All import tests passed');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
