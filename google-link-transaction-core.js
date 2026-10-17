'use strict';
const core = require('./google-auth-core');
const { snapshotGoogleLinks, findChangedExistingGoogleAccounts,
  revokePersistedSessionsForAccounts } = require('./google-link-session-revocation-core');

// Apply both security invariants before persisting the changed link, under
// the same DB/auth file lock. No post-response cleanup can be lost.
function enforceGoogleLinkInvariants(previous, proposed, now = Date.now()) {
  const updated = core.normalizeStore(proposed);
  const changed = findChangedExistingGoogleAccounts(snapshotGoogleLinks(previous), updated);
  if (!changed.length) return proposed;
  // A new verified session created within THIS SAME locked link transaction
  // belongs to the new identity; only pre-existing sessions must be revoked.
  const oldHashes = new Set((previous.sessions || []).map(s => s?.tokenHash));
  const freshVerified = updated.sessions.filter(s => s?.authMethod === 'google'
    && s?.accountFingerprint && s?.tokenHash && !oldHashes.has(s.tokenHash)
    && changed.some(item => item.accountType === s.type && item.accountId === s.userId));
  const result = revokePersistedSessionsForAccounts(updated, changed);
  result.store.sessions.push(...freshVerified);
  const affected = new Set(changed.map(x => x.accountType + ':' + x.accountId));
  const timestamp = new Date(now).toISOString();
  for (const request of result.store.linkRequests) {
    if (request?.status !== 'pending') continue;
    const key = request.studentId ? 'student:' + request.studentId
      : request.staffId ? 'staff:' + request.staffId : '';
    if (!affected.has(key)) continue;
    request.status = 'superseded';
    request.updatedAt = timestamp;
  }
  return result.store;
}
module.exports = { enforceGoogleLinkInvariants };
