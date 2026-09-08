'use strict';

const assert = require('assert');
const http = require('http');
require('../release-hardening-preload');

let value = 0;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => resolve(JSON.parse(body || '{}')));
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/mentor/students') {
    res.statusCode = 404;
    res.end();
    return;
  }
  const snapshot = value;
  parseBody(req).then(() => {
    value = snapshot + 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ value }));
  }).catch((error) => {
    res.statusCode = 500;
    res.end(error.message);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const request = http.request({
    host: '127.0.0.1',
    port: address.port,
    path: '/api/mentor/students',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, (response) => {
    let raw = '';
    response.on('data', (chunk) => { raw += chunk.toString(); });
    response.on('end', () => {
      try {
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(JSON.parse(raw).value, 11);
        assert.strictEqual(value, 11, 'Listener moet pas na de volledig ontvangen body een state-snapshot nemen');
        console.log('Streamed body snapshot hardening test geslaagd.');
      } finally {
        server.close();
      }
    });
  });

  request.write('{"name":"');
  setTimeout(() => {
    value = 10;
    request.end('Sanne"}');
  }, 30);
});
