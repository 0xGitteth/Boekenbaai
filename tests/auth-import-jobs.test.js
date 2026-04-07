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
      { Titel: 'Boek 3', Auteur: 'Auteur 3', Barcode: '9781234567892' },
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
    let sawRunningProgress = false;
    let lastProcessed = -1;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const statusResponse = await request(`/api/books/import-jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(statusResponse.status, 200);
      job = statusResponse.body;
      if (job.status === 'running') {
        if (Number(job.processed) > 0) {
          sawRunningProgress = true;
        }
        assert.ok(Number(job.processed) >= lastProcessed, 'processed mag niet teruglopen');
        lastProcessed = Number(job.processed);
      }
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
    assert.ok(typeof job.currentStage === 'string', 'job.currentStage ontbreekt');
    assert.ok(
      job.lastProgressAt === null || typeof job.lastProgressAt === 'string',
      'job.lastProgressAt ontbreekt'
    );
    assert.ok(typeof job.cancelRequested === 'boolean', 'job.cancelRequested ontbreekt');
    assert.ok(sawRunningProgress || job.processed === job.total, 'running progress niet waargenomen');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function testImportJobCancelLifecycle() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-job-cancel-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);
  const serverProcess = startServer(dbPath);

  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const rows = Array.from({ length: 250 }, (_, index) => ({
      Titel: `Boek ${index + 1}`,
      Auteur: `Auteur ${index + 1}`,
      Barcode: `978${String(1000000000 + index).slice(0, 10)}`,
    }));
    const workbookBase64 = buildWorkbookBase64(rows);
    const startResponse = await request('/api/books/import-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64, fileName: 'cancel.xlsx', enrichIsbn: false }),
    });
    assert.ok([200, 202].includes(startResponse.status), `Onverwachte startstatus: ${startResponse.status}`);
    const jobId = startResponse.body.jobId;
    assert.ok(jobId, 'jobId ontbreekt');

    let runningSeen = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await request(`/api/books/import-jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(statusResponse.status, 200);
      if (statusResponse.body.status === 'running') {
        runningSeen = true;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert.ok(runningSeen, 'Importjob kwam niet in running status');

    const cancelResponse = await request(`/api/books/import-jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(cancelResponse.status, 200);
    assert.ok(
      ['running', 'cancelled'].includes(cancelResponse.body.status),
      `Onverwachte cancelstatus: ${cancelResponse.body.status}`
    );
    assert.ok(cancelResponse.body.cancelRequested, 'cancelRequested werd niet gezet');

    let finalJob = cancelResponse.body;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await request(`/api/books/import-jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(statusResponse.status, 200);
      finalJob = statusResponse.body;
      if (finalJob.status === 'cancelled') {
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    assert.strictEqual(finalJob.status, 'cancelled');
    assert.ok(typeof finalJob.cancelledAt === 'string' && finalJob.cancelledAt, 'cancelledAt ontbreekt');
    assert.ok(finalJob.processed <= finalJob.total, 'processed mag total niet overschrijden');
  } finally {
    serverProcess.kill('SIGINT');
  }
}

async function testImmediateCancelBeforeStart() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-job-cancel-queued-'));
  const dbPath = path.join(tempDir, 'db.json');
  createDbFixture(dbPath);
  const serverProcess = startServer(dbPath);
  try {
    await waitForServer(serverProcess);
    const token = await loginAdmin();
    const rows = Array.from({ length: 200 }, (_, index) => ({
      Titel: `QBoek ${index + 1}`,
      Auteur: `QAuteur ${index + 1}`,
      Barcode: `978${String(2000000000 + index).slice(0, 10)}`,
    }));
    const workbookBase64 = buildWorkbookBase64(rows);
    const startResponse = await request('/api/books/import-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ file: workbookBase64, fileName: 'queued-cancel.xlsx', enrichIsbn: false }),
    });
    assert.ok([200, 202].includes(startResponse.status), `Onverwachte startstatus: ${startResponse.status}`);
    const jobId = startResponse.body.jobId;
    assert.ok(jobId, 'jobId ontbreekt');

    const cancelResponse = await request(`/api/books/import-jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(cancelResponse.status, 200);

    let finalJob = cancelResponse.body;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statusResponse = await request(`/api/books/import-jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(statusResponse.status, 200);
      finalJob = statusResponse.body;
      if (finalJob.status === 'cancelled') {
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    assert.strictEqual(finalJob.status, 'cancelled');
    assert.strictEqual(Number(finalJob.processed), 0, 'Queued-cancel zou niet mogen starten met verwerken');
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
  await testImportJobCancelLifecycle();
  await testImmediateCancelBeforeStart();
  await testInterruptedJobsOnRestart();
  console.log('Auth/import job tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
