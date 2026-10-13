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
  fs.writeFileSync(metadataHookFile, `
    globalThis.__BOEKENBAAI_MOCK_ISBN_LOOKUP = async (isbn) => ({
      found: true, title: 'Metadata thema boek', author: 'A Auteur',
      authors: ['A Auteur'], isbn13: isbn,
      themes: ['Pesten', 'Nieuw vakgebied'],
      tags: ['bullying'], publisher: 'Metadata uitgever',
      publishedYear: 2018, pageCount: 240, language: 'nl',
      description: 'Metadata beschrijving',
      coverUrl: 'https://example.com/boek.jpg', source: 'test-metadata'
    });
  `);
  const child = spawn(process.execPath, ['--require', metadataHookFile, 'server.js'], {
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
    assert.strictEqual(explicitClear.body.rows[0].provenance.themes.source, 'unknown');
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
    const emptyMetadataIsbn = '9780061120084';
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
    assert.deepStrictEqual(reloadedMetadata.tags, []);
    assert.ok(!persistedMetadata.publishedYear && !reloadedMetadata.publishedYear);
    assert.ok(!persistedMetadata.pageCount && !reloadedMetadata.pageCount);

    console.log('PR3 staged HTTP preview and single-use apply integration tests passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
