'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseUi = fs.readFileSync(path.join(root, 'public', 'release-ui-hardening.js'), 'utf8');
const compat = fs.readFileSync(path.join(root, 'public', 'student-management-compat.js'), 'utf8');
const googleLinks = fs.readFileSync(path.join(root, 'public', 'admin-google-links.js'), 'utf8');
const adminModern = fs.readFileSync(path.join(root, 'public', 'admin-modern.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

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
  /\[data-admin-people-view="students"\] \.admin-card--students[\s\S]*display: none !important/,
  'De oude leerlingaccountkaart mag niet naast het nieuwe leerlingbeheer zichtbaar blijven'
);
assert.match(
  releaseUi,
  /\+ Docent toevoegen/,
  'Docentenbeheer moet dezelfde duidelijke toevoegactie krijgen als leerlingbeheer'
);
assert.match(
  releaseUi,
  /Docenten staan per klas gegroepeerd/,
  'Docentenbeheer moet standaard klasgericht worden uitgelegd'
);
assert.match(
  releaseUi,
  /teacherIdsForClass\(klass, teachers\)[\s\S]*createTeacherButton\(teacher, selectedId\)/,
  'Docenten moeten per klas worden gerenderd met hun bestaande account-ID'
);
assert.match(
  releaseUi,
  /button\.dataset\.teacherId = teacher\.id/,
  'Dezelfde docent moet vanuit iedere klasvermelding hetzelfde teacherId openen'
);
assert.match(
  releaseUi,
  /Zonder klas/,
  'Handmatig aangemaakte docenten zonder klas moeten vindbaar blijven'
);
assert.match(
  releaseUi,
  /teacher-picker:focus-within[\s\S]*teacher-picker__results/,
  'De lijst met docenten bij klas aanmaken moet als compacte dropdown openen'
);
// Current class membership must not display the old class label once
// stored in the legacy grade field. The list itself uses klass.studentIds.
assert.match(app,
  /const members = \(klass\.studentIds \|\| \[\]\)[\s\S]*?const nameSpan = appendTextElement\(\s*li,\s*'span',\s*member\.name\s*\)/,
  'The class member list must use actual membership and show names only');
assert.doesNotMatch(app,
  /member\.grade \? \`\$\{member\.name\} \(\$\{member\.grade\}\)\`/,
  'Historical grade may not appear as a current class label');
assert.match(styles,
  /\.admin-class-details__form \.teacher-picker\s*\{[\s\S]*?position: relative/,
  'The class editing teacher picker must position its own dropdown');
assert.match(styles,
  /\.admin-class-details__form \.teacher-picker__results\s*\{[\s\S]*?display: none;[\s\S]*?max-height: 15rem;[\s\S]*?overflow-y: auto/,
  'All teachers must be hidden until the searchable dropdown opens');
assert.match(styles,
  /\.admin-class-details__form \.teacher-picker:focus-within \.teacher-picker__results:not\(:empty\)\s*\{\s*display: grid/,
  'Focusing the class editing teacher picker must open the results list');

assert.match(
  releaseUi,
  /setTextIfChanged\(button, 'Importeren'\)/,
  'De beheer-tab moet Importeren heten'
);
assert.match(
  releaseUi,
  /startsWith\('boekenbaai_last_books_import_job'\)/,
  'Een afgeronde boekenimport moet zijn herstelreferentie uit localStorage kunnen wissen'
);
assert.match(
  releaseUi,
  /text === 'Import gereed\.'/,
  'De reset moet op een afgeronde boekenimport reageren'
);
assert.match(
  releaseUi,
  /resetBookImportUi/,
  'De boekenimport-UI moet naar een schone beginstaat kunnen terugkeren'
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
assert.match(
  googleLinks,
  /selectedTeacherId\(\) !== teacherId[\s\S]*scheduleRender\(\)/,
  'Een oud laadantwoord mag niet in het detail van een nieuw geselecteerde docent terechtkomen'
);
assert.match(
  googleLinks,
  /selectedTeacherId\(\) !== currentId[\s\S]*scheduleRender\(\)/,
  'Een schoolmail-save voor een vorige selectie mag de nieuwe docentweergave niet overschrijven'
);
assert.doesNotMatch(
  googleLinks,
  /Kies een docent/,
  'Schoolmailbeheer mag geen tweede losse docentdropdown meer tonen'
);
assert.match(
  adminModern,
  /\['imports', 'Importeren'(?:, '[^']+')?\]/,
  'De primaire beheer-navigatie moet Importeren blijven noemen'
);

console.log('Admin UX polish regressietests geslaagd.');
