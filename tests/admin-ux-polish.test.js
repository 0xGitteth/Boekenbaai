'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseUi = fs.readFileSync(path.join(root, 'public', 'release-ui-hardening.js'), 'utf8');
const compat = fs.readFileSync(path.join(root, 'public', 'student-management-compat.js'), 'utf8');
const googleLinks = fs.readFileSync(path.join(root, 'public', 'admin-google-links.js'), 'utf8');
const adminModern = fs.readFileSync(path.join(root, 'public', 'admin-modern.js'), 'utf8');

assert.match(
  releaseUi,
  /parent\.insertBefore\(adminDashboard, teacherDashboard\)/,
  'Beheer moet voor het boekenoverzicht worden geplaatst voor admins'
);
assert.match(
  releaseUi,
  /content\.hidden = true[\s\S]*aria-expanded', 'false'[\s\S]*Uitklappen/,
  'Het boekenoverzicht moet na inloggen standaard ingeklapt worden'
);
assert.match(
  releaseUi,
  /\+ Docent toevoegen/,
  'Docentenbeheer moet dezelfde duidelijke toevoegactie krijgen als leerlingbeheer'
);
assert.match(
  releaseUi,
  /teacher-picker:focus-within[\s\S]*teacher-picker__results/,
  'De lijst met docenten bij klas aanmaken moet als compacte dropdown openen'
);
assert.match(
  releaseUi,
  /setTextIfChanged\(button, 'Importeren'\)/,
  'De beheer-tab moet Importeren heten'
);
assert.doesNotMatch(
  compat,
  /Schoolgegevens/,
  'Een compatlaag mag Importeren niet opnieuw naar Schoolgegevens hernoemen'
);
assert.match(
  compat,
  /querySelector\('\[data-admin-people-view="students"\]'\)/,
  'Leerlingbeheer moet fysiek in de Leerlingen-subtab worden geplaatst'
);
assert.doesNotMatch(
  compat,
  /if \(panel && host && panel\.parentElement !== host\) host\.append\(panel\)/,
  'Leerlingbeheer mag niet langer in de gedeelde Google-host staan'
);
assert.match(
  googleLinks,
  /#admin-teacher-detail-content/,
  'Google-schoolaccountbeheer moet aan het geselecteerde docentdetail gekoppeld zijn'
);
assert.match(
  googleLinks,
  /Google-schoolaccount/,
  'Het docentdetail moet een Google-schoolaccountsectie bevatten'
);
assert.match(
  googleLinks,
  /body: \{ staffId: currentId, email:/,
  'Schoolmail opslaan moet de geselecteerde docent gebruiken'
);
assert.doesNotMatch(
  googleLinks,
  /Kies een docent/,
  'Schoolmailbeheer mag geen tweede losse docentdropdown meer tonen'
);
assert.match(
  adminModern,
  /\['imports', 'Importeren'\]/,
  'De primaire beheer-navigatie moet Importeren blijven noemen'
);

console.log('Admin UX polish regressietests geslaagd.');
