'use strict';

const http = require('http');

http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ delegated: true, path: req.url }));
}).listen(Number(process.env.PORT || 31431));
