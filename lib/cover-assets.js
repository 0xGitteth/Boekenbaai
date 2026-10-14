'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const MAX_BYTES = 4 * 1024 * 1024;
const LOCAL_PATH = /^\/api\/covers\/([a-f0-9]{64})\.(jpg|png|webp|gif)$/;

function safeCoverUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw Error('invalid_cover_url');
  let target;
  try { target = new URL(input); } catch { throw Error('invalid_cover_url'); }
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password
    || target.port || !/^[a-z0-9.-]+$/i.test(target.hostname)
    || !target.hostname.includes('.') || net.isIP(target.hostname)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/i.test(target.hostname)) {
    throw Error('unsafe_cover_url');
  }
  return target;
}

function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const a = address.split('.').map(Number);
  if (a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224) return false;
  if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return false;
  if (a[0] === 169 && a[1] === 254) return false;
  if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return false;
  if (a[0] === 192 && (a[1] === 168 || a[1] === 0 || a[1] === 0 && a[2] === 0 || (a[1] === 88 && a[2] === 99))) return false;
  if (a[0] === 192 && a[1] === 0 && a[2] === 2) return false;
  if (a[0] === 198 && (a[1] === 18 || a[1] === 19 || (a[1] === 51 && a[2] === 100))) return false;
  if (a[0] === 203 && a[1] === 0 && a[2] === 113) return false;
  return true;
}

function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { ext: 'jpg', type: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', type: 'image/png' };
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF89a' || buffer.subarray(0, 6).toString('ascii') === 'GIF87a') return { ext: 'gif', type: 'image/gif' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

// One deadline covers DNS resolution, the HTTP response, and every redirect.
// The abort signal prevents a late DNS resolution from starting another request.
async function downloadCover(source, options = {}) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : 6500;
  const controller = new AbortController();
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(Error('cover_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchCoverStep(source, 0, controller.signal, options),
      deadline,
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw Error('cover_timeout');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

async function fetchCoverStep(source, hops, signal, options) {
  if (hops > 3) throw Error('cover_redirect_limit');
  if (signal.aborted) throw Error('cover_timeout');
  const url = safeCoverUrl(source);
  const resolveHost = options.lookup || dns.lookup.bind(dns);
  const answers = await resolveHost(url.hostname, { family: 4, all: true });
  if (signal.aborted) throw Error('cover_timeout');
  if (!Array.isArray(answers) || !answers.length
      || answers.some((answer) => !publicIPv4(answer.address))) {
    throw Error('cover_dns_not_public');
  }
  const pinnedAddress = answers[0].address;
  const response = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:'
      ? (options.httpsClient || https) : (options.httpClient || http);
    const request = transport.get(url, {
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif', 'User-Agent': 'Boekenbaai/1.0' },
      lookup(_hostname, _options, callback) { callback(null, pinnedAddress, 4); },
      family: 4, signal,
    }, (result) => {
      // Attach stream failure handlers *before* status/header rejection and
      // before resuming/destroying the stream. Otherwise a rejected response
      // can emit an uncaught 'error' and terminate the entire Node server.
      result.on('error', reject);
      if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
        const location = result.headers.location;
        result.resume();
        if (!location) { reject(Error('cover_missing_redirect')); return; }
        let redirectUrl;
        try {
          redirectUrl = new URL(location, url).href;
          safeCoverUrl(redirectUrl);
        } catch {
          reject(Error('cover_invalid_redirect'));
          return;
        }
        resolve({ redirect: redirectUrl });
        return;
      }
      if (result.statusCode !== 200) { result.resume(); reject(Error('cover_http_error')); return; }
      const mime = String(result.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mime && !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream'].includes(mime)) {
        result.resume(); reject(Error('cover_wrong_content_type')); return;
      }
      if (Number(result.headers['content-length']) > MAX_BYTES) {
        reject(Error('cover_too_large'));
        result.destroy();
        return;
      }
      const chunks = [];
      let length = 0;
      result.on('data', (chunk) => {
        length += chunk.length;
        if (length > MAX_BYTES) {
          reject(Error('cover_too_large'));
          result.destroy();
          return;
        }
        chunks.push(chunk);
      });
      let complete = false;
      result.on('end', () => {
        complete = true;
        resolve({ buffer: Buffer.concat(chunks) });
      });
      result.on('aborted', () => reject(Error('cover_incomplete')));
      result.on('close', () => {
        if (!complete) reject(Error('cover_incomplete'));
      });
    });
    request.on('error', reject);
  });
  if (response.redirect) return fetchCoverStep(response.redirect, hops + 1, signal, options);
  return response.buffer;
}

function createCoverAssetStore({ directory, downloader = downloadCover } = {}) {
  if (!directory || !path.isAbsolute(directory)) throw Error('cover_storage_directory_required');
  const inFlight = new Map();
  async function saveSource(source) {
    if (!source) return '';
    const local = typeof source === 'string' ? source.match(LOCAL_PATH) : null;
    if (local) {
      const stored = path.join(directory, local[1] + '.' + local[2]);
      if (fs.existsSync(stored)) return source;
      throw Error('missing_local_cover');
    }
    const url = safeCoverUrl(source).href;
    if (!inFlight.has(url)) {
      const task = (async () => {
        const buffer = await downloader(url);
        if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw Error('invalid_cover_bytes');
        const kind = imageType(buffer);
        if (!kind) throw Error('unsupported_cover_image');
        const id = crypto.createHash('sha256').update(buffer).digest('hex');
        await fs.promises.mkdir(directory, { recursive: true });
        const filename = id + '.' + kind.ext;
        const destination = path.join(directory, filename);
        if (!fs.existsSync(destination)) {
          const temporary = path.join(directory, '.' + crypto.randomUUID() + '.tmp');
          try {
            await fs.promises.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(temporary, destination);
          } finally {
            await fs.promises.rm(temporary, { force: true }).catch(() => {});
          }
        }
        return '/api/covers/' + filename;
      })();
      if (inFlight.size >= 5000) inFlight.clear();
      inFlight.set(url, task);
      // A completed promise cannot be kept forever: garbage collection may
      // later delete the file, and future requests must then re-download it.
      const release = () => {
        if (inFlight.get(url) === task) inFlight.delete(url);
      };
      task.then(release, release);
    }
    return inFlight.get(url);
  }
  // Never delete a shared image while any book references its content hash.
  // A grace period protects downloads not yet committed to the database.
  // The callback is evaluated immediately before synchronous unlink, so a
  // concurrently edited book cannot lose a newly linked asset mid-cleanup.
  function cleanupUnreferenced(getReferencedUrls, { minAgeMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
    if (typeof getReferencedUrls !== 'function') throw Error('cover_references_required');
    if (!fs.existsSync(directory)) return { removed: 0, retained: 0 };
    const refs = getReferencedUrls();
    if (!Array.isArray(refs)) throw Error('cover_references_invalid');
    const currentRefs = new Set(refs.filter((url) => typeof url === 'string'));
    let removed = 0;
    let retained = 0;
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/.test(name)
        && !/^\.[0-9a-f-]{36}\.tmp$/.test(name)) continue;
      const filename = path.join(directory, name);
      let stat;
      try { stat = fs.lstatSync(filename); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isFile() || (now - stat.mtimeMs) < minAgeMs) { retained++; continue; }
      if (currentRefs.has('/api/covers/' + name)) { retained++; continue; }
      try {
        fs.unlinkSync(filename);
        removed++;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return { removed, retained };
  }
  function hasAsset(localUrl) {
    if (typeof localUrl !== 'string') return false;
    const match = localUrl.match(LOCAL_PATH);
    return Boolean(match && fs.existsSync(path.join(directory, match[1] + '.' + match[2])));
  }
  function serve(req, res, pathname) {
    const found = pathname.match(LOCAL_PATH);
    if (!found) return false;
    const file = path.join(directory, found[1] + '.' + found[2]);
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Omslag niet gevonden'); return;
      }
      const types = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      res.writeHead(200, { 'Content-Type': types[found[2]], 'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
    return true;
  }
  return { saveSource, serve, hasAsset, cleanupUnreferenced };
}

module.exports = { safeCoverUrl, publicIPv4, imageType, downloadCover, createCoverAssetStore, LOCAL_PATH };
