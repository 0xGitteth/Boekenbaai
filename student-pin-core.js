'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PIN_PATTERN = /^[0-9]{6}$/;
const KEY_LENGTH = 32;
const KDF_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const PIN_VERSION = 1;

function validPin(pin) {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

function configuredSecret(env = process.env) {
  const value = String(env.BOEKENBAAI_PIN_SECRET
    || env.BOEKENBAAI_AUTH_SECRET
    || env.BOEKENBAAI_GOOGLE_CLIENT_SECRET
    || env.GOOGLE_CLIENT_SECRET
    || '');
  return value.length >= 16 ? value : '';
}

function credentialFor(store, studentId) {
  if (!Array.isArray(store?.studentPins)) return null;
  return store.studentPins.find(entry =>
    entry && entry.studentId === studentId) || null;
}

function currentGeneration(record) {
  return Number.isSafeInteger(record?.generation) && record.generation >= 0
    ? record.generation : 0;
}

function pepperedPin(pin, studentId, secret) {
  if (!secret || !studentId) throw new Error('pin_secret_missing');
  return crypto.createHmac('sha256', secret)
    .update('boekenbaai:pin:v1\0', 'utf8')
    .update(studentId, 'utf8')
    .update('\0', 'utf8')
    .update(pin, 'utf8')
    .digest();
}

async function derive(pin, studentId, secret, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  if (salt.length !== 16) throw new Error('pin_bad_salt');
  const value = pepperedPin(pin, studentId, secret);
  try {
    return await scrypt(value, salt, KEY_LENGTH, KDF_OPTIONS);
  } finally {
    value.fill(0);
  }
}

async function makeCredential(pin, studentId, secret, previous = null, linkedSub = '') {
  if (!validPin(pin)) throw new Error('pin_invalid_format');
  if (!secret || !studentId || !linkedSub) throw new Error('pin_no_verified_identity');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await derive(pin, studentId, secret, salt)).toString('hex');
  return {
    studentId, version: PIN_VERSION, salt, hash,
    generation: currentGeneration(previous) + 1,
    linkedSub, updatedAt: new Date().toISOString(),
  };
}

async function verifyCredential(pin, studentId, secret, credential, currentLinkedSub) {
  if (!validPin(pin) || !secret || !credential
    || credential.studentId !== studentId
    || credential.version !== PIN_VERSION
    || !credential.hash || !credential.salt || !currentLinkedSub
    || credential.linkedSub !== currentLinkedSub
    || !/^[0-9a-f]{64}$/i.test(credential.hash)
    || !/^[0-9a-f]{32}$/i.test(credential.salt)) return false;
  const actual = await derive(pin, studentId, secret, credential.salt);
  const expected = Buffer.from(credential.hash, 'hex');
  return crypto.timingSafeEqual(actual, expected);
}

function replaceCredential(store, next) {
  const pins = Array.isArray(store.studentPins) ? store.studentPins : [];
  store.studentPins = pins.filter(entry => entry?.studentId !== next.studentId);
  store.studentPins.push(next);
  return store;
}

function resetCredential(store, studentId, previous = null) {
  // Keep a generation tombstone: short-lived checkout grants issued by a
  // future PIN verification flow must not survive an administrative reset.
  return replaceCredential(store, {
    studentId, version: PIN_VERSION, salt: '', hash: '',
    generation: currentGeneration(previous) + 1,
    linkedSub: '', updatedAt: new Date().toISOString(),
  });
}

module.exports = {
  validPin, configuredSecret, credentialFor, currentGeneration,
  makeCredential, verifyCredential, replaceCredential, resetCredential,
};
