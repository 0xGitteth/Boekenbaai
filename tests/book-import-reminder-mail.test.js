'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const mail = require('../book-import-reminder-mail');

const now = Date.parse('2026-10-15T09:00:00Z');
const env = {
  BOEKENBAAI_MAIL_ENABLED: 'true',
  BOEKENBAAI_MAIL_SCRIPT_URL: 'https://script.google.com/macros/s/TESTBRIDGE123/exec',
  BOEKENBAAI_MAIL_SCRIPT_SECRET: 'x'.repeat(64),
  BOEKENBAAI_PUBLIC_URL: 'https://boekenbaai.example',
};
const conf = mail.configuration(env);
assert.equal(conf.ready, true);
assert.equal(mail.configuration({}).ready, false);
assert.equal(mail.configuration({ ...env, BOEKENBAAI_PUBLIC_URL: 'http://127.0.0.1' }).ready, false);
assert.equal(mail.configuration({ ...env, BOEKENBAAI_MAIL_SCRIPT_URL: 'https://evil.example/exec' }).ready, false);
assert.equal(mail.validEmail('Teacher@Koraal.nl'), 'teacher@koraal.nl');
for (const addr of ['t@bad', 't@@koraal.nl', 't@koraal.nl\nBcc:x', 'a..b@koraal.nl',
  'n@koraal.nl extra', '<n@koraal.nl>']) assert.equal(mail.validEmail(addr), '');

const data = {
  classes: [
    { id: 'a', name: 'A', teacherIds: ['t1', 't2'] },
    { id: 'b', name: 'B', teacherIds: ['t1', 't3'] },
  ],
  users: [
    { id: 't1', role: 'teacher' }, { id: 't2', role: 'teacher' },
    { id: 't3', role: 'teacher', active: false },
    { id: 'admin', role: 'admin' },
  ],
  books: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
  bookImportFollowupSettings: { reminderDays: 7, escalationDays: 14 },
  bookImportFollowups: [
    { id: 'c1', bookId: 'b1', classId: 'a', status: 'open',
      createdAt: new Date(now - 8 * mail.DAY_MS).toISOString() },
    { id: 'c2', bookId: 'b2', classId: 'b', status: 'open',
      createdAt: new Date(now - 9 * mail.DAY_MS).toISOString() },
    { id: 'c3', bookId: 'b3', classId: 'a', status: 'completed',
      createdAt: new Date(now - 8 * mail.DAY_MS).toISOString() },
    { id: 'too-old', bookId: 'b2', classId: 'a', status: 'open',
      createdAt: new Date(now - 15 * mail.DAY_MS).toISOString() },
  ],
};
const links = { links: [
  { accountType: 'staff', accountId: 't1', email: 't1@koraaledu.nl', sub: '' },
  { accountType: 'staff', accountId: 't2', email: 't2@koraaledu.nl', sub: '' },
  { accountType: 'staff', accountId: 't3', email: 't3@koraaledu.nl', sub: '' },
], sessions: [], pendingIdentities: [], linkRequests: [] };
const people = mail.collectRecipients(data, links, now);
assert.deepEqual(people.map(x => [x.teacherId, x.tasks.length]), [['t1', 2], ['t2', 1]]);
assert.equal(people[0].to, 't1@koraaledu.nl');
assert.equal(JSON.stringify(people).includes('booktitle'), false);
data.bookImportEmailPreferences = { t1: { mode: 'alternate',
  alternateEmail: 't1@koraal.nl', revision: 2 },
t2: { mode: 'off', alternateEmail: '', revision: 1 } };
assert.deepEqual(mail.collectRecipients(data, links, now).map(x => x.to), ['t1@koraal.nl']);
assert.equal(mail.collectRecipients(data, links, now - 2 * mail.DAY_MS).length, 1);
data.bookImportFollowups[0].status = 'cancelled';
assert.equal(mail.collectRecipients(data, links, now)[0].tasks.length, 1);
data.bookImportFollowups[0].status = 'open';
data.books = data.books.filter(b => b.id !== 'b1');
assert.equal(mail.collectRecipients(data, links, now)[0].tasks.length, 1);
data.books.push({ id: 'b1' });
const verification = mail.beginVerification(data, 't1', 'another@koraal.nl', conf.key, now);
assert.equal(verification.ok, true);
assert.equal(verification.next.pending.hash.length, 64);
assert.equal(JSON.stringify(verification.next).includes(verification.code), false);
assert.equal(mail.beginVerification(data, 't1', 'another@koraal.nl', conf.key, now).error, 'rate_limited');
assert.equal(mail.confirmVerification(data, 't1', '00000000', conf.key, now).error, 'invalid_code');
assert.equal(mail.confirmVerification(data, 't1', verification.code, conf.key, now).ok, true);
assert.equal(mail.prefsFor(data, 't1').alternateEmail, 'another@koraal.nl');
assert.equal(mail.prefsFor(data, 't1').mode, 'alternate');
assert.equal(mail.beginVerification(data, 't1', 'bypass@koraal.nl',
  conf.key, now + 1).error, 'rate_limited',
'Confirming the previous code cannot bypass the five-minute request limit.');
assert.equal(mail.changePreference(data, 't1', 'off'), true);
assert.equal(mail.beginVerification(data, 't1', 'bypass@koraal.nl',
  conf.key, now + 2).error, 'rate_limited',
'Disabling email may cancel a code but cannot reset the cooldown.');
assert.equal(mail.collectRecipients(data, links, now).length, 0);
assert.equal(mail.changePreference(data, 't1', 'school'), true);
// A staff account cannot exhaust the free Gmail quota via verification spam.
assert.equal(mail.beginVerification(data, 't1', '2@koraal.nl',
  conf.key, now + 300001).ok, true);
assert.equal(mail.beginVerification(data, 't1', '3@koraal.nl',
  conf.key, now + 600002).ok, true);
assert.equal(mail.beginVerification(data, 't1', '4@koraal.nl',
  conf.key, now + 900003).error, 'daily_limit');
const obsoleteCode = '12345678';
assert.equal(mail.changePreference(data, 't1', 'off'), true);
assert.equal(mail.prefsFor(data, 't1').pending, null);
assert.equal(mail.confirmVerification(data, 't1', obsoleteCode,
  conf.key, now + 610000).ok, false,
'Disabling notifications must invalidate all pending verification codes.');
assert.equal(mail.changePreference(data, 't1', 'school'), true);
// Corrupted historical data also must not crash verification.
const probe = structuredClone(data);
probe.bookImportEmailPreferences.t1.pending = { email: 'other@koraal.nl',
  hash: 'corrupt', requestedAt: now, expiresAt: now + mail.DAY_MS, attempts: 0 };
const corrupted = probe;
assert.equal(mail.confirmVerification(corrupted, 't1', '12345678',
  conf.key, now + 610000).ok, false);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pr7-'));
const folder = path.join(tmp, 'durable-claims');
const called = [];
const fake = async (url, opts) => {
  called.push({ url, opts });
  if (called.length % 2 === 1) return {
    status: 302, headers: { get: () => 'https://script.googleusercontent.com/macros/echo?user_content_key=test' },
  };
  return { ok: true, json: async () => ({ ok: true,
    id: JSON.parse(called[called.length - 2].opts.body).payload
      && JSON.parse(JSON.parse(called[called.length - 2].opts.body).payload).id }) };
};
async function run() {
  const first = await mail.dispatchReminders({ db: data, links, folder, env, now,
    fetchImpl: fake });
  assert.equal(first.claimed, 2);
  assert.equal(first.accepted, 2);
  assert.equal(called.length, 2);
  assert.equal(called[0].opts.redirect, 'manual');
  const json = JSON.parse(called[0].opts.body);
  assert.equal(mail.signature(json.payload, conf.key), json.signature);
  assert.equal(JSON.parse(json.payload).to, 't1@koraaledu.nl');
  assert.equal(json.payload.includes('another@koraal.nl'), false);
  assert.equal(JSON.parse(json.payload).body.includes('leerlingnaam'), false);
  const repeated = await mail.dispatchReminders({ db: data, links, folder, env, now,
    fetchImpl: fake });
  assert.equal(repeated.claimed, 0);
  assert.equal(called.length, 2);
  const files = fs.readdirSync(folder).filter(file => file.endsWith('.claim'));
  assert.equal(files.length, 2);
  assert.ok(fs.existsSync(path.join(folder, 'locks')));
  assert.equal(mail.claimOnce(folder, files[0].replace('.claim', '')), false);
  // Competing workers may not split the same teacher's book reminders.
  const concurrentFolder = path.join(tmp, 'concurrent-claims');
  const concurrentMessages = [];
  const concurrentFetch = async (url, options) => {
    await Promise.resolve();
    const payload = JSON.parse(JSON.parse(options.body).payload);
    concurrentMessages.push(payload);
    return { ok: true, status: 200, json: async () => ({ ok: true, id: payload.id }) };
  };
  const concurrentResults = await Promise.all([
    mail.dispatchReminders({ db: data, links, folder: concurrentFolder, env, now,
      fetchImpl: concurrentFetch }),
    mail.dispatchReminders({ db: data, links, folder: concurrentFolder, env, now,
      fetchImpl: concurrentFetch }),
  ]);
  assert.equal(concurrentResults.reduce((sum, item) => sum + item.recipients, 0), 1);
  assert.equal(concurrentMessages.length, 1);
  assert.ok(concurrentMessages[0].body.includes('2 openstaande controles'));
  assert.equal(fs.readdirSync(concurrentFolder).filter(f => f.endsWith('.claim')).length, 2);

  // An ambiguous provider failure is never blindly retried after restart.
  const otherFolder = path.join(tmp, 'uncertain');
  const unknown = await mail.dispatchReminders({ db: data, links, folder: otherFolder,
    env, now, fetchImpl: async () => { throw Error('network error'); } });
  assert.equal(unknown.failed, 2);
  assert.equal((await mail.dispatchReminders({ db: data, links,
    folder: otherFolder, env, now, fetchImpl: fake })).claimed, 0);
  // A new reminder arrives later. The message must accurately state ALL
  // currently open tasks, even though only one task is newly claimed.
  data.books.push({ id: 'b4' });
  data.bookImportFollowups.push({
    id: 'c4', classId: 'a', bookId: 'b4', status: 'open',
    createdAt: new Date(now - 8 * mail.DAY_MS).toISOString(),
  });
  const incremental = await mail.dispatchReminders({ db: data, links, folder,
    env, now, fetchImpl: fake });
  assert.equal(incremental.claimed, 1);
  const incrementalBody = JSON.parse(JSON.parse(called[2].opts.body).payload).body;
  assert.ok(incrementalBody.includes('3 openstaande controles'),
    'Mail must count all visible reminder tasks, not only new receipts.');
  assert.equal((await mail.dispatchReminders({ db: data, links, folder,
    env, now, fetchImpl: fake })).claimed, 0);
  // Never follow a malicious redirect with an authenticated POST.
  assert.equal(await mail.bridgeSend({ config: conf, id: 'a'.repeat(64),
    to: 't1@koraaledu.nl', subject: 'Safe', body: 'Safe',
    fetchImpl: async () => ({
      status: 302, headers: { get: () => 'https://attacker.example/path' },
    }) }), false);

  // Execute the real GAS source under mocks, including HMAC, replay and quota.
  const gs = fs.readFileSync(path.join(__dirname, '..',
    'google-apps-script', 'boekenbaai-mail.gs'), 'utf8');
  const props = { BOEKENBAAI_SHARED_SECRET: conf.key };
  let sent = 0;
  const sandbox = {
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: value => ({
        value, setMimeType() { return this; },
      }),
    },
    Utilities: {
      computeHmacSha256Signature: (raw, key) =>
        [...crypto.createHmac('sha256', key).update(raw).digest()].map(x => x > 127 ? x - 256 : x),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => props[key] || null,
        setProperty: (key, value) => { props[key] = value; },
        getProperties: () => ({ ...props }),
        deleteProperty: key => { delete props[key]; },
      }),
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => true, releaseLock: () => {},
    }) },
    MailApp: {
      getRemainingDailyQuota: () => 100,
      sendEmail: message => {
        assert.equal(message.to, 't1@koraaledu.nl');
        assert.equal(message.name, 'Boekenbaai');
        sent++;
      },
    },
    Date, JSON, Number, Object, String, Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(gs, sandbox);
  const input = { version: 1, timestamp: Date.now(),
    id: 'b'.repeat(64), to: 't1@koraaledu.nl', subject: 'Test', body: 'Reminder' };
  const payload = JSON.stringify(input);
  const event = (p, sig) => ({ postData: { contents: JSON.stringify({
    payload: p, signature: sig,
  }) } });
  const bad = JSON.parse(sandbox.doPost(event(payload, 'f'.repeat(64))).value);
  assert.equal(bad.ok, false);
  assert.equal(sent, 0);
  const accepted = JSON.parse(sandbox.doPost(event(payload,
    mail.signature(payload, conf.key))).value);
  assert.equal(accepted.ok, true);
  assert.equal(sent, 1);
  assert.equal(JSON.parse(sandbox.doPost(event(payload,
    mail.signature(payload, conf.key))).value).ok, true);
  assert.equal(sent, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PR7: Gmail bridge HMAC, privacy, preferences, deduplication and quotas passed');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
