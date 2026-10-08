import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      { find: 'server-only', replacement: `${root}/tests/stubs/server-only.ts` },
    ],
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000, fileParallelism: false, silent: false }, // silent:false: show the accuracy and speed numbers on a green run
});
