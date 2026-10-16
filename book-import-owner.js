'use strict';
const os = require('node:os');

// A rolling deploy can temporarily run two instances against the same data
// volume. Only the process which created a legacy import owns that job.
// Unknown/remote owners are deliberately NOT marked interrupted: falsely
// declaring an import failed can cause a duplicate committed book import.
function currentImportOwner() {
  return {
    version: 1,
    host: os.hostname(),
    pid: process.pid,
    processStartedAt: Math.floor(Date.now() - process.uptime() * 1000),
  };
}

function isImportOwnerConfirmedDead(owner, { hostname = os.hostname(),
  kill = process.kill.bind(process) } = {}) {
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

module.exports = { currentImportOwner, isImportOwnerConfirmedDead };
