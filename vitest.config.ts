import { defineConfig } from 'vitest/config';

// The fast loop, unit and contract. Integration tests launch Chromium and the target app,
// so they run through vitest.integration.config.ts and npm run test:integration.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    environment: 'node',
  },
});
