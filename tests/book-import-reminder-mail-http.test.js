'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const XLSX = require('xlsx');
const reminder = require('../book-import-reminder-mail');
const authCore = require('../google-auth-core');

const PORT = 4087;
const BASE = 'http://127.0.0.1:' + PORT;
const passwordHash = pass => crypto.createHash('sha256').update(pass).digest('hex');
async function call(route, token, payload, method) {
  const response = await fetch(BASE + route, {
    method: method || (payload === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}
async function ready(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('PR7 HTTP server startup timeout')), 12000);
    const onLog = bytes => {
      if (bytes.toString().includes('http://localhost:' + PORT)) {
        clearTimeout(timer);
        child.stdout.off('data', onLog);
        resolve();
      }
    };
    child.stdout.on('data', onLog);
    child.once('exit', code => reject(Error('PR7 HTTP server exited: ' + code)));
  });
}
async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pr7-api-'));
  const dataPath = path.join(dir, 'db.json');
  const authPath = path.join(dir, 'auth.json');
  const messages = path.join(dir, 'sent.jsonl');
  const initial = {
    books: [{ id: 'book-a', title: 'Boek A', author: 'Auteur',
      barcode: '19910011', status: 'available' }],
    classes: [{ id: 'class-a', name: 'Klas A',
      teacherIds: ['teacher-a'], studentIds: ['student-a'] }],
    students: [{ id: 'student-a', username: 'student-a', name: 'Leerling A',
      role: 'student', classIds: ['class-a'], borrowedBooks: [],
      passwordHash: passwordHash('pass') }],
    users: [
      { id: 'teacher-a', username: 'teacher-a', name: 'Docent A',
        role: 'teacher', passwordHash: passwordHash('pass') },
      { id: 'admin', username: 'admin', name: 'Beheer',
        role: 'admin', passwordHash: passwordHash('pass') },
    ],
    history: [], folders: [], bookImportFollowupSettings: {
      reminderDays: 7, escalationDays: 14,
    },
    bookImportFollowups: [{
      id: 'task-a', reportId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      bookId: 'book-a', classId: 'class-a', status: 'open', revision: 1,
      title: 'Boek A', createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
      sourceClassNames: ['Klas A'],
    }],
    bookImportReports: [{
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      followupTaskIds: ['task-a'], fullyReviewed: false,
    }],
  };
  fs.writeFileSync(dataPath, JSON.stringify(initial));
  fs.writeFileSync(authPath, JSON.stringify({ links: [{
    accountType: 'staff', accountId: 'teacher-a',
    email: 'teacher@koraaledu.nl', sub: '',
  }], sessions: [], pendingIdentities: [], linkRequests: [] }));
  const child = spawn(process.execPath, ['--require',
    path.join(__dirname, 'mock-import-mail-bridge.js'), 'server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dataPath,
      BOEKENBAAI_AUTH_DATA_PATH: authPath,
      BOEKENBAAI_STATIC_DIR: path.resolve(__dirname, '..', 'public'),
      BOEKENBAAI_MAIL_ENABLED: 'true',
      BOEKENBAAI_MAIL_SCRIPT_URL: 'https://script.google.com/macros/s/TESTBRIDGE123/exec',
      BOEKENBAAI_MAIL_SCRIPT_SECRET: 'x'.repeat(64),
      BOEKENBAAI_MAIL_TEST_CAPTURE: messages,
      BOEKENBAAI_IMPORT_ENRICH_ISBN: 'false',
      BOEKENBAAI_PUBLIC_URL: 'https://boekenbaai.example' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  try {
    await ready(child);
    const login = async username => {
      const result = await call('/api/login', null, { username, password: 'pass' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.token;
    };
    const teacher = await login('teacher-a');
    const admin = await login('admin');
    const student = await login('student-a');
    const route = '/api/staff/book-import-mail-preferences';
    const adminRoute = '/api/admin/mail-notifications';
    assert.equal((await call(adminRoute, student)).status, 403);
    assert.equal((await call(adminRoute, teacher)).status, 403);
    assert.equal((await call(route, admin)).status, 403,
      'Shared admin login must use its own address list, not teacher preferences.');
    assert.equal((await call(adminRoute, null)).status, 401);
    assert.deepEqual((await call(adminRoute, admin)).body.recipients, []);
    assert.equal((await call(adminRoute, admin, {
      action: 'request_address', email: 'central@koraal.nl',
    })).status, 200);
    assert.equal((await call(adminRoute, admin)).body.recipients[0].verified, false);
    const adminCode = fs.readFileSync(messages, 'utf8').trim().split('\n')
      .map(JSON.parse)[0].payload.body.match(/\b\d{8}\b/)[0];
    assert.equal((await call(adminRoute, admin, {
      action: 'confirm_address', email: 'central@koraal.nl', code: adminCode,
    })).status, 200);
    assert.equal((await call(adminRoute, admin)).body.recipients[0].verified, true);
    assert.equal((await call(adminRoute, teacher, {
      action: 'remove_address', email: 'central@koraal.nl',
    })).status, 403);
    assert.equal((await call(adminRoute, admin, {
      action: 'update_categories',
      categories: {transfers:false, google:true, books:true},
    })).status, 200);
    assert.equal((await call(adminRoute, admin)).body.categories.transfers, false);
    assert.equal((await call(adminRoute, admin, {
      action: 'update_categories',
      categories: {transfers:true, google:true, books:true},
    })).status, 200);
    assert.equal((await call(adminRoute, admin, {
      action: 'remove_address', email: 'central@koraal.nl',
    })).status, 200);
    assert.deepEqual((await call(adminRoute, admin)).body.recipients, []);
    assert.equal((await call(route, null)).status, 401);
    assert.equal((await call(route, student)).status, 403);
    assert.equal((await call(route, teacher)).body.mode, 'school');
    assert.equal((await call(route, teacher)).body.schoolEmail, 'teacher@koraaledu.nl');
    assert.equal((await call(route, teacher)).body.deliveryConfigured, true);
    assert.equal((await call(route, teacher, { action: 'request_alternative',
      email: 'bad\nbcc@koraal.nl' })).status, 400);
    assert.equal((await call(route, teacher, { action: 'use_alternate' })).status, 409);
    assert.equal((await call(route, teacher, { action: 'request_alternative',
      email: 'teacher@koraal.nl' })).status, 200);
    assert.equal((await call(route, teacher)).body.mode, 'school',
      'Unverified email must never become active.');
    assert.equal((await call(route, teacher)).body.pendingEmail, 'teacher@koraal.nl');
    assert.equal((await call(route, teacher, { action: 'request_alternative',
      email: 'other@koraal.nl' })).status, 429);
    assert.equal((await call(route, student, { action: 'confirm_alternative',
      code: '00000000' })).status, 403);
    const pendingMail = fs.readFileSync(messages, 'utf8').trim().split('\n')
      .map(JSON.parse);
    assert.equal(pendingMail.length, 2);
    const code = pendingMail[1].payload.body.match(/\b\d{8}\b/)[0];
    assert.equal(pendingMail[0].payload.to, 'teacher@koraal.nl');
    assert.equal((await call(route, teacher, {
      action: 'confirm_alternative', code: '11111111',
    })).status, 400);
    const verified = await call(route, teacher, {
      action: 'confirm_alternative', code,
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal((await call(route, teacher)).body.mode, 'alternate');
    assert.equal((await call(route, teacher)).body.alternateEmail, 'teacher@koraal.nl');
    let saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(JSON.stringify(saved).includes(code), false);
    assert.equal(saved.bookImportEmailPreferences['teacher-a'].pending, null);
    // Self-service cannot mutate any other staff account.
    assert.equal(saved.bookImportEmailPreferences.admin, undefined);
    assert.equal((await call(route, teacher, { action: 'disable' })).status, 200);
    assert.equal((await call(route, teacher)).body.mode, 'off');
    assert.equal((await call('/api/staff/book-import-followups', teacher)).body.tasks.length, 1,
      'Turning off email must not affect in-app tasks.');
    assert.equal((await call(route, teacher, { action: 'use_school' })).status, 200);
    assert.equal((await call(route, teacher)).body.mode, 'school');
    assert.equal((await call(route, teacher, { action: 'use_alternate' })).status, 200);
    assert.equal((await call(route, teacher)).body.mode, 'alternate');
    // Full import -> reminder -> escalation -> mentor decision -> closed
    // report. Sending is mocked so no real school or student data goes out.
    const excel = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(excel, XLSX.utils.json_to_sheet([{
      Titel: 'Nieuwe klasimport', Auteur: 'Auteur X',
      'ISBN-nummer': '9780140328721', Klassen: 'Klas A', Aantal: 1,
    }]), 'Schoolbibliotheek');
    const file = XLSX.write(excel, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
    const staged = await call('/api/admin/book-import-stages', admin, {
      fileName: 'pr7-e2e.xlsx', file,
    });
    assert.equal(staged.status, 201, JSON.stringify(staged.body).slice(0, 600));
    const reviewed = await call('/api/admin/book-import-stages/' + staged.body.id + '/review',
      admin, { revision: staged.body.revision, acceptWarnings: true, corrections: [] });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body).slice(0, 600));
    const applied = await call('/api/admin/book-import-stages/' + staged.body.id + '/apply',
      admin, { revision: reviewed.body.revision, confirm: true });
    assert.equal(applied.status, 200, JSON.stringify(applied.body).slice(0, 600));
    assert.equal(applied.body.result.report.followupTasksCreated, 1);
    const imported = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const importedTask = imported.bookImportFollowups.find(t =>
      t.reportId === applied.body.result.batchId);
    assert.ok(importedTask);
    assert.equal(importedTask.classId, 'class-a');
    assert.equal((await call('/api/admin/book-import-reports/' + applied.body.result.batchId,
      admin)).body.fullyReviewed, false);
    const reminderConfig = {
      BOEKENBAAI_MAIL_ENABLED: 'true',
      BOEKENBAAI_MAIL_SCRIPT_URL: 'https://script.google.com/macros/s/TESTBRIDGE123/exec',
      BOEKENBAAI_MAIL_SCRIPT_SECRET: 'x'.repeat(64),
      BOEKENBAAI_PUBLIC_URL: 'https://boekenbaai.example',
    };
    const reminderFolder = path.join(dir, 'dispatch-receipts');
    const outbound = [];
    const fakeDelivery = async (url, options) => {
      const signed = JSON.parse(options.body);
      const payload = JSON.parse(signed.payload);
      outbound.push(payload);
      return new Response(JSON.stringify({ ok: true, id: payload.id }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const authLinks = authCore.normalizeStore(JSON.parse(fs.readFileSync(authPath, 'utf8')));
    const dueTime = Date.now() + 8 * reminder.DAY_MS;
    const reminded = await reminder.dispatchReminders({
      db: imported, links: authLinks, folder: reminderFolder,
      env: reminderConfig, now: dueTime, fetchImpl: fakeDelivery,
    });
    assert.equal(reminded.claimed, 1);
    assert.equal(outbound[0].to, 'teacher@koraal.nl');
    assert.ok(!outbound[0].body.includes('Nieuwe klasimport'),
      'Reminder must not leak book titles.');
    assert.equal((await reminder.dispatchReminders({
      db: imported, links: authLinks, folder: reminderFolder,
      env: reminderConfig, now: dueTime, fetchImpl: fakeDelivery,
    })).claimed, 0, 'Retry may not send the same task again.');
    const overdue = reminder.collectRecipients(imported, authLinks,
      Date.now() + 15 * reminder.DAY_MS);
    assert.equal(overdue.length, 0, 'Escalation ends teacher reminders.');
    const importedResolution = await call(
      '/api/staff/book-import-followups/' + importedTask.id + '/decision',
      teacher, { choice: 'fixed_location', revision: importedTask.revision });
    assert.equal(importedResolution.status, 200,
      JSON.stringify(importedResolution.body));
    assert.equal((await call('/api/admin/book-import-reports/' + applied.body.result.batchId,
      admin)).body.fullyReviewed, true);
    const finalDb = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(reminder.collectRecipients(finalDb, authLinks, dueTime).length, 0,
      'Completed tasks cannot produce email after the mentor decision.');

    // The original seeded import also remains unfinished until a teacher
    // performs a legitimate PR6 decision; preference updates cannot close it.
    assert.equal((await call('/api/admin/book-import-reports/'
      + initial.bookImportReports[0].id, admin)).body.fullyReviewed, false);
    const decision = await call('/api/staff/book-import-followups/task-a/decision',
      teacher, { choice: 'fixed_location', revision: 1 });
    assert.equal(decision.status, 200, JSON.stringify(decision.body));
    assert.equal((await call('/api/admin/book-import-reports/'
      + initial.bookImportReports[0].id, admin)).body.fullyReviewed, true);
    saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(saved.books[0].fixedLocation, 'Klas A');
    assert.ok(saved.bookImportEmailPreferences['teacher-a'].alternateEmail);
    // Removing a staff account must also forget the verified address,
    // pending codes and rate-limit metadata, without dropping other data.
    assert.equal((await call('/api/teachers/teacher-a',
      admin, undefined, 'DELETE')).status, 200);
    saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(
      saved.bookImportEmailPreferences, 'teacher-a'), false);
    assert.equal(saved.bookImportReports.some(r => r.id === applied.body.result.batchId), true);
    assert.equal((await call(route, teacher)).status, 401);
    console.log('PR7: real staff HTTP preferences, deletion cleanup and complete import flow passed');
  } catch (error) {
    console.error(stderr.slice(-1800));
    throw error;
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
