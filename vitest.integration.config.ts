import { defineConfig } from 'vitest/config';

// Each file starts its own target app on an ephemeral port and its own browser, so files
// run in parallel without sharing state.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
