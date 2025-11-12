import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');

const deployTarget = process.env.DEPLOY_TARGET;
const configuredBase = process.env.BOEKENBAAI_BASE_PATH || process.env.BOEKENBAAI_BASE || null;
const base = configuredBase ?? (deployTarget === 'gh-pages' ? '/Boekenbaai/' : '/');

export default defineConfig({
  base,
  root: publicRoot,
  publicDir: false,
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
