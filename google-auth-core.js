'use strict';

const crypto = require('crypto');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_IDENTITY_MAX_AGE_MS = 30 * 60 * 1000;
const PENDING_LINK_REQUEST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_REQUEST_HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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

  const parts = normalizedEmail.split('@');
  if (parts.length !== 2) return false;
  const [localPart, emailDomain] = parts;
  if (!localPart || emailDomain !== normalizedDomain) return false;
  if (/\s/.test(localPart) || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) return false;
  return true;
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
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : OAUTH_STATE_MAX_AGE_MS;
  if (!Number.isFinite(payload?.iat) || payload.iat > now + 60_000 || now - payload.iat > maxAgeMs) return null;
  return payload;
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
  const store = input && typeof input === 'object' ? input : {};
  return {
    version: Number(store.version) || 1,
    links: Array.isArray(store.links) ? store.links.filter(Boolean) : [],
    sessions: Array.isArray(store.sessions) ? store.sessions.filter(Boolean) : [],
    pendingIdentities: Array.isArray(store.pendingIdentities) ? store.pendingIdentities.filter(Boolean) : [],
    linkRequests: Array.isArray(store.linkRequests) ? store.linkRequests.filter(Boolean) : [],
  };
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function pruneStore(input, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const store = normalizeStore(input);
  store.sessions = store.sessions.filter((session) => {
    const expiresAt = Number(session?.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
  store.pendingIdentities = store.pendingIdentities.filter((identity) => {
    const expiresAt = Number(identity?.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
  store.linkRequests = store.linkRequests.filter((request) => {
    const status = String(request?.status || 'open');
    const createdAt = timestamp(request?.createdAt);
    const resolvedAt = timestamp(request?.resolvedAt || request?.updatedAt);
    if (status === 'open') return !createdAt || now - createdAt <= PENDING_LINK_REQUEST_MAX_AGE_MS;
    return !resolvedAt || now - resolvedAt <= LINK_REQUEST_HISTORY_MAX_AGE_MS;
  });
  return store;
}

function findLinkByAccount(store, accountType, accountId) {
  return normalizeStore(store).links.find(
    (link) => link?.accountType === accountType && link?.accountId === accountId
  ) || null;
}

function findLinkBySub(store, sub) {
  if (!sub) return null;
  return normalizeStore(store).links.find((link) => link?.sub === sub) || null;
}

function findLinkByEmail(store, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return normalizeStore(store).links.find((link) => normalizeEmail(link?.email) === normalized) || null;
}

function findLinkByIdentity(store, accountType, identity = {}) {
  const normalized = normalizeStore(store);
  const sub = String(identity?.sub || '').trim();
  if (sub) {
    const bySub = normalized.links.find((link) => link?.accountType === accountType && link?.sub === sub) || null;
    if (bySub) return bySub;
  }
  const email = normalizeEmail(identity?.email);
  if (!email) return null;
  return normalized.links.find(
    (link) => link?.accountType === accountType && !link?.sub && normalizeEmail(link?.email) === email
  ) || null;
}

function upsertLink(input, values = {}) {
  const store = normalizeStore(input);
  const accountType = values.accountType;
  const accountId = String(values.accountId || '').trim();
  const email = normalizeEmail(values.email);
  const sub = String(values.sub || '').trim();
  if (!['student', 'staff'].includes(accountType) || !accountId) {
    throw new Error('Ongeldige accountkoppeling');
  }
  if (isLocalOnlyStaffAccount(accountType, accountId)) {
    throw new Error('Dit beheeraccount is alleen lokaal en kan niet aan Google worden gekoppeld');
  }
  const bySub = sub ? findLinkBySub(store, sub) : null;
  if (bySub && (bySub.accountType !== accountType || bySub.accountId !== accountId)) {
    throw new Error('Dit Google-account is al aan een ander account gekoppeld');
  }
  const byEmail = email ? findLinkByEmail(store, email) : null;
  if (byEmail && byEmail.sub && sub && byEmail.sub !== sub) {
    throw new Error('Dit schoolmailadres is al aan een ander Google-account gekoppeld');
  }
  if (byEmail && (byEmail.accountType !== accountType || byEmail.accountId !== accountId)) {
    throw new Error('Dit schoolmailadres is al aan een ander account gekoppeld');
  }
  const existingIndex = store.links.findIndex(
    (link) => link?.accountType === accountType && link?.accountId === accountId
  );
  const existing = existingIndex >= 0 ? store.links[existingIndex] : null;
  if (existing?.sub && sub && existing.sub !== sub) {
    throw new Error('Dit account is al aan een ander Google-account gekoppeld');
  }
  const link = {
    ...(existing || {}),
    accountType,
    accountId,
    email: email || existing?.email || '',
    sub: sub || existing?.sub || '',
    updatedAt: new Date().toISOString(),
  };
  if (!link.createdAt) link.createdAt = link.updatedAt;
  if (existingIndex >= 0) store.links[existingIndex] = link;
  else store.links.push(link);
  return { store, link };
}

function removeLink(input, accountType, accountId) {
  const store = normalizeStore(input);
  const before = store.links.length;
  store.links = store.links.filter(
    (link) => !(link?.accountType === accountType && link?.accountId === accountId)
  );
  return { store, removed: before !== store.links.length };
}

function sessionLifetime(remember) {
  return remember ? THIRTY_DAYS_MS : SESSION_WINDOW_MS;
}

function upsertSession(input, token, values = {}) {
  const store = normalizeStore(input);
  const cleanToken = String(token || '').trim();
  const userId = String(values.userId || '').trim();
  const type = values.type;
  if (!cleanToken || !userId || !['student', 'staff'].includes(type)) {
    throw new Error('Ongeldige sessie');
  }
  const now = Number.isFinite(values.now) ? values.now : Date.now();
  const remember = Boolean(values.remember);
  const session = {
    token: cleanToken,
    userId,
    type,
    remember,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + sessionLifetime(remember),
  };
  const index = store.sessions.findIndex((entry) => entry?.token === cleanToken);
  if (index >= 0) store.sessions[index] = session;
  else store.sessions.push(session);
  return { store, session };
}

function resolveSession(input, token, options = {}) {
  const store = pruneStore(input, options);
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;
  return store.sessions.find((session) => session?.token === cleanToken) || null;
}

function removeSessionsForUser(input, type, userId) {
  const store = normalizeStore(input);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(
    (session) => !(session?.type === type && session?.userId === userId)
  );
  return { store, removed: before - store.sessions.length };
}

function removeSessionToken(input, token) {
  const store = normalizeStore(input);
  const cleanToken = String(token || '').trim();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((session) => session?.token !== cleanToken);
  return { store, removed: before !== store.sessions.length };
}

function createPendingIdentity(input, values = {}) {
  const store = normalizeStore(input);
  const now = Number.isFinite(values.now) ? values.now : Date.now();
  const id = String(values.id || crypto.randomUUID());
  const pending = {
    id,
    type: values.type,
    email: normalizeEmail(values.email),
    sub: String(values.sub || '').trim(),
    profileName: String(values.profileName || '').trim(),
    accountHint: String(values.accountHint || '').trim(),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + PENDING_IDENTITY_MAX_AGE_MS,
  };
  store.pendingIdentities = store.pendingIdentities.filter(
    (entry) => !(entry?.sub && pending.sub && entry.sub === pending.sub)
  );
  store.pendingIdentities.push(pending);
  return { store, pending };
}

function consumePendingIdentity(input, id, options = {}) {
  const store = pruneStore(input, options);
  const index = store.pendingIdentities.findIndex((identity) => identity?.id === id);
  if (index < 0) return { store, identity: null };
  const [identity] = store.pendingIdentities.splice(index, 1);
  return { store, identity };
}

function upsertLinkRequest(input, values = {}) {
  const store = normalizeStore(input);
  const now = Number.isFinite(values.now) ? values.now : Date.now();
  const request = {
    id: String(values.id || crypto.randomUUID()),
    type: values.type,
    accountId: String(values.accountId || '').trim(),
    email: normalizeEmail(values.email),
    sub: String(values.sub || '').trim(),
    profileName: String(values.profileName || '').trim(),
    selectedName: String(values.selectedName || '').trim(),
    selectedClass: String(values.selectedClass || '').trim(),
    similarity: values.similarity || null,
    status: values.status || 'open',
    createdAt: new Date(now).toISOString(),
  };
  if (request.sub) {
    const conflict = store.linkRequests.find(
      (entry) => entry?.status === 'open' && entry?.sub === request.sub && entry?.accountId !== request.accountId
    );
    if (conflict) throw new Error('Dit Google-account heeft al een openstaand koppelverzoek');
  }
  store.linkRequests.push(request);
  return { store, request };
}

function resolveLinkRequest(input, id, values = {}) {
  const store = normalizeStore(input);
  const request = store.linkRequests.find((entry) => entry?.id === id) || null;
  if (!request) return { store, request: null };
  request.status = values.status || 'approved';
  request.resolvedBy = values.resolvedBy || '';
  request.resolvedAt = new Date(Number.isFinite(values.now) ? values.now : Date.now()).toISOString();
  if (values.note) request.note = String(values.note);
  return { store, request };
}

function canStaffManageStudent(db, staff, student) {
  if (!staff || !student) return false;
  if (staff.role === 'admin') return true;
  if (staff.role !== 'teacher') return false;
  const staffClassIds = new Set(Array.isArray(staff.classIds) ? staff.classIds : []);
  const studentClassIds = new Set(Array.isArray(student.classIds) ? student.classIds : []);
  if ([...studentClassIds].some((id) => staffClassIds.has(id))) return true;
  const classes = Array.isArray(db?.classes) ? db.classes : [];
  return classes.some((entry) => {
    const teacherIds = Array.isArray(entry?.teacherIds) ? entry.teacherIds : [];
    const studentIds = Array.isArray(entry?.studentIds) ? entry.studentIds : [];
    return teacherIds.includes(staff.id) && studentIds.includes(student.id);
  });
}

module.exports = {
  THIRTY_DAYS_MS,
  SESSION_WINDOW_MS,
  PENDING_LINK_REQUEST_MAX_AGE_MS,
  LINK_REQUEST_HISTORY_MAX_AGE_MS,
  setLocalOnlyStaffAccountIds,
  isLocalOnlyStaffAccount,
  normalizeEmail,
  normalizeDomain,
  isAllowedSchoolEmail,
  createSignedState,
  verifySignedState,
  emptyAuthStore,
  normalizeStore,
  pruneStore,
  findLinkByAccount,
  findLinkBySub,
  findLinkByEmail,
  findLinkByIdentity,
  upsertLink,
  removeLink,
  upsertSession,
  resolveSession,
  removeSessionsForUser,
  removeSessionToken,
  createPendingIdentity,
  consumePendingIdentity,
  upsertLinkRequest,
  resolveLinkRequest,
  canStaffManageStudent,
};
