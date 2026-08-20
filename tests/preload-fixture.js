'use strict';

const http = require('http');

const unrelatedBeforeThemes = new Map();
const EXACT_THEME_MAP = new Map([['x', 'y']]);
const unrelatedBeforeSessions = new Map();
const sessions = new Map();
const other = new Map();

if (process.env.SEED_LEGACY === '1') {
  sessions.set('legacy-token', {
    userId: 'teacher-1',
    type: 'staff',
    createdAt: Date.now(),
  });
}

http.createServer((req, res) => {
  if (req.url === '/api/me') {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    const session = match ? sessions.get(match[1]) : null;
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Niet ingelogd' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: session.userId, role: 'teacher', mustChangePassword: true }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><html><head></head><body><script type="module" src="app.js"></script></body></html>'
  );
}).listen(Number(process.env.PORT || 31337));

void unrelatedBeforeThemes;
void EXACT_THEME_MAP;
void unrelatedBeforeSessions;
void other;
