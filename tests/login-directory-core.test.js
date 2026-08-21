'use strict';

const assert = require('assert');
const {
  normalizeSearchText,
  queryMatchesName,
  createStudentDisplayName,
  buildStudentMatches,
  buildStaffMatches,
  DirectoryRateLimiter,
} = require('../login-directory-core');

assert.strictEqual(normalizeSearchText('  Réka   de Vries '), 'reka de vries');
assert.strictEqual(queryMatchesName('Gitte van Bakel', 'git'), true);
assert.strictEqual(queryMatchesName('Gitte van Bakel', 'bak'), true);
assert.strictEqual(queryMatchesName('Gitte van Bakel', 'git bak'), true);
assert.strictEqual(queryMatchesName('Gitte van Bakel', 'itte'), false);
assert.strictEqual(queryMatchesName('Mirsad Smit', 'mi'), false, 'Twee letters mogen geen prefixdump geven');
assert.strictEqual(queryMatchesName('Bo Janssen', 'bo'), true, 'Een echte tweeletter-voornaam moet wel vindbaar blijven');
assert.strictEqual(queryMatchesName('Jan de Boer', 'de'), false, 'Tweeletter-tussenvoegsel mag geen directorydump geven');
assert.strictEqual(queryMatchesName('Jan van Dijk', 'van'), false, 'Los veelvoorkomend tussenvoegsel moet te breed zijn');
assert.strictEqual(queryMatchesName('Jan van Dijk', 'van di'), true, 'Tussenvoegsel met specifieker naamdeel moet wel werken');
assert.strictEqual(queryMatchesName('Van Morrison', 'van'), true, 'Een tussenvoegselwoord dat echt de voornaam is moet vindbaar blijven');

const students = [
  {
    id: 'student-gitte',
    name: 'Gitte van Bakel',
    firstName: 'Gitte',
    middleName: 'van',
    lastName: 'Bakel',
    username: 'geheim-gitte',
    passwordHash: 'mag-nooit-lekken',
    grade: '4',
    classIds: ['class-a'],
  },
  {
    id: 'student-gina',
    name: 'Gina Bakkers',
    firstName: 'Gina',
    lastName: 'Bakkers',
    grade: '5',
  },
  {
    id: 'student-gitte-2',
    name: 'Gitte van Bakkers',
    firstName: 'Gitte',
    middleName: 'van',
    lastName: 'Bakkers',
  },
  {
    id: 'student-sam-a',
    name: 'Sam de Boer',
    firstName: 'Sam',
    middleName: 'de',
    lastName: 'Boer',
  },
  {
    id: 'student-sam-b',
    name: 'Sam van Boer',
    firstName: 'Sam',
    middleName: 'van',
    lastName: 'Boer',
  },
  {
    id: 'student-alex-a',
    name: 'Alex de Wit',
    firstName: 'Alex',
    middleName: 'de',
    lastName: 'Wit',
  },
  {
    id: 'student-alex-b',
    name: 'Alex de Wit',
    firstName: 'Alex',
    middleName: 'de',
    lastName: 'Wit',
  },
  { id: 'student-bo', name: 'Bo', firstName: 'Bo' },
  { id: 'student-mirsad', name: 'Mirsad Smit', firstName: 'Mirsad', lastName: 'Smit' },
];
const classes = [
  { id: 'class-a', name: 'Structuur A', studentIds: ['student-gitte', 'student-sam-a', 'student-alex-a'] },
  { id: 'class-b', name: 'Structuur B', studentIds: ['student-sam-b', 'student-alex-b'] },
];
const db = {
  students,
  classes,
  users: [
    { id: 'teacher-1', name: 'Docent Test', username: 'docent-secret', role: 'teacher', passwordHash: 'nope' },
    { id: 'admin-1', name: 'Boekenbaai Beheer', username: 'beheer-secret', role: 'admin', passwordHash: 'nope' },
    { id: 'other-1', name: 'Niet Inloggen', role: 'other' },
  ],
};

const gitteLabel = createStudentDisplayName(students[0], students, classes);
assert.strictEqual(gitteLabel, 'Gitte Bake.', 'Gelijk beginnende achternamen moeten alleen zo ver als nodig worden uitgebreid');

const samALabel = createStudentDisplayName(students[3], students, classes);
const samBLabel = createStudentDisplayName(students[4], students, classes);
assert.strictEqual(samALabel, 'Sam de Boer', 'Tussenvoegsel moet klasmetadata voorkomen als het al voldoende onderscheid geeft');
assert.strictEqual(samBLabel, 'Sam van Boer');

const alexALabel = createStudentDisplayName(students[5], students, classes);
const alexBLabel = createStudentDisplayName(students[6], students, classes);
assert.strictEqual(alexALabel, 'Alex de Wit (Structuur A)', 'Klas mag alleen zichtbaar worden bij werkelijk identieke volledige namen');
assert.strictEqual(alexBLabel, 'Alex de Wit (Structuur B)');

const studentMatches = buildStudentMatches(db, 'git');
assert.strictEqual(studentMatches.length, 2);
for (const match of studentMatches) {
  assert.deepStrictEqual(
    Object.keys(match).sort(),
    ['displayName', 'id', 'name', 'type'],
    'Publieke leerlingresultaten mogen alleen minimale selectievelden bevatten'
  );
  assert.strictEqual(match.type, 'student');
  assert.strictEqual(match.name, match.displayName);
  assert.ok(!Object.hasOwn(match, 'class'));
  assert.ok(!Object.hasOwn(match, 'grade'));
  assert.ok(!Object.hasOwn(match, 'username'));
  assert.ok(!Object.hasOwn(match, 'passwordHash'));
}
assert.strictEqual(studentMatches.some((entry) => entry.name === 'Gitte van Bakel'), false, 'Volledige leerlingnaam mag niet onnodig terugkomen');
const singleSpecificMatch = buildStudentMatches(db, 'bakel');
assert.strictEqual(singleSpecificMatch.length, 1);
assert.strictEqual(singleSpecificMatch[0].name, 'Gitte B.', 'Niet-matchende leerlingen mogen de zichtbare naam niet langer maken');
assert.strictEqual(buildStudentMatches(db, 'itte').length, 0);
assert.strictEqual(buildStudentMatches(db, 'mi').length, 0);
assert.strictEqual(buildStudentMatches(db, 'bo').some((entry) => entry.id === 'student-bo'), true);
assert.strictEqual(buildStudentMatches(db, 'de').length, 0, 'Veelvoorkomend tweeletter-tussenvoegsel mag niets opsommen');
assert.strictEqual(buildStudentMatches(db, 'van').length, 0, 'Los veelvoorkomend tussenvoegsel mag niets opsommen');

const nineMatchesDb = {
  students: [
    ['nina-a', 'Nina Aarts', 'Aarts'],
    ['nina-b', 'Nina Beks', 'Beks'],
    ['nina-c', 'Nina Cornelissen', 'Cornelissen'],
    ['nina-d', 'Nina Driessen', 'Driessen'],
    ['nina-e', 'Nina Evers', 'Evers'],
    ['nina-f', 'Nina Franssen', 'Franssen'],
    ['nina-g', 'Nina Gerrits', 'Gerrits'],
    ['nina-za', 'Nina Zaal', 'Zaal'],
    ['nina-zo', 'Nina Zoon', 'Zoon'],
  ].map(([id, name, lastName]) => ({ id, name, firstName: 'Nina', lastName })),
  classes: [],
};
const limitedNine = buildStudentMatches(nineMatchesDb, 'nin');
assert.strictEqual(limitedNine.length, 8);
assert.strictEqual(limitedNine.some((entry) => entry.id === 'nina-zo'), false, 'Negende match hoort niet teruggegeven te worden');
assert.strictEqual(
  limitedNine.find((entry) => entry.id === 'nina-za').name,
  'Nina Z.',
  'Een verborgen negende match mag het zichtbare label van resultaat acht niet beïnvloeden'
);

const staffMatches = buildStaffMatches(db, 'doc');
assert.deepStrictEqual(staffMatches, [
  { id: 'teacher-1', name: 'Docent Test', displayName: 'Docent Test', type: 'staff' },
]);
assert.strictEqual(buildStaffMatches(db, 'boe')[0].id, 'admin-1');
assert.strictEqual(buildStaffMatches(db, 'niet').length, 0, 'Niet-inlogbare rollen horen niet in de directory');

const limiter = new DirectoryRateLimiter({
  windowMs: 1000,
  browserMax: 2,
  networkMax: 3,
  globalMax: 5,
});
assert.strictEqual(limiter.checkAndRecord({ browserKey: 'a', networkKey: 'n1' }, 100).allowed, true);
assert.strictEqual(limiter.checkAndRecord({ browserKey: 'a', networkKey: 'n1' }, 200).allowed, true);
const browserLimited = limiter.checkAndRecord({ browserKey: 'a', networkKey: 'n1' }, 300);
assert.strictEqual(browserLimited.allowed, false);
assert.strictEqual(browserLimited.scope, 'browser');
assert.ok(browserLimited.retryAfterSeconds > 0);
assert.strictEqual(limiter.checkAndRecord({ browserKey: 'b', networkKey: 'n1' }, 300).allowed, true);
const networkLimited = limiter.checkAndRecord({ browserKey: 'c', networkKey: 'n1' }, 400);
assert.strictEqual(networkLimited.allowed, false);
assert.strictEqual(networkLimited.scope, 'network');
assert.strictEqual(limiter.checkAndRecord({ browserKey: 'c', networkKey: 'n2' }, 1200).allowed, true, 'Venster moet verlopen events opruimen');

console.log('Login-directory privacy core tests geslaagd.');
