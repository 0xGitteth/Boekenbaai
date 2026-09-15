'use strict';

const runCore = require('./book-import-analysis-core.test');
const runMetadata = require('./book-import-analysis-metadata.test');
const runSafety = require('./book-import-analysis-safety.test');

(async () => {
  await runCore();
  await runMetadata();
  await runSafety();
  console.log('book-import-analysis tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
