'use strict';
const crypto = require('node:crypto');
const os = require('node:os');

// A live import continuously renews a persisted lease. A rolling deploy may
// change hostname or PID namespace; relying only on process.kill(pid, 0)
// strands those jobs forever. No worker may commit after losing its lease.
const IMPORT_LEASE_MS = 5 * 60 * 1000;
const IMPORT_HEARTBEAT_MS = 15 * 1000;
const LEGACY_UNKNOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const processStartedAt = Math.floor(Date.now() - process.uptime() * 1000);
const instanceId = crypto.randomUUID();

function currentImportOwner(now = Date.now()) {
  return {
    version: 1,
    host: os.hostname(),
    pid: process.pid,
    processStartedAt,
    instanceId,
    heartbeatAt: now,
    leaseExpiresAt: now + IMPORT_LEASE_MS,
  };
}

function sameImportOwner(owner, expected) {
  return Boolean(owner?.version === 1 && expected?.version === 1
    && owner.instanceId && expected.instanceId
    && owner.instanceId === expected.instanceId);
}

function isImportLeaseActive(owner, now = Date.now()) {
  return Number.isFinite(owner?.leaseExpiresAt) && owner.leaseExpiresAt > now;
}

function isImportOwnerConfirmedDead(owner, {
  hostname = os.hostname(), kill = process.kill.bind(process),
  now = Date.now(), lastSeenAt = null,
} = {}) {
  // New jobs have a bounded, fenced lease. It also handles remote hosts and
  // recycled local PIDs, which a bare process liveness probe cannot detect.
  if (Number.isFinite(owner?.leaseExpiresAt)) {
    if (owner.leaseExpiresAt <= now) return true;
  } else if (lastSeenAt) {
    // Older jobs predate owner leases and cannot be fenced: deliberately use
    // a far longer grace period to avoid interrupting a normal rolling deploy.
    const last = Date.parse(lastSeenAt);
    if (Number.isFinite(last) && last < now - LEGACY_UNKNOWN_MAX_AGE_MS) return true;
  }
  if (!owner || owner.version !== 1 || owner.host !== hostname
    || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    throw error;
  }
}

module.exports = {
  IMPORT_LEASE_MS, IMPORT_HEARTBEAT_MS,
  currentImportOwner, sameImportOwner, isImportLeaseActive,
  isImportOwnerConfirmedDead,
};
