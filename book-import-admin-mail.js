'use strict';
// The shared admin login has no Google email identity. Administrators manage
// a distinct list of VERIFIED delivery addresses, not Google-linked accounts.
const crypto = require('node:crypto');
const { validEmail, verificationHash, DAY_MS } = require('./book-import-reminder-mail');
const DEFAULT_CATEGORIES = Object.freeze({ transfers: true, google: true, books: true });
const MAX_ADDRESSES = 10;
const CATEGORY_KEYS = Object.keys(DEFAULT_CATEGORIES);
function normalizedCategories(value, fallback = DEFAULT_CATEGORIES) {
  return Object.fromEntries(CATEGORY_KEYS.map(key => [key,
    value && typeof value[key] === 'boolean' ? value[key] : fallback[key] !== false]));
}
function validCategoryUpdate(candidate) {
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join(',') === 'books,google,transfers'
    && Object.values(candidate).every(x => typeof x === 'boolean');
}
function adminSettings(db) {
  const source = db.bookImportAdminMail || {};
  const sourceCategories = source.categories || {};
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    categories: normalizedCategories(sourceCategories),
    recipients: (Array.isArray(source.recipients) ? source.recipients : [])
      .filter(row => row && validEmail(row.email))
      .slice(0, MAX_ADDRESSES)
      .map(row => ({
        email: validEmail(row.email),
        verifiedAt: typeof row.verifiedAt === 'string' ? row.verifiedAt : '',
        pending: row.pending || null,
        // Legacy shared preferences are inherited for *each* existing address,
        // so migration never changes who receives an existing category.
        categories: normalizedCategories(row.categories, normalizedCategories(sourceCategories)),
      })),
    verificationRequests: Array.isArray(source.verificationRequests)
      ? source.verificationRequests.filter(Number.isSafeInteger).slice(-3) : [],
    lastRequestAt: Number.isSafeInteger(source.lastRequestAt) ? source.lastRequestAt : 0,
  };
}
function saveSettings(db, settings) {
  db.bookImportAdminMail = { ...settings, revision: settings.revision + 1 };
}
function requestAddress(db, email, secret, now = Date.now()) {
  const normalized = validEmail(email);
  if (!normalized) return { ok: false, error: 'invalid_email' };
  const settings = adminSettings(db);
  const existing = settings.recipients.find(x => x.email === normalized);
  if (existing?.verifiedAt) return { ok: false, error: 'already_verified' };
  if (!existing && settings.recipients.length >= MAX_ADDRESSES) {
    return { ok: false, error: 'too_many_recipients' };
  }
  if (settings.lastRequestAt && now - settings.lastRequestAt < 300000) {
    return { ok: false, error: 'rate_limited' };
  }
  const recent = settings.verificationRequests.filter(t => t <= now && t > now - DAY_MS);
  if (recent.length >= 3) return { ok: false, error: 'daily_limit' };
  const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  const pending = { hash: verificationHash('admin', normalized, code, secret),
    requestedAt: now, expiresAt: now + DAY_MS, attempts: 0 };
  if (existing) existing.pending = pending;
  else settings.recipients.push({ email: normalized, verifiedAt: '', pending,
    categories: { ...settings.categories } });
  settings.verificationRequests = [...recent, now];
  settings.lastRequestAt = now;
  saveSettings(db, settings);
  return { ok: true, email: normalized, code, hash: pending.hash };
}
function confirmAddress(db, email, code, secret, now = Date.now()) {
  const settings = adminSettings(db);
  const row = settings.recipients.find(x => x.email === validEmail(email));
  const pending = row?.pending;
  if (!pending || !Number.isSafeInteger(pending.attempts)
    || pending.attempts >= 5 || pending.expiresAt < now
    || !/^[0-9a-f]{64}$/.test(pending.hash || '')
    || !/^\d{8}$/.test(String(code))) return { ok: false, error: 'invalid_or_expired' };
  const candidate = verificationHash('admin', row.email, String(code), secret);
  if (!crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(pending.hash))) {
    pending.attempts++;
    saveSettings(db, settings);
    return { ok: false, error: 'invalid_code', persist: true };
  }
  row.verifiedAt = new Date(now).toISOString();
  row.pending = null;
  saveSettings(db, settings);
  return { ok: true, email: row.email };
}
function removeAddress(db, email) {
  const settings = adminSettings(db);
  const before = settings.recipients.length;
  settings.recipients = settings.recipients.filter(x => x.email !== validEmail(email));
  if (settings.recipients.length === before) return false;
  saveSettings(db, settings);
  return true;
}
// Kept for older clients and existing tests, but now updates the inherited
// defaults for all recipients, preserving backward compatibility. The v3.1
// interface uses updateRecipientCategories and never invokes this action.
function updateCategories(db, candidate) {
  if (!validCategoryUpdate(candidate)) return false;
  const settings = adminSettings(db);
  settings.categories = { ...candidate };
  settings.recipients = settings.recipients.map(row => ({
    ...row, categories: { ...candidate },
  }));
  saveSettings(db, settings);
  return true;
}
function updateRecipientCategories(db, email, candidate) {
  if (!validCategoryUpdate(candidate)) return false;
  const normalized = validEmail(email);
  if (!normalized) return false;
  const settings = adminSettings(db);
  const recipient = settings.recipients.find(row => row.email === normalized && row.verifiedAt);
  if (!recipient) return false;
  recipient.categories = { ...candidate };
  saveSettings(db, settings);
  return true;
}
function publicSettings(db, ready) {
  const settings = adminSettings(db);
  return { deliveryConfigured: Boolean(ready), categories: settings.categories,
    recipients: settings.recipients.map(row => ({
      email: row.email, verified: Boolean(row.verifiedAt),
      pending: Boolean(row.pending),
      categories: { ...row.categories },
    })) };
}
module.exports = { adminSettings, requestAddress, confirmAddress, removeAddress,
  updateCategories, updateRecipientCategories, publicSettings, MAX_ADDRESSES };
