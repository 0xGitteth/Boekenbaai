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

function createDbFixture(filePath) {
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

async function readBookCollection(token) {
  const { status, body } = await request('/api/books', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(status, 200);
  return body;
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

  console.log('All import tests passed');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
