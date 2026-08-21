'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  MIN_NEW_PASSWORD_LENGTH,
  parseScryptHash,
  isScryptHash,
  isLegacySha256Hash,
  hashPassword,
  verifyPassword,
  validateNewPassword,
  LoginFailureLimiter,
} = require('../local-password-security-core');

function legacyHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

(async () => {
  const password = 'een sterke beheerpassphrase';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.ok(isScryptHash(first), 'Nieuwe wachtwoorden moeten scrypt gebruiken');
  assert.ok(isScryptHash(second), 'Tweede hash moet ook scrypt gebruiken');
  assert.notStrictEqual(first, second, 'Elk wachtwoord moet een unieke salt krijgen');

  const parsed = parseScryptHash(first);
  assert.strictEqual(parsed.N, SCRYPT_N);
  assert.strictEqual(parsed.r, SCRYPT_R);
  assert.strictEqual(parsed.p, SCRYPT_P);

  const correct = await verifyPassword(password, first);
  assert.strictEqual(correct.ok, true);
  assert.strictEqual(correct.needsUpgrade, false);
  assert.strictEqual(correct.scheme, 'scrypt');

  const wrong = await verifyPassword('zeker niet goed', first);
  assert.strictEqual(wrong.ok, false);
  assert.strictEqual(wrong.needsUpgrade, false);

  const legacy = legacyHash('oud-wachtwoord');
  assert.strictEqual(isLegacySha256Hash(legacy), true);
  const legacyCorrect = await verifyPassword('oud-wachtwoord', legacy);
  assert.strictEqual(legacyCorrect.ok, true);
  assert.strictEqual(legacyCorrect.needsUpgrade, true);
  assert.strictEqual(legacyCorrect.scheme, 'sha256');
  const legacyWrong = await verifyPassword('fout', legacy);
  assert.strictEqual(legacyWrong.ok, false);

  const pieces = first.split('$');
  pieces[2] = '262144';
  assert.strictEqual(
    parseScryptHash(pieces.join('$')),
    null,
    'Database-inhoud mag niet zelf veel duurdere scryptparameters kiezen'
  );

  assert.strictEqual(validateNewPassword('x'.repeat(MIN_NEW_PASSWORD_LENGTH - 1)).ok, false);
  assert.strictEqual(validateNewPassword('x'.repeat(MIN_NEW_PASSWORD_LENGTH)).ok, true);

  const limiter = new LoginFailureLimiter({
    perKeyWindowMs: 1000,
    perKeyMax: 2,
    globalWindowMs: 100,
    globalMax: 4,
  });
  assert.strictEqual(limiter.status('a', 1000).allowed, true);
  limiter.recordFailure('a', 1000);
  limiter.recordFailure('a', 1010);
  assert.strictEqual(limiter.status('a', 1020).allowed, false);
  assert.strictEqual(limiter.status('b', 1020).allowed, true);
  limiter.clearKey('a');
  assert.strictEqual(limiter.status('a', 1020).allowed, true);
  limiter.recordFailure('b', 1030);
  limiter.recordFailure('c', 1040);
  assert.strictEqual(
    limiter.status('d', 1050).allowed,
    false,
    'Globale korte limiet moet gedistribueerde brute-force afremmen'
  );
  assert.strictEqual(
    limiter.status('d', 1200).allowed,
    true,
    'Globale limiet moet na het korte venster vanzelf herstellen'
  );

  console.log('Local password security core tests geslaagd.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
