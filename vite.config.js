import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');

const deployTarget = process.env.DEPLOY_TARGET;
const configuredBase = process.env.BOEKENBAAI_BASE_PATH || process.env.BOEKENBAAI_BASE || null;
const base = configuredBase ?? (deployTarget === 'gh-pages' ? '/Boekenbaai/' : '/');
const publicApiBase =
  process.env.BOEKENBAAI_PUBLIC_API_BASE || process.env.VITE_BOEKENBAAI_API_BASE || '';

export default defineConfig({
  base,
  root: publicRoot,
  publicDir: false,
  define: {
    'import.meta.env.BOEKENBAAI_PUBLIC_API_BASE': JSON.stringify(publicApiBase),
    'import.meta.env.VITE_BOEKENBAAI_API_BASE': JSON.stringify(publicApiBase),
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(publicRoot, 'index.html'),
        staff: resolve(publicRoot, 'staff.html'),
      },
    },
  },
});
