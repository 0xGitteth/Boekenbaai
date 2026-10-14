const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const XLSX = require('xlsx');
const { rewriteLegacyOpenLibraryArchiveCoverUrl } = require('../lib/cover-url');

const PORT = 4012;
const BASE_URL = `http://localhost:${PORT}`;
const LEGACY_ARCHIVE_URL = 'https://archive.org/download/l_covers_0013/l_covers_0013_53.zip/0013539664-L.jpg';
const CANONICAL_URL = 'https://covers.openlibrary.org/b/id/13539664-L.jpg?default=false';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createDbFixture(filePath, books = []) {
  const db = {
    books,
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

function startServer(env = {}) {
  return spawn('node', ['server.js'], {
    env: {
      ...process.env,
      ...env,
      PORT,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

async function loginAdmin() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass' }),
  });
  assert.strictEqual(response.status, 200);
  return response.body.token;
}

function buildWorkbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer.toString('base64');
}

async function runIntegrationChecks() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-cover-pipeline-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, [
    {
      id: 'legacy-1',
      title: 'De reis van de lege flessen',
      author: 'Kader Abdolah',
      barcode: '9789029078733',
      coverUrl: LEGACY_ARCHIVE_URL,
      status: 'available',
    },
    {
      id: 'import-existing-cover',
      title: 'Herbruikbaar',
      author: 'Auteur',
      barcode: '9781234567889',
      coverUrl: 'https://oldcover.example.org/old.png',
      localCoverUrl: '/api/covers/' + 'a'.repeat(64) + '.png',
      status: 'available',
    },
    {
      id: 'import-existing-cover-2',
      title: 'Herbruikbaar',
      author: 'Auteur',
      barcode: '9781234567890',
      coverUrl: 'https://oldcover.example.org/old.png',
      localCoverUrl: '/api/covers/' + 'a'.repeat(64) + '.png',
      status: 'available',
    },
  ]);
  // The stale asset must be real on disk. Otherwise the old backfill would
  // retry it anyway and fail to reproduce the regression Codex identified.
  const storedCoverDir = path.join(tempDir, 'covers');
  fs.mkdirSync(storedCoverDir, { recursive: true });
  fs.writeFileSync(path.join(storedCoverDir, 'a'.repeat(64) + '.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvmkAAAAASUVORK5CYII=', 'base64'));

  const serverProcess = startServer({ BOEKENBAAI_DATA_PATH: dbPath });
  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();

    const readResponse = await request('/api/books');
    assert.strictEqual(readResponse.status, 200);
    const readBook = readResponse.body.find((entry) => entry.id === 'legacy-1');
    assert.ok(readBook);
    assert.strictEqual(readBook.coverUrl, LEGACY_ARCHIVE_URL, 'read path should preserve legacy persisted URL');

    const putResponse = await request('/api/books/legacy-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ coverUrl: LEGACY_ARCHIVE_URL }),
    });
    assert.strictEqual(putResponse.status, 200);
    assert.strictEqual(putResponse.body.book.coverUrl, LEGACY_ARCHIVE_URL, 'PUT should preserve provided legacy cover URL');

    const postResponse = await request('/api/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: 'Nieuw boek',
        author: 'Auteur',
        barcode: '9781234567897',
      }),
    });
    assert.strictEqual(postResponse.status, 201);
    assert.strictEqual(postResponse.body.book.coverUrl, '', 'POST with no image should not depend on an external source');

    const workbookBase64 = buildWorkbookBase64([
      {
        Titel: 'Import boek',
        Auteur: 'Import auteur',
        Barcode: '9781234567898',
        Cover: LEGACY_ARCHIVE_URL,
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
    const afterImport = await request('/api/books');
    const imported = afterImport.body.find((entry) => entry.barcode === '9781234567898');
    assert.ok(imported, 'imported book should exist');
    assert.strictEqual(imported.coverUrl, LEGACY_ARCHIVE_URL, 'import should preserve provided legacy cover URL');

    // A new source must never keep showing the old locally cached image.
    const replacementUrl = 'https://replacement-cover.invalid/new.png';
    const replacement = await request('/api/books/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ file: buildWorkbookBase64([{
        Titel: 'Herbruikbaar', Auteur: 'Auteur', Barcode: '9781234567889',
        Cover: replacementUrl,
      }]) }),
    });
    assert.strictEqual(replacement.status, 200);
    const afterReplacement = await request('/api/books');
    const changed = afterReplacement.body.find((entry) => entry.id === 'import-existing-cover');
    assert.ok(changed);
    assert.strictEqual(changed.coverUrl, replacementUrl);
    assert.strictEqual(changed.localCoverUrl, '', 'The still-existing previous local image must be invalidated');
    assert.strictEqual(changed.localCoverUrl, '',
      'A changed Excel cover URL must clear the old cached image reference');
    const secondCopy = afterReplacement.body.find((entry) => entry.id === 'import-existing-cover-2');
    assert.ok(secondCopy, 'The second physical copy must still exist');
    assert.strictEqual(secondCopy.coverUrl, replacementUrl,
      'Every copy sharing the original edition cover must use the new source across different barcodes');
    assert.strictEqual(secondCopy.localCoverUrl, '',
      'An old cover cache cannot remain on another copy of the same edition');

  } finally {
    serverProcess.kill('SIGINT');
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  }
}

function runFrontendChecks() {
  const appPath = path.join(__dirname, '..', 'public', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8');
  assert.ok(
    source.includes('const coverUrl = normalizeRenderedCoverUrl(book.localCoverUrl || book.coverUrl);'),
    'createBookCard should normalize cover URL before image assignment'
  );
  assert.ok(
    source.includes('const manualCoverUrl = normalizeRenderedCoverUrl(representative.localCoverUrl || representative.coverUrl);'),
    'populateBookDetail should normalize representative cover URL'
  );
  assert.ok(
    source.includes('const metadataCoverUrl = normalizeRenderedCoverUrl(extractMetadataCoverUrl(metadata));'),
    'populateBookDetail should normalize metadata cover URL'
  );
}

function runRepresentativeChecks() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  function extractBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
      throw new Error(`Kon blok niet vinden tussen ${startMarker} en ${endMarker}`);
    }
    return source.slice(start, end).trim();
  }

  const factory = new Function(
    [
      extractBetween('function normalizeGroupKeyPart(', 'function getBookGroupKey('),
      extractBetween('function getBookGroupKey(', 'function pickRepresentativeBook('),
      extractBetween('function normalizeRenderedCoverUrl(', 'function populateBookDetail('),
      extractBetween('function pickRepresentativeBook(', 'function groupBooksByTitleAuthor('),
      extractBetween('function groupBooksByTitleAuthor(', 'function createBookCard('),
      'return { groupBooksByTitleAuthor };',
    ].join('\n\n')
  );

  const { groupBooksByTitleAuthor } = factory();

  const grouped = groupBooksByTitleAuthor([
    { id: 'empty', title: 'T', author: 'A', metadataIsbn: '', coverUrl: '', description: '' },
    { id: 'legacy', title: 'T', author: 'A', metadataIsbn: '', coverUrl: LEGACY_ARCHIVE_URL, description: '' },
    { id: 'canonical', title: 'T', author: 'A', metadataIsbn: '', coverUrl: CANONICAL_URL, description: '' },
  ]);

  assert.strictEqual(grouped[0].coverUrl, CANONICAL_URL, 'group representative should expose canonical effective cover URL');

  const legacyOnlyGroup = groupBooksByTitleAuthor([
    { id: 'legacy-only', title: 'T2', author: 'A2', metadataIsbn: '', coverUrl: LEGACY_ARCHIVE_URL, description: '' },
  ]);
  assert.strictEqual(
    legacyOnlyGroup[0].coverUrl,
    CANONICAL_URL,
    'legacy-only cover should be normalized to canonical in representative output'
  );
}

function runCleanupScriptChecks() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-cover-cleanup-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, [
    { id: 'legacy', title: 'T', author: 'A', barcode: '1', coverUrl: LEGACY_ARCHIVE_URL, status: 'available' },
    { id: 'google', title: 'T2', author: 'A2', barcode: '2', coverUrl: 'https://books.google.com/x', status: 'available' },
  ]);

  const before = fs.readFileSync(dbPath, 'utf8');
  const dryRunOutput = execFileSync('node', ['scripts/cleanup-legacy-openlibrary-covers.js', `--file=${dbPath}`], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  const afterDryRun = fs.readFileSync(dbPath, 'utf8');
  assert.strictEqual(afterDryRun, before, 'dry run should not mutate db file');
  assert.ok(dryRunOutput.includes('DRY-RUN'));

  const applyOutput = execFileSync(
    'node',
    ['scripts/cleanup-legacy-openlibrary-covers.js', '--apply', `--file=${dbPath}`],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
  );
  assert.ok(applyOutput.includes('APPLY'));
  const rewritten = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert.strictEqual(rewritten.books[0].coverUrl, CANONICAL_URL, 'apply mode should rewrite matching legacy URLs');
  assert.strictEqual(rewritten.books[1].coverUrl, 'https://books.google.com/x', 'apply mode should leave non-matching URLs untouched');
}

async function run() {
  assert.strictEqual(rewriteLegacyOpenLibraryArchiveCoverUrl(LEGACY_ARCHIVE_URL), CANONICAL_URL);
  assert.strictEqual(
    rewriteLegacyOpenLibraryArchiveCoverUrl('https://covers.openlibrary.org/b/id/12345-L.jpg?default=false'),
    'https://covers.openlibrary.org/b/id/12345-L.jpg?default=false'
  );
  assert.strictEqual(
    rewriteLegacyOpenLibraryArchiveCoverUrl('https://books.google.com/books/content?id=abc'),
    'https://books.google.com/books/content?id=abc'
  );
  assert.strictEqual(rewriteLegacyOpenLibraryArchiveCoverUrl(''), '');
  assert.strictEqual(rewriteLegacyOpenLibraryArchiveCoverUrl(null), null);

  await runIntegrationChecks();
  runRepresentativeChecks();
  runFrontendChecks();
  runCleanupScriptChecks();
  console.log('Cover URL pipeline tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
