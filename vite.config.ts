import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(dir, 'client'),
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        controller: resolve(dir, 'client/index.html'),
        tv: resolve(dir, 'client/tv.html'),
        musik: resolve(dir, 'client/musik.html'),
      },
    },
  },
});
