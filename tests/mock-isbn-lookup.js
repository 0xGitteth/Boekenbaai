const fs = require('fs');
const path = require('path');

const logPath = process.env.BOEKENBAAI_ISBN_MOCK_LOG || '';
const fixturesRaw = process.env.BOEKENBAAI_TEST_ISBN_FIXTURES || '{}';
let fixtures;
try {
  fixtures = JSON.parse(fixturesRaw);
} catch (error) {
  fixtures = {};
}

function logLookup(isbn) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${isbn}\n`);
  } catch (error) {
    // Best-effort logging; ignore errors in test helper.
  }
}

global.__BOEKENBAAI_MOCK_ISBN_LOOKUP = async (isbn) => {
  logLookup(isbn);
  const fixture = fixtures[isbn];
  if (fixture && fixture.reject) {
    throw new Error(fixture.reject);
  }
  const found = fixture !== undefined;
  return {
    barcode: isbn,
    title: fixture?.title || '',
    author: fixture?.author || '',
    authors: fixture?.authors || (fixture?.author ? [fixture.author] : []),
    description: fixture?.description || '',
    publisher: fixture?.publisher || '',
    publishedAt: fixture?.publishedAt || '',
    publishedYear: fixture?.publishedYear,
    pageCount: fixture?.pageCount,
    language: fixture?.language || '',
    coverUrl: fixture?.coverUrl || '',
    tags: fixture?.tags || [],
    source: fixture?.source || 'mock',
    found,
  };
};
