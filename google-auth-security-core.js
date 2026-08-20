'use strict';

const crypto = require('crypto');
const { tokenHash } = require('./google-auth-core');

const GOOGLE_SESSION_PATHS = new Set([
  '/api/auth/google/callback',
  '/api/auth/google/link-request',
  '/api/auth/google/pending/complete',
]);

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(String(value)).origin;
  } catch (error) {
    return '';
  }
}

function getExpectedOrigin(req, configuredPublicUrl = '') {
  const configured = normalizeOrigin(configuredPublicUrl);
  if (configured) return configured;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || (req?.socket?.encrypted ? 'https' : 'http');
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  return host ? normalizeOrigin(`${protocol}://${host}`) : '';
}

function isMutationRequest(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

function isSameOriginMutation(req, expectedOrigin) {
  if (!isMutationRequest(req?.method)) return true;
  const origin = normalizeOrigin(req?.headers?.origin);
  if (origin) return Boolean(expectedOrigin) && origin === expectedOrigin;
  const fetchSite = String(req?.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  return fetchSite === 'same-origin';
}

function accountCredentialFingerprint(account) {
  if (!account?.id) return '';
  const material = [
    account.id,
    account.passwordHash || '',
    account.role || 'student',
    account.mustChangePassword ? '1' : '0',
  ].join('\u0000');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function findAccountForSession(db, session) {
  if (!session?.userId) return null;
  if (session.type === 'student') {
    const student = (db?.students || []).find((entry) => entry?.id === session.userId);
    return student ? { ...student, role: 'student' } : null;
  }
  return (
    (db?.users || []).find(
      (entry) => entry?.id === session.userId && ['teacher', 'admin'].includes(entry?.role)
    ) || null
  );
}

function validatePersistedSession(store, token, db, now = Date.now()) {
  const hash = tokenHash(token);
  const session = (store?.sessions || []).find((entry) => entry?.tokenHash === hash) || null;
  if (!session) return { valid: false, reason: 'missing', tokenHash: hash };
  if (!Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) <= now) {
    return { valid: false, reason: 'expired', tokenHash: hash, session };
  }
  const account = findAccountForSession(db, session);
  if (!account) return { valid: false, reason: 'account-missing', tokenHash: hash, session };
  const currentFingerprint = accountCredentialFingerprint(account);
  if (!session.accountFingerprint) {
    return { valid: false, reason: 'legacy-session', tokenHash: hash, session, account };
  }
  if (session.accountFingerprint !== currentFingerprint) {
    return { valid: false, reason: 'credentials-changed', tokenHash: hash, session, account };
  }
  return { valid: true, tokenHash: hash, session, account };
}

function classifySessionAuthMethod(pathname) {
  return GOOGLE_SESSION_PATHS.has(String(pathname || '')) ? 'google' : 'password';
}

function decorateSessionResult(result, db, pathname) {
  const session = result?.session;
  if (!session) return result;
  const account = findAccountForSession(db, session);
  if (!account) return result;
  session.accountFingerprint = accountCredentialFingerprint(account);
  session.authMethod = classifySessionAuthMethod(pathname);
  const stored = (result.store?.sessions || []).find(
    (entry) => entry?.tokenHash === session.tokenHash
  );
  if (stored) {
    stored.accountFingerprint = session.accountFingerprint;
    stored.authMethod = session.authMethod;
  }
  return result;
}

module.exports = {
  normalizeOrigin,
  getExpectedOrigin,
  isMutationRequest,
  isSameOriginMutation,
  accountCredentialFingerprint,
  findAccountForSession,
  validatePersistedSession,
  classifySessionAuthMethod,
  decorateSessionResult,
};