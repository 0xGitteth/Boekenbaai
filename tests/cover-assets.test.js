'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCoverAssetStore, safeCoverUrl, imageType, publicIPv4 } = require('../lib/cover-assets');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvmkAAAAASUVORK5CYII=',
  'base64',
);

async function main() {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1/test.png',
    'http://localhost/img.png', 'https://user:pass@books.example.org/i.png',
    'http://169.254.169.254/metadata', 'https://books.example.org:8080/i.png',
    'https://books.example.org@127.0.0.1/image.png']) {
    assert.throws(() => safeCoverUrl(url), /invalid_cover_url|unsafe_cover_url/);
  }
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.1.2', '192.168.3.5',
    '169.254.169.254', '100.64.0.1', '198.18.0.1', '::1']) {
    assert.equal(publicIPv4(ip), false, ip);
  }
  assert.equal(publicIPv4('8.8.8.8'), true);
  assert.equal(imageType(PNG).ext, 'png');
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boekenbaai-covers-'));
  let server;
  try {
    let calls = 0;
    const store = createCoverAssetStore({ directory: path.join(root, 'covers'),
      downloader: async () => { calls += 1; await Promise.resolve(); return PNG; } });
    const [first, repeated] = await Promise.all([
      store.saveSource('https://covers.example.org/one.png'),
      store.saveSource('https://covers.example.org/one.png'),
    ]);
    const digest = crypto.createHash('sha256').update(PNG).digest('hex');
    assert.equal(first, '/api/covers/' + digest + '.png');
    assert.equal(repeated, first);
    assert.equal(calls, 1);
    assert.deepEqual(await fs.promises.readFile(path.join(root, 'covers', digest + '.png')), PNG);
    assert.equal(await store.saveSource('https://covers.example.org/two.png'), first);
    assert.equal(await store.saveSource(first), first);
    assert.equal(calls, 2);
    await assert.rejects(store.saveSource('/api/covers/' + '0'.repeat(64) + '.png'), /missing_local_cover/);
    server = http.createServer((req, res) => {
      if (!store.serve(req, res, new URL(req.url, 'http://localhost').pathname)) res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + first);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control').includes('immutable'), true);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    const absent = await fetch('http://127.0.0.1:' + server.address().port
      + '/api/covers/' + '0'.repeat(64) + '.png');
    assert.equal(absent.status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('Local cover asset validation passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
