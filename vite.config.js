import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');
const outputRoot = resolve(projectRoot, 'dist');
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

const deployTarget = process.env.DEPLOY_TARGET;
const configuredBase = process.env.BOEKENBAAI_BASE_PATH || process.env.BOEKENBAAI_BASE || null;
const base = configuredBase ?? (deployTarget === 'gh-pages' ? '/Boekenbaai/' : '/');
const publicApiBase =
  process.env.BOEKENBAAI_PUBLIC_API_BASE || process.env.VITE_BOEKENBAAI_API_BASE || '';

function copyRuntimeAuthAssets() {
  return {
    name: 'boekenbaai-copy-runtime-auth-assets',
    apply: 'build',
    closeBundle() {
      mkdirSync(outputRoot, { recursive: true });
      for (const filename of runtimeAuthAssets) {
        copyFileSync(resolve(publicRoot, filename), resolve(outputRoot, filename));
      }
    },
  };
}

export default defineConfig({
  base,
  root: publicRoot,
  publicDir: false,
  plugins: [copyRuntimeAuthAssets()],
  define: {
    'import.meta.env.BOEKENBAAI_PUBLIC_API_BASE': JSON.stringify(publicApiBase),
    'import.meta.env.VITE_BOEKENBAAI_API_BASE': JSON.stringify(publicApiBase),
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(publicRoot, 'index.html'),
        staff: resolve(publicRoot, 'staff.html'),
      },
    },
  },
});
