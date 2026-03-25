const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4015;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(proc) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
    proc.stdout.on('data', (data) => {
      if (data.toString().includes(`http://localhost:${PORT}`)) {
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
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function login(username, password) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.strictEqual(response.status, 200, body.message || 'Login mislukt');
  return body.token;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createDbFixture(filePath) {
  const db = {
    books: [
      {
        id: 'book-1',
        title: 'Ruwe bronboek',
        author: 'Auteur Een',
        barcode: '11111',
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        easyReading: false,
        tags: ['juvenile fiction', 'friendship'],
      },
      {
        id: 'book-2',
        title: 'Handmatig thema',
        author: 'Auteur Twee',
        barcode: '22222',
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        easyReading: true,
        tags: ['easy reading', 'friendship'],
        manualThemes: ['Mysterie', 'Makkelijk Lezen'],
      },
      {
        id: 'book-3',
        title: 'Gemengde handmatige thema’s',
        author: 'Auteur Drie',
        barcode: '33333',
        status: 'available',
        borrowedBy: null,
        dueDate: null,
        easyReading: false,
        tags: ['adventure stories', 'friendship'],
        manualThemes: ['Fantasy', 'Psychische gezondheid', 'Spanning'],
      },
    ],
    students: [],
    folders: [],
    classes: [],
    users: [
      {
        id: 'a1',
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

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-manual-themes-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);

  const serverProcess = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT,
      BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(serverProcess);
    const adminToken = await login('admin', 'admin-pass');

    const listResponse = await request('/api/books');
    assert.strictEqual(listResponse.status, 200);
    const book1 = listResponse.body.find((book) => book.id === 'book-1');
    const book2 = listResponse.body.find((book) => book.id === 'book-2');
    const book3 = listResponse.body.find((book) => book.id === 'book-3');

    assert.deepStrictEqual(book1.tags, ['juvenile fiction', 'friendship']);
    assert.deepStrictEqual(book1.themes, ['Vriendschap']);
    assert.deepStrictEqual(book1.manualThemes, []);

    assert.deepStrictEqual(book2.tags, ['easy reading', 'friendship']);
    assert.deepStrictEqual(book2.manualThemes, ['Mysterie']);
    assert.deepStrictEqual(book2.themes, ['Mysterie']);
    assert.ok(!book2.themes.includes('Makkelijk Lezen'));
    assert.deepStrictEqual(book3.manualThemes, ['Psychische gezondheid', 'Fantasy', 'Spanning']);
    assert.deepStrictEqual(book3.themes, ['Psychische gezondheid', 'Fantasy', 'Spanning']);

    const updateResponse = await request('/api/books/book-1', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Ruwe bronboek',
        author: 'Auteur Een',
        barcode: '11111',
        tags: ['juvenile fiction', 'friendship'],
        manualThemes: ['Mysterie', 'Makkelijk Lezen'],
      }),
    });
    assert.strictEqual(updateResponse.status, 200);
    assert.deepStrictEqual(updateResponse.body.book.tags, ['juvenile fiction', 'friendship']);
    assert.deepStrictEqual(updateResponse.body.book.manualThemes, ['Mysterie']);
    assert.deepStrictEqual(updateResponse.body.book.themes, ['Mysterie']);

    const refetch = await request('/api/books/book-1');
    assert.strictEqual(refetch.status, 200);
    assert.deepStrictEqual(refetch.body.tags, ['juvenile fiction', 'friendship']);
    assert.deepStrictEqual(refetch.body.manualThemes, ['Mysterie']);
    assert.deepStrictEqual(refetch.body.themes, ['Mysterie']);

    const saveWithoutThemeChange = await request('/api/books/book-2', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Handmatig thema',
        author: 'Auteur Twee',
        barcode: '22222',
        tags: ['easy reading', 'friendship'],
        manualThemes: ['Mysterie'],
      }),
    });
    assert.strictEqual(saveWithoutThemeChange.status, 200);
    assert.deepStrictEqual(saveWithoutThemeChange.body.book.tags, ['easy reading', 'friendship']);
    assert.deepStrictEqual(saveWithoutThemeChange.body.book.manualThemes, ['Mysterie']);
    assert.deepStrictEqual(saveWithoutThemeChange.body.book.themes, ['Mysterie']);

    const updateMixedThemes = await request('/api/books/book-3', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Gemengde handmatige thema’s',
        author: 'Auteur Drie',
        barcode: '33333',
        tags: ['adventure stories', 'friendship'],
        manualThemes: ['Fantasy', 'Psychische gezondheid', 'Overleven', 'Makkelijk Lezen'],
      }),
    });
    assert.strictEqual(updateMixedThemes.status, 200);
    assert.deepStrictEqual(updateMixedThemes.body.book.tags, ['adventure stories', 'friendship']);
    assert.deepStrictEqual(updateMixedThemes.body.book.manualThemes, ['Psychische gezondheid', 'Overleven', 'Fantasy']);
    assert.deepStrictEqual(updateMixedThemes.body.book.themes, ['Psychische gezondheid', 'Overleven', 'Fantasy']);

    const postUpdateList = await request('/api/books');
    assert.strictEqual(postUpdateList.status, 200);
    const filtered = postUpdateList.body.filter((book) => (book.themes || []).includes('Mysterie'));
    assert.strictEqual(filtered.length, 2);

    console.log('Manual themes persistence tests passed');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
