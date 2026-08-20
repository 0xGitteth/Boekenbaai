'use strict';

const crypto = require('crypto');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_IDENTITY_MAX_AGE_MS = 30 * 60 * 1000;

let localOnlyStaffAccountIds = new Set();

function setLocalOnlyStaffAccountIds(accountIds = []) {
  localOnlyStaffAccountIds = new Set(
    Array.from(accountIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function isLocalOnlyStaffAccount(accountType, accountId) {
  return accountType === 'staff' && localOnlyStaffAccountIds.has(String(accountId || '').trim());
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDomain(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^@/, '')
    : '';
}

function isAllowedSchoolEmail(email, domain) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedEmail || !normalizedDomain) return false;
  const at = normalizedEmail.lastIndexOf('@');
  if (at <= 0) return false;
  return normalizedEmail.slice(at + 1) === normalizedDomain;
}

function base64urlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignedState(payload, secret) {
  if (!secret) throw new Error('Auth secret ontbreekt');
  const encoded = base64urlEncode(JSON.stringify(payload || {}));
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifySignedState(state, secret, options = {}) {
  if (!state || !secret || !String(state).includes('.')) return null;
  const [encoded, signature, ...rest] = String(state).split('.');
  if (!encoded || !signature || rest.length) return null;
  const expected = sign(encoded, secret);
  if (!timingSafeEqualText(signature, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch (error) {
    return null;
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? options.maxAgeMs
    : OAUTH_STATE_MAX_AGE_MS;
  const issuedAt = Number(payload?.iat);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > maxAgeMs) {
    return null;
  }
  return payload;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function emptyAuthStore() {
  return {
    version: 1,
    links: [],
    sessions: [],
    pendingIdentities: [],
    linkRequests: [],
  };
}

function normalizeStore(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: 1,
    links: Array.isArray(source.links) ? source.links.filter(Boolean) : [],
    sessions: Array.isArray(source.sessions) ? source.sessions.filter(Boolean) : [],
    pendingIdentities: Array.isArray(source.pendingIdentities)
      ? source.pendingIdentities.filter(Boolean)
      : [],
    linkRequests: Array.isArray(source.linkRequests) ? source.linkRequests.filter(Boolean) : [],
  };
}

function pruneStore(store, now = Date.now()) {
  const safe = normalizeStore(store);
  safe.sessions = safe.sessions.filter((entry) => Number(entry?.expiresAt) > now);
  safe.pendingIdentities = safe.pendingIdentities.filter(
    (entry) => Number(entry?.expiresAt) > now
  );
  const historyCutoff = now - 90 * 24 * 60 * 60 * 1000;
  safe.linkRequests = safe.linkRequests.filter((entry) => {
    if (entry?.status === 'pending') return true;
    const updatedAt = Date.parse(entry?.updatedAt || entry?.createdAt || '');
    return Number.isFinite(updatedAt) ? updatedAt >= historyCutoff : true;
  });
  return safe;
}

function findLinkByAccount(store, accountType, accountId) {
  if (isLocalOnlyStaffAccount(accountType, accountId)) return null;
  return normalizeStore(store).links.find(
    (entry) => entry?.accountType === accountType && entry?.accountId === accountId
  ) || null;
}

function findLinkByIdentity(store, accountType, { email, sub } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedSub = typeof sub === 'string' ? sub.trim() : '';
  const links = normalizeStore(store).links.filter(
    (entry) =>
      entry?.accountType === accountType &&
      !isLocalOnlyStaffAccount(entry?.accountType, entry?.accountId)
  );
  if (normalizedSub) {
    const bySub = links.find((entry) => entry?.sub === normalizedSub);
    if (bySub) return bySub;
  }
  if (normalizedEmail) {
    return links.find(
      (entry) => !String(entry?.sub || '').trim() && normalizeEmail(entry?.email) === normalizedEmail
    ) || null;
  }
  return null;
}

function upsertLink(store, input) {
  const safe = normalizeStore(store);
  const accountType = input?.accountType;
  const accountId = input?.accountId;
  const email = normalizeEmail(input?.email);
  const sub = typeof input?.sub === 'string' ? input.sub.trim() : '';
  if (!['student', 'staff'].includes(accountType) || !accountId || !email) {
    const error = new Error('Ongeldige accountkoppeling');
    error.code = 'INVALID_LINK';
    throw error;
  }
  if (isLocalOnlyStaffAccount(accountType, accountId)) {
    const error = new Error('Dit beheeraccount gebruikt alleen lokale wachtwoordlogin.');
    error.code = 'LOCAL_ONLY_ACCOUNT';
    throw error;
  }

  const emailConflict = safe.links.find(
    (entry) =>
      !isLocalOnlyStaffAccount(entry?.accountType, entry?.accountId) &&
      normalizeEmail(entry?.email) === email &&
      !(entry?.accountType === accountType && entry?.accountId === accountId)
  );
  if (emailConflict) {
    const error = new Error('Dit Google e-mailadres is al aan een ander account gekoppeld.');
    error.code = 'EMAIL_CONFLICT';
    throw error;
  }

  if (sub) {
    const subConflict = safe.links.find(
      (entry) =>
        !isLocalOnlyStaffAccount(entry?.accountType, entry?.accountId) &&
        entry?.sub === sub &&
        !(entry?.accountType === accountType && entry?.accountId === accountId)
    );
    if (subConflict) {
      const error = new Error('Dit Google-account is al aan een ander account gekoppeld.');
      error.code = 'SUB_CONFLICT';
      throw error;
    }
  }

  const nowIso = new Date().toISOString();
  const existingIndex = safe.links.findIndex(
    (entry) => entry?.accountType === accountType && entry?.accountId === accountId
  );
  const existing = existingIndex >= 0 ? safe.links[existingIndex] : null;
  const emailChanged = existing && normalizeEmail(existing.email) !== email;
  const next = {
    accountType,
    accountId,
    email,
    sub: sub || (emailChanged ? '' : existing?.sub || ''),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    linkedBy: input?.linkedBy || existing?.linkedBy || null,
  };
  if (existingIndex >= 0) safe.links[existingIndex] = next;
  else safe.links.push(next);
  return { store: safe, link: next };
}

function createSessionRecord(token, input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const remember = Boolean(input.remember);
  const ttl = remember ? THIRTY_DAYS_MS : SESSION_WINDOW_MS;
  return {
    tokenHash: tokenHash(token),
    userId: input.userId,
    type: input.type,
    remember,
    createdAt: now,
    expiresAt: now + ttl,
  };
}

function upsertSession(store, token, input = {}) {
  const safe = pruneStore(store, Number.isFinite(input.now) ? input.now : Date.now());
  const record = createSessionRecord(token, input);
  safe.sessions = safe.sessions.filter((entry) => entry?.tokenHash !== record.tokenHash);
  safe.sessions.push(record);
  return { store: safe, session: record };
}

function resolveSession(store, token, now = Date.now()) {
  const hash = tokenHash(token);
  return pruneStore(store, now).sessions.find(
    (entry) => entry?.tokenHash === hash && Number(entry?.expiresAt) > now
  ) || null;
}

function removeSession(store, token) {
  const safe = normalizeStore(store);
  const hash = tokenHash(token);
  safe.sessions = safe.sessions.filter((entry) => entry?.tokenHash !== hash);
  return safe;
}

function getTeacherClassIds(db, teacherId) {
  const ids = new Set();
  const teacher = (db?.users || []).find((entry) => entry?.id === teacherId);
  for (const classId of teacher?.classIds || []) {
    if (classId) ids.add(classId);
  }
  for (const klass of db?.classes || []) {
    if ((klass?.teacherIds || []).includes(teacherId) && klass?.id) ids.add(klass.id);
  }
  return Array.from(ids);
}

function getStudentClassIds(db, studentId) {
  const ids = new Set();
  const student = (db?.students || []).find((entry) => entry?.id === studentId);
  for (const classId of student?.classIds || []) {
    if (classId) ids.add(classId);
  }
  for (const klass of db?.classes || []) {
    if ((klass?.studentIds || []).includes(studentId) && klass?.id) ids.add(klass.id);
  }
  return Array.from(ids);
}

function canStaffManageStudent(db, staffUser, studentId) {
  if (!staffUser || !studentId) return false;
  if (staffUser.role === 'admin') return true;
  if (staffUser.role !== 'teacher') return false;
  const teacherClasses = new Set(getTeacherClassIds(db, staffUser.id));
  return getStudentClassIds(db, studentId).some((classId) => teacherClasses.has(classId));
}

module.exports = {
  THIRTY_DAYS_MS,
  SESSION_WINDOW_MS,
  OAUTH_STATE_MAX_AGE_MS,
  PENDING_IDENTITY_MAX_AGE_MS,
  setLocalOnlyStaffAccountIds,
  isLocalOnlyStaffAccount,
  normalizeEmail,
  normalizeDomain,
  isAllowedSchoolEmail,
  createSignedState,
  verifySignedState,
  tokenHash,
  emptyAuthStore,
  normalizeStore,
  pruneStore,
  findLinkByAccount,
  findLinkByIdentity,
  upsertLink,
  createSessionRecord,
  upsertSession,
  resolveSession,
  removeSession,
  getTeacherClassIds,
  getStudentClassIds,
  canStaffManageStudent,
};
