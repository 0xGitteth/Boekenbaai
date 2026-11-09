// Unified visual design: keep the real Boekenbaai staff/student DOM and auth.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const staff = read('public/staff.html');
const student = read('public/index.html');
const css = read('public/portal-unified-v41.css');
const app = read('public/app.js');
const existing = read('public/catalog-v40.css');
const loginFlow = read('public/google-login-hint.js');
const googleRuntime = read('google-auth-runtime-preload.js');

const staffStylesheets = [...staff.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(x => x[1]);
const studentStylesheets = [...student.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(x => x[1]);
assert.equal(staffStylesheets.at(-1), 'portal-refine-v47.css');
assert.equal(studentStylesheets.at(-1), 'portal-refine-v47.css',
  'The shared nonredundant content and final layout layer must load on both portals');
assert.ok(student.indexOf('portal-student-compact-v44.css') > student.indexOf('portal-pr1-v43.css'));
assert.ok(staff.indexOf('catalog-v40.css') < staff.indexOf('portal-unified-v41.css'));
assert.ok(student.indexOf('student-v31.css') < student.indexOf('portal-unified-v41.css'));

assert.match(student, /class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(staff, /class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(student, /class="bb-student-wordmark-icon"/);
assert.doesNotMatch(student, /<img class="bb-student-school-logo"/,
  'The student masthead must not put the navy logo into a white box');
assert.match(staff, /class="bb-login-site-brand"/);
assert.match(staff, /class="bb-login-school-brand"/);
assert.match(staff, /class="bb-login-wordmark"/);
assert.match(staff, /class="bb-login-back" href="index.html">Terug naar leerlingen/);
assert.equal((staff.match(/id="login-form"/g)||[]).length,1);
assert.equal((staff.match(/id="login-name"/g)||[]).length,1);
assert.equal((staff.match(/id="login-password"/g)||[]).length,1);
assert.equal((staff.match(/id="login-suggestions"/g)||[]).length,1);
assert.equal((staff.match(/id="staff-meta"/g)||[]).length,1);
assert.match(app, /loginPanel\?\.classList\.toggle\('hidden', loggedIn\)/);
assert.match(loginFlow, /nameInput\.dataset\.selectedAccountId/,
  'Existing student/staff name-selection binding remains intact');
assert.match(googleRuntime, /html\.includes\('\/google-login-hint\.js'\)/,
  'Original runtime Google-login injection is unchanged');

assert.match(css, /:has\(#staff-login-panel:not\(\.hidden\)\)/,
  'Redesign must be restricted to the visible login, not the logged-in staff portal');
assert.match(css, /\.hero--staff \.hero__actions/);
assert.match(css, /#login-form button\[type="submit"\]:disabled/);
assert.match(css, /#login-form input:not\(\[type="checkbox"\]\):focus-visible/,
  'Text fields keep their high visibility focus without resizing checkbox controls');
assert.match(css, /#login-form input\[type="text"\],\s*body\[data-page="staff"\]:has\(#staff-login-panel:not\(\.hidden\)\) #login-form input\[type="password"\]/,
  'Large field styles apply only to the two legitimate text/password fields');
assert.doesNotMatch(css, /#login-form input \{\s*width:100%/,
  'The Google remember-me checkbox must keep its native, compact dimensions');
assert.match(css, /body\[data-page="staff"\] \.bb-login-site-brand \{\s*display:none;/);
assert.match(css, /body\[data-page="student"\] \.bb-student-school-brand/);
assert.match(css, /background-image:url\("logo\/het-dok-logo\.svg"\)/);
assert.match(css, /background:#ffffff20 url\("logo\/boekenbaai-book-mark-v31\.svg"\)/);
assert.doesNotMatch(css, /zoom\s*:|transform\s*:\s*scale\(/,
  'Real layout must not use CSS zoom or scaling to imitate the preview');

const forStudent = 'body[data-page="student"] #book-grid > .book-card';
const forStaff = 'body[data-page="staff"] .bb-catalog-v36 #book-grid > .book-card';
assert.ok(css.includes(forStudent) && css.includes(forStaff));
assert.match(css, /#book-grid > \.book-card--easy-reading \{\s*border:2px solid #19b99a;\s*outline:0;/,
  'Green badge is a single border around the complete card');
assert.match(css, /#book-grid \.book-card--easy-reading \.book-card__cover-wrapper \{\s*outline:0!important;/,
  'The former v41 cover-outline rule is intentionally superseded by v43 green-card hover');
assert.match(css, /#book-grid > \.book-card:hover \{/,
  'Matching whole-card hover effects apply to all roles');
assert.match(css, /#book-grid \.book-card:hover \.book-card__cover-wrapper,/,
  'Older staff hover must not re-introduce a cover-only band');
assert.match(css, /body\[data-page="staff"\] \.bb-catalog-v36 #book-grid > \.book-card \{\s*display:flex;[\s\S]*?width:100%;[\s\S]*?padding:12px;/,
  'Staff cards acquire the padded white card layout instead of cover-only frames');
assert.match(css, /aspect-ratio:2\/3;/,
  'Book cover geometry stays at the approved 2:3 ratio');
assert.match(css, /#book-grid \.book-card--exam-list::before \{display:none\}/,
  'Global exam marker should not duplicate the actual cover bookmark');
assert.match(css, /@media \(forced-colors:active\)/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /#book-grid > \.book-card:focus-visible \{\s*outline:3px solid #78a9e7;/,
  'Keyboard focus must remain visible separately from Makkelijk Lezen');
assert.match(existing,/forced-colors:active/,
  'Earlier Windows high-contrast regression remains present');

console.log('Boekenbaai unified portal branding, staff login and cards: OK.');
