'use strict';

const runCore = require('./book-import-analysis-core.test');
const runMetadata = require('./book-import-analysis-metadata.test');
const runSafety = require('./book-import-analysis-safety.test');
const runFinalReview = require('./book-import-analysis-final-review.test');
const runReviewTail = require('./book-import-analysis-review-tail.test');
const runCodexFinal = require('./book-import-analysis-codex-final.test');

(async () => {
  await runCore();
  await runMetadata();
  await runSafety();
  await runFinalReview();
  await runReviewTail();
  await runCodexFinal();
  console.log('book-import-analysis tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
