'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public', 'google-login-hint.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'google-auth.css'), 'utf8');

assert.match(script, /data-selected-account-id/, 'Login moet een echte dropdownselectie vereisen');
assert.match(script, /\/api\/auth\/login-mode/, 'UI moet de server om de inlogmethode vragen');
assert.match(script, /accountId/, 'Google-start moet het geselecteerde account-id meesturen');
assert.match(script, /selectedMode === 'password'/, 'Lokale beheerlogin moet een apart passwordpad hebben');
assert.match(script, /login-local-password/, 'Wachtwoordveld moet alleen in lokale beheermodus zichtbaar worden');
assert.match(script, /boekenbaai-remember-login/, 'Docenten moeten de remember-me keuze behouden');
assert.match(script, /stopImmediatePropagation/, 'Google-login moet de oude wachtwoord-submit onderscheppen');
assert.match(script, /Kies je naam uit de lijst/, 'Vrij getypte namen moeten een duidelijke melding krijgen');
assert.doesNotMatch(script, /googleButton\.click\s*\(/, 'Accountselectie mag niet automatisch naar Google doorgaan');
assert.doesNotMatch(script, /google-login__fallback/, 'Er mag geen algemene wachtwoordfallback zichtbaar blijven');
assert.match(script, /stripAdminGoogleManageOptions/, 'Adminfilter voor Google-koppelingen moet aanwezig zijn');
assert.match(script, /option\.remove\(\)/, 'Adminfilter moet de beheeroptie uit de Google-koppelkeuze verwijderen');

assert.match(
  css,
  /\.form-field:has\(#student-login-password\)[\s\S]*\.form-field:has\(#login-password\)[\s\S]*display:\s*none/,
  'Wachtwoordvelden moeten al vóór JavaScript verborgen zijn'
);
assert.match(
  css,
  /body\.login-local-password[\s\S]*#login-password[\s\S]*display:\s*grid/,
  'Alleen lokale beheermodus mag het staff-wachtwoordveld tonen'
);

console.log('Login-flow UI guards geslaagd.');
