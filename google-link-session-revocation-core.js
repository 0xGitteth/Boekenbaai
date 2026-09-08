'use strict';

const core = require('./google-auth-core');

function accountKey(accountType, accountId) {
  const type = accountType === 'student' ? 'student' : accountType === 'staff' ? 'staff' : '';
  const id = String(accountId || '').trim();
  return type && id ? `${type}:${id}` : '';
}

function snapshotGoogleLinks(store) {
  const snapshot = new Map();
  for (const link of core.normalizeStore(store).links) {
    const key = accountKey(link?.accountType, link?.accountId);
    if (!key) continue;
    snapshot.set(key, {
      accountType: link.accountType,
      accountId: String(link.accountId),
      email: core.normalizeEmail(link.email),
      sub: String(link.sub || '').trim(),
    });
  }
  return snapshot;
}

function findChangedExistingGoogleAccounts(beforeSnapshot, afterStore) {
  const before = beforeSnapshot instanceof Map ? beforeSnapshot : new Map();
  const after = snapshotGoogleLinks(afterStore);
  const changed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);

  for (const key of keys) {
    const previous = before.get(key) || null;
    const next = after.get(key) || null;
    if (
      !previous ||
      !next ||
      previous.email !== next.email ||
      previous.sub !== next.sub
    ) {
      const identity = next || previous;
      changed.push({
        accountType: identity.accountType,
        accountId: identity.accountId,
      });
    }
  }
  return changed;
}

function revokePersistedSessionsForAccounts(store, accounts = []) {
  const safe = core.normalizeStore(store);
  const targets = new Set(
    accounts
      .map((entry) => accountKey(entry?.accountType, entry?.accountId))
      .filter(Boolean)
  );
  const revokedTokenHashes = [];
  safe.sessions = safe.sessions.filter((session) => {
    const key = accountKey(session?.type, session?.userId);
    if (!key || !targets.has(key)) return true;
    const hash = String(session?.tokenHash || '').trim();
    if (hash) revokedTokenHashes.push(hash);
    return false;
  });
  return { store: safe, revokedTokenHashes };
}

module.exports = {
  accountKey,
  snapshotGoogleLinks,
  findChangedExistingGoogleAccounts,
  revokePersistedSessionsForAccounts,
};
