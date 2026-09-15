import { defineConfig } from 'vitest/config';

// The thread as a caller runs it. Each file spawns a CLI as its own process against MERIDIAN
// Core on :4010, the port the committed allowlist names, so files run one at a time and a
// running npm run target makes the suite fail loudly on the port.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
