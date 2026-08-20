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
  /if \(error\.status === 404\)[\s\S]*Oude of directe flow zonder beveiligde leerlingselectie/,
  'Alleen oude flows zonder beveiligde selectie mogen terugvallen op handmatig zoeken'
);
assert.match(
  source,
  /googleAuth[^\n]*account-mismatch|state === 'account-mismatch'/,
  'Een gekozen naam die bij een ander Google-account hoort moet een duidelijke fout geven'
);
assert.match(
  source,
  /hideManualSearch\(\)/,
  'Na veilige automatische koppeling moet de tweede naamzoekstap verdwijnen'
);

console.log('Student Google handoff UI guards geslaagd.');
