'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isAllowedSchoolEmail } = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'public', 'schoolmail-domain-helper.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'schoolmail-domain-helper-preload.js'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(helper, /const FALLBACK_DOMAIN = 'koraaledu\.nl'/, 'De standaard fallback moet koraaledu.nl zijn');
assert.match(
  helper,
  /fetch\(apiUrl\('\/api\/auth\/google\/config'\)/,
  'Het daadwerkelijke Google-domein moet uit de runtime-config worden geladen'
);
assert.doesNotMatch(
  helper,
  /placeholder\.match\(\/@/,
  'Een hard-coded placeholder mag niet meer bepalend zijn voor het schooldomein'
);
assert.match(
  helper,
  /if \(domainReady && !input\.value\.trim\(\)\) input\.value = suffixFor\(\)/,
  'Alleen een leeg bewerkbaar schoolmailveld mag automatisch de domeinsuffix krijgen'
);
assert.match(
  helper,
  /if \(input\.disabled \|\| input\.readOnly\) return false/,
  'Uitgeschakelde of alleen-lezen velden mogen niet worden aangepast'
);
assert.match(
  helper,
  /input\.type = 'text'[\s\S]*input\.inputMode = 'email'[\s\S]*input\.setSelectionRange\(0, 0\)/,
  'Tijdens het typen moet de cursor betrouwbaar vóór de domeinsuffix kunnen staan'
);
assert.match(
  helper,
  /function handlePaste[\s\S]*pasted\.includes\('@'\)[\s\S]*event\.preventDefault\(\)[\s\S]*input\.value = pasted/,
  'Een volledig geplakt mailadres moet de vooringevulde suffix vervangen'
);
assert.match(
  helper,
  /function normalizePrefilledAddress[\s\S]*prefix\.includes\('@'\)[\s\S]*input\.value = prefix/,
  'Een handmatig volledig adres vóór de suffix moet vóór opslaan worden genormaliseerd'
);
assert.match(
  helper,
  /function stopSuffixEditing[\s\S]*input\.type = 'email'/,
  'Voor validatie en na het bewerken moet het veld weer type=email zijn'
);
assert.match(
  helper,
  /document\.addEventListener\('submit'[\s\S]*blockInvalidSave/,
  'Enter/form-submit moet eerst de schoolmailvalidatie doorlopen'
);
assert.match(
  helper,
  /schoolmail opslaan[\s\S]*blockInvalidSave/,
  'Ook schoolmailknoppen van niet-submit flows moeten eerst gevalideerd worden'
);
assert.match(helper, /new MutationObserver/, 'Later dynamisch geopende leerling- en docentvelden moeten ook worden verbeterd');

assert.strictEqual(isAllowedSchoolEmail('leerling@koraaledu.nl', 'koraaledu.nl'), true);
assert.strictEqual(
  isAllowedSchoolEmail('leerling@koraaledu.nl@koraaledu.nl', 'koraaledu.nl'),
  false,
  'De backend mag meerdere @-tekens nooit accepteren'
);
assert.strictEqual(
  isAllowedSchoolEmail('leer ling@koraaledu.nl', 'koraaledu.nl'),
  false,
  'De backend mag spaties in het lokale deel niet accepteren'
);
assert.strictEqual(isAllowedSchoolEmail('.leerling@koraaledu.nl', 'koraaledu.nl'), false);
assert.strictEqual(isAllowedSchoolEmail('leerling..test@koraaledu.nl', 'koraaledu.nl'), false);
assert.strictEqual(isAllowedSchoolEmail('leerling+test@koraaledu.nl', 'koraaledu.nl'), true);

assert.match(preload, /SCRIPT_URL = '\/schoolmail-domain-helper\.js'/, 'De helper moet een eigen statische route hebben');
assert.match(preload, /html\.includes\(SCRIPT_NAME\)/, 'Serverinjectie mag geen dubbele helper-tag toevoegen');
assert.match(
  vite,
  /runtimeAuthAssets[\s\S]*'schoolmail-domain-helper\.js'/,
  'De helper moet naar de statische Vite-output worden gekopieerd'
);
assert.match(
  vite,
  /transformIndexHtml[\s\S]*schoolmail-domain-helper\.js/,
  'Vite moet de helper in zowel index.html als staff.html injecteren'
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
