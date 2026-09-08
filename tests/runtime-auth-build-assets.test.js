'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');
const runtimeAuthAssets = [
  'google-auth.css',
  'google-auth.js',
  'google-login-hint.js',
  'admin-modern.css',
  'admin-modern.js',
  'admin-google-links.js',
  'student-management.css',
  'student-management.js',
];

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCommand, ['run', 'build'], {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
});

assert.strictEqual(
  build.status,
  0,
  `Production build faalde.\nSTDOUT:\n${build.stdout || ''}\nSTDERR:\n${build.stderr || ''}`
);

for (const filename of runtimeAuthAssets) {
  const sourcePath = path.join(publicDir, filename);
  const builtPath = path.join(distDir, filename);
  assert.ok(
    fs.existsSync(builtPath),
    `${filename} moet als los runtimebestand in dist aanwezig zijn`
  );
  assert.strictEqual(
    fs.readFileSync(builtPath, 'utf8'),
    fs.readFileSync(sourcePath, 'utf8'),
    `${filename} in dist moet exact overeenkomen met de runtimebron`
  );
}

console.log('Runtime Google-auth en beheer-assets build test geslaagd.');
