const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const PORT = 4021;
const BASE_URL = `http://localhost:${PORT}`;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function buildWorkbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer.toString('base64');
}

function createDbFixture(filePath, overrides = {}) {
  const db = {
    books: [],
    students: [
      {
        id: 'student-1',
        name: 'Student Een',
        username: 'student1',
        passwordHash: hashPassword('student-pass'),
        grade: '1A',
        borrowedBooks: [],
        classIds: [],
      },
    ],
    classes: [],
    folders: [],
    users: [
      {
        id: 'admin-1',
        name: 'Admin',
        username: 'admin',
        passwordHash: hashPassword('admin-pass'),
        role: 'admin',
      },
    ],
    history: [],
    importJobs: [],
    ...overrides,
  };
  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

function startServer(dbPath) {
  return spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT,
      BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.join(__dirname, '..', 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

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

async function loginAdmin() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass' }),
  });
  assert.strictEqual(response.status, 200);
  return response.body.token;
}

async function testAuthFrontendRegressionGuards() {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf-8');
  assert.ok(appJs.includes("error.code = 'ROLE_MISMATCH'"), 'ROLE_MISMATCH marker ontbreekt');
  assert.ok(
    appJs.includes("if (error?.code === 'ROLE_MISMATCH') {") && appJs.includes('clearAuth();'),
    'Bootstrap-afhandeling voor role mismatch ontbreekt'
  );
  assert.ok(
    appJs.includes('currentBookImportJobId = null;'),
    'currentBookImportJobId moet gereset worden bij uitloggen/auth reset'
  );
  assert.ok(
    appJs.includes('localStorage.getItem(getBookImportStorageKey()) || currentBookImportJobId'),
    'refreshStaffData moet eerst user-gebonden localStorage key gebruiken'
  );
}

async function testImportJobLifecycle() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-job-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);
  const serverProcess = startServer(dbPath);

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const workbookBase64 = buildWorkbookBase64([
      { Titel: 'Boek 1', Auteur: 'Auteur 1', Barcode: '9781234567890' },
      { Titel: 'Boek 2', Auteur: 'Auteur 2', Barcode: '9781234567891' },
    ]);

    const startResponse = await request('/api/books/import-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64, fileName: 'test.xlsx' }),
    });
    assert.ok([200, 202].includes(startResponse.status), `Onverwachte startstatus: ${startResponse.status}`);
    const jobId = startResponse.body.jobId;
    assert.ok(jobId, 'jobId ontbreekt');

    let job = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const statusResponse = await request(`/api/books/import-jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(statusResponse.status, 200);
      job = statusResponse.body;
      if (job.status === 'completed' || job.status === 'failed') {
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    assert.ok(job, 'Jobstatus ontbreekt');
    assert.ok(['completed', 'failed'].includes(job.status), `Onverwachte jobstatus: ${job.status}`);
    assert.ok(Number.isFinite(job.total), 'job.total ontbreekt');
    assert.ok(Number.isFinite(job.processed), 'job.processed ontbreekt');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function testInterruptedJobsOnRestart() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-job-restart-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath, {
    importJobs: [
      {
        id: 'job-running',
        type: 'books_import',
        createdBy: 'admin-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
      },
    ],
  });

  const serverProcess = startServer(dbPath);
  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const response = await request('/api/books/import-jobs/job-running', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'interrupted');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function run() {
  await testAuthFrontendRegressionGuards();
  await testImportJobLifecycle();
  await testInterruptedJobsOnRestart();
  console.log('Auth/import job tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
