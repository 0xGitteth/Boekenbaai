const fs = require('fs');
const path = require('path');

const logPath = process.env.BOEKENBAAI_ISBN_MOCK_LOG || '';
const fixturesRaw = process.env.BOEKENBAAI_TEST_ISBN_FIXTURES || '{}';
const titleAuthorFixturesRaw = process.env.BOEKENBAAI_TEST_TITLE_AUTHOR_FIXTURES || '{}';
let fixtures;
let titleAuthorFixtures;
try {
  fixtures = JSON.parse(fixturesRaw);
} catch (error) {
  fixtures = {};
}
try {
  titleAuthorFixtures = JSON.parse(titleAuthorFixturesRaw);
} catch (error) {
  titleAuthorFixtures = {};
}

function logLookup(entry) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${entry}\n`);
  } catch (error) {
    // Best-effort logging; ignore errors in test helper.
  }
}

global.__BOEKENBAAI_MOCK_ISBN_LOOKUP = async (isbn) => {
  logLookup(`ISBN:${isbn}`);
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

global.__BOEKENBAAI_MOCK_TITLE_AUTHOR_LOOKUP = async ({ title, author }) => {
  const key = `${String(title || '').trim().toLowerCase()}|||${String(author || '').trim().toLowerCase()}`;
  logLookup(`TA:${key}`);
  const fixture = titleAuthorFixtures[key];
  if (!fixture) {
    return null;
  }
  return {
    title: fixture.title || '',
    rawTitle: fixture.rawTitle || fixture.title || '',
    author: fixture.author || '',
    language: fixture.language || '',
    publisher: fixture.publisher || '',
    description: fixture.description || '',
    coverUrl: fixture.coverUrl || '',
    source: fixture.source || 'mock-title-author',
    found: true,
  };
};
