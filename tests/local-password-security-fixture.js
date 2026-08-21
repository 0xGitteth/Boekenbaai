'use strict';

const http = require('http');
const { URL } = require('url');

const port = Number(process.env.PORT || 31451);

http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (requestUrl.pathname === '/health') {
    res.statusCode = 200;
    return res.end('ok');
  }
  if (requestUrl.pathname === '/api/test') {
    res.statusCode = 418;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ delegated: true }));
  }
  if (
    requestUrl.pathname === '/api/login-by-name' ||
    requestUrl.pathname === '/api/login' ||
    requestUrl.pathname === '/api/account/password'
  ) {
    res.statusCode = 599;
    return res.end('security preload did not intercept protected route');
  }
  res.statusCode = 404;
  return res.end('not found');
}).listen(port, '127.0.0.1');
