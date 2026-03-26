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
  await runThemeImportWorkflowTest();

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
