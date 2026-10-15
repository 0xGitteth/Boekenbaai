'use strict';
// Only loaded in PR7 HTTP tests. Fakes Google's web-app response without
// exposing any production shortcut or opening an external network connection.
const fs = require('node:fs');
const original = global.fetch;
global.fetch = async function mockedAppsScriptFetch(url, options) {
  if (String(url).startsWith('https://script.google.com/macros/s/TESTBRIDGE123/exec')) {
    const signed = JSON.parse(options.body);
    const payload = JSON.parse(signed.payload);
    if (process.env.BOEKENBAAI_MAIL_TEST_CAPTURE) {
      fs.appendFileSync(process.env.BOEKENBAAI_MAIL_TEST_CAPTURE,
        JSON.stringify({ payload, signature: signed.signature }) + '\n');
    }
    return new Response(JSON.stringify({ ok: true, id: payload.id }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return original(url, options);
};
