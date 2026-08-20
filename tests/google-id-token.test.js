'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  verifyGoogleIdToken,
  resetJwksCacheForTests,
} = require('../google-id-token');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
publicJwk.kid = 'test-key';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeToken(overrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key', ...headerOverrides };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    azp: 'client-id',
    sub: 'google-sub-1',
    email: 'leerling@koraaledu.nl',
    email_verified: true,
    hd: 'koraaledu.nl',
    name: 'Leerling Test',
    given_name: 'Leerling',
    nonce: 'test-nonce',
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function makeFetchCounter(keys = [publicJwk]) {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name) => String(name).toLowerCase() === 'cache-control'
          ? 'public, max-age=3600'
          : null,
      },
      json: async () => ({ keys }),
    };
  };
  return { fetchFn, get calls() { return calls; } };
}

function verify(token, fetchFn, overrides = {}) {
  return verifyGoogleIdToken(token, {
    clientId: 'client-id',
    domain: 'koraaledu.nl',
    expectedNonce: 'test-nonce',
    fetchFn,
    ...overrides,
  });
}

(async () => {
  resetJwksCacheForTests();
  const counter = makeFetchCounter();
  const identity = await verify(makeToken(), counter.fetchFn);
  assert.deepStrictEqual(identity, {
    sub: 'google-sub-1',
    email: 'leerling@koraaledu.nl',
    name: 'Leerling Test',
    givenName: 'Leerling',
  });
  assert.strictEqual(counter.calls, 1);

  await verify(makeToken({ sub: 'google-sub-2' }), counter.fetchFn);
  assert.strictEqual(counter.calls, 1, 'JWKS moet binnen max-age uit cache komen');

  await verify(
    makeToken({ aud: ['client-id', 'andere-audience'], azp: 'client-id' }),
    counter.fetchFn
  );
  await assert.rejects(
    () => verify(
      makeToken({ aud: ['client-id', 'andere-audience'], azp: undefined }),
      counter.fetchFn
    ),
    /authorized party/
  );
  await assert.rejects(
    () => verify(
      makeToken({ aud: ['client-id', 'andere-audience'], azp: 'andere-client' }),
      counter.fetchFn
    ),
    /authorized party/
  );

  const valid = makeToken();
  const [header, payload, signature] = valid.split('.');
  const tamperedPayload = encodeJson({
    ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    sub: 'aanvaller',
  });
  await assert.rejects(
    () => verify(`${header}.${tamperedPayload}.${signature}`, counter.fetchFn),
    /handtekening/
  );

  await assert.rejects(
    () => verify(makeToken({ aud: 'ander-client', azp: 'ander-client' }), counter.fetchFn),
    /audience/
  );
  await assert.rejects(
    () => verify(makeToken({ hd: 'gmail.com', email: 'leerling@gmail.com' }), counter.fetchFn),
    /@koraaledu\.nl/
  );
  await assert.rejects(
    () => verify(makeToken({ email_verified: false }), counter.fetchFn),
    /niet geverifieerd/
  );
  await assert.rejects(
    () => verify(makeToken({ exp: Math.floor(Date.now() / 1000) - 1 }), counter.fetchFn),
    /verlopen/
  );
  await assert.rejects(
    () => verify(makeToken({ iat: 'geen-tijd' }), counter.fetchFn),
    /uitgiftetijd/
  );
  await assert.rejects(
    () => verify(makeToken({ nonce: 'andere-login' }), counter.fetchFn),
    /loginpoging/
  );
  await assert.rejects(
    () => verify(makeToken({}, { alg: 'HS256' }), counter.fetchFn),
    /ongeldige ondertekening/
  );
  await assert.rejects(
    () => verify('x'.repeat(16 * 1024 + 1), counter.fetchFn),
    /ongeldig formaat/
  );

  resetJwksCacheForTests();
  const wrongUseJwk = { ...publicJwk, use: 'enc' };
  const wrongKeyCounter = makeFetchCounter([wrongUseJwk]);
  await assert.rejects(
    () => verify(makeToken(), wrongKeyCounter.fetchFn),
    /ondertekeningssleutel is onbekend/
  );
  assert.strictEqual(wrongKeyCounter.calls, 2, 'Onbekende signing key moet één geforceerde refresh proberen');

  console.log('Google ID-token verificatietests geslaagd.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
