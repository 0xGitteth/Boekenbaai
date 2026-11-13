'use strict';

// Redirect safe browser navigation from the optional www hostname to the
// single canonical HTTPS origin. State-changing HTTP requests are NEVER
// redirected so the existing same-origin/CSRF protections remain enforced.
const CANONICAL_ORIGIN = 'https://boekenbaai.nl';
const WWW_HOST = /^www\.boekenbaai\.nl(?::443)?$/i;

function canonicalNavigationTarget(req) {
  if (!['GET', 'HEAD'].includes(String(req?.method || '').toUpperCase())) return '';
  // Use Host (the address the browser opened), not user-supplied Origin or
  // X-Forwarded-Host. The target is a fixed allowed origin.
  const host = String(req?.headers?.host || '').trim();
  if (!WWW_HOST.test(host)) return '';
  let path;
  try {
    const requested = new URL(String(req.url || '/'), CANONICAL_ORIGIN);
    path = requested.pathname + requested.search;
  } catch {
    return '';
  }
  return CANONICAL_ORIGIN + path;
}

function redirectCanonicalNavigation(req, res) {
  const destination = canonicalNavigationTarget(req);
  if (!destination) return false;
  res.statusCode = 308;
  res.setHeader('Location', destination);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end();
  return true;
}

module.exports = { canonicalNavigationTarget, redirectCanonicalNavigation };
