'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 4361;
const ROOT = path.join(__dirname, '..');

function dbFixture() {
  const passwordHash = crypto.createHash('sha256').update('admin-pass').digest('hex');
  return {
    books: [
          {
                "id": "edition-1",
                "title": "Shared book",
                "author": "Shared author",
                "metadataIsbn": "9789029078733",
                "barcode": "9789029078733",
                "status": "available",
                "coverUrl": "https://covers.example.org/old-edition.png",
                "localCoverUrl": ""
          },
          {
                "id": "edition-2",
                "title": "Shared book",
                "author": "Shared author",
                "metadataIsbn": "9789029078733",
                "barcode": "9789029078734",
                "status": "available",
                "coverUrl": "https://covers.example.org/old-edition.png",
                "localCoverUrl": "/api/covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
          },
          {
                "id": "edition-custom",
                "title": "Shared book",
                "author": "Shared author",
                "metadataIsbn": "9789029078733",
                "barcode": "9789029078735",
                "status": "available",
                "coverUrl": "https://covers.example.org/custom-edition.png",
                "localCoverUrl": ""
          }
    ],
    users: [{ id: 'admin', username: 'admin', name: 'Admin', role: 'admin', passwordHash }],
    students: [{ id: 'student-1', username: 'student', name: 'Student', active: true, borrowedBooks: [] }],
    classes: [], folders: [], history: [],
  };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label) {
  for (let i = 0; i < 250; i += 1) {
    if (predicate()) return;
    await delay(10);
  }
  throw Error('Timed out waiting for ' + label);
}

async function request(url, token, body) {
  const response = await fetch('http://127.0.0.1:' + PORT + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function mutation(method, url, token, data) {
  const response = await fetch('http://127.0.0.1:' + PORT + url, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-cover-write-race-'));
  const dbPath = path.join(temp, 'db.json');
  fs.writeFileSync(dbPath, JSON.stringify(dbFixture()));
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'mock-slow-cover-preload.js'), 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_COVER_RACE_DIR: temp,
      BOEKENBAAI_STATIC_DIR: path.join(ROOT, 'public') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLogs = '';
  child.stdout.on('data', (data) => { serverLogs += data.toString(); });
  child.stderr.on('data', (data) => { serverLogs += data.toString(); });
  function resetGate() {
    for (const file of ['started', 'release']) {
      try { fs.unlinkSync(path.join(temp, file)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  async function releaseOnce(call, name) {
    await waitFor(() => fs.existsSync(path.join(temp, 'started')), name + ' cover start');
    const result = await call();
    fs.writeFileSync(path.join(temp, 'release'), 'go');
    return result;
  }
  try {
    await waitFor(() => serverLogs.includes('Boekenbaai server draait'), 'server start');
    const login = await request('/api/login', null, { username: 'admin', password: 'admin-pass' });
    assert.equal(login.status, 200);
    const token = login.body.token;

    const bookA = await mutation('POST', '/api/books', token, {
      title: 'Borrowable book A', author: 'Test', barcode: '9780000000101',
    });
    assert.equal(bookA.status, 201);
    const idA = bookA.body.book.id;
    resetGate();

    // POST with slow image must not revert checkout of another book.
    const pendingCreate = mutation('POST', '/api/books', token, {
      title: 'Cover creates book C', author: 'Test', barcode: '9780000000103',
      coverUrl: 'https://covers.example.org/slow-create.png',
    });
    const checkoutA = await releaseOnce(
      () => mutation('POST', '/api/books/' + idA + '/check-out', token, { studentId: 'student-1' }),
      'POST');
    assert.equal(checkoutA.status, 200);
    assert.equal((await pendingCreate).status, 201);
    let current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(current.books.find((b) => b.id === idA).status, 'borrowed',
      'The delayed POST must preserve the simultaneous checkout');
    assert.equal(current.students[0].borrowedBooks.length, 1);
    assert(current.books.some((b) => b.barcode === '9780000000103'));
    assert(current.history.some((entry) => entry.type === 'check_out'));

    const bookB = await mutation('POST', '/api/books', token, {
      title: 'Borrowable book B', author: 'Test', barcode: '9780000000102',
    });
    assert.equal(bookB.status, 201);
    const idB = bookB.body.book.id;
    resetGate();

    // PUT with slow image must also preserve unrelated concurrent writes.
    const pendingPut = mutation('PUT', '/api/books/' + idB, token, {
      coverUrl: 'https://covers.example.org/slow-edit.png',
    });
    const otherBook = await releaseOnce(() => mutation('POST', '/api/books', token, {
      title: 'Concurrent unrelated book', author: 'Test', barcode: '9780000000104',
    }), 'PUT');
    assert.equal(otherBook.status, 201);
    assert.equal((await pendingPut).status, 200);
    current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert(current.books.some((b) => b.barcode === '9780000000104'),
      'Delayed PUT must retain other concurrently created books');

    resetGate();
    // Two writes to the SAME book cannot be safely rebased. Return 409
    // instead of undoing a checkout made during the cover download.
    const pendingConflict = mutation('PUT', '/api/books/' + idB, token, {
      coverUrl: 'https://covers.example.org/slow-conflict.png',
    });
    const checkoutB = await releaseOnce(
      () => mutation('POST', '/api/books/' + idB + '/check-out', token, { studentId: 'student-1' }),
      'PUT conflict');
    assert.equal(checkoutB.status, 200);
    const conflict = await pendingConflict;
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'DATABASE_WRITE_CONFLICT');
    current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(current.books.find((b) => b.id === idB).status, 'borrowed');
    assert.equal(current.students[0].borrowedBooks.length, 2);
    assert.equal(current.books.find((b) => b.id === idB).coverUrl,
      'https://covers.example.org/slow-edit.png', 'Conflicting cover edit must not overwrite checkout');

    // Editing a copy with a missing local image must keep a valid sibling's
    // cache, even when the two copies have different barcodes.
    const crop = { enabled: true, x: 35, y: 55, zoom: 1.45 };
    const sharedEdit = await mutation('PUT', '/api/books/edition-1', token, {
      coverUrl: 'https://covers.example.org/old-edition.png', coverCrop: crop,
    });
    assert.equal(sharedEdit.status, 200);
    current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    for (const id of ['edition-1', 'edition-2']) {
      const copy = current.books.find((entry) => entry.id === id);
      assert.equal(copy.localCoverUrl, '/api/covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
        'A good local cover on a sibling must be kept across same-edition barcodes');
      assert.deepEqual(copy.coverCrop, crop);
    }
    assert.equal(current.books.find((entry) => entry.id === 'edition-custom').coverUrl,
      'https://covers.example.org/custom-edition.png',
      'A separately selected cover must not be overwritten');

    // Renaming a physical copy moves it to a new catalog edition. A cover
    // edit in that same request must not affect the edition it leaves.
    const renamedCrop = { enabled: true, x: 60, y: 40, zoom: 1.2 };
    const movedEdit = await mutation('PUT', '/api/books/edition-1', token, {
      title: 'Separate title', coverUrl: 'https://covers.example.org/old-edition.png', coverCrop: renamedCrop,
    });
    assert.equal(movedEdit.status, 200);
    current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.deepEqual(current.books.find((entry) => entry.id === 'edition-1').coverCrop, renamedCrop);
    assert.deepEqual(current.books.find((entry) => entry.id === 'edition-2').coverCrop, crop,
      'Renaming a copy must not modify artwork of its former edition');

    resetGate();
    // A background localCoverUrl attachment is not a conflicting user edit.
    const cacheOnlyEdit = mutation('PUT', '/api/books/' + idB, token, {
      coverUrl: 'https://covers.example.org/slow-cacheonly.png',
    });
    await releaseOnce(async () => {
      const latest = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      latest.books.find((entry) => entry.id === idB).localCoverUrl =
        '/api/covers/' + 'b'.repeat(64) + '.png';
      fs.writeFileSync(dbPath, JSON.stringify(latest));
      return true;
    }, 'PUT cache-only');
    const cacheOnlyResult = await cacheOnlyEdit;
    assert.equal(cacheOnlyResult.status, 200,
      'An automatic local cache update must not trigger a false HTTP 409');
    current = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(current.books.find((entry) => entry.id === idB).coverUrl,
      'https://covers.example.org/slow-cacheonly.png');

    console.log('Cover concurrent create/edit/checkout regressions passed');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
