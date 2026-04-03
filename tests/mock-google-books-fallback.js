const fs = require('fs');
const path = require('path');

const planRaw = process.env.BOEKENBAAI_TEST_GOOGLE_BOOKS_FALLBACK_PLAN || '{}';
const logPath = process.env.BOEKENBAAI_TEST_GOOGLE_BOOKS_LOG || '';
let queryPlan = {};
try {
  queryPlan = JSON.parse(planRaw);
} catch (error) {
  queryPlan = {};
}
const callCountByQuery = new Map();
const originalFetch = typeof global.fetch === 'function' ? global.fetch.bind(globalThis) : null;

function logLookup(entry) {
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${entry}\n`);
  } catch (error) {
    // Ignore logging errors in test helper.
  }
}

global.fetch = async (input, init) => {
  const requestUrl = String(input || '');
  if (!requestUrl.startsWith('https://www.googleapis.com/books/v1/volumes')) {
    if (!originalFetch) {
      throw new Error(`No fetch mock for ${requestUrl}`);
    }
    return originalFetch(input, init);
  }
  const parsed = new URL(requestUrl);
  const query = parsed.searchParams.get('q') || '';
  const calls = (callCountByQuery.get(query) || 0) + 1;
  callCountByQuery.set(query, calls);
  const plannedResponses = Array.isArray(queryPlan[query]) ? queryPlan[query] : [];
  const selected = plannedResponses[Math.min(calls - 1, Math.max(plannedResponses.length - 1, 0))] || { status: 200, items: [] };
  logLookup(`GB:${query}#${calls}:http_${selected.status}`);
  return new Response(JSON.stringify({ items: selected.items || [] }), {
    status: selected.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
