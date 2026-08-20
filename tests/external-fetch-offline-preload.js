'use strict';

const nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

if (nativeFetch) {
  globalThis.fetch = async function testFetch(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url || String(input || '');
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      return nativeFetch(input, init);
    }

    if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      return nativeFetch(input, init);
    }

    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
