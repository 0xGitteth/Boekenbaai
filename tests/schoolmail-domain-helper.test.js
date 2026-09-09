'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'public', 'schoolmail-domain-helper.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'schoolmail-domain-helper-preload.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(helper, /const FALLBACK_DOMAIN = 'koraaledu\.nl'/, 'De standaard schoolmaildomain moet koraaledu.nl zijn');
assert.match(
  helper,
  /if \(!input\.value\.trim\(\)\) input\.value = suffix/,
  'Alleen een leeg schoolmailveld mag automatisch de domeinsuffix krijgen'
);
assert.match(
  helper,
  /if \(input\.disabled \|\| input\.readOnly\) return false/,
  'Uitgeschakelde of alleen-lezen velden mogen niet worden aangepast'
);
assert.match(
  helper,
  /input\.type = 'text'[\s\S]*input\.inputMode = 'email'[\s\S]*input\.setSelectionRange\(0, 0\)/,
  'Tijdens het typen moet een leeg schoolmailveld de cursor betrouwbaar vóór de domeinsuffix zetten'
);
assert.match(
  helper,
  /function stopSuffixEditing[\s\S]*input\.type = 'email'/,
  'Na het bewerken moet het veld weer normale e-mailvalidatie gebruiken'
);
assert.match(helper, /new MutationObserver/, 'Later dynamisch geopende leerling- en docentvelden moeten ook worden verbeterd');
assert.match(
  helper,
  /attributeFilter: \['placeholder', 'disabled', 'readonly'\]/,
  'Dynamische Google-schoolmailvelden moeten opnieuw beoordeeld worden wanneer hun metadata wordt ingevuld'
);

assert.match(preload, /SCRIPT_URL = '\/schoolmail-domain-helper\.js'/, 'De helper moet een eigen statische route hebben');
assert.match(preload, /html\.includes\(SCRIPT_URL\)/, 'De helper mag maar één keer per HTML-pagina geïnjecteerd worden');
assert.ok(
  preload.includes('<script src="${SCRIPT_URL}"></script>'),
  'De helper moet daadwerkelijk in HTML worden geladen'
);

assert.ok(
  pkg.scripts.start.includes('--require ./schoolmail-domain-helper-preload.js'),
  'Productiestart moet de schoolmail-helper preload laden'
);
assert.ok(
  pkg.scripts.test.includes('node tests/schoolmail-domain-helper.test.js'),
  'De schoolmail-helper regressietest moet onderdeel zijn van npm test'
);
assert.ok(
  pkg.scripts.test.includes('node --check public/schoolmail-domain-helper.js'),
  'De browserscript-syntax moet in CI gecontroleerd worden'
);
assert.ok(
  pkg.scripts.test.includes('node --check schoolmail-domain-helper-preload.js'),
  'De preload-syntax moet in CI gecontroleerd worden'
);

console.log('Schoolmail domein-prefill regressietest geslaagd.');
