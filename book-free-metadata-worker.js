'use strict';

// A low-volume, resumable worker. Import HTTP responses do not await any
// external request. The saved per-book check is the restart checkpoint.
const {
  validContact, isbnOf, workKey, nextCandidate, fetchEasyCb, applyResult,
} = require('./book-free-metadata');

function createFreeMetadataWorker({
  loadDb, commit, onNewCover = () => {}, isPaused = () => false,
  getFailedCovers = () => new Set(),
  contact = '', fetchImpl = global.fetch, logger = console,
  delayMs = 1800, retryDelayMs = 30000,
} = {}) {
  const enabled = validContact(contact);
  let timer = null, running = false, stopped = false;
  const failedInProcess = new Map();
  const gap = Math.max(1000, delayMs);
  function schedule(delay = 200) {
    if (!enabled || stopped || running || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void processOne();
    }, delay);
    timer.unref?.();
  }
  async function processOne() {
    if (stopped || running || !enabled) return;
    if (isPaused()) { schedule(4000); return; }
    running = true;
    let continueSoon = false;
    let nextDelay = gap;
    try {
      const now = Date.now();
      for (const [key, retryAt] of failedInProcess) if (retryAt <= now) failedInProcess.delete(key);
      const failedCovers = getFailedCovers();
      const candidate = nextCandidate(loadDb().books, now, new Set(failedInProcess.keys()), failedCovers);
      if (!candidate) {
        // After all other works are processed, revisit a temporarily failed
        // ISBN when its cooldown expires, without busy polling.
        const retryAt = Math.min(...failedInProcess.values());
        if (Number.isFinite(retryAt)) {
          continueSoon = true;
          nextDelay = Math.max(gap, retryAt - Date.now());
        }
        return;
      }
      continueSoon = true;
      const result = await fetchEasyCb(candidate.isbn, {contact, fetchImpl});
      if (stopped) return;
      // An import may have started while the external website responded.
      // Preserve the reviewed import snapshot and do not write into its stage.
      if (isPaused()) return;
      if (result.status === 'error') {
        // A temporary outage cannot cause a busy request loop or a database
        // write. Retry after a delay, never immediately.
        failedInProcess.set(candidate.key, Date.now() + 15 * 60 * 1000);
        return;
      }
      const outcome = await commit(db => applyResult(
        db, candidate, result.metadata, new Date().toISOString(), result.status, failedCovers,
      ));
      if (outcome?.newCover) onNewCover();
    } catch (error) {
      logger.warn?.('Gratis boekverrijking overgeslagen:', error?.message || String(error));
      // A temporary database lock or I/O failure must not strand the
      // remaining queue until a restart or another administrator action.
      continueSoon = true;
      nextDelay = Math.max(50, retryDelayMs);
    } finally {
      running = false;
      if (!stopped && continueSoon) schedule(nextDelay);
    }
  }
  function status() {
    const books = loadDb().books || [];
    const seen = new Set();
    let checked = 0, pending = 0;
    for (const book of books) {
      const key = workKey(book);
      if (seen.has(key) || !isbnOf(book)) continue;
      seen.add(key);
      if (book.freeMetadataCheck?.checkedAt) checked++;
      if (nextCandidate([book], Date.now(), new Set(), getFailedCovers())) pending++;
    }
    return {enabled, running, checkedWorks:checked, pendingWorks:pending};
  }
  return {
    enabled,
    schedule,
    status,
    stop() {stopped = true; if (timer) clearTimeout(timer); timer = null;},
  };
}
module.exports = {createFreeMetadataWorker};
