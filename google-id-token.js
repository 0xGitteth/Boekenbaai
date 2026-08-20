'use strict';

const crypto = require('crypto');
const { normalizeDomain, normalizeEmail, isAllowedSchoolEmail } = require('./google-auth-core');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ACCEPTED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const MAX_JWKS_TTL_MS = 24 * 60 * 60 * 1000;

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function decodeJsonSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(String(segment || ''), 'base64url').toString('utf8'));
  } catch (error) {
    const wrapped = new Error(`Google ID-token bevat ongeldige ${label}.`);
    wrapped.code = 'INVALID_ID_TOKEN';
    throw wrapped;
  }
}

function parseJwt(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    const error = new Error('Google ID-token heeft een ongeldig formaat.');
    error.code = 'INVALID_ID_TOKEN';
    throw error;
  }
  const header = decodeJsonSegment(parts[0], 'header');
  const payload = decodeJsonSegment(parts[1], 'payload');
  let signature;
  try {
    signature = Buffer.from(parts[2], 'base64url');
  } catch (error) {
    const wrapped = new Error('Google ID-token bevat een ongeldige handtekening.');
    wrapped.code = 'INVALID_ID_TOKEN';
    throw wrapped;
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

async function getSigningKey(kid, fetchFn, now) {
  let keys = await fetchJwks(fetchFn, { now });
  let key = keys.find((entry) => entry?.kid === kid && entry?.kty === 'RSA');
  if (!key) {
    keys = await fetchJwks(fetchFn, { force: true, now });
    key = keys.find((entry) => entry?.kid === kid && entry?.kty === 'RSA');
  }
  if (!key) {
    const error = new Error('Google ondertekeningssleutel is onbekend.');
    error.code = 'INVALID_ID_TOKEN';
    throw error;
  }
  return key;
}

function audienceMatches(aud, clientId) {
  if (Array.isArray(aud)) return aud.includes(clientId);
  return String(aud || '') === clientId;
}

function validateClaims(payload, { clientId, domain, now = Date.now() }) {
  const nowSeconds = Math.floor(now / 1000);
  if (!ACCEPTED_ISSUERS.has(String(payload?.iss || ''))) {
    throw new Error('Onverwachte Google issuer.');
  }
  if (!audienceMatches(payload?.aud, clientId)) {
    throw new Error('Google audience klopt niet.');
  }
  if (payload?.azp && String(payload.azp) !== clientId) {
    throw new Error('Google authorized party klopt niet.');
  }
  const expiresAt = Number(payload?.exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    throw new Error('Google ID-token is verlopen.');
  }
  const issuedAt = Number(payload?.iat);
  if (Number.isFinite(issuedAt) && issuedAt > nowSeconds + 60) {
    throw new Error('Google ID-token heeft een ongeldige uitgiftetijd.');
  }
  const normalizedDomain = normalizeDomain(domain);
  const hostedDomain = normalizeDomain(payload?.hd);
  const email = normalizeEmail(payload?.email);
  const emailVerified = payload?.email_verified === true || String(payload?.email_verified).toLowerCase() === 'true';
  if (!emailVerified) throw new Error('Google e-mailadres is niet geverifieerd.');
  if (hostedDomain !== normalizedDomain || !isAllowedSchoolEmail(email, normalizedDomain)) {
    const error = new Error(`Gebruik een @${normalizedDomain} account.`);
    error.code = 'WRONG_DOMAIN';
    throw error;
  }
  const sub = String(payload?.sub || '').trim();
  if (!sub) throw new Error('Google account-id ontbreekt.');
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
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!clientId || !domain || typeof fetchFn !== 'function') {
    const error = new Error('Google tokenverificatie is niet correct geconfigureerd.');
    error.code = 'GOOGLE_VERIFY_NOT_CONFIGURED';
    throw error;
  }

  const parsed = parseJwt(idToken);
  if (parsed.header?.alg !== 'RS256' || !parsed.header?.kid) {
    const error = new Error('Google ID-token gebruikt een ongeldige ondertekening.');
    error.code = 'INVALID_ID_TOKEN';
    throw error;
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
    const error = new Error('Google ID-token handtekening klopt niet.');
    error.code = 'INVALID_ID_TOKEN';
    throw error;
  }
  return validateClaims(parsed.payload, { clientId, domain, now });
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
