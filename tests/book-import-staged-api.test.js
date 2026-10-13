'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
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

// Send only request headers and a small body prefix, then pause. This
// reproduces the exact overlap where a second import request arrives while
// parseBody() in the first handler is awaiting the rest of its JSON body.
function abortPartialImport(route, token) {
  const req = http.request({
    hostname: '127.0.0.1', port: PORT, path: route, method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': 1000000,
    },
  });
  req.on('error', () => {}); // Expected ECONNRESET after disconnect.
  req.write('{"file":"');
  return req;
}

function pausedImportPost(route, token, payload) {
  const body = JSON.stringify(payload);
  let finish;
  const done = new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: route, method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.write(body.slice(0, 13));
    finish = () => req.end(body.slice(13));
  });
  return { done, finish };
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
    books: [],
    students: [{ id: 'student-match', name: 'Lisa Leerling', username: 'lisa' }],
    classes: [{ id: 'class-match', name: 'Groep A', studentIds: [], teacherIds: [] }],
    folders: [],
    users: [
      { id: 'admin1', name: 'Admin One', username: 'admin1', passwordHash: hashPassword('pass1'), role: 'admin' },
      { id: 'admin2', name: 'Admin Two', username: 'admin2', passwordHash: hashPassword('pass2'), role: 'admin' },
    ], history: [],
    importJobs: [
      { id: 'old-queued', type: 'books_import', createdBy: 'admin1', status: 'queued' },
      { id: 'old-running', type: 'books_import', createdBy: 'admin1', status: 'running' },
    ],
  };
  fs.writeFileSync(dbPath, JSON.stringify(db));
  // Supply deterministic metadata through the server's existing test-only
  // lookup hook; no network or production changes are necessary.
  const metadataHookFile = path.join(tempDir, 'metadata-hook.js');
  const workerHeldMarker = path.join(tempDir, 'worker-held');
  const workerReleaseMarker = path.join(tempDir, 'worker-released');
  fs.writeFileSync(metadataHookFile, `
    const testFs = require('fs');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('http://127.0.0.1:' + process.env.PORT + '/api/books/import')) {
        testFs.writeFileSync(process.env.TEST_WORKER_HELD, 'held');
        for (let i = 0; i < 200 && !testFs.existsSync(process.env.TEST_WORKER_RELEASE); i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      return realFetch(url, options);
    };
    let exactRetryCount = 0;
    let titleRetryCount = 0;
    globalThis.__BOEKENBAAI_MOCK_TITLE_AUTHOR_LOOKUP = async (input) => {
      if (input.title !== 'Herstel via titel') return null;
      titleRetryCount += 1;
      if (titleRetryCount === 1) return null;
      return { found: true, title: 'Herstel via titel', author: 'A Auteur',
        isbn13: '9783333333335', publisher: 'Titel gevonden' };
    };

    globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP = async (isbn) => {
      if (isbn === '9782222222224') {
        exactRetryCount += 1;
        if (exactRetryCount === 1) return { found: false };
        return { found: true, isbn13: isbn, title: 'Herstel via ISBN',
          author: 'A Auteur', publisher: 'ISBN gevonden' };
      }
      if (isbn === '9783333333335') {
        return { found: true, isbn13: isbn, title: 'Herstel via titel',
          author: 'A Auteur', publisher: 'Titel gevonden' };
      }
      return {
      found: true, title: 'Metadata thema boek', author: 'A Auteur',
      authors: ['A Auteur'], isbn13: isbn,
      themes: ['Pesten', 'Nieuw vakgebied'],
      tags: ['bullying'], publisher: 'Metadata uitgever',
      publishedYear: 2018, pageCount: 240, language: 'nl',
      description: 'Metadata beschrijving',
      coverUrl: 'https://example.com/boek.jpg', source: 'test-metadata'
      };
    };
  `);
  const child = spawn(process.execPath, ['--require', metadataHookFile, 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
      TEST_WORKER_HELD: workerHeldMarker, TEST_WORKER_RELEASE: workerReleaseMarker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child);
    const login1 = await call('/api/login', null, { username: 'admin1', password: 'pass1' });
    const login2 = await call('/api/login', null, { username: 'admin2', password: 'pass2' });
    assert.strictEqual(login1.status, 200);
    assert.strictEqual(login2.status, 200);
    const token1 = login1.body.token, token2 = login2.body.token;
    for (const id of ['old-queued', 'old-running']) {
      const interrupted = await call('/api/books/import-jobs/' + id, token1);
      assert.strictEqual(interrupted.status, 200);
      assert.strictEqual(interrupted.body.status, 'interrupted',
        'A server restart must not leave an orphaned queued/running worker');
    }
    // Same administrator account signed in from a second device/session.
    const loginSameAccountAgain = await call('/api/login', null, { username: 'admin1', password: 'pass1' });
    assert.strictEqual(loginSameAccountAgain.status, 200);
    const token1b = loginSameAccountAgain.body.token;
    assert.notStrictEqual(token1, token1b);
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1b)).body.stage, null);
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
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token2)).status, 200);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token1b)).status, 200);
    const activeFromSecondSession = await call('/api/admin/book-import-stages/active', token1b);
    assert.strictEqual(activeFromSecondSession.status, 200);
    assert.strictEqual(activeFromSecondSession.body.stage.id, id);
    assert.strictEqual(activeFromSecondSession.body.stage.revision, 1);
    assert.strictEqual(activeFromSecondSession.body.stage.rows, undefined,
      'The frequent status poll must not resend the full workbook');
    const parallelAttempt = await call('/api/admin/book-import-stages', token1b, {
      file: fileBase64([{ Titel: 'Ander upload', Auteur: 'B', 'ISBN-nummer': ISBN2 }]),
    });
    assert.strictEqual(parallelAttempt.status, 409);
    assert.strictEqual(parallelAttempt.body.error, 'stage_busy');
    assert.strictEqual(parallelAttempt.body.active.id, id);
    const legacyJobWhileShared = await call('/api/books/import-jobs', token1b, { file });
    assert.strictEqual(legacyJobWhileShared.status, 409,
      'Old importer must not start while a shared reviewed stage is active');
    const legacyDirectWhileShared = await call('/api/books/import', token1b, { file });
    assert.strictEqual(legacyDirectWhileShared.status, 409,
      'Direct legacy import must not bypass the single-active-import rule');

    const invalid = await call('/api/admin/book-import-stages/' + id + '/review', token1, {
      revision: 1, acceptWarnings: false, corrections: [{ index: 1, fields: { editionIsbn: 'not-an-isbn' } }],
    });
    assert.strictEqual(invalid.status, 400);
    const corrected = await call('/api/admin/book-import-stages/' + id + '/review', token1, {
      revision: 1, acceptWarnings: true, corrections: [{ index: 1, fields: { editionIsbn: ISBN2 } }],
    });
    assert.strictEqual(corrected.status, 200, JSON.stringify(corrected.body));
    assert.strictEqual(corrected.body.revision, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1b)).body.stage.revision, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token1b)).body.corrections[0].index, 1);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/review', token1b, {
      revision: 1, acceptWarnings: false, corrections: [],
    })).status, 409, 'An older browser cannot overwrite newer reviewed changes');
    assert.strictEqual(corrected.body.decisions.summary.readyToApply, true);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 1, confirm: true })).status, 409);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: false })).status, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 0);
    const applied = await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: true });
    assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));
    assert.strictEqual(applied.body.result.created, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id, token1b)).body.status, 'completed');
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1b)).body.stage, null);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + id + '/apply', token1, { revision: 2, confirm: true })).status, 409);
    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(saved.books.length, 2);
    assert.ok(saved.books.every((book) => book.status === 'available'));
    assert.ok(saved.books.some((book) => book.metadataIsbn === ISBN1 && book.barcode === '23456'));
    assert.ok(saved.books.some((book) => book.metadataIsbn === ISBN2));
    assert.strictEqual(saved.books.find((book) => book.metadataIsbn === ISBN2).barcode, ISBN2,
      'An unlabelled physical copy needs a scan-friendly fallback barcode');
    const isbnBarcodeLookup = await call('/api/books/barcode/' + ISBN2, token1);
    assert.strictEqual(isbnBarcodeLookup.status, 200);
    assert.strictEqual(isbnBarcodeLookup.body.groups[0].totalCopies, 1);
    assert.strictEqual(saved.bookImportReports.length, 1);
    assert.strictEqual(saved.bookImportReports[0].rows.length, 2);
    assert.strictEqual(saved.books[0].importInfo.importJobId, applied.body.result.batchId);
    const copiedMetadataIsbn = saved.books.find((book) => book.metadataIsbn === ISBN1);
    assert.strictEqual(copiedMetadataIsbn.importProvenance?.fieldSources?.metadataIsbn?.sourceType,
      copiedMetadataIsbn.importProvenance?.fieldSources?.editionIsbn?.sourceType,
      'A copied metadata ISBN must inherit the Excel ISBN source attribution');
    assert.strictEqual(copiedMetadataIsbn.importProvenance?.fieldSources?.metadataIsbn?.sourceType, 'excel');
    const correctedIsbnBook = saved.books.find((book) => book.metadataIsbn === ISBN2);
    assert.strictEqual(correctedIsbnBook.importProvenance?.fieldSources?.editionIsbn?.sourceType, 'manual');
    assert.strictEqual(correctedIsbnBook.importProvenance?.fieldSources?.metadataIsbn?.sourceType, 'manual');
    const reportId = applied.body.result.batchId;
    assert.strictEqual((await call('/api/admin/book-import-reports/' + reportId, null)).status, 403);
    const storedReport = await call('/api/admin/book-import-reports/' + reportId, token1);
    assert.strictEqual(storedReport.status, 200);
    assert.strictEqual(storedReport.body.rows.length, 2);
    const reportList = await call('/api/admin/book-import-reports', token2);
    assert.strictEqual(reportList.status, 200);
    assert.strictEqual(reportList.body.reports[0].id, reportId);
    assert.strictEqual(reportList.body.reports[0].rows, undefined, 'Report lists must not disclose raw context');

    const duplicateStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Kopie test', Auteur: 'Auteur', 'ISBN-nummer': ISBN1 }]),
    });
    assert.strictEqual(duplicateStage.status, 201);
    assert.strictEqual(duplicateStage.body.decisions.rows[0].reason, 'existing_edition_requires_review');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + duplicateStage.body.id + '/apply', token1, {
      revision: 1, confirm: true,
    })).status, 409);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + duplicateStage.body.id, token1b)).body.status,
      'failed', 'A rejected apply has already closed the shared stage');
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1)).body.stage, null);

    const stageWithRace = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Uniek', Auteur: 'Auteur', 'ISBN-nummer': ISBN1, Barcode: '60001' }]),
    });
    assert.strictEqual(stageWithRace.status, 201);
    // This edition already exists, so the stage cannot apply despite having a fresh barcode.
    assert.strictEqual(stageWithRace.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + stageWithRace.body.id + '/cancel', token1b, {
      revision: 1,
    })).status, 200);

    // A separate admin may create the same edition after preview. Applying
    // must re-check the latest database rather than trusting stale preview.
    const raceIsbn = '9780140328721';
    const validBeforeRace = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Race test', Auteur: 'Auteur', 'ISBN-nummer': raceIsbn }]),
    });
    assert.strictEqual(validBeforeRace.status, 201);
    assert.strictEqual(validBeforeRace.body.decisions.summary.readyToApply, true);
    const otherAdminCreate = await call('/api/books', token2, {
      title: 'Race test', author: 'Auteur', barcode: '909090', metadataIsbn: raceIsbn,
    });
    assert.strictEqual(otherAdminCreate.status, 201, JSON.stringify(otherAdminCreate.body));
    const staleApply = await call('/api/admin/book-import-stages/' + validBeforeRace.body.id + '/apply', token1, {
      revision: 1, confirm: true,
    });
    assert.strictEqual(staleApply.status, 409);
    assert.strictEqual(staleApply.body.error, 'review_not_ready');
    const afterRace = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterRace.books.filter((book) => book.metadataIsbn === raceIsbn).length, 1,
      'A race must not create a second physical copy');
    assert.strictEqual(afterRace.bookImportReports.length, 1,
      'Rejected apply must not persist an import report');

    // Regression: auth reads a request-scoped database snapshot as soon as
    // headers arrive, but /apply can await the REST of a slow request body.
    // Another admin must be allowed to add a book meanwhile, and completing
    // the original /apply must NOT overwrite that newly saved copy.
    const midBodyIsbn = '9780061120084';
    const pendingStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Tijdens upload', Auteur: 'A Auteur', 'ISBN-nummer': midBodyIsbn }]),
    });
    assert.strictEqual(pendingStage.status, 201);
    assert.strictEqual(pendingStage.body.decisions.summary.readyToApply, true);
    const incompleteBody = JSON.stringify({ revision: 1, confirm: true });
    let finishPendingBody;
    const pendingApply = new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1', port: PORT,
        path: '/api/admin/book-import-stages/' + pendingStage.body.id + '/apply',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token1,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(incompleteBody),
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.write(incompleteBody.slice(0, 12));
      finishPendingBody = () => request.end(incompleteBody.slice(12));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const simultaneousCreate = await call('/api/books', token2, {
      title: 'Tijdens upload', author: 'A Auteur',
      barcode: '626262', metadataIsbn: midBodyIsbn,
    });
    assert.strictEqual(simultaneousCreate.status, 201);
    finishPendingBody();
    const pendingConflict = await pendingApply;
    assert.strictEqual(pendingConflict.status, 409, JSON.stringify(pendingConflict.body));
    assert.strictEqual(pendingConflict.body.error, 'review_not_ready');
    const afterPending = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterPending.books.filter((book) => book.metadataIsbn === midBodyIsbn).length, 1);
    assert.strictEqual(afterPending.books.length, 4, 'Late apply must preserve concurrent new books');
    assert.strictEqual(afterPending.bookImportReports.length, 1);

    const malformed = await call('/api/admin/book-import-stages', token1, {
      file: Buffer.from('definitely not a spreadsheet').toString('base64'),
    });
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.length, 4);

    // School inventory format: separate author columns and the confirmed
    // Makkelijk Lezen + StructuurBB physical-location exception.
    const schoolIsbn = '9780590353427';
    const schoolStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Schoolvoorraad', 'Voornaam schrijver': 'Carry',
        'Achternaam schrijver': 'Slee', 'ISBN-nummer': schoolIsbn,
        'Makkelijk lezen?': 'x', 'Geleend door klas': 'StructuurBB',
      }]),
    });
    assert.strictEqual(schoolStage.status, 201);
    assert.strictEqual(schoolStage.body.rows[0].book.author, 'Carry Slee');
    assert.deepStrictEqual(schoolStage.body.rows[0].context.fixedLocation, {
      status: 'resolved', label: 'SK BB', source: 'ml_class_loan_rule',
    });
    assert.strictEqual(schoolStage.body.decisions.summary.readyToApply, true);
    const schoolApplied = await call('/api/admin/book-import-stages/' + schoolStage.body.id + '/apply', token1, {
      revision: 1, confirm: true,
    });
    assert.strictEqual(schoolApplied.status, 200);
    const finalData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(finalData.books.filter((book) => book.metadataIsbn === schoolIsbn).length, 1);
    assert.strictEqual(finalData.bookImportReports.length, 2);
    assert.strictEqual(finalData.bookImportReports[1].rows[0].context.fixedLocation.label, 'SK BB');
    const schoolCopy = finalData.books.find((book) => book.metadataIsbn === schoolIsbn);
    assert.strictEqual(schoolCopy.fixedLocation, 'SK BB',
      'A confirmed fixed shelf location must survive on the physical book, not only in the report');

    const blockedLocation = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Klascontext', Auteur: 'Auteur', 'ISBN-nummer': '9780747532699',
        Klassen: 'Bovenbouw', 'Aanwezig bieb': 'nee',
      }]),
    });
    assert.strictEqual(blockedLocation.status, 201);
    const acceptedLocationWarnings = await call(
      '/api/admin/book-import-stages/' + blockedLocation.body.id + '/review', token1,
      { revision: 1, acceptWarnings: true, corrections: [] },
    );
    assert.strictEqual(acceptedLocationWarnings.status, 200);
    assert.strictEqual(acceptedLocationWarnings.body.decisions.rows[0].reason, 'location_context_requires_followup');
    assert.strictEqual(acceptedLocationWarnings.body.decisions.summary.readyToApply, false);
    const forbiddenLocationApply = await call('/api/admin/book-import-stages/' + blockedLocation.body.id + '/apply',
      token1, { revision: 2, confirm: true });
    assert.strictEqual(forbiddenLocationApply.status, 409);

    // Reverse race: a normal /api/books mutation starts first, waits for a
    // slow body, then PR3 commits. Finishing that old writer must NOT erase
    // the new import or its audit report.
    const reverseIsbn = '9780451524935';
    const reverseStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Behouden import', Auteur: 'A', 'ISBN-nummer': reverseIsbn }]),
    });
    assert.strictEqual(reverseStage.status, 201);
    assert.strictEqual(reverseStage.body.decisions.summary.readyToApply, true);
    const lateNormalBody = JSON.stringify({
      title: 'Oude schrijfactie', author: 'A',
      barcode: '775522', metadataIsbn: '9780679783268',
    });
    let completeNormalBody;
    const pendingNormalSave = new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/api/books',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token2,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(lateNormalBody),
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.write(lateNormalBody.slice(0, 12));
      completeNormalBody = () => request.end(lateNormalBody.slice(12));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const reverseApply = await call('/api/admin/book-import-stages/' + reverseStage.body.id + '/apply', token1, {
      revision: 1, confirm: true,
    });
    assert.strictEqual(reverseApply.status, 200);
    completeNormalBody();
    const rejectedNormalSave = await pendingNormalSave;
    assert.strictEqual(rejectedNormalSave.status, 409);
    assert.strictEqual(rejectedNormalSave.body.error, 'DATABASE_WRITE_CONFLICT');
    const afterReverse = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.ok(afterReverse.books.some((book) => book.metadataIsbn === reverseIsbn),
      'Import must not be overwritten by an older normal writer');
    assert.ok(!afterReverse.books.some((book) => book.barcode === '775522'));
    assert.strictEqual(afterReverse.bookImportReports.length, 3);

    // Skipped rows must retain enough original identity and diagnostics to
    // explain decisions after temporary staging is discarded.
    const skippedStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([
        { Titel: 'Veilig importeren', Auteur: 'A', 'ISBN-nummer': '9780385490818' },
        { Titel: 'Bewust overgeslagen', Auteur: 'B', 'ISBN-nummer': 'foute-code' },
      ]),
    });
    assert.strictEqual(skippedStage.status, 201);
    const skipReview = await call('/api/admin/book-import-stages/' + skippedStage.body.id + '/review', token1, {
      revision: 1, acceptWarnings: true, corrections: [{ index: 1, skip: true }],
    });
    assert.strictEqual(skipReview.status, 200);
    assert.strictEqual(skipReview.body.decisions.summary.readyToApply, true);
    const skipApply = await call('/api/admin/book-import-stages/' + skippedStage.body.id + '/apply', token1, {
      revision: 2, confirm: true,
    });
    assert.strictEqual(skipApply.status, 200);
    const auditSkipped = skipApply.body.result.report.rows.find((row) => row.status === 'skipped');
    assert.strictEqual(auditSkipped.title, 'Bewust overgeslagen');
    assert.strictEqual(auditSkipped.originalIdentifiers.isbn, 'foute-code');
    assert.ok(auditSkipped.issues.length > 0);
    assert.ok(auditSkipped.provenance && auditSkipped.context);
    const savedSkippedAudit = await call('/api/admin/book-import-reports/' + skipApply.body.result.batchId, token1);
    assert.strictEqual(savedSkippedAudit.status, 200);
    assert.strictEqual(savedSkippedAudit.body.rows.find((row) => row.status === 'skipped').title, 'Bewust overgeslagen');

    // Both directions of the import race: each handler must acquire the
    // SINGLE global admission lock before awaiting the request body.
    const pausedLegacy = pausedImportPost('/api/books/import', token1b, { file: 'invalid-workbook' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const stagedDuringLegacy = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Geblokkeerd', Auteur: 'A', 'ISBN-nummer': '9780451524935' }]),
    });
    assert.strictEqual(stagedDuringLegacy.status, 409);
    assert.strictEqual(stagedDuringLegacy.body.error, 'stage_busy');
    pausedLegacy.finish();
    assert.strictEqual((await pausedLegacy.done).status, 400);

    const pausedLegacyJob = pausedImportPost('/api/books/import-jobs', token1b, { file: 'invalid-workbook' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const stagedDuringJobUpload = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Geblokkeerd 2', Auteur: 'A', 'ISBN-nummer': '9780451524935' }]),
    });
    assert.strictEqual(stagedDuringJobUpload.status, 409);
    pausedLegacyJob.finish();
    assert.strictEqual((await pausedLegacyJob.done).status, 400);

    const pausedStage = pausedImportPost('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Gedeelde start', Auteur: 'A', 'ISBN-nummer': '9780451524935' }]),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const seenWhileUploading = await call('/api/admin/book-import-stages/active', token1b);
    assert.strictEqual(seenWhileUploading.status, 200);
    assert.strictEqual(seenWhileUploading.body.stage.status, 'preparing');
    assert.strictEqual((await call('/api/books/import', token1b, { file: 'invalid-workbook' })).status, 409);
    assert.strictEqual((await call('/api/books/import-jobs', token1b, { file: 'invalid-workbook' })).status, 409);
    pausedStage.finish();
    const stagedAfterUpload = await pausedStage.done;
    assert.strictEqual(stagedAfterUpload.status, 201, JSON.stringify(stagedAfterUpload.body).slice(0, 250));
    assert.strictEqual((await call('/api/admin/book-import-stages/' + stagedAfterUpload.body.id
      + '/cancel', token1b, { revision: 1 })).status, 200);
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1b)).body.stage, null);

    // A school workbook with many valid edited rows must not be rejected
    // merely because the combined correction JSON exceeds the old 400 KB cap.
    const largeSourceRows = Array.from({ length: 130 }, () => ({
      Titel: 'Grote correctiebatch', Auteur: 'A Auteur', 'ISBN-nummer': '9780374533557',
    }));
    const largeStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64(largeSourceRows),
    });
    assert.strictEqual(largeStage.status, 201);
    const largeCorrections = largeSourceRows.map((row, index) => ({
      index, fields: { description: 'Correctietekst '.repeat(225) },
    }));
    assert.ok(JSON.stringify(largeCorrections).length > 400000);
    const checkedLarge = await call('/api/admin/book-import-stages/' + largeStage.body.id + '/review', token1b, {
      revision: 1, acceptWarnings: false, corrections: largeCorrections,
    });
    assert.strictEqual(checkedLarge.status, 200, JSON.stringify(checkedLarge.body).slice(0, 180));
    assert.strictEqual(checkedLarge.body.revision, 2);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + largeStage.body.id + '/cancel', token1b, {
      revision: 2,
    })).status, 200);

    // A terminated connection MUST release the stage and the shared import
    // admission lock. It should never require a server restart.
    for (const route of [
      '/api/admin/book-import-stages',
      '/api/books/import-jobs',
      '/api/books/import',
    ]) {
      const abandoned = abortPartialImport(route, token1);
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (route === '/api/admin/book-import-stages') {
        const activeWhileUploading = await call('/api/admin/book-import-stages/active', token1b);
        assert.strictEqual(activeWhileUploading.body.stage?.status, 'preparing');
      }
      abandoned.destroy();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const usable = await call('/api/admin/book-import-stages', token1b, {
        file: fileBase64([{ Titel: 'Na verbroken upload', Auteur: 'A Auteur',
          'ISBN-nummer': '9780140328721' }]),
      });
      assert.strictEqual(usable.status, 201,
        'Disconnected upload must release the shared lease: ' + route + ': ' + JSON.stringify(usable.body));
      assert.strictEqual((await call('/api/admin/book-import-stages/' + usable.body.id + '/cancel', token1, {
        revision: 1,
      })).status, 200);
    }

    // Students and classes are lookup context, not automatically importable
    // loans. Both preview and re-review must attach the stable matched ID.
    const loanStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([
        { Titel: 'Veilig naast leningen', Auteur: 'A Auteur', 'ISBN-nummer': '9780141439518' },
        { Titel: 'Al bij leerling', Auteur: 'A Auteur', 'ISBN-nummer': '9780747532699',
          'naam leerling': 'Lisa Leerling' },
        { Titel: 'Al bij klas', Auteur: 'A Auteur', 'ISBN-nummer': '9780385490818',
          'Geleend door klas': 'Groep A' },
      ]),
    });
    assert.strictEqual(loanStage.status, 201, JSON.stringify(loanStage.body).slice(0, 900));
    assert.deepStrictEqual(loanStage.body.rows[1].context.studentLoan, {
      status: 'matched', id: 'student-match', name: 'Lisa Leerling',
    });
    assert.deepStrictEqual(loanStage.body.rows[2].context.classLoan, {
      status: 'matched', id: 'class-match', name: 'Groep A',
    });
    const loanReview = await call('/api/admin/book-import-stages/' + loanStage.body.id + '/review', token1b, {
      revision: 1, acceptWarnings: true,
      corrections: [{ index: 1, skip: true }, { index: 2, skip: true }],
    });
    assert.strictEqual(loanReview.status, 200);
    const loanApplied = await call('/api/admin/book-import-stages/' + loanStage.body.id + '/apply', token1, {
      revision: 2, confirm: true,
    });
    assert.strictEqual(loanApplied.status, 200);
    assert.strictEqual(loanApplied.body.result.report.rows[1].context.studentLoan.id, 'student-match');
    assert.strictEqual(loanApplied.body.result.report.rows[2].context.classLoan.id, 'class-match');

    // Metadata-only themes must survive both the stored JSON and the normal
    // /api/books listing, which re-runs ensureBookShape.
    const themeIsbn = '9780679783268';
    const themeStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Metadata thema boek', Auteur: 'A Auteur',
        'ISBN-nummer': themeIsbn }]),
      enrichIsbn: true,
    });
    assert.strictEqual(themeStage.status, 201, JSON.stringify(themeStage.body).slice(0, 950));
    assert.deepStrictEqual(themeStage.body.rows[0].book.themes, ['Pesten', 'Nieuw vakgebied']);
    const themeReview = await call('/api/admin/book-import-stages/' + themeStage.body.id + '/review', token1b, {
      revision: 1, acceptWarnings: true, corrections: [],
    });
    assert.strictEqual(themeReview.status, 200, JSON.stringify(themeReview.body).slice(0, 400));
    assert.strictEqual(themeReview.body.decisions.summary.readyToApply, true);
    const themeApplied = await call('/api/admin/book-import-stages/' + themeStage.body.id + '/apply', token1, {
      revision: 2, confirm: true,
    });
    assert.strictEqual(themeApplied.status, 200, JSON.stringify(themeApplied.body).slice(0, 400));
    const storedThemeBook = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === themeIsbn);
    assert.deepStrictEqual(storedThemeBook.importedThemes, ['Pesten', 'Nieuw vakgebied']);
    assert.deepStrictEqual(storedThemeBook.themes, ['Pesten', 'Nieuw vakgebied']);
    const rereadThemes = await call('/api/books', token1);
    assert.strictEqual(rereadThemes.status, 200);
    const listedThemeBook = (rereadThemes.body.books || rereadThemes.body)
      .find((book) => book.metadataIsbn === themeIsbn);
    assert.deepStrictEqual(listedThemeBook.themes, ['Pesten', 'Nieuw vakgebied']);

    // Deleting metadata-proposed themes in the review must be respected
    // even with ISBN enrichment still enabled for other missing fields.
    const clearedThemeIsbn = '9780140449136';
    const clearedThemeStage = await call('/api/admin/book-import-stages', token1b, {
      file: fileBase64([{ Titel: 'Metadata thema boek', Auteur: 'A Auteur',
        'ISBN-nummer': clearedThemeIsbn }]),
      enrichIsbn: true,
    });
    assert.strictEqual(clearedThemeStage.status, 201);
    assert.deepStrictEqual(clearedThemeStage.body.rows[0].book.themes, ['Pesten', 'Nieuw vakgebied']);
    const explicitClear = await call('/api/admin/book-import-stages/' + clearedThemeStage.body.id
      + '/review', token1, {
      revision: 1, acceptWarnings: false, corrections: [{ index: 0, fields: { themes: '   ' } }],
    });
    assert.strictEqual(explicitClear.status, 200, JSON.stringify(explicitClear.body).slice(0, 600));
    assert.deepStrictEqual(explicitClear.body.rows[0].book.themes, [],
      'Cleared review themes must not be immediately repopulated by metadata');
    assert.strictEqual(explicitClear.body.rows[0].provenance.themes.source, 'manual');
    const clearedConfirmed = await call('/api/admin/book-import-stages/' + clearedThemeStage.body.id
      + '/review', token1, {
      revision: 2, acceptWarnings: true, corrections: [{ index: 0, fields: { themes: '   ' } }],
    });
    assert.strictEqual(clearedConfirmed.status, 200);
    assert.strictEqual(clearedConfirmed.body.decisions.summary.readyToApply, true);
    const appliedClear = await call('/api/admin/book-import-stages/' + clearedThemeStage.body.id
      + '/apply', token1, { revision: 3, confirm: true });
    assert.strictEqual(appliedClear.status, 200);
    const persistCleared = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === clearedThemeIsbn);
    assert.deepStrictEqual(persistCleared.importedThemes, []);
    assert.strictEqual(persistCleared.themesCleared, true);
    assert.deepStrictEqual(persistCleared.themes, [],
      'Explicitly cleared themes must remain absent despite derived metadata tags');


    // Explicit clears outrank optional metadata at preview, apply and reload.
    const emptyMetadataIsbn = '9781234567897';
    const emptyMetadataStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Metadata thema boek', Auteur: 'A Auteur',
        'ISBN-nummer': emptyMetadataIsbn }]),
      enrichIsbn: true,
    });
    assert.strictEqual(emptyMetadataStage.status, 201);
    assert.strictEqual(emptyMetadataStage.body.rows[0].book.description, 'Metadata beschrijving');
    const emptyMetadataFields = {
      tags: ' ', description: ' ', publisher: '', language: ' ',
      coverUrl: ' ', publishedYear: ' ', pageCount: ' ',
    };
    const clearedMetadataReview = await call(
      '/api/admin/book-import-stages/' + emptyMetadataStage.body.id + '/review', token1, {
        revision: 1, acceptWarnings: true,
        corrections: [{ index: 0, fields: emptyMetadataFields }],
      });
    assert.strictEqual(clearedMetadataReview.status, 200,
      JSON.stringify(clearedMetadataReview.body).slice(0, 600));
    const previewBook = clearedMetadataReview.body.rows[0].book;
    for (const field of ['description', 'publisher', 'language', 'coverUrl']) {
      assert.strictEqual(previewBook[field], '', 'Preview retained cleared ' + field);
    }
    assert.deepStrictEqual(previewBook.tags, []);
    assert.strictEqual(previewBook.publishedYear, null);
    assert.strictEqual(previewBook.pageCount, null);
    const appliedMetadataClear = await call(
      '/api/admin/book-import-stages/' + emptyMetadataStage.body.id + '/apply',
      token1, { revision: 2, confirm: true });
    assert.strictEqual(appliedMetadataClear.status, 200,
      JSON.stringify(appliedMetadataClear.body).slice(0, 500));
    const persistedMetadata = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === emptyMetadataIsbn);
    assert.ok(persistedMetadata);
    const rereadAfterClear = await call('/api/books', token1);
    assert.strictEqual(rereadAfterClear.status, 200);
    const reloadedMetadata = (rereadAfterClear.body.books || rereadAfterClear.body)
      .find((book) => book.metadataIsbn === emptyMetadataIsbn);
    for (const field of ['description', 'publisher', 'language', 'coverUrl']) {
      assert.strictEqual(persistedMetadata[field], '', 'Persisted field restored: ' + field);
      assert.strictEqual(reloadedMetadata[field], '', 'Reloaded field restored: ' + field);
    }
    assert.deepStrictEqual(persistedMetadata.tags, []);
    assert.strictEqual(persistedMetadata.importProvenance.fieldSources.description.sourceType, 'manual');
    assert.strictEqual(persistedMetadata.importProvenance.fieldSources.publisher.sourceType, 'manual');
    assert.strictEqual(persistedMetadata.importProvenance.fieldSources.tags.sourceType, 'manual');
    assert.deepStrictEqual(reloadedMetadata.tags, []);
    assert.ok(!persistedMetadata.publishedYear && !reloadedMetadata.publishedYear);
    assert.ok(!persistedMetadata.pageCount && !reloadedMetadata.pageCount);


    // One transient missing lookup should not persist through every re-review.
    const retryIsbnStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Herstel via ISBN', Auteur: 'A Auteur',
        'ISBN-nummer': '9782222222224' }]), enrichIsbn: true,
    });
    assert.strictEqual(retryIsbnStage.status, 201);
    assert.strictEqual(retryIsbnStage.body.rows[0].book.publisher, '');
    const recoveredExact = await call(
      '/api/admin/book-import-stages/' + retryIsbnStage.body.id + '/review', token1, {
        revision: 1, corrections: [], acceptWarnings: true,
      });
    assert.strictEqual(recoveredExact.status, 200);
    assert.strictEqual(recoveredExact.body.rows[0].book.publisher, 'ISBN gevonden');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + retryIsbnStage.body.id
      + '/cancel', token1, { revision: 2 })).status, 200);

    const retryTitleStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Herstel via titel', Auteur: 'A Auteur' }]), enrichIsbn: true,
    });
    assert.strictEqual(retryTitleStage.status, 201);
    assert.strictEqual(retryTitleStage.body.decisions.summary.readyToApply, false);
    const recoveredTitle = await call(
      '/api/admin/book-import-stages/' + retryTitleStage.body.id + '/review', token1, {
        revision: 1, corrections: [], acceptWarnings: true,
      });
    assert.strictEqual(recoveredTitle.status, 200);
    assert.strictEqual(recoveredTitle.body.rows[0].book.editionIsbn, '9783333333335');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + retryTitleStage.body.id
      + '/cancel', token1, { revision: 2 })).status, 200);

    // The browser knows the import job ID and bearer token, but must not
    // impersonate the single trusted internal worker.
    const heldWorkbook = fileBase64([{ Titel: 'Legacy worker', Auteur: 'A Auteur',
      Barcode: '99663322' }]);
    const heldJob = await call('/api/books/import-jobs', token1, {
      file: heldWorkbook, fileName: 'legacy-worker-test.xlsx',
    });
    assert.strictEqual(heldJob.status, 202);
    try {
      let held = false;
      for (let i = 0; i < 100; i += 1) {
        if (fs.existsSync(workerHeldMarker)) { held = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(held, true, 'Legacy worker must reach the held handoff');
      const forged = await fetch(BASE + '/api/books/import', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token1,
          'Content-Type': 'application/json',
          'X-Import-Job-Id': heldJob.body.jobId,
        },
        body: JSON.stringify({ file: fileBase64([{
          Titel: 'Forged import', Auteur: 'A Auteur', Barcode: '99991155',
        }]) }),
      });
      assert.strictEqual(forged.status, 409, 'Browser cannot borrow internal job lease');
      assert.strictEqual((await forged.json()).error, 'stage_busy');
    } finally {
      fs.writeFileSync(workerReleaseMarker, 'release');
    }
    let jobFinal = null;
    for (let i = 0; i < 120; i += 1) {
      const response = await call('/api/books/import-jobs/' + heldJob.body.jobId, token1);
      if (['completed', 'failed'].includes(response.body.status)) {
        jobFinal = response.body; break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.strictEqual(jobFinal?.status, 'completed', 'Original worker must still finish');
    const afterHandoff = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterHandoff.books.filter((b) => b.barcode === '99663322').length, 1);
    assert.strictEqual(afterHandoff.books.filter((b) => b.barcode === '99991155').length, 0);


    // The reviewed Excel preview is a contract. An approved freeform theme
    // must survive actual persistence, book listings, and the next load.
    const freeformIsbn = '9781234567002';
    const freeformStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Vrije thema import', Auteur: 'A Auteur',
        'ISBN-nummer': freeformIsbn, "Thema's": 'Pesten; Nieuw vakgebied' }]),
    });
    assert.strictEqual(freeformStage.status, 201, JSON.stringify(freeformStage.body).slice(0, 400));
    assert.deepStrictEqual(freeformStage.body.rows[0].book.themes, ['Pesten', 'Nieuw vakgebied']);
    const adjustedFreeform = await call('/api/admin/book-import-stages/' + freeformStage.body.id
      + '/review', token1b, {
      revision: 1, acceptWarnings: true,
      corrections: [{ index: 0, fields: { themes: 'Pesten; Nieuw vakgebied; Extra onderwerp' } }],
    });
    assert.strictEqual(adjustedFreeform.status, 200);
    assert.deepStrictEqual(adjustedFreeform.body.rows[0].book.themes,
      ['Pesten', 'Nieuw vakgebied', 'Extra onderwerp']);
    assert.strictEqual(adjustedFreeform.body.rows[0].provenance.manualThemes.source, 'manual');
    assert.strictEqual(adjustedFreeform.body.rows[0].provenance.themes.source, 'manual');
    const appliedFreeform = await call('/api/admin/book-import-stages/' + freeformStage.body.id
      + '/apply', token1, { revision: 2, confirm: true });
    assert.strictEqual(appliedFreeform.status, 200, JSON.stringify(appliedFreeform.body).slice(0, 300));
    const storedFreeform = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === freeformIsbn);
    assert.ok(storedFreeform);
    assert.deepStrictEqual(storedFreeform.themes, adjustedFreeform.body.rows[0].book.themes,
      'The actual library must match the reviewed theme list');
    assert.deepStrictEqual(storedFreeform.importedThemes, adjustedFreeform.body.rows[0].book.themes);
    const loadedFreeform = await call('/api/books', token1);
    assert.deepStrictEqual((loadedFreeform.body.books || loadedFreeform.body)
      .find((book) => book.metadataIsbn === freeformIsbn).themes, adjustedFreeform.body.rows[0].book.themes);

    // Changes to the library after preview must appear at the next review,
    // rather than allowing a stale "ready" badge for an existing ISBN.
    const afterPreviewIsbn = '9781234567019';
    const beforeAddition = await call('/api/admin/book-import-stages', token1b, {
      file: fileBase64([{ Titel: 'Reeds later toegevoegd', Auteur: 'A Auteur',
        'ISBN-nummer': afterPreviewIsbn }]),
    });
    assert.strictEqual(beforeAddition.status, 201);
    assert.strictEqual(beforeAddition.body.decisions.summary.readyToApply, true);
    // Leave the review request waiting on its body while another admin adds
    // the matching ISBN. The review handler must refresh its earlier auth DB.
    const pausedReview = pausedImportPost(
      '/api/admin/book-import-stages/' + beforeAddition.body.id + '/review',
      token1, { revision: 1, acceptWarnings: true, corrections: [] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const addedDuringPreview = await call('/api/books', token2, {
      title: 'Reeds later toegevoegd', author: 'A Auteur',
      barcode: '88119922', metadataIsbn: afterPreviewIsbn,
    });
    assert.strictEqual(addedDuringPreview.status, 201);
    pausedReview.finish();
    const recheckedCollection = await pausedReview.done;
    assert.strictEqual(recheckedCollection.status, 200);
    assert.strictEqual(recheckedCollection.body.decisions.rows[0].reason,
      'existing_edition_requires_review');
    assert.strictEqual(recheckedCollection.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + beforeAddition.body.id
      + '/cancel', token1, { revision: 2 })).status, 200);


    // Initial upload may overlap an ordinary admin book creation.
    // Preview decisions must use the collection AFTER receiving the upload.
    const firstUploadIsbn = '9781234567026';
    const delayedInitialUpload = pausedImportPost('/api/admin/book-import-stages', token1, {
      file: fileBase64([{ Titel: 'Tijdens upload', Auteur: 'A Auteur',
        'ISBN-nummer': firstUploadIsbn }]),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const insertedDuringUpload = await call('/api/books', token2, {
      title: 'Tijdens upload', author: 'A Auteur',
      barcode: '84119002', metadataIsbn: firstUploadIsbn,
    });
    assert.strictEqual(insertedDuringUpload.status, 201);
    delayedInitialUpload.finish();
    const initialAfterInsert = await delayedInitialUpload.done;
    assert.strictEqual(initialAfterInsert.status, 201);
    assert.strictEqual(initialAfterInsert.body.decisions.rows[0].reason,
      'existing_edition_requires_review');
    assert.strictEqual(initialAfterInsert.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + initialAfterInsert.body.id
      + '/cancel', token1, { revision: 1 })).status, 200);

    // An approved multilingual Excel value must remain identical after apply
    // and after fetching the book again.
    const multipleLanguagesIsbn = '9781234567033';
    const languageStage = await call('/api/admin/book-import-stages', token1b, {
      file: fileBase64([{ Titel: 'Meertalig boek', Auteur: 'A Auteur',
        'ISBN-nummer': multipleLanguagesIsbn, Taal: 'Nederlands / Engels' }]),
    });
    assert.strictEqual(languageStage.status, 201);
    assert.strictEqual(languageStage.body.rows[0].book.language, 'Nederlands / Engels');
    const languageApplied = await call('/api/admin/book-import-stages/' + languageStage.body.id
      + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(languageApplied.status, 200, JSON.stringify(languageApplied.body).slice(0, 300));
    const persistedMultilingual = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === multipleLanguagesIsbn);
    assert.strictEqual(persistedMultilingual.language, 'Nederlands / Engels');
    const listedMultilingual = await call('/api/books', token1);
    assert.strictEqual((listedMultilingual.body.books || listedMultilingual.body)
      .find((book) => book.metadataIsbn === multipleLanguagesIsbn).language, 'Nederlands / Engels');

    // Tag-derived themes must be visible BEFORE confirmation and exactly
    // match what is saved. An explicit administrator clear must still win.
    const tagDerivedIsbn = '9781234567040';
    const clearedDerivedIsbn = '9781234567057';
    const taggedStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([
        { Titel: 'Tag thema', Auteur: 'A Auteur', 'ISBN-nummer': tagDerivedIsbn,
          Tags: 'fantasy fiction' },
        { Titel: 'Tag thema verwijderen', Auteur: 'A Auteur', 'ISBN-nummer': clearedDerivedIsbn,
          Tags: 'fantasy fiction' },
      ]),
    });
    assert.strictEqual(taggedStage.status, 201, JSON.stringify(taggedStage.body).slice(0, 400));
    assert.deepStrictEqual(taggedStage.body.rows[0].book.themes, ['Fantasy'],
      'Tag-derived themes must be visible in the initial preview');
    assert.strictEqual(taggedStage.body.rows[0].provenance.themes.source, 'derived');
    const clearedTagReview = await call('/api/admin/book-import-stages/' + taggedStage.body.id
      + '/review', token1b, {
      revision: 1, acceptWarnings: true,
      corrections: [{ index: 1, fields: { themes: '' } }],
    });
    assert.strictEqual(clearedTagReview.status, 200);
    assert.deepStrictEqual(clearedTagReview.body.rows[0].book.themes, ['Fantasy']);
    assert.deepStrictEqual(clearedTagReview.body.rows[1].book.themes, [],
      'An explicit empty theme correction must suppress automatic tag derivation');
    assert.strictEqual(clearedTagReview.body.decisions.summary.readyToApply, true);
    const appliedTagThemes = await call('/api/admin/book-import-stages/' + taggedStage.body.id
      + '/apply', token1, { revision: 2, confirm: true });
    assert.strictEqual(appliedTagThemes.status, 200);
    const tagDbBooks = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books;
    assert.deepStrictEqual(tagDbBooks.find((book) => book.metadataIsbn === tagDerivedIsbn).themes,
      taggedStage.body.rows[0].book.themes, 'Stored themes must equal the approved preview');
    assert.deepStrictEqual(tagDbBooks.find((book) => book.metadataIsbn === clearedDerivedIsbn).themes,
      clearedTagReview.body.rows[1].book.themes);
    const tagsOnBooksEndpoint = await call('/api/books', token1);
    assert.deepStrictEqual((tagsOnBooksEndpoint.body.books || tagsOnBooksEndpoint.body)
      .find((book) => book.metadataIsbn === tagDerivedIsbn).themes, ['Fantasy']);

    // PR4 inventory sync uses desired TOTAL quantities, counts checked-out
    // copies, and never overwrites/removes any existing physical book.
    const syncIsbn = '9781234567101';
    const initialInventory = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
        'ISBN-nummer': syncIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(initialInventory.status, 201, JSON.stringify(initialInventory.body).slice(0, 350));
    assert.strictEqual(initialInventory.body.mode, 'inventory_sync');
    assert.strictEqual(initialInventory.body.decisions.summary.addCopies, 1);
    assert.strictEqual(initialInventory.body.decisions.summary.readyToApply, true);
    const firstSync = await call('/api/admin/book-import-stages/' + initialInventory.body.id
      + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(firstSync.status, 200, JSON.stringify(firstSync.body).slice(0, 350));
    assert.strictEqual(firstSync.body.result.created, 1);
    assert.strictEqual(firstSync.body.result.removed, 0);
    assert.strictEqual(firstSync.body.result.report.mode, 'inventory_sync');
    const firstInventoryDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const firstPhysical = firstInventoryDb.books.find((item) => item.metadataIsbn === syncIsbn);
    assert.ok(firstPhysical?.id);
    // Simulate an active school loan with a durable history event.
    firstPhysical.status = 'borrowed';
    firstPhysical.borrowedBy = 'student-match';
    firstPhysical.borrowedAt = '2026-10-10T10:00:00Z';
    firstPhysical.loanId = 'active-loan-secret';
    firstPhysical.dueDate = '2026-11-30';
    firstInventoryDb.students[0].borrowedBooks = [firstPhysical.id];
    firstInventoryDb.history.unshift({ id: 'loan-sync-regression', type: 'check_out',
      bookId: firstPhysical.id, studentId: 'student-match', timestamp: '2026-10-13T16:00:00Z' });
    fs.writeFileSync(dbPath, JSON.stringify(firstInventoryDb));

    const sameCount = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
        'ISBN-nummer': syncIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(sameCount.status, 201);
    assert.strictEqual(sameCount.body.decisions.rows[0].action, 'unchanged');
    assert.strictEqual(sameCount.body.decisions.rows[0].borrowedCopies, 1);
    assert.strictEqual(sameCount.body.decisions.summary.addCopies, 0);
    assert.strictEqual(sameCount.body.decisions.summary.readyToApply, true);
    const noChangeSync = await call('/api/admin/book-import-stages/' + sameCount.body.id
      + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(noChangeSync.status, 200, 'No-change reconciliations must be auditable');
    assert.strictEqual(noChangeSync.body.result.created, 0);
    assert.strictEqual(noChangeSync.body.result.removed, 0);
    assert.strictEqual(noChangeSync.body.result.report.rows[0].status, 'unchanged');

    const addStock = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
        'ISBN-nummer': syncIsbn, Aantal: 2 }]),
    });
    assert.strictEqual(addStock.status, 201);
    assert.strictEqual(addStock.body.decisions.summary.addCopies, 1);
    assert.strictEqual(addStock.body.decisions.rows[0].existingCopies, 1);
    assert.strictEqual(addStock.body.decisions.rows[0].borrowedCopies, 1);
    const secondSync = await call('/api/admin/book-import-stages/' + addStock.body.id
      + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(secondSync.status, 200, JSON.stringify(secondSync.body).slice(0, 350));
    assert.strictEqual(secondSync.body.result.created, 1);
    const afterStock = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const syncCopies = afterStock.books.filter((item) => item.metadataIsbn === syncIsbn);
    assert.strictEqual(syncCopies.length, 2, 'Reupload must reconcile total stock without duplicates');
    const retainedLoan = syncCopies.find((item) => item.id === firstPhysical.id);
    assert.strictEqual(retainedLoan.status, 'borrowed');
    assert.strictEqual(retainedLoan.borrowedBy, 'student-match');
    assert.strictEqual(retainedLoan.dueDate, '2026-11-30');
    assert.strictEqual(syncCopies.filter((item) => item.status === 'available').length, 1);
    const addedAvailable = syncCopies.find((item) => item.id !== firstPhysical.id);
    assert.strictEqual(addedAvailable.borrowedBy, null);
    assert.strictEqual(addedAvailable.borrowedAt, null,
      'New physical copies must have an empty normalized loan date, never inherit a prior loan');
    assert.strictEqual(addedAvailable.borrowedByClassId, null,
      'A new copy must not inherit a class borrower from an old physical edition');
    assert.strictEqual(addedAvailable.loanId, undefined);
    assert.strictEqual(addedAvailable.title, 'Synchronisatieboek');
    assert.ok(afterStock.history.some((item) => item.id === 'loan-sync-regression'),
      'Inventory reconciliation must retain the existing loan event');
    assert.ok(afterStock.students[0].borrowedBooks.includes(firstPhysical.id));

    const lessStock = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
        'ISBN-nummer': syncIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(lessStock.status, 201);
    assert.strictEqual(lessStock.body.decisions.rows[0].reason, 'reduction_requires_manual_review');
    assert.strictEqual(lessStock.body.decisions.summary.readyToApply, false);
    const refusedShrink = await call('/api/admin/book-import-stages/' + lessStock.body.id
      + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(refusedShrink.status, 409);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .filter((item) => item.metadataIsbn === syncIsbn).length, 2,
    'A smaller Excel count must never silently remove a library copy');

    // PR4: a lower Excel quantity can be explicitly acknowledged without
    // deleting stock, losing borrower information or blocking all other work.
    const retainStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
        'ISBN-nummer': syncIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(retainStage.status, 201);
    assert.strictEqual(retainStage.body.decisions.summary.readyToApply, false);
    const invalidChoice = await call('/api/admin/book-import-stages/' + retainStage.body.id
      + '/review', token1b, { revision: 1, acceptWarnings: true, corrections: [],
        inventoryResolutions: [{ isbn: syncIsbn, action: 'remove_everything' }] });
    assert.strictEqual(invalidChoice.status, 400);
    assert.strictEqual(invalidChoice.body.error, 'invalid_sync_resolutions');
    const unknownChoice = await call('/api/admin/book-import-stages/' + retainStage.body.id
      + '/review', token1b, { revision: 1, acceptWarnings: true, corrections: [],
        inventoryResolutions: [{ isbn: '9781234567118', action: 'keep_existing' }] });
    assert.strictEqual(unknownChoice.status, 400);
    assert.strictEqual(unknownChoice.body.error, 'unknown_sync_resolution');
    const keepReview = await call('/api/admin/book-import-stages/' + retainStage.body.id
      + '/review', token1b, { revision: 1, acceptWarnings: true, corrections: [],
        inventoryResolutions: [{ isbn: syncIsbn, action: 'keep_existing' }] });
    assert.strictEqual(keepReview.status, 200, JSON.stringify(keepReview.body).slice(0, 400));
    assert.strictEqual(keepReview.body.revision, 2);
    assert.strictEqual(keepReview.body.decisions.rows[0].action, 'kept_existing');
    assert.strictEqual(keepReview.body.decisions.summary.readyToApply, true);
    assert.deepStrictEqual((await call('/api/admin/book-import-stages/'
      + retainStage.body.id, token1)).body.inventoryResolutions,
    [{ isbn: syncIsbn, action: 'keep_existing' }]);
    const retainedStockSync = await call('/api/admin/book-import-stages/' + retainStage.body.id
      + '/apply', token1, { revision: 2, confirm: true });
    assert.strictEqual(retainedStockSync.status, 200);
    assert.strictEqual(retainedStockSync.body.result.created, 0);
    assert.strictEqual(retainedStockSync.body.result.removed, 0);
    assert.strictEqual(retainedStockSync.body.result.retainedEditions, 1);
    assert.deepStrictEqual(retainedStockSync.body.result.report.inventoryResolutions,
      [{ isbn: syncIsbn, action: 'keep_existing' }]);
    assert.strictEqual(retainedStockSync.body.result.report.rows[0].status, 'kept_existing');
    const safeDbAfterRetention = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(safeDbAfterRetention.books.filter((book) => book.metadataIsbn === syncIsbn).length, 2);
    assert.strictEqual(safeDbAfterRetention.books.find((book) =>
      book.id === firstPhysical.id).borrowedBy, 'student-match');
    assert.ok(safeDbAfterRetention.history.some((event) => event.id === 'loan-sync-regression'));

    // A forged keep-existing resolution MUST NOT override student/class loan
    // contexts, even when the same workbook includes safely addable stock.
    const loanBlockStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([
        { Titel: 'Synchronisatieboek', Auteur: 'A Auteur',
          'ISBN-nummer': syncIsbn, Aantal: 1, 'naam leerling': 'Lisa Leerling' },
        { Titel: 'Andere nieuwe voorraad', Auteur: 'A Auteur',
          'ISBN-nummer': '9781234567217', Aantal: 1 },
      ]),
    });
    assert.strictEqual(loanBlockStage.status, 201, JSON.stringify(loanBlockStage.body).slice(0, 600));
    assert.strictEqual(loanBlockStage.body.decisions.summary.addCopies, 1);
    assert.strictEqual(loanBlockStage.body.decisions.rows[0].reason,
      'loan_requires_physical_copy_match',
      'A borrowed ISBN with several indistinguishable copies must still be blocked');
    assert.strictEqual(loanBlockStage.body.decisions.rows[0].canKeepExisting, false);
    assert.strictEqual(loanBlockStage.body.decisions.summary.readyToApply, false);
    const forgedRetention = await call('/api/admin/book-import-stages/' + loanBlockStage.body.id
      + '/review', token1b, { revision: 1, acceptWarnings: true, corrections: [],
        inventoryResolutions: [{ isbn: syncIsbn, action: 'keep_existing' }] });
    assert.strictEqual(forgedRetention.status, 400,
      'Inventory choice must never bypass an unresolved student loan');
    assert.strictEqual(forgedRetention.body.error, 'invalid_sync_resolution_reason');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + loanBlockStage.body.id
      + '/apply', token1, { revision: 1, confirm: true })).status, 409);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.some((book) =>
      book.metadataIsbn === '9781234567217'), false,
    'Unresolved loan in another Excel row must block applying the whole reviewed batch');
    assert.strictEqual((await call('/api/admin/book-import-stages/' + loanBlockStage.body.id
      + '/cancel', token1b, { revision: 1 })).status, 409,
      'The rejected unsafe apply closes its single-use stage');

    // Concurrent book creation after preview invalidates the checked plan.
    const syncRaceIsbn = '9781234567118';
    const raceSync = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Bijgewerkte voorraad', Auteur: 'A Auteur',
        'ISBN-nummer': syncRaceIsbn, Aantal: 2 }]),
    });
    assert.strictEqual(raceSync.status, 201);
    assert.strictEqual(raceSync.body.decisions.summary.addCopies, 2);
    const concurrentBook = await call('/api/books', token2, {
      title: 'Bijgewerkte voorraad', author: 'A Auteur',
      barcode: '77661122', metadataIsbn: syncRaceIsbn,
    });
    assert.strictEqual(concurrentBook.status, 201);
    const staleInventoryApply = await call('/api/admin/book-import-stages/' + raceSync.body.id
      + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(staleInventoryApply.status, 409);
    assert.strictEqual(staleInventoryApply.body.error, 'inventory_preview_stale');
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .filter((item) => item.metadataIsbn === syncRaceIsbn).length, 1);
    assert.strictEqual((await call('/api/admin/book-import-stages/active', token1)).body.stage, null);

    // Existing metadata is NEVER an implicit template for newly added copies.
    // Approved Excel values must match storage; existing physical copies stay
    // untouched even when someone updates spreadsheet descriptions or tags.
    const reviewedMetadataIsbn = '9781234567125';
    const metadataBase = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Metadata controle', Auteur: 'A Auteur',
        'ISBN-nummer': reviewedMetadataIsbn, Aantal: 1,
        Beschrijving: 'Oude beschrijving', Tags: 'adventure stories' }]),
    });
    assert.strictEqual(metadataBase.status, 201);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + metadataBase.body.id
      + '/apply', token1, { revision: 1, confirm: true })).status, 200);
    const metadataBefore = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((book) => book.metadataIsbn === reviewedMetadataIsbn);
    assert.strictEqual(metadataBefore.description, 'Oude beschrijving');
    const metadataIncrease = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Metadata controle', Auteur: 'A Auteur',
        'ISBN-nummer': reviewedMetadataIsbn, Aantal: 2,
        Beschrijving: 'Nieuwe goedgekeurde beschrijving', Tags: 'fantasy fiction' }]),
    });
    assert.strictEqual(metadataIncrease.status, 201);
    assert.strictEqual(metadataIncrease.body.decisions.summary.addCopies, 1);
    const previewedThemes = metadataIncrease.body.rows[0].book.themes;
    const metadataIncreaseApplied = await call('/api/admin/book-import-stages/'
      + metadataIncrease.body.id + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(metadataIncreaseApplied.status, 200);
    const metadataAfter = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .filter((book) => book.metadataIsbn === reviewedMetadataIsbn);
    assert.strictEqual(metadataAfter.length, 2);
    assert.strictEqual(metadataAfter.find((book) => book.id === metadataBefore.id).description,
      'Oude beschrijving', 'Existing copies are never silently overwritten');
    const newMetadataCopy = metadataAfter.find((book) => book.id !== metadataBefore.id);
    assert.strictEqual(newMetadataCopy.description, 'Nieuwe goedgekeurde beschrijving');
    assert.deepStrictEqual(newMetadataCopy.themes, previewedThemes,
      'New physical book must match its reviewed themes');
    assert.deepStrictEqual(newMetadataCopy.tags, ['fantasy fiction']);

    // Repeated ISBN rows may create distinct new copies; every worksheet row
    // must be written to the report once, including combined barcode rows.
    const distinctBarcodeIsbn = '9781234567132';
    const multiRowStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([
        { Titel: 'Dubbele ISBN rijen', Auteur: 'A Auteur',
          'ISBN-nummer': distinctBarcodeIsbn, Aantal: 1 },
        { Titel: 'Dubbele ISBN rijen', Auteur: 'A Auteur',
          'ISBN-nummer': distinctBarcodeIsbn, Aantal: 1, Barcode: '79446655' },
      ]),
    });
    assert.strictEqual(multiRowStage.status, 201);
    assert.strictEqual(multiRowStage.body.decisions.summary.addCopies, 2);
    const multiApplied = await call('/api/admin/book-import-stages/' + multiRowStage.body.id
      + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(multiApplied.status, 200);
    assert.strictEqual(multiApplied.body.result.created, 2);
    assert.strictEqual(multiApplied.body.result.report.rows.length, 2);
    assert.deepStrictEqual(multiApplied.body.result.report.rows.map((row) => row.index), [0, 1]);
    assert.deepStrictEqual(multiApplied.body.result.report.rows.map((row) => row.copies), [1, 1]);

    // While the preview is open, changed inventory OMITTED from Excel must
    // invalidate its displayed count and its final approved audit summary.
    const omissionTarget = '9781234567149';
    const omittedPreview = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Andere nieuwe editie', Auteur: 'A Auteur',
        'ISBN-nummer': omissionTarget, Aantal: 1 }]),
    });
    assert.strictEqual(omittedPreview.status, 201);
    assert.ok(omittedPreview.body.decisions.summary.omittedExistingCopies > 0);
    const omittedChanged = await call('/api/books', token2, {
      title: 'Dubbele ISBN rijen', author: 'A Auteur',
      barcode: '79446656', metadataIsbn: distinctBarcodeIsbn,
    });
    assert.strictEqual(omittedChanged.status, 201);
    const omittedStaleApply = await call('/api/admin/book-import-stages/' + omittedPreview.body.id
      + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(omittedStaleApply.status, 409);
    assert.strictEqual(omittedStaleApply.body.error, 'inventory_preview_stale');

    const unnamedIsbn = '9781234567156';
    const unnamedStage = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync',
      file: fileBase64([{ Auteur: 'A Auteur', 'ISBN-nummer': unnamedIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(unnamedStage.status, 201);
    const acknowledgedMissingName = await call('/api/admin/book-import-stages/'
      + unnamedStage.body.id + '/review', token1, {
      revision: 1, acceptWarnings: true, corrections: [], inventoryResolutions: [],
    });
    assert.strictEqual(acknowledgedMissingName.status, 200);
    assert.strictEqual(acknowledgedMissingName.body.decisions.rows[0].reason,
      'missing_title_or_author');
    assert.strictEqual(acknowledgedMissingName.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + unnamedStage.body.id
      + '/cancel', token1, { revision: 2 })).status, 200);

    // Independent row provenance check: two copies of the same new ISBN
    // have DIFFERENT approved descriptions and no printed barcodes.
    // Each created physical copy must retain its own worksheet row's data.
    const splitMetadataIsbn = '9781234567163';
    const splitStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([
        { Titel: 'Eén ISBN twee varianten', Auteur: 'A Auteur',
          'ISBN-nummer': splitMetadataIsbn, Aantal: 1, Beschrijving: 'Beschrijving eerste rij' },
        { Titel: 'Eén ISBN twee varianten', Auteur: 'A Auteur',
          'ISBN-nummer': splitMetadataIsbn, Aantal: 1, Beschrijving: 'Beschrijving tweede rij' },
      ]),
    });
    assert.strictEqual(splitStage.status, 201, JSON.stringify(splitStage.body).slice(0, 450));
    assert.deepStrictEqual(splitStage.body.decisions.proposedAdds.map((a) => a.index), [0, 1]);
    assert.strictEqual(splitStage.body.decisions.rows[1].rowAddCopies, 1);
    const splitApply = await call('/api/admin/book-import-stages/' + splitStage.body.id
      + '/apply', token2, { revision: 1, confirm: true });
    assert.strictEqual(splitApply.status, 200, JSON.stringify(splitApply.body).slice(0, 450));
    const splitBooks = JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.filter(
      (book) => book.metadataIsbn === splitMetadataIsbn);
    assert.strictEqual(splitBooks.length, 2);
    assert.deepStrictEqual(splitBooks.map((book) => book.description),
      ['Beschrijving eerste rij', 'Beschrijving tweede rij']);
    assert.deepStrictEqual(splitApply.body.result.report.rows.map((r) => r.copies), [1, 1]);

    // A legacy title/author with only a NON-ISBN physical barcode must
    // not be silently duplicated when a new Excel supplies a proper ISBN.
    const legacyWithoutIsbn = await call('/api/books', token1, {
      title: 'Ouder boek zonder ISBN', author: 'A Auteur', barcode: '66554433',
    });
    assert.strictEqual(legacyWithoutIsbn.status, 201);
    const legacySync = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Ouder boek zonder ISBN', Auteur: 'A Auteur',
        'ISBN-nummer': '9781234567170', Aantal: 1 }]),
    });
    assert.strictEqual(legacySync.status, 201);
    assert.strictEqual(legacySync.body.decisions.rows[0].reason,
      'possible_existing_book_without_isbn');
    assert.strictEqual(legacySync.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/' + legacySync.body.id
      + '/cancel', token1, { revision: 1 })).status, 200);

    // A stale ordinary book-create request holds a request-local DB snapshot
    // while its JSON body is still uploading. Completing a PR4 sync must be
    // durable; the older request MUST be rejected rather than overwrite the
    // newly saved book, audit report or import history.
    const guardedSyncIsbn = '9781234567187';
    const guardedStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{ Titel: 'Beschermde synchronisatie', Auteur: 'A Auteur',
        'ISBN-nummer': guardedSyncIsbn, Aantal: 1 }]),
    });
    assert.strictEqual(guardedStage.status, 201);
    const olderOrdinaryCreate = pausedImportPost('/api/books', token2, {
      title: 'Stale request must fail', author: 'A Auteur',
      barcode: '77441122', metadataIsbn: '9781234567194',
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const guardedApply = await call('/api/admin/book-import-stages/' + guardedStage.body.id
      + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(guardedApply.status, 200, JSON.stringify(guardedApply.body).slice(0, 400));
    olderOrdinaryCreate.finish();
    const staleOrdinaryResult = await olderOrdinaryCreate.done;
    assert.strictEqual(staleOrdinaryResult.status, 409,
      'Ordinary writers must not overwrite a successful completed stock sync');
    assert.strictEqual(staleOrdinaryResult.body.error, 'DATABASE_WRITE_CONFLICT');
    const savedGuardedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.ok(savedGuardedDb.books.some((book) => book.metadataIsbn === guardedSyncIsbn));
    assert.ok(savedGuardedDb.bookImportReports.some((report) =>
      report.id === guardedApply.body.result.batchId));
    assert.ok(savedGuardedDb.history.some((event) => event.type === 'books_inventory_sync'));
    assert.ok(!savedGuardedDb.books.some((book) => book.barcode === '77441122'));

    // PR5 completion: an already borrowed book in the Excel inventory must
    // become a real active student/class loan, not an available physical copy.
    // Missing original checkout dates remain UNKNOWN, and the migration must
    // not inflate genuine historical check_out reading statistics.
    const studentLoanIsbn = '9780131103627';
    const studentLoanStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Bestaande leerlinglening', Auteur: 'A Auteur',
        'ISBN-nummer': studentLoanIsbn, 'naam leerling': 'Lisa Leerling',
      }]),
    });
    assert.strictEqual(studentLoanStage.status, 201, JSON.stringify(studentLoanStage.body).slice(0, 420));
    assert.strictEqual(studentLoanStage.body.decisions.rows[0].loanBorrower?.id, 'student-match');
    assert.strictEqual(studentLoanStage.body.decisions.summary.readyToApply, true);
    const studentLoanApplied = await call('/api/admin/book-import-stages/'
      + studentLoanStage.body.id + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(studentLoanApplied.status, 200, JSON.stringify(studentLoanApplied.body).slice(0, 420));
    assert.strictEqual(studentLoanApplied.body.result.restoredLoans, 1);
    const storedStudentLoanDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const importedStudentCopy = storedStudentLoanDb.books.find((copy) =>
      copy.metadataIsbn === studentLoanIsbn);
    assert.strictEqual(importedStudentCopy.status, 'borrowed');
    assert.strictEqual(importedStudentCopy.borrowedBy, 'student-match');
    assert.strictEqual(importedStudentCopy.borrowedAt, null);
    assert.strictEqual(importedStudentCopy.dueDate, null);
    const loanOwner = storedStudentLoanDb.students.find((student) => student.id === 'student-match');
    assert.ok(loanOwner.borrowedBooks.some((loan) => loan.bookId === importedStudentCopy.id));
    assert.ok(storedStudentLoanDb.history.some((event) => event.type === 'loan_imported'
      && event.bookId === importedStudentCopy.id));
    assert.ok(!storedStudentLoanDb.history.some((event) => event.type === 'check_out'
      && event.bookId === importedStudentCopy.id),
      'An old Excel loan must not claim a brand-new reading moment');
    const publicBorrowerData = await call('/api/books/' + importedStudentCopy.id, null);
    assert.strictEqual(publicBorrowerData.status, 200);
    assert.strictEqual(publicBorrowerData.body.status, 'borrowed');
    assert.ok(!JSON.stringify(publicBorrowerData.body).includes('student-match'));

    const classLoanIsbn = '9780262033848';
    const classLoanStage = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Bestaande klaslening', Auteur: 'A Auteur',
        'ISBN-nummer': classLoanIsbn, 'Geleend door klas': 'Groep A',
      }]),
    });
    assert.strictEqual(classLoanStage.status, 201);
    assert.strictEqual(classLoanStage.body.decisions.rows[0].loanBorrower?.id, 'class-match');
    const classLoanApplied = await call('/api/admin/book-import-stages/'
      + classLoanStage.body.id + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(classLoanApplied.status, 200, JSON.stringify(classLoanApplied.body).slice(0, 420));
    const classDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(classDb.books.find((copy) => copy.metadataIsbn === classLoanIsbn)
      .borrowedByClassId, 'class-match');
    assert.ok(classDb.history.some((event) => event.type === 'loan_imported'
      && event.classId === 'class-match'));
    assert.strictEqual((await call('/api/admin/book-import-stages/' + classLoanStage.body.id
      + '/apply', token1, { revision: 1, confirm: true })).status, 409,
      'Replaying a completed import must not duplicate an old class loan');

    const tooManyLoanCopies = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Onbekend geleend exemplaar', Auteur: 'A Auteur',
        'ISBN-nummer': '9780201633610', Aantal: 2, 'naam leerling': 'Lisa Leerling',
      }]),
    });
    assert.strictEqual(tooManyLoanCopies.status, 201);
    assert.strictEqual(tooManyLoanCopies.body.decisions.rows[0].reason,
      'loan_requires_single_copy');
    assert.strictEqual(tooManyLoanCopies.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/'
      + tooManyLoanCopies.body.id + '/cancel', token1, { revision: 1 })).status, 200);

    const missingStudentLoan = await call('/api/admin/book-import-stages', token1, {
      file: fileBase64([{
        Titel: 'Onbekende leerling', Auteur: 'A Auteur',
        'ISBN-nummer': '9780321146533', 'naam leerling': 'Onbekende leerlingnaam',
      }]),
    });
    assert.strictEqual(missingStudentLoan.status, 201);
    assert.strictEqual(missingStudentLoan.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/'
      + missingStudentLoan.body.id + '/cancel', token1, { revision: 1 })).status, 200);

    // An already imported, AVAILABLE physical copy may be restored to the
    // historical student's active loans, but must never be duplicated.
    const existingLoanEdition = '9780596007126';
    const preexistingAvailable = await call('/api/books', token2, {
      title: 'Bestaande fysieke editie', author: 'A Auteur',
      metadataIsbn: existingLoanEdition, barcode: '88992211',
    });
    assert.strictEqual(preexistingAvailable.status, 201, JSON.stringify(preexistingAvailable.body));
    const physicalId = preexistingAvailable.body.book.id;
    const syncLoanExcel = fileBase64([{
      Titel: 'Bestaande fysieke editie', Auteur: 'A Auteur',
      'ISBN-nummer': existingLoanEdition, Barcode: '88992211',
      'naam leerling': 'Lisa Leerling', Aantal: 1,
    }]);
    const syncLoanPreview = await call('/api/admin/book-import-stages', token1b, {
      mode: 'inventory_sync', file: syncLoanExcel,
    });
    assert.strictEqual(syncLoanPreview.status, 201, JSON.stringify(syncLoanPreview.body).slice(0, 500));
    assert.strictEqual(syncLoanPreview.body.decisions.summary.addCopies, 0);
    assert.strictEqual(syncLoanPreview.body.decisions.summary.restoreLoans, 1);
    assert.strictEqual(syncLoanPreview.body.decisions.loanAssignments[0].target, 'existing');
    assert.strictEqual(syncLoanPreview.body.decisions.loanAssignments[0].bookId, physicalId);
    const syncLoanApply = await call('/api/admin/book-import-stages/'
      + syncLoanPreview.body.id + '/apply', token1b, { revision: 1, confirm: true });
    assert.strictEqual(syncLoanApply.status, 200, JSON.stringify(syncLoanApply.body).slice(0, 500));
    assert.strictEqual(syncLoanApply.body.result.created, 0);
    assert.strictEqual(syncLoanApply.body.result.restoredLoans, 1);
    const syncedStudentDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(syncedStudentDb.books.find((book) => book.id === physicalId).borrowedBy,
      'student-match');
    assert.strictEqual(syncedStudentDb.books.filter((book) =>
      book.metadataIsbn === existingLoanEdition).length, 1);
    assert.ok(syncedStudentDb.students.find((student) => student.id === 'student-match')
      .borrowedBooks.some((loan) => loan.bookId === physicalId));
    const recordedCount = syncedStudentDb.history.filter((event) =>
      event.type === 'loan_imported' && event.bookId === physicalId).length;

    const repeatedSync = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync', file: syncLoanExcel,
    });
    assert.strictEqual(repeatedSync.status, 201);
    assert.strictEqual(repeatedSync.body.decisions.summary.restoreLoans, 0);
    assert.strictEqual(repeatedSync.body.decisions.summary.alreadyRecordedLoans, 1);
    assert.strictEqual((await call('/api/admin/book-import-stages/'
      + repeatedSync.body.id + '/apply', token1, { revision: 1, confirm: true })).status, 200);
    const repeatedLoanDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(repeatedLoanDb.history.filter((event) =>
      event.type === 'loan_imported' && event.bookId === physicalId).length, recordedCount);
    assert.strictEqual(repeatedLoanDb.books.filter((book) =>
      book.metadataIsbn === existingLoanEdition).length, 1);

    const conflictingClassLoan = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{
        Titel: 'Bestaande fysieke editie', Auteur: 'A Auteur',
        'ISBN-nummer': existingLoanEdition, Barcode: '88992211',
        'Geleend door klas': 'Groep A', Aantal: 1,
      }]),
    });
    assert.strictEqual(conflictingClassLoan.status, 201);
    assert.strictEqual(conflictingClassLoan.body.decisions.rows[0].reason,
      'loan_copy_borrowed_by_other');
    assert.strictEqual(conflictingClassLoan.body.decisions.summary.readyToApply, false);
    assert.strictEqual((await call('/api/admin/book-import-stages/'
      + conflictingClassLoan.body.id + '/cancel', token1, { revision: 1 })).status, 200);

    // If a live checkout occurs after preview, the stage may not overwrite
    // it or append a second historic checkout on apply.
    const staleLoanEdition = '9780132350884';
    const createdForRace = await call('/api/books', token2, {
      title: 'Racing checkout', author: 'A Auteur',
      metadataIsbn: staleLoanEdition, barcode: '88993322',
    });
    assert.strictEqual(createdForRace.status, 201);
    const staleLoanStage = await call('/api/admin/book-import-stages', token1, {
      mode: 'inventory_sync',
      file: fileBase64([{
        Titel: 'Racing checkout', Auteur: 'A Auteur',
        'ISBN-nummer': staleLoanEdition, Barcode: '88993322',
        'naam leerling': 'Lisa Leerling', Aantal: 1,
      }]),
    });
    assert.strictEqual(staleLoanStage.status, 201);
    assert.strictEqual(staleLoanStage.body.decisions.summary.restoreLoans, 1);
    const actualCheckout = await call('/api/books/' + createdForRace.body.book.id + '/check-out',
      token2, { studentId: 'student-match' });
    assert.strictEqual(actualCheckout.status, 200, JSON.stringify(actualCheckout.body).slice(0, 340));
    const staleLoanApply = await call('/api/admin/book-import-stages/'
      + staleLoanStage.body.id + '/apply', token1, { revision: 1, confirm: true });
    assert.strictEqual(staleLoanApply.status, 409);
    assert.strictEqual(staleLoanApply.body.error, 'inventory_preview_stale');
    const afterHistoricLoanRace = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterHistoricLoanRace.books.find((book) => book.id === createdForRace.body.book.id)
      .borrowedBy, 'student-match');
    assert.ok(!afterHistoricLoanRace.history.some((event) =>
      event.type === 'loan_imported' && event.bookId === createdForRace.body.book.id));

    console.log('PR3 staged HTTP preview and single-use apply integration tests passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
