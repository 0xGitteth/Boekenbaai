'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-auth-runtime-preload.js'), 'utf8');

assert.ok(
  source.includes("if (requestUrl.searchParams.get('error'))"),
  'Google OAuth error-return moet expliciet worden afgehandeld'
);
assert.ok(
  source.includes("makeOauthErrorRedirect(type, 'state-error')"),
  'Ongeldige state/nonce moet een veilige fout opleveren'
);
assert.ok(
  source.includes("error?.code === 'WRONG_DOMAIN' ? 'wrong-domain' : 'oauth-error'"),
  'Verkeerd schooldomein moet onderscheiden worden zonder interne details te lekken'
);
assert.ok(
  source.includes("return sendJson(res, 500, { message: 'Google-inlog kon niet worden verwerkt' })"),
  'Onverwachte authfouten moeten generiek naar de client terugkeren'
);

console.log('Google-auth foutafhandelingtests geslaagd.');
