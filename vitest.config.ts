import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'node:sqlite': fileURLToPath(new URL('./src/testing/nodeSqliteShim.ts', import.meta.url)),
    },
  },
});
