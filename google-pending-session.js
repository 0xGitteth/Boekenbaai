'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const core = require('./google-auth-core');
const { accountCredentialFingerprint } = require('./google-auth-security-core');
const { mutateJsonLocked } = require('./database-write-coordinator');

// Consume a verified pending Google identity AND persist the login session in
// one locked auth write. No consumed-but-sessionless intermediate state.
function completePendingGoogleSession({ dataPath, authPath, pendingHash, accountId,
  mode, remember = false } = {}) {
  if (!['staff-approved', 'student-approved', 'student-prelinked'].includes(mode)
    || !pendingHash || !accountId) throw Error('invalid_pending_completion');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const type = mode === 'staff-approved' ? 'staff' : 'student';
  mutateJsonLocked({
    lockPath: dataPath, filePath: authPath,
    read: () => {
      const raw = fs.readFileSync(authPath, 'utf8');
      return core.pruneStore(core.normalizeStore(JSON.parse(raw)));
    },
    mutate: current => {
      const pending = (current.pendingIdentities || []).find(item =>
        item?.tokenHash === pendingHash && Number(item.expiresAt) > now);
      if (!pending) throw conflict();
      const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const account = type === 'staff'
        ? (db.users || []).find(user => user?.id === accountId
          && user?.role === 'teacher' && user?.active !== false)
        : (db.students || []).find(student => student?.id === accountId
          && student?.active !== false);
      if (!account || (type === 'staff' && pending.staffId !== accountId)) throw conflict();
      const existing = core.findLinkByAccount(current, type, accountId);
      let next = current;
      if (mode === 'student-prelinked') {
        if (!existing || existing.sub
          || core.normalizeEmail(existing.email) !== core.normalizeEmail(pending.email)) {
          throw conflict();
        }
        const identity = core.findLinkByIdentity(current, type, pending);
        if (identity && identity.accountId !== accountId) throw conflict();
        next = core.upsertLink(current, {
          accountType: 'student', accountId,
          sub: pending.sub, email: pending.email, linkedBy: 'prelinked-email',
        }).store;
      } else {
        const approved = (current.linkRequests || []).filter(request =>
          request?.status === 'approved'
          && core.normalizeEmail(request.email) === core.normalizeEmail(pending.email)
          && String(request.sub || '') === String(pending.sub || '')
          && (type === 'staff'
            ? request.accountType === 'staff' && request.staffId === accountId
            : request.studentId === accountId))
          .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0)
            - (Date.parse(a.updatedAt || a.createdAt || '') || 0))[0];
        if (!approved || !existing || existing.sub !== pending.sub
          || core.normalizeEmail(existing.email) !== core.normalizeEmail(pending.email)) throw conflict();
      }
      next.pendingIdentities = next.pendingIdentities.filter(x => x?.tokenHash !== pendingHash);
      const updated = core.upsertSession(next, token, {
        userId: accountId, type, remember: Boolean(remember), now,
      });
      const session = updated.session;
      session.accountFingerprint = accountCredentialFingerprint(account);
      session.authMethod = 'google';
      return updated.store;
    },
  });
  return { token, createdAt: now, type, userId: accountId };
}

function conflict() {
  const error = new Error('De Google-koppeling of aanvraag is intussen gewijzigd.');
  error.code = 'DATABASE_WRITE_CONFLICT';
  return error;
}

module.exports = { completePendingGoogleSession };
