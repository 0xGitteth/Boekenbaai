'use strict';
const assert = require('node:assert/strict');
const {canonicalNavigationTarget, redirectCanonicalNavigation} =
  require('../canonical-domain-redirect');
const fs = require('node:fs');
const path = require('node:path');

const browser = (method, host, url, extras={}) =>
  ({method, headers:{host,...extras}, url});
const main = 'https://boekenbaai.nl';

assert.equal(canonicalNavigationTarget(browser('GET','www.boekenbaai.nl','/')),
  main+'/');
assert.equal(canonicalNavigationTarget(browser('GET','WWW.BOEKENBAAI.NL','/staff.html?tab=importeren&voorcontrole=1')),
  main+'/staff.html?tab=importeren&voorcontrole=1');
assert.equal(canonicalNavigationTarget(browser('HEAD','www.boekenbaai.nl:443','/student.html?klas=3')),
  main+'/student.html?klas=3');
assert.equal(canonicalNavigationTarget(browser('GET','boekenbaai.nl','/staff.html')),'');
assert.equal(canonicalNavigationTarget(browser('GET','boekenbaai.sliplane.app','/staff.html')),'');
assert.equal(canonicalNavigationTarget(browser('GET','fakeboekenbaai.nl','/')),'');
assert.equal(canonicalNavigationTarget(browser('GET','www.boekenbaai.nl.evil.test','/')),'');
assert.equal(canonicalNavigationTarget(browser('POST','www.boekenbaai.nl','/api/admin/school-sync/apply')),'');
assert.equal(canonicalNavigationTarget(browser('PATCH','www.boekenbaai.nl','/api/books/1')),'');
assert.equal(canonicalNavigationTarget(browser('DELETE','www.boekenbaai.nl','/api/books/1')),'');
assert.equal(canonicalNavigationTarget(browser('GET','www.boekenbaai.nl','/staff.html',{
  origin:'https://evil.example'})),main+'/staff.html');
const headers={};let ended=false;
const response={setHeader(key,val){headers[key]=val;},end(){ended=true;}};
assert.equal(redirectCanonicalNavigation(browser('GET','www.boekenbaai.nl','/staff.html?x=1'),response),true);
assert.equal(response.statusCode,308);
assert.equal(headers.Location,main+'/staff.html?x=1');
assert.equal(ended,true);
assert.equal(redirectCanonicalNavigation(browser('POST','www.boekenbaai.nl','/api/login'),{}),false);

const security=fs.readFileSync(path.join(__dirname,'..','google-auth-security-preload.js'),'utf8');
assert.match(security,/redirectCanonicalNavigation\(req, res\)/);
const where=security.indexOf('if (redirectCanonicalNavigation(req, res))');
assert.ok(where>security.indexOf('function wrapRequestListener') &&
  where<security.indexOf('const expectedOrigin = getExpectedOrigin'));
console.log('Canonical-domain navigation redirects preserve strict mutation protections.');
