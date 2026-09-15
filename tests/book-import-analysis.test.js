'use strict';

const runCore = require('./book-import-analysis-core.test');
const runMetadata = require('./book-import-analysis-metadata.test');
const runSafety = require('./book-import-analysis-safety.test');
const runFinalReview = require('./book-import-analysis-final-review.test');

(async () => {
  await runCore();
  await runMetadata();
  await runSafety();
  await runFinalReview();
  console.log('book-import-analysis tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
