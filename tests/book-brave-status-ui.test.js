'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','public','admin-book-import-review.js'),'utf8');
assert.match(code,/window\.setInterval\(\(\) => \{/,
  'Brave status must refresh automatically without a full page reload');
assert.match(code,/if \(enrichmentExtra\.open && !document\.hidden\) void refreshBrave\(\);/,
  'Polling must run only while the relevant panel is open');
assert.doesNotMatch(code,/window\.setInterval\(refreshBrave, 10000\)/,
  'The former unconditional Brave timer must be replaced, not duplicated');
assert.equal((code.match(/if \(enrichmentExtra\.open && !document\.hidden\) void refreshBrave\(\);/g)||[]).length,1,
  'There must be a single guarded Brave status timer');
assert.match(code,/enrichmentExtra\.addEventListener\('toggle'/,
  'Opening the panel must fetch a fresh status immediately');
assert.match(code,/const ownLimitReached =/,
  'The local monthly application cap must be distinguished');
assert.match(code,/const providerLimitReached =/,
  'Provider-reported quota depletion must be distinguished');
assert.match(code,/Dit is niet hetzelfde als het geldtegoed in je Brave-account\./,
  'A zero app budget must never be presented as proven depletion of paid credits');
const from=code.indexOf('    function bravePauseReason(code) {');
const to=code.indexOf('    async function refreshBrave()',from);
assert.ok(from>0&&to>from,'Pause reason translator must exist');
const describe=new Function(code.slice(from,to)+'\nreturn bravePauseReason;')();
assert.match(describe('payment_required'),/betaaltegoed/,
  'Payment rejection should be explained clearly');
assert.match(describe('rate_limited'),/tijdelijk/,
  'Provider rate-limiting is not the same as permanently exhausted credits');
assert.match(describe('budget_exhausted'),/zoekbudget/,
  'A local limit must not be described as provider payment failure');
assert.match(describe('unauthorized'),/API-sleutel/,
  'An invalid key must be diagnosed without asking for paid credits');
assert.match(describe('unknown_test'),/onderbroken/,
  'Unknown reasons must be displayed without falsely claiming exhausted credits');
console.log('Brave status refresh, quota distinction and paused diagnostics checks passed.');
