'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pr-tests.yml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const nvmrc = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();

assert.strictEqual(
  Number(process.versions.node.split('.')[0]),
  24,
  'De test-suite moet op dezelfde Node 24 LTS-major draaien als productie.'
);
assert.strictEqual(nvmrc, '24', '.nvmrc moet Node 24 vastleggen.');
assert.match(dockerfile, /^FROM node:24-slim AS app$/m, 'Dockerproductie moet Node 24 gebruiken.');
assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\[\s*main\s*\]/, 'CI moet pull requests naar main testen.');
assert.match(workflow, /push:\s*\n\s*branches:\s*\[\s*main\s*\]/, 'CI moet elke push naar main opnieuw testen.');
assert.match(workflow, /uses:\s*actions\/checkout@v6/, 'CI moet checkout gebruiken met Node 24-runtime.');
assert.match(workflow, /uses:\s*actions\/setup-node@v6/, 'CI moet setup-node gebruiken met Node 24-runtime.');
assert.match(workflow, /node-version-file:\s*\.nvmrc/, 'CI moet dezelfde .nvmrc als productiebeleid gebruiken.');
assert.match(
  workflow,
  /npm audit --omit=dev --audit-level=high/,
  'CI moet high en critical productie-dependencykwetsbaarheden blokkeren.'
);
assert.match(workflow, /npm test/, 'CI moet de volledige testsuite draaien.');
assert.match(workflow, /npm run build/, 'CI moet de productiebuild draaien.');

console.log('Runtime/CI policytests geslaagd.');
