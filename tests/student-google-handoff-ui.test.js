'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'google-login-hint.js'),
  'utf8'
);

assert.match(
  source,
  /const initialGoogleState[\s\S]*window\.location\.search/,
  'Callbackstatus moet direct bij het laden worden vastgelegd vóór google-auth.js de query opruimt'
);
assert.match(
  source,
  /const googleState = initialGoogleState/,
  'De handoff-retries moeten de vastgelegde callbackstatus gebruiken'
);
assert.match(
  source,
  /\/api\/auth\/google\/start-token/,
  'Google-start moet eerst een kortlevend same-origin starttoken ophalen'
);
assert.match(
  source,
  /handoffToken:\s*startToken/,
  'Het starttoken moet aan de uiteindelijke Google-start worden gebonden'
);
assert.match(
  source,
  /await fetchGoogleStartToken\(type, accountId\)/,
  'De UI mag niet rechtstreeks naar de Google-start navigeren zonder starttoken'
);
assert.match(
  source,
  /\/api\/auth\/google\/auto-link-request/,
  'Eerste niet-gekoppelde leerlinglogin moet automatisch een koppelverzoek starten'
);
assert.match(
  source,
  /\/api\/auth\/google\/pending\/complete/,
  'Na docentgoedkeuring moet de leerlinglogin automatisch kunnen worden afgerond'
);
assert.match(
  source,
  /window\.setTimeout\(checkPending,\s*5000\)/,
  'De wachtpagina moet periodiek op docentgoedkeuring controleren'
);
assert.match(
  source,
  /existing\.automaticSelection\) hideManualSearch\(\)/,
  'De handmatige tweede zoekstap moet direct verdwijnen zodra de server de veilige selectie bevestigt'
);
assert.match(
  source,
  /if \(error\.status === 404\)[\s\S]*Oude of directe flow zonder beveiligde leerlingselectie/,
  'Alleen oude flows zonder beveiligde selectie mogen terugvallen op handmatig zoeken'
);
assert.match(
  source,
  /state === 'account-mismatch'/,
  'Een gekozen naam die bij een ander Google-account hoort moet een duidelijke fout geven'
);
assert.match(
  source,
  /hideManualSearch\(\)/,
  'Na veilige automatische koppeling moet de tweede naamzoekstap verdwijnen'
);

console.log('Student Google handoff UI guards geslaagd.');
