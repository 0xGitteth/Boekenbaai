'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const core = require('./google-auth-core');
const { accountCredentialFingerprint } = require('./google-auth-security-core');
const { mutateJsonLocked } = require('./database-write-coordinator');

function changedLink() {
  const error = new Error('De Google-koppeling is tijdens het inloggen gewijzigd.');
  error.code = 'GOOGLE_LINK_CHANGED';
  return error;
}

// Re-resolve the verified Google identity inside the shared database lock.
// A link cannot be changed or unlinked between verification and session
// persistence, and newly verified prelinks are saved in the SAME commit.
function completeVerifiedGoogleSession({
  dataPath, authPath, type, identity, expectedAccountId, remember = false,
} = {}) {
  if (!dataPath || !authPath || !['staff', 'student'].includes(type)
    || !expectedAccountId || !identity?.sub || !core.normalizeEmail(identity.email)) {
    throw changedLink();
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  mutateJsonLocked({
    lockPath: dataPath,
    filePath: authPath,
    read: () => {
      try {
        return core.pruneStore(core.normalizeStore(
          JSON.parse(fs.readFileSync(authPath, 'utf8'))));
      } catch (error) {
        if (error?.code === 'ENOENT') return core.emptyAuthStore();
        throw error;
      }
    },
    mutate: current => {
      // DB and auth files are both read under the same shared lock.
      const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const account = type === 'staff'
        ? (db.users || []).find(entry => entry?.id === expectedAccountId
          && ['admin', 'teacher'].includes(entry.role) && entry.active !== false)
        : (db.students || []).find(entry => entry?.id === expectedAccountId
          && entry.active !== false);
      const link = core.findLinkByIdentity(current, type, identity);
      if (!account || !link || link.accountId !== expectedAccountId) throw changedLink();

      let next = current;
      if (String(link.sub || '') !== String(identity.sub)
        || core.normalizeEmail(link.email) !== core.normalizeEmail(identity.email)) {
        // An unverified prelink can be verified by its school email, or an
        // existing sub may have an updated email. Upsert conflict checks still apply.
        next = core.upsertLink(current, {
          accountType: type, accountId: expectedAccountId,
          email: identity.email, sub: identity.sub,
          linkedBy: link.linkedBy || 'google-login',
        }).store;
      }
      const created = core.upsertSession(next, token, {
        userId: expectedAccountId, type, remember, now: createdAt,
      });
      created.session.accountFingerprint = accountCredentialFingerprint(account);
      created.session.authMethod = 'google';
      return created.store;
    },
  });
  return { token, userId: expectedAccountId, type, createdAt };
}

module.exports = { completeVerifiedGoogleSession };
