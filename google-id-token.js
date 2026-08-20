'use strict';

const crypto = require('crypto');
const { normalizeDomain, normalizeEmail, isAllowedSchoolEmail } = require('./google-auth-core');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ACCEPTED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const MAX_JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ID_TOKEN_LENGTH = 16 * 1024;

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function invalidToken(message) {
  const error = new Error(message);
  error.code = 'INVALID_ID_TOKEN';
  return error;
}

function decodeJsonSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(String(segment || ''), 'base64url').toString('utf8'));
  } catch (error) {
    throw invalidToken(`Google ID-token bevat ongeldige ${label}.`);
  }
}

function parseJwt(idToken) {
  const raw = String(idToken || '');
  if (!raw || raw.length > MAX_ID_TOKEN_LENGTH) {
    throw invalidToken('Google ID-token heeft een ongeldig formaat.');
  }
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw invalidToken('Google ID-token heeft een ongeldig formaat.');
  }
  const header = decodeJsonSegment(parts[0], 'header');
  const payload = decodeJsonSegment(parts[1], 'payload');
  let signature;
  try {
    signature = Buffer.from(parts[2], 'base64url');
  } catch (error) {
    throw invalidToken('Google ID-token bevat een ongeldige handtekening.');
  }
  return {
    header,
    payload,
    signature,
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

function getCacheMaxAgeMs(response) {
  const header = String(response?.headers?.get?.('cache-control') || '');
  const match = header.match(/(?:^|,)\s*max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_JWKS_TTL_MS;
  return Math.min(seconds * 1000, MAX_JWKS_TTL_MS);
}

async function fetchJwks(fetchFn, { force = false, now = Date.now() } = {}) {
  if (!force && cachedJwks && cachedJwksExpiresAt > now) {
    return cachedJwks;
  }
  const response = await fetchFn(GOOGLE_JWKS_URL, {
    headers: { Accept: 'application/json' },
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
  });
  if (!response?.ok) {
    const error = new Error(`Google certificaten konden niet worden opgehaald (${response?.status || 'onbekend'}).`);
    error.code = 'GOOGLE_KEYS_UNAVAILABLE';
    throw error;
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.keys) || !payload.keys.length) {
    const error = new Error('Google certificaatantwoord bevat geen sleutels.');
    error.code = 'GOOGLE_KEYS_UNAVAILABLE';
    throw error;
  }
  cachedJwks = payload.keys;
  cachedJwksExpiresAt = now + getCacheMaxAgeMs(response);
  return cachedJwks;
}

function isUsableSigningKey(entry, kid) {
  return Boolean(
    entry?.kid === kid &&
    entry?.kty === 'RSA' &&
    (!entry?.use || entry.use === 'sig') &&
    (!entry?.alg || entry.alg === 'RS256')
  );
}

async function getSigningKey(kid, fetchFn, now) {
  let keys = await fetchJwks(fetchFn, { now });
  let key = keys.find((entry) => isUsableSigningKey(entry, kid));
  if (!key) {
    keys = await fetchJwks(fetchFn, { force: true, now });
    key = keys.find((entry) => isUsableSigningKey(entry, kid));
  }
  if (!key) {
    throw invalidToken('Google ondertekeningssleutel is onbekend.');
  }
  return key;
}

function audienceMatches(aud, clientId) {
  if (Array.isArray(aud)) return aud.includes(clientId);
  return String(aud || '') === clientId;
}

function validateClaims(payload, { clientId, domain, expectedNonce = '', now = Date.now() }) {
  const nowSeconds = Math.floor(now / 1000);
  if (!ACCEPTED_ISSUERS.has(String(payload?.iss || ''))) {
    throw invalidToken('Onverwachte Google issuer.');
  }
  if (!audienceMatches(payload?.aud, clientId)) {
    throw invalidToken('Google audience klopt niet.');
  }
  if (payload?.azp && String(payload.azp) !== clientId) {
    throw invalidToken('Google authorized party klopt niet.');
  }
  const expiresAt = Number(payload?.exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    throw invalidToken('Google ID-token is verlopen.');
  }
  const issuedAt = Number(payload?.iat);
  if (!Number.isFinite(issuedAt) || issuedAt > nowSeconds + 60) {
    throw invalidToken('Google ID-token heeft een ongeldige uitgiftetijd.');
  }
  if (expectedNonce && String(payload?.nonce || '') !== expectedNonce) {
    throw invalidToken('Google ID-token hoort niet bij deze loginpoging.');
  }
  const normalizedDomain = normalizeDomain(domain);
  const hostedDomain = normalizeDomain(payload?.hd);
  const email = normalizeEmail(payload?.email);
  const emailVerified = payload?.email_verified === true || String(payload?.email_verified).toLowerCase() === 'true';
  if (!emailVerified) throw invalidToken('Google e-mailadres is niet geverifieerd.');
  if (hostedDomain !== normalizedDomain || !isAllowedSchoolEmail(email, normalizedDomain)) {
    const error = new Error(`Gebruik een @${normalizedDomain} account.`);
    error.code = 'WRONG_DOMAIN';
    throw error;
  }
  const sub = String(payload?.sub || '').trim();
  if (!sub) throw invalidToken('Google account-id ontbreekt.');
  return {
    sub,
    email,
    name: String(payload?.name || email).trim(),
    givenName: String(payload?.given_name || '').trim(),
  };
}

async function verifyGoogleIdToken(idToken, options = {}) {
  const clientId = String(options.clientId || '').trim();
  const domain = normalizeDomain(options.domain);
  const expectedNonce = String(options.expectedNonce || '');
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!clientId || !domain || typeof fetchFn !== 'function') {
    const error = new Error('Google tokenverificatie is niet correct geconfigureerd.');
    error.code = 'GOOGLE_VERIFY_NOT_CONFIGURED';
    throw error;
  }

  const parsed = parseJwt(idToken);
  if (parsed.header?.alg !== 'RS256' || !parsed.header?.kid) {
    throw invalidToken('Google ID-token gebruikt een ongeldige ondertekening.');
  }

  const jwk = await getSigningKey(String(parsed.header.kid), fetchFn, now);
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (error) {
    const wrapped = new Error('Google ondertekeningssleutel kon niet worden gelezen.');
    wrapped.code = 'GOOGLE_KEYS_UNAVAILABLE';
    throw wrapped;
  }
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parsed.signingInput),
    publicKey,
    parsed.signature
  );
  if (!validSignature) {
    throw invalidToken('Google ID-token handtekening klopt niet.');
  }
  return validateClaims(parsed.payload, { clientId, domain, expectedNonce, now });
}

function resetJwksCacheForTests() {
  cachedJwks = null;
  cachedJwksExpiresAt = 0;
}

module.exports = {
  GOOGLE_JWKS_URL,
  parseJwt,
  validateClaims,
  verifyGoogleIdToken,
  resetJwksCacheForTests,
};
