'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createCoverAssetStore, safeCoverUrl, imageType, publicIPv4, downloadCover } = require('../lib/cover-assets');

const {dimensions,usableDimensions}=require('../lib/cover-dimensions');
const TINY=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvmkAAAAASUVORK5CYII=','base64');
const TINY_GIF=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAB4CAIAAADqjOKhAAAApElEQVR4nO3PAQ3AIADAMEALStCCfw138Sd7q2Cb+9zxJ+vrgLcZrjNcZ7jOcJ3hOsN1husM1xmuM1xnuM5wneE6w3WG6wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1xnuM5wneE6w3WG6wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1xnuO4Bj2YBuolyvV4AAAAASUVORK5CYII=',
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
  // The entire request, including a stalled DNS resolver, must be bounded.
  await assert.rejects(downloadCover('https://covers.example.org/slow.png', {
    lookup: () => new Promise(() => {}),
    timeoutMs: 30,
  }), /cover_timeout/);

  // A malformed Location header is a recoverable bad source, never an
  // uncaught exception from the HTTP response event callback.
  const redirected = {
    get(_url, _options, onResponse) {
      const request = new EventEmitter();
      process.nextTick(() => {
        const response = new PassThrough();
        response.statusCode = 302;
        response.headers = { location: 'http://[malformed' };
        onResponse(response);
        response.end();
      });
      return request;
    },
  };
  await assert.rejects(downloadCover('https://covers.example.org/redirect.png', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    httpsClient: redirected,
    timeoutMs: 500,
  }), /cover_invalid_redirect/);


  // Exercise all failure paths using real Node streams. None of these may
  // emit an unhandled stream error, crash the server or silently save a
  // truncated/oversized image.
  async function mockedCoverResponse({ status = 200, headers = {}, body = null,
    disconnect = false, errorAfterResponse = false }) {
    const client = {
      get(_url, _options, onResponse) {
        const request = new EventEmitter();
        process.nextTick(() => {
          const response = new PassThrough();
          response.statusCode = status;
          response.headers = headers;
          onResponse(response);
          if (errorAfterResponse) {
            response.destroy(Error('upstream_stream_error'));
          } else if (disconnect) {
            response.write(PNG.subarray(0, 10));
            response.destroy();
          } else if (body) {
            response.end(body);
          } else {
            response.end();
          }
        });
        return request;
      },
    };
    return downloadCover('https://covers.example.org/test-cover.png', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      httpsClient: client, timeoutMs: 500,
    });
  }
  await assert.rejects(mockedCoverResponse({
    headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
    errorAfterResponse: true,
  }), /cover_too_large/, 'Oversized Content-Length must reject, not emit uncaught errors');
  await assert.rejects(mockedCoverResponse({
    headers: { 'content-type': 'image/png' },
    body: Buffer.alloc(4 * 1024 * 1024 + 1),
  }), /cover_too_large/, 'Oversized streamed response must reject');
  await assert.rejects(mockedCoverResponse({
    status: 503, errorAfterResponse: true,
  }), /cover_http_error/, 'Invalid HTTP status must safely drain/error');
  await assert.rejects(mockedCoverResponse({
    headers: { 'content-type': 'text/html' }, errorAfterResponse: true,
  }), /cover_wrong_content_type/, 'Unexpected content type must safely reject');
  await assert.rejects(mockedCoverResponse({
    headers: { 'content-type': 'image/png' }, disconnect: true,
  }), /cover_incomplete/, 'Incomplete response must not become an image asset');
  const mockedSuccess = await mockedCoverResponse({
    headers: { 'content-type': 'image/png' }, body: PNG,
  });
  assert.deepEqual(mockedSuccess, PNG, 'Valid image bytes must remain unchanged');

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boekenbaai-covers-'));
  let server;
  try {
    assert.equal(usableDimensions(TINY),null);
    assert.equal(usableDimensions(TINY_GIF),null);
    assert.deepEqual(dimensions(PNG),{width:80,height:120,format:'png'});
    assert.equal(usableDimensions(PNG.subarray(0,30)),null);
    // The original 80x120 PNG is valid; corrupted or fake pixels must not
    // become valid solely because their IHDR has plausible dimensions.
    const corrupt=Buffer.from(PNG);
    corrupt[45]^=1;
    assert.equal(usableDimensions(corrupt),null,'Reject bad PNG chunk CRC');
    const badScan=Buffer.from(PNG);
    const idat=33, idatLength=badScan.readUInt32BE(idat);
    badScan[idat+8]=0; // Invalid zlib header, but repair the chunk CRC.
    badScan.writeUInt32BE(require('node:zlib').crc32(
      badScan.subarray(idat+4,idat+8+idatLength)),idat+8+idatLength);
    assert.equal(usableDimensions(badScan),null,'Reject invalid compressed PNG with correct CRC');
    const spoofedGif=Buffer.from(TINY_GIF);
    spoofedGif.writeUInt16LE(80,6);spoofedGif.writeUInt16LE(120,8);
    assert.equal(usableDimensions(spoofedGif),null,'Reject a one-pixel frame on a large GIF canvas');
    const gif=Buffer.from('R0lGODdhUAB4AIEAADdklgAAAAAAAAAAACwAAAAAUAB4AEAInwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK04YEAA7','base64');
    assert.deepEqual(usableDimensions(gif),{width:80,height:120,format:'gif'});
    const webp=Buffer.from('UklGRlYAAABXRUJQVlA4IEoAAAAQBQCdASpQAHgAPm02mUmkIqKhIMgAgA2JaQB2AAAMb3U30bUOcZQD3U30bUOcZP9AAP7uQx//3BmfV2OH/8bzea1YgAAAAAAAAA==','base64');
    assert.deepEqual(usableDimensions(webp),{width:80,height:120,format:'webp'});
    const fakeWebp=Buffer.from(webp.subarray(0,30));
    fakeWebp.writeUInt32LE(fakeWebp.length-8,4);
    fakeWebp.writeUInt32LE(10,16);
    assert.equal(usableDimensions(fakeWebp),null,'Reject WebP dimensions with no frame data');
    // The frame tag declares a 40-byte first partition, but this RIFF
    // contains only two payload bytes after the keyframe header.
    const truncatedWebp=Buffer.from(webp.subarray(0,32));
    truncatedWebp.writeUInt32LE(truncatedWebp.length-8,4);
    truncatedWebp.writeUInt32LE(12,16);
    assert.equal(truncatedWebp.readUIntLE(20,3)>>>5,40);
    assert.equal(usableDimensions(truncatedWebp),null,'Reject truncated first VP8 partition');
    // A first partition that consumes the entire payload also leaves no
    // compressed token data.
    const noTokensWebp=Buffer.from(webp.subarray(0,70));
    noTokensWebp.writeUInt32LE(noTokensWebp.length-8,4);
    noTokensWebp.writeUInt32LE(50,16);
    assert.equal(usableDimensions(noTokensWebp),null,'Require data beyond the VP8 first partition');
    const webpDirectory=path.join(root,'invalid-webp');
    fs.mkdirSync(webpDirectory);
    const webpStore=createCoverAssetStore({directory:webpDirectory,downloader:async()=>truncatedWebp});
    await assert.rejects(webpStore.saveSource('https://covers.example.org/truncated.webp'),/invalid_cover_dimensions/);
    assert.deepEqual(fs.readdirSync(webpDirectory),[]);
    const truncatedName=crypto.createHash('sha256').update(truncatedWebp).digest('hex')+'.webp';
    fs.writeFileSync(path.join(webpDirectory,truncatedName),truncatedWebp);
    assert.equal(webpStore.assetStatus('/api/covers/'+truncatedName),'invalid');
    // A JPEG with SOF but no valid scan must be rejected even if it ends in EOI.
    const fakeJpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x78,0x00,0x50,0x01,0x01,0x11,0x00,0xff,0xda]),Buffer.from([0xff,0xd9])]);
    assert.equal(usableDimensions(fakeJpeg),null);

    const invalidDirectory=path.join(root,'invalid');
    fs.mkdirSync(invalidDirectory);
    const invalidStore=createCoverAssetStore({directory:invalidDirectory,downloader:async()=>TINY_GIF});
    await assert.rejects(invalidStore.saveSource('https://covers.example.org/pixel.gif'),/invalid_cover_dimensions/);
    assert.deepEqual(fs.readdirSync(invalidDirectory),[]);
    const invalidName=crypto.createHash('sha256').update(TINY_GIF).digest('hex')+'.gif';
    fs.writeFileSync(path.join(invalidDirectory,invalidName),TINY_GIF);
    const invalidPath='/api/covers/'+invalidName;
    assert.equal(invalidStore.assetStatus(invalidPath),'invalid');
    assert.equal(invalidStore.hasAsset(invalidPath),false);
    await assert.rejects(invalidStore.saveSource(invalidPath),/invalid_cover_dimensions/);
    assert.equal(fs.existsSync(path.join(invalidDirectory,invalidName)),true,'Historical file is not silently deleted');
    // Run the real server's cleanup function with a real on-disk database
    // and asset store. The normalized view has already cleared the link,
    // while the raw database still needs to persist that rejection.
    const legacyFile=path.join(invalidDirectory,invalidName);
    const legacyAge=new Date(Date.now()-3*24*60*60*1000);
    fs.utimesSync(legacyFile,legacyAge,legacyAge);
    const legacySource='https://covers.example.org/pixel.gif';
    const legacyDbPath=path.join(root,'legacy.json');
    const legacyBook={id:'legacy',coverUrl:legacySource,localCoverUrl:invalidPath,
      coverCrop:{x:0.1,y:0.1,width:0.8,height:0.8}};
    const writeLegacy=books=>fs.writeFileSync(legacyDbPath,JSON.stringify({books}));
    writeLegacy([legacyBook]);
    const serverCode=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const cleanupStart=serverCode.indexOf('function runCoverGarbageCollection() {');
    const cleanupEnd=serverCode.indexOf('const DIST_DIR',cleanupStart);
    assert.ok(cleanupStart>=0&&cleanupEnd>cleanupStart);
    const {readJsonSnapshot}=require('../database-write-coordinator');
    const normalizedBook={...legacyBook,localCoverUrl:'',coverCrop:null,rejectedCoverSource:legacySource};
    const gc=new Function('coverAssets','readJsonSnapshot','DATA_PATH','loadDb','shuttingDown','console',
      serverCode.slice(cleanupStart,cleanupEnd)+'\nreturn runCoverGarbageCollection;')(
      invalidStore,readJsonSnapshot,legacyDbPath,()=>({books:[normalizedBook]}),false,
      {info(){},warn(message,error){throw Error(message+' '+error);}});
    gc();
    assert.equal(invalidStore.assetStatus(invalidPath),'invalid',
      'GC must retain the invalid file while its rejection is only in memory');
    // Another copy of the same cover is enough to keep the raw reference.
    writeLegacy([normalizedBook,{...legacyBook,id:'legacy-copy'}]);
    gc();
    assert.equal(invalidStore.assetStatus(invalidPath),'invalid','Keep any remaining persisted reference');
    // Once the normalized rejection is committed, the file is safe to remove.
    writeLegacy([normalizedBook]);
    gc();
    assert.equal(invalidStore.assetStatus(invalidPath),'missing');
    const persisted=readJsonSnapshot(legacyDbPath).books[0];
    assert.equal(persisted.localCoverUrl,'');
    assert.equal(persisted.coverCrop,null);
    assert.equal(persisted.rejectedCoverSource,legacySource);
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
    assert.equal(store.hasAsset(first), true);
    assert.equal(store.hasAsset('/api/covers/' + '0'.repeat(64) + '.png'), false);
    assert.equal(calls, 1);
    assert.deepEqual(await fs.promises.readFile(path.join(root, 'covers', digest + '.png')), PNG);
    assert.equal(await store.saveSource('https://covers.example.org/two.png'), first);
    assert.equal(await store.saveSource(first), first);
    assert.equal(calls, 2);
    // Shared hashes are retained when any book still refers to them.
    const savedFile = path.join(root, 'covers', digest + '.png');
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    fs.utimesSync(savedFile, old, old);
    const protectedSweep = store.cleanupUnreferenced(() => [first]);
    assert.equal(protectedSweep.removed, 0);
    assert.equal(store.hasAsset(first), true);
    const abandonedTmp = path.join(root, 'covers', '.' + crypto.randomUUID() + '.tmp');
    fs.writeFileSync(abandonedTmp, PNG);
    fs.utimesSync(abandonedTmp, old, old);
    const sweep = store.cleanupUnreferenced(() => []);
    assert.equal(sweep.removed, 2);
    assert.equal(fs.existsSync(abandonedTmp), false);
    assert.equal(store.hasAsset(first), false);
    // Deleting the last reference must not leave a cached resolved Promise
    // which returns an image path whose file no longer exists.
    assert.equal(await store.saveSource('https://covers.example.org/one.png'), first);
    assert.equal(calls, 3);
    assert.equal(store.hasAsset(first), true);
    // A transient upstream failure must not permanently poison the in-flight
    // cache; retrying the same image source should start a new download.
    let attempts = 0;
    const flakyStore = createCoverAssetStore({
      directory: path.join(root, 'flaky'),
      downloader: async () => {
        attempts++;
        if (attempts === 1) throw Error('temporary_upstream_failure');
        return PNG;
      },
    });
    await assert.rejects(flakyStore.saveSource('https://covers.example.org/flaky.png'),
      /temporary_upstream_failure/);
    assert.equal(await flakyStore.saveSource('https://covers.example.org/flaky.png'), first);
    assert.equal(attempts, 2);
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
