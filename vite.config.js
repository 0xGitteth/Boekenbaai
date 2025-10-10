import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');

export default defineConfig({
  base: '/Boekenbaai/',
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
