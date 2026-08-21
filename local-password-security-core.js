'use strict';

const crypto = require('crypto');

const SCRYPT_VERSION = 'v1';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const MIN_NEW_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const LEGACY_SHA256_RE = /^[a-f0-9]{64}$/i;
const DUMMY_SALT = crypto.randomBytes(SCRYPT_SALT_BYTES);

function normalizePassword(value) {
  return typeof value === 'string' ? value : String(value || '');
}

function deriveScrypt(password, salt, { N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      normalizePassword(password),
      salt,
      SCRYPT_KEY_LENGTH,
      { N, r, p, maxmem: SCRYPT_MAXMEM },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
}

function safeEqual(left, right) {
  if (!Buffer.isBuffer(left)) left = Buffer.from(left || '');
  if (!Buffer.isBuffer(right)) right = Buffer.from(right || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseScryptHash(storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== SCRYPT_VERSION) return null;
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  // v1 heeft één vaste, gereviewde kostenconfiguratie. Een databasewaarde mag
  // niet zelf bepalen hoeveel CPU/geheugen een loginverificatie verbruikt.
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;

  let salt;
  let hash;
  try {
    salt = Buffer.from(parts[5], 'base64url');
    hash = Buffer.from(parts[6], 'base64url');
  } catch (error) {
    return null;
  }
  if (salt.length !== SCRYPT_SALT_BYTES || hash.length !== SCRYPT_KEY_LENGTH) return null;
  return { N, r, p, salt, hash };
}

function isScryptHash(storedHash) {
  return Boolean(parseScryptHash(storedHash));
}

function isLegacySha256Hash(storedHash) {
  return LEGACY_SHA256_RE.test(String(storedHash || ''));
}

async function hashPassword(password) {
  const normalized = normalizePassword(password);
  if (!normalized || normalized.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Ongeldig wachtwoord');
  }
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = await deriveScrypt(normalized, salt);
  return [
    'scrypt',
    SCRYPT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

async function verifyPassword(password, storedHash) {
  const normalized = normalizePassword(password);
  if (!normalized || normalized.length > MAX_PASSWORD_LENGTH) {
    await deriveScrypt('invalid-password-length', DUMMY_SALT);
    return { ok: false, needsUpgrade: false, scheme: 'invalid' };
  }

  const parsed = parseScryptHash(storedHash);
  if (parsed) {
    const derived = await deriveScrypt(normalized, parsed.salt, parsed);
    return {
      ok: safeEqual(derived, parsed.hash),
      needsUpgrade: false,
      scheme: 'scrypt',
    };
  }

  if (isLegacySha256Hash(storedHash)) {
    // Geef ook legacy-controles de scrypt-kosten. Zo blijft het oude publieke
    // SHA-256-formaat niet als goedkope online brute-force route beschikbaar
    // in de korte periode vóór de eerste succesvolle migratielogin.
    await deriveScrypt(normalized, DUMMY_SALT);
    const expected = Buffer.from(String(storedHash).toLowerCase(), 'hex');
    const actual = crypto.createHash('sha256').update(normalized).digest();
    const ok = safeEqual(actual, expected);
    return { ok, needsUpgrade: ok, scheme: 'sha256' };
  }

  // Onbekend of leeg formaat: voer nog steeds dezelfde dure afleiding uit om
  // account-/hashformaat-timing zo min mogelijk prijs te geven.
  await deriveScrypt(normalized, DUMMY_SALT);
  return { ok: false, needsUpgrade: false, scheme: 'unknown' };
}

async function burnPasswordAttempt(password) {
  const normalized = normalizePassword(password).slice(0, MAX_PASSWORD_LENGTH) || 'missing-password';
  await deriveScrypt(normalized, DUMMY_SALT);
}

function validateNewPassword(password) {
  const normalized = normalizePassword(password);
  if (normalized.length < MIN_NEW_PASSWORD_LENGTH) {
    return { ok: false, message: `Kies een nieuw wachtwoord van minimaal ${MIN_NEW_PASSWORD_LENGTH} tekens.` };
  }
  if (normalized.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `Kies een wachtwoord van maximaal ${MAX_PASSWORD_LENGTH} tekens.` };
  }
  return { ok: true, password: normalized };
}

class LoginFailureLimiter {
  constructor({
    perKeyWindowMs = 10 * 60 * 1000,
    perKeyMax = 8,
    globalWindowMs = 60 * 1000,
    globalMax = 60,
  } = {}) {
    this.perKeyWindowMs = perKeyWindowMs;
    this.perKeyMax = perKeyMax;
    this.globalWindowMs = globalWindowMs;
    this.globalMax = globalMax;
    this.byKey = new Map();
    this.globalEvents = [];
  }

  _prune(now) {
    const globalCutoff = now - this.globalWindowMs;
    this.globalEvents = this.globalEvents.filter((time) => time > globalCutoff);
    const keyCutoff = now - this.perKeyWindowMs;
    for (const [key, events] of this.byKey.entries()) {
      const fresh = events.filter((time) => time > keyCutoff);
      if (fresh.length) this.byKey.set(key, fresh);
      else this.byKey.delete(key);
    }
  }

  status(key, now = Date.now()) {
    this._prune(now);
    const keyEvents = this.byKey.get(key) || [];
    if (keyEvents.length >= this.perKeyMax) {
      const retryAt = keyEvents[0] + this.perKeyWindowMs;
      return { allowed: false, scope: 'client', retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
    }
    if (this.globalEvents.length >= this.globalMax) {
      const retryAt = this.globalEvents[0] + this.globalWindowMs;
      return { allowed: false, scope: 'global', retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(key, now = Date.now()) {
    this._prune(now);
    const events = this.byKey.get(key) || [];
    events.push(now);
    this.byKey.set(key, events);
    this.globalEvents.push(now);
  }

  clearKey(key) {
    this.byKey.delete(key);
  }
}

module.exports = {
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  MIN_NEW_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  parseScryptHash,
  isScryptHash,
  isLegacySha256Hash,
  hashPassword,
  verifyPassword,
  burnPasswordAttempt,
  validateNewPassword,
  LoginFailureLimiter,
};
