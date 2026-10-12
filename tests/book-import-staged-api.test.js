'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const PORT = 4047;
const BASE = 'http://127.0.0.1:' + PORT;
const ISBN1 = '9780306406157';
const ISBN2 = '9780439554930';
const hashPassword = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

function fileBase64(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Bibliotheek');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
}

async function call(route, token, body, method = body === undefined ? 'GET' : 'POST') {
  const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + route, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 8000);
    const ready = (data) => {
      if (data.toString().includes('http://localhost:' + PORT)) {
        clearTimeout(timeout);
        child.stdout.off('data', ready);
        resolve();
      }
    };
    child.stdout.on('data', ready);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('Server exited early: ' + code));
    });
  });
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pr3-'));
  const dbPath = path.join(tempDir, 'db.json');
  const db = {
    books: [], students: [], classes: [], folders: [],
    users: [
      { id: 'admin1', name: 'Admin One', username: 'admin1', passwordHash: hashPassword('pass1'), role: 'admin' },
      { id: 'admin2', name: 'Admin Two', username: 'admin2', passwordHash: hashPassword('pass2'), role: 'admin' },
    ], history: [],
  };
  fs.writeFileSync(dbPath, JSON.stringify(db));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath, BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child);
    const login1 = await call('/api/login', null, { username: 'admin1', password: 'pass1' });
    const login2 = await call('/api/login', null, { username: 'admin2', password: 'pass2' });
    assert.strictEqual(login1.status, 200);
    assert.strictEqual(login2.status, 200);
    const token1 = login1.body.token, token2 = login2.body.token;
    const file = fileBase64([
      { Titel: 'Kopie test', Auteur: 'Auteur', 'ISBN-nummer': ISBN1, Barcode: '23456' },
      { Titel: 'Correctie test', Auteur: 'Auteur', 'ISBN-nummer': 'not-an-isbn' },
    ]);
    const denied = await call('/api/admin/book-import-stages', null, { file });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 0);
    const created = await call('/api/admin/book-import-stages', token1, { file, fileName: 'controle.xlsx' });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.ok(id);
    assert.strictEqual(created.body.revision, 1);
    assert.strictEqual(created.body.decisions.summary.readyToApply, false);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 0, 'Preview must never mutate database');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token2)).status, 404);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token1)).status, 200);

    const invalid = await call('/api/admin/book-import-stages/' + id + '/review', token1, {
      revision: 1, acceptWarnings: false, corrections: [{ index: 1, fields: { editionIsbn: 'not-an-isbn' } }],
    });
    assert.strictEqual(invalid.status, 400);
    const corrected = await call('/api/admin/book-import-stages/' + id + '/review', token1, {
      revision: 1, acceptWarnings: true, corrections: [{ index: 1, fields: { editionIsbn: ISBN2 } }],
    });
    assert.strictEqual(corrected.status, 200, JSON.stringify(corrected.body));
    assert.strictEqual(corrected.body.revision, 2);
    assert.strictEqual(corrected.body.decisions.summary.readyToApply, true);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 1, confirm: true })).status, 409);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: false })).status, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 0);
    const applied = await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: true });
    assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));
    assert.strictEqual(applied.body.result.created, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: true })).status, 409);
    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(saved.books.length, 2);
    assert.ok(saved.books.every((book) => book.status === 'available'));
    assert.ok(saved.books.some((book) => book.metadataIsbn === ISBN1 && book.barcode === '23456'));
    assert.ok(saved.books.some((book) => book.metadataIsbn === ISBN2));
    assert.strictEqual(saved.bookImportReports.length, 1);
    assert.strictEqual(saved.bookImportReports[0].rows.length, 2);
    assert.strictEqual(saved.books[0].importInfo.importJobId, applied.body.result.batchId);

    const duplicateStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Kopie test', Auteur: 'Auteur', 'ISBN-nummer': ISBN1 }]),
    });
    assert.strictEqual(duplicateStage.status, 201);
    assert.strictEqual(duplicateStage.body.decisions.rows[0].reason, 'existing_edition_requires_review');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + duplicateStage.body.id + '/apply', token1, {
      revision: 1, confirm: true,
    })).status, 409);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 2);

    const stageWithRace = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Uniek', Auteur: 'Auteur', 'ISBN-nummer': ISBN1, Barcode: '60001' }]),
    });
    assert.strictEqual(stageWithRace.status, 201);
    // This edition already exists, so the stage cannot apply despite having a fresh barcode.
    assert.strictEqual(stageWithRace.body.decisions.summary.readyToApply, false);

    console.log('PR3 staged HTTP preview and single-use apply integration tests passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
