import { defineConfig } from 'vitest/config';

// Server-side integration tests run in Node against a real Postgres (the app
// connects via DATABASE_URL). Kept separate from the jsdom frontend suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    fileParallelism: false, // tests share one database; run serially
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
