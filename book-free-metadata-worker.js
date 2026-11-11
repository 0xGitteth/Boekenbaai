'use strict';

// A low-volume, resumable worker. Import HTTP responses do not await any
// external request. The saved per-book check is the restart checkpoint.
const {
  validContact, nextCandidate, fetchEasyCb, applyResult,
} = require('./book-free-metadata');

function createFreeMetadataWorker({
  loadDb, commit, onNewCover = () => {}, isPaused = () => false,
  contact = '', fetchImpl = global.fetch, logger = console,
  delayMs = 1800,
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
    try {
      const now = Date.now();
      for (const [key, retryAt] of failedInProcess) if (retryAt <= now) failedInProcess.delete(key);
      const candidate = nextCandidate(loadDb().books, now, new Set(failedInProcess.keys()));
      if (!candidate) return;
      continueSoon = true;
      const result = await fetchEasyCb(candidate.isbn, {contact, fetchImpl});
      if (stopped) return;
      if (result.status === 'error') {
        // A temporary outage cannot cause a busy request loop or a database
        // write. Retry after a delay, never immediately.
        failedInProcess.set(candidate.key, Date.now() + 15 * 60 * 1000);
        return;
      }
      const outcome = await commit(db => applyResult(
        db, candidate, result.metadata, new Date().toISOString(), result.status,
      ));
      if (outcome?.newCover) onNewCover();
    } catch (error) {
      logger.warn?.('Gratis boekverrijking overgeslagen:', error?.message || String(error));
      continueSoon = false;
    } finally {
      running = false;
      if (!stopped && continueSoon) schedule(gap);
    }
  }
  function status() {
    const books = loadDb().books || [];
    const seen = new Set();
    let checked = 0, pending = 0;
    for (const book of books) {
      const key = require('./book-free-metadata').workKey(book);
      if (seen.has(key) || !require('./book-free-metadata').isbnOf(book)) continue;
      seen.add(key);
      if (book.freeMetadataCheck?.checkedAt) checked++;
      if (nextCandidate([book])) pending++;
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
