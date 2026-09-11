import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // each file boots its own PGlite; keep them serial like bm-identity/bm-sales
    fileParallelism: false,
  },
});
