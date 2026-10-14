'use strict';

/**
 * Build the next batch without depending on any network operation.
 * Physical copies can share both a source URL and an image asset.
 * Failed sources that no longer have missing copies are dropped so an
 * expired retry timestamp cannot keep waking the worker indefinitely.
 */
function planCoverBackfill(books, { hasAsset, failures, now = Date.now() }) {
  if (typeof hasAsset !== 'function' || !(failures instanceof Map)) {
    throw new TypeError('Invalid cover backfill dependencies');
  }
  const cachedBySource = new Map();
  const missingSources = new Set();
  for (const book of Array.isArray(books) ? books : []) {
    if (!book?.coverUrl) continue;
    if (book.localCoverUrl && hasAsset(book.localCoverUrl)) {
      cachedBySource.set(book.coverUrl, book.localCoverUrl);
    } else {
      missingSources.add(book.coverUrl);
    }
  }
  for (const [source, failure] of failures) {
    if (missingSources.has(source) && failure?.phase === 'link'
      && failure.localAsset && hasAsset(failure.localAsset)) {
      cachedBySource.set(source, failure.localAsset);
    }
    // A newly shared cache can bypass a DOWNLOAD failure. A failed DATABASE
    // link still needs its cooldown and bounded attempts, even if a sibling
    // already has the image file; otherwise each pass resets the counter.
    if (!missingSources.has(source) || (cachedBySource.has(source) && failure?.phase !== 'link')) {
      failures.delete(source);
    }
  }
  return [...missingSources]
    .filter((source) => {
      const failure = failures.get(source);
      return !failure || (
        failure.attempts <= 3 &&
        Number.isFinite(failure.nextRetryAt) &&
        failure.nextRetryAt <= now
      );
    })
    .map((source) => ({
      source,
      localAsset: cachedBySource.get(source) || '',
    }));
}

module.exports = { planCoverBackfill };
